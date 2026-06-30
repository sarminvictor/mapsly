// modules/agency-portal/discover/discovery-signals.ts · the SERIALIZATION
// bridge between the goal step's active signal set and the workbench evaluator.
//
// THE THREAD THIS COMPLETES (P3).
//   GoalState.filters (the working goal — GoalFilter[] with on/tune/conds/match)
//     → PERSIST the active (on:true) ones to Discovery.signalsJson on run
//     → at the workbench, READ signalsJson, rebuild ActiveSignal[] via SIG_META,
//       hydrate the businesses once, and resolveMatches per lead for a REAL
//       match% + per-signal verdicts — replacing the pain-count heuristic.
//
// This module is pure + DB-free so the round-trip (GoalFilter → JSON → Active
// signal) is unit-testable. The DB work (hydrate + persist) lives in the page /
// the discovery action; this only shapes the data.
//
// SHAPE (Discovery.signalsJson):
//   { signals: Array<{ key: string; tune?: SignalTuneValue;
//                      conds?: Record<string,boolean>; match?: "all"|"any" }> }
// Only the ACTIVE (on:true) filters are persisted; `tune`/`conds`/`match` are
// included only where the goal set them. The `key` is the SIG_META key — the
// comparator/value/registryKey are NOT stored (they come from SIG_META at read
// time, so a registry tweak doesn't strand an old discovery on a stale binding).

import type { ActiveSignal } from "./signal-eval";
import { SIG_META } from "./goal-templates";
import type { SignalTuneValue } from "./flow-types";

/**
 * One persisted goal signal on `Discovery.signalsJson`. The minimal, forward-
 * compatible record: the SIG_META key plus the user's chosen tune / per-condition
 * toggles / combine mode (only where set). Everything else (registryKey,
 * comparator, value) is re-derived from SIG_META at read time.
 */
export interface PersistedSignal {
  /** SIG_META key (e.g. "diy_platform"). */
  key: string;
  /** The chosen tune-control value (omitted when the goal left the default). */
  tune?: SignalTuneValue;
  /** Composite per-condition include toggles (recipe-line index → on). */
  conds?: Record<string, boolean>;
  /** Composite combine mode ("all" / "any"). */
  match?: "all" | "any";
}

/** The `Discovery.signalsJson` payload. */
export interface DiscoverySignals {
  signals: PersistedSignal[];
}

/** A goal filter as it lives in the working GoalState (the shape we persist FROM). */
export interface GoalFilterLike {
  key: string;
  on: boolean;
  tune?: SignalTuneValue;
  conds?: Record<string, boolean>;
  match?: "all" | "any";
}

/**
 * Build the persisted payload from the working goal filters. Keeps ONLY the
 * active (on:true) filters and only the tune/conds/match fields the goal set —
 * so the stored JSON is the minimal serializable record of "what the research's
 * signals were". Returns `{ signals: [] }` when nothing is active (the caller
 * may then choose to store null and fall back to the heuristic).
 */
export function buildDiscoverySignals(
  filters: readonly GoalFilterLike[],
): DiscoverySignals {
  const signals: PersistedSignal[] = [];
  for (const f of filters) {
    if (!f.on) continue;
    const entry: PersistedSignal = { key: f.key };
    if (f.tune) entry.tune = f.tune;
    if (f.conds) entry.conds = f.conds;
    if (f.match) entry.match = f.match;
    signals.push(entry);
  }
  return { signals };
}

/**
 * Parse an arbitrary `Discovery.signalsJson` value (untyped `Prisma.JsonValue`)
 * into the typed payload, defensively. Returns `null` when the value is absent
 * or malformed — the caller treats null as "no persisted signals → fall back to
 * the pain-count heuristic" so an older/empty discovery never breaks.
 */
export function parseDiscoverySignals(raw: unknown): DiscoverySignals | null {
  if (!raw || typeof raw !== "object") return null;
  const arr = (raw as { signals?: unknown }).signals;
  if (!Array.isArray(arr)) return null;
  const signals: PersistedSignal[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const key = (item as { key?: unknown }).key;
    if (typeof key !== "string" || key.length === 0) continue;
    const entry: PersistedSignal = { key };
    const tune = (item as { tune?: unknown }).tune;
    if (isTune(tune)) entry.tune = tune;
    const conds = (item as { conds?: unknown }).conds;
    if (isCondMap(conds)) entry.conds = conds;
    const match = (item as { match?: unknown }).match;
    if (match === "all" || match === "any") entry.match = match;
    signals.push(entry);
  }
  return { signals };
}

/**
 * Map persisted signals → the evaluator's {@link ActiveSignal}[]. Each persisted
 * `{ key, tune?, conds?, match? }` is merged with its SIG_META entry: the
 * `registryKey` + `comparator` + `value` come from SIG_META (so the binding is
 * always current), the `tune`/`conds`/`match` come from the persisted record
 * (the user's thresholds). A persisted key with no SIG_META entry is dropped
 * (the evaluator would return null for it anyway — we skip it cleanly).
 *
 * Pure: no DB, no SIG_META mutation. The resulting ActiveSignal[] is exactly
 * what `resolveMatches(activeSignals, hydratedBusiness)` consumes.
 */
export function toActiveSignals(
  signals: readonly PersistedSignal[],
): ActiveSignal[] {
  const out: ActiveSignal[] = [];
  for (const s of signals) {
    const meta = SIG_META[s.key];
    if (!meta) continue; // unknown SIG_META key — nothing to evaluate
    out.push({
      key: s.key,
      registryKey: meta.registryKey,
      comparator: meta.comparator,
      value: meta.value,
      ...(s.tune ? { tune: s.tune } : {}),
      ...(s.conds ? { conds: s.conds } : {}),
      ...(s.match ? { match: s.match } : {}),
    });
  }
  return out;
}

/**
 * One-shot helper: parse `Discovery.signalsJson` and build the ActiveSignal[].
 * Returns `[]` when there are no persisted signals — the workbench treats an
 * empty result as "fall back to the heuristic" (same as a null signalsJson).
 */
export function activeSignalsFromJson(raw: unknown): ActiveSignal[] {
  const parsed = parseDiscoverySignals(raw);
  if (!parsed) return [];
  return toActiveSignals(parsed.signals);
}

// ── Defensive type guards (the JSON came off the wire / DB — never trust it) ──

function isTune(v: unknown): v is SignalTuneValue {
  if (!v || typeof v !== "object") return false;
  const kind = (v as { kind?: unknown }).kind;
  switch (kind) {
    case "strictness": {
      const lvl = (v as { level?: unknown }).level;
      return lvl === "loose" || lvl === "balanced" || lvl === "strict";
    }
    case "scale":
      return Array.isArray((v as { bands?: unknown }).bands);
    case "mode":
      return typeof (v as { value?: unknown }).value === "string";
    case "platform":
      return Array.isArray((v as { values?: unknown }).values);
    case "presence": {
      const val = (v as { value?: unknown }).value;
      return val === "has" || val === "hasnt";
    }
    default:
      return false;
  }
}

function isCondMap(v: unknown): v is Record<string, boolean> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  return Object.values(v as Record<string, unknown>).every(
    (x) => typeof x === "boolean",
  );
}
