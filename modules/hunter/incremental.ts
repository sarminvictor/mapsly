/**
 * Hunter filter evaluation · incremental refresh helpers · D.4
 *
 * The eval engine is pure (`evaluate.ts`); this module is its
 * "what changed since last refresh?" companion.
 *
 * Production flow:
 *   1. The list-refresh cron loads `List.filterJson`.
 *   2. {@link describeSpec} tells the cron which Prisma models to query
 *      (so we don't re-fetch unused relations).
 *   3. The cron checks {@link Business.lastRefreshedAt} (and related
 *      timestamps on snapshots / Lighthouse audits) vs the list's
 *      last refresh time. Only changed rows are re-hydrated.
 *   4. The cron evaluates the spec against the changed rows + the prior
 *      `Lead.businessId` set, then calls {@link computeRefreshDelta} to
 *      decide what to insert / update / hide.
 *
 * Everything here is pure. No Prisma imports. Tests can exercise the full
 * delta logic without a database.
 */

import { getSignal } from "@/modules/signals/registry";
import type { SignalCadence, SignalDefinition } from "@/modules/signals/types";

import { isKnownModel, parseColumnRef } from "./evaluate";
import type { FilterSpec, ModelName, RefreshDelta } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Spec → models / cadence summary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Summary of a {@link FilterSpec} useful for refresh planning.
 *
 * - `models`: Prisma model names referenced by any signal in the spec.
 *   The cron can scope its `findMany` to only these tables.
 * - `cadences`: refresh cadences referenced. Use the strictest one to
 *   decide how often the list itself needs to refresh.
 * - `unknownSignalKeys`: keys in the spec that are not in the registry.
 *   Surface to the dashboard as "stale filter" warnings.
 */
export interface SpecSummary {
  readonly models: ReadonlySet<ModelName>;
  readonly cadences: ReadonlySet<SignalCadence>;
  readonly unknownSignalKeys: readonly string[];
}

/** Inspect the spec and report which models + cadences it depends on. */
export function describeSpec(spec: FilterSpec): SpecSummary {
  const models = new Set<ModelName>();
  const cadences = new Set<SignalCadence>();
  const unknownKeys: string[] = [];

  const allRows = [...(spec.rows ?? []), ...(spec.exclusions ?? [])];

  for (const row of allRows) {
    const signal: SignalDefinition | undefined = getSignal(row.signalKey);
    if (!signal) {
      unknownKeys.push(row.signalKey);
      continue;
    }
    const ref = parseColumnRef(signal.column);
    if (ref && isKnownModel(ref.model)) {
      models.add(ref.model);
    }
    cadences.add(signal.cadence);
  }

  return {
    models,
    cadences,
    unknownSignalKeys: unknownKeys,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cadence ordering
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cadence priority (lower = more frequent / stricter refresh demand).
 * Used by {@link strictestCadence} to pick the refresh interval for a
 * list given a spec that mixes signals of different cadences.
 */
export const CADENCE_RANK: Record<SignalCadence, number> = {
  "on-demand": 0,
  daily: 1,
  weekly: 2,
  monthly: 3,
  static: 4,
};

/**
 * Return the strictest cadence among the given set. If the set is empty,
 * defaults to `"weekly"` — the platform's baseline refresh tier.
 *
 * "Strictest" here means most frequent: `on-demand < daily < weekly < monthly < static`.
 */
export function strictestCadence(
  cadences: Iterable<SignalCadence>,
): SignalCadence {
  let best: SignalCadence | null = null;
  for (const c of cadences) {
    if (best === null || CADENCE_RANK[c] < CADENCE_RANK[best]) {
      best = c;
    }
  }
  return best ?? "weekly";
}

// ─────────────────────────────────────────────────────────────────────────────
// Refresh delta
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Given the prior matching set and the newly computed matching set,
 * produce the delta. Output arrays are sorted by ID for stability —
 * the Hunter UI shows them in deterministic order across reloads.
 */
export function computeRefreshDelta(
  prev: Iterable<string>,
  next: Iterable<string>,
): RefreshDelta {
  const prevSet = toSet(prev);
  const nextSet = toSet(next);

  const added: string[] = [];
  const removed: string[] = [];
  const stable: string[] = [];

  for (const id of nextSet) {
    if (prevSet.has(id)) stable.push(id);
    else added.push(id);
  }
  for (const id of prevSet) {
    if (!nextSet.has(id)) removed.push(id);
  }

  added.sort();
  removed.sort();
  stable.sort();

  return { added, removed, stable };
}

function toSet(it: Iterable<string>): Set<string> {
  return it instanceof Set ? it : new Set(it);
}

// ─────────────────────────────────────────────────────────────────────────────
// Change detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shape we need from a business + its relations to decide whether it could
 * have changed since the last refresh. Mirrors the timestamp fields on the
 * Prisma models but typed loosely so the cron can pass partial selects.
 *
 * Pass the latest snapshot/lighthouse rows only — older rows can't impact
 * "newer than" comparisons because they've already been considered.
 */
export interface ChangeCandidate {
  readonly id: string;
  readonly business?: {
    readonly lastRefreshedAt?: Date | string | null;
    readonly updatedAt?: Date | string | null;
  } | null;
  readonly snapshot?: {
    readonly snapshotDate?: Date | string | null;
  } | null;
  readonly lighthouseAudit?: {
    readonly auditedAt?: Date | string | null;
  } | null;
  readonly latestReviewAt?: Date | string | null;
  readonly latestSerpAt?: Date | string | null;
  readonly latestAdLibraryAt?: Date | string | null;
}

/**
 * Decide whether a candidate has any relation newer than `since`. Models
 * not referenced in `relevantModels` are ignored — pass
 * `describeSpec(spec).models` to scope the check to what the filter needs.
 *
 * - `since === null` (first refresh ever): all candidates are "changed".
 * - Missing timestamps are treated as "not newer" (won't trigger). The
 *   cron's initial seed should pass `since=null` to backfill.
 */
export function hasChangedSince(
  candidate: ChangeCandidate,
  since: Date | string | null,
  relevantModels: ReadonlySet<ModelName>,
): boolean {
  if (since === null) return true;
  const sinceMs = toEpochMs(since);
  if (sinceMs === null) return true; // malformed since → don't filter out

  if (relevantModels.has("Business")) {
    if (newer(candidate.business?.lastRefreshedAt, sinceMs)) return true;
    if (newer(candidate.business?.updatedAt, sinceMs)) return true;
  }
  if (
    relevantModels.has("BusinessSnapshot") &&
    newer(candidate.snapshot?.snapshotDate, sinceMs)
  ) {
    return true;
  }
  if (
    relevantModels.has("LighthouseAudit") &&
    newer(candidate.lighthouseAudit?.auditedAt, sinceMs)
  ) {
    return true;
  }
  if (
    relevantModels.has("Review") &&
    newer(candidate.latestReviewAt, sinceMs)
  ) {
    return true;
  }
  if (
    relevantModels.has("SerpResult") &&
    newer(candidate.latestSerpAt, sinceMs)
  ) {
    return true;
  }
  if (
    relevantModels.has("AdLibraryEntry") &&
    newer(candidate.latestAdLibraryAt, sinceMs)
  ) {
    return true;
  }

  return false;
}

/**
 * Filter `candidates` to the ones with changes since `since` relevant to
 * the spec. The result is the working set the evaluator needs to re-run on.
 *
 * Unchanged candidates inherit their prior verdict (in/out of the matching
 * set), so the cron only persists deltas for the working set.
 */
export function selectChangedCandidates(
  candidates: readonly ChangeCandidate[],
  since: Date | string | null,
  spec: FilterSpec,
): ChangeCandidate[] {
  const { models } = describeSpec(spec);
  return candidates.filter((c) => hasChangedSince(c, since, models));
}

function newer(
  value: Date | string | null | undefined,
  sinceMs: number,
): boolean {
  const ms = toEpochMs(value);
  return ms !== null && ms > sinceMs;
}

function toEpochMs(value: Date | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === "string") {
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : null;
  }
  return null;
}
