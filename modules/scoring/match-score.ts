/**
 * Match Score · D.5
 *
 * Per-lead, per-list ranking. Within a list, how strongly does this
 * particular business match the list's filter spec? Surfaced as:
 *
 *   - The numeric column `Lead.matchScore` (Float, 0–100). The agency
 *     list-detail view (F.3) sorts on this; the prospect view (F.4)
 *     renders the breakdown's `contributions` as "Why this lead qualifies".
 *   - The cron-side ranking step in list-refresh (C.8 / C.9): after the
 *     Hunter evaluator decides who's in the list, this module decides who
 *     bubbles to the top.
 *
 * The score is intentionally simple to keep it explainable to Tom:
 *
 *   matchRatio   = matched filter rows / total filter rows          (0–1)
 *   quality      = (mapslyScore ?? 5) / 10                          (0–1)
 *   score        = matchRatio × MATCH_SCORE_MAX × (QUALITY_FLOOR + QUALITY_LIFT × quality)
 *
 * QUALITY_FLOOR = 0.5 → a low-quality biz with 100% match still scores 50.
 * QUALITY_LIFT  = 0.5 → a high-quality biz with 100% match scores 100.
 *
 * Exclusions short-circuit: if ANY exclusion row matches, the score is 0
 * (the business shouldn't be in the list in the first place — but match
 * score is a safety net for stale Lead rows after spec edits).
 *
 * Mapsly Score is an OPTIONAL quality multiplier — when missing we use the
 * neutral midpoint (5/10) so the score still ranks by match-ratio. This
 * matters for new businesses whose latest BusinessSnapshot row may not
 * have a populated `mapslyScore` yet.
 *
 * Invariants enforced by tests:
 *   1. Excluded → score === MATCH_SCORE_MIN (= 0).
 *   2. Zero filter rows → score === MATCH_SCORE_MIN (no signal = no rank).
 *   3. All match + perfect quality → score === MATCH_SCORE_MAX (= 100).
 *   4. All match + zero quality → score === MATCH_SCORE_MAX × QUALITY_FLOOR.
 *   5. score ∈ [0, MATCH_SCORE_MAX] for any input (NaN / Infinity /
 *      negative mapslyScore are clamped defensively).
 *   6. rankByMatchScore is stable (ties broken by mapslyScore desc, then id asc).
 *   7. Spec normalization: undefined `rows` and `exclusions` arrays are
 *      treated as empty (lenient JSON read, same as the Hunter evaluator).
 *
 * See:
 *   - PLAN.md §"D.5 Match score" — task description
 *   - .claude/rules/signal-engineering.md — signal vocabulary
 *   - .claude/rules/testing.md §"Signal scoring" — 100% coverage required
 *   - prisma/schema.prisma `Lead.matchScore` — persistence
 *   - modules/hunter/evaluate.ts — the per-row evaluator we delegate to
 */

import {
  evaluateSpecWithTrace,
  type EvaluationRow,
  type FilterSpec,
  type RowVerdictTrace,
} from "@/modules/hunter";
import { getSignal } from "@/modules/signals";

/** Score range. Clamped on both ends. */
export const MATCH_SCORE_MIN = 0;
export const MATCH_SCORE_MAX = 100;

/**
 * The "floor" share of the score that pure match-ratio earns regardless
 * of business quality. With QUALITY_FLOOR = 0.5 a 100%-match business
 * scores at least 50 even if it has the worst Mapsly Score on record.
 *
 * Rationale: in a Hunter list, the most relevant signal is "does this
 * business match the filters I tuned?". Mapsly Score is the secondary
 * tie-breaker. We never want a higher-quality but worse-fitting business
 * to outrank a lower-quality but perfectly-fitting one.
 */
export const QUALITY_FLOOR = 0.5;

/**
 * The "lift" share of the score earned by Mapsly Score. With QUALITY_LIFT
 * = 0.5 a 100%-match + perfect-quality business hits 100; the same match
 * ratio with zero quality hits 50. Always: QUALITY_FLOOR + QUALITY_LIFT
 * === 1 (asserted at module load).
 */
export const QUALITY_LIFT = 0.5;

/**
 * Neutral Mapsly Score used when a business has no snapshot yet. Chosen
 * as the midpoint of [0, MAPSLY_SCORE_MAX (= 10)] so unscored businesses
 * neither penalize nor benefit from the quality multiplier.
 */
export const NEUTRAL_MAPSLY_SCORE = 5;

// Self-check: floor + lift MUST sum to 1 so the formula's range is
// [QUALITY_FLOOR, 1.0] in the multiplier domain.
{
  const total = QUALITY_FLOOR + QUALITY_LIFT;
  if (Math.abs(total - 1) > 1e-9) {
    throw new Error(
      `[match-score] QUALITY_FLOOR + QUALITY_LIFT must sum to 1; got ${total}. ` +
        `Edit modules/scoring/match-score.ts to keep them in balance.`,
    );
  }
}

/**
 * Defensive clamp to [0, 1]. Mirrors `sub-scores.clamp01` but local — we
 * don't want match-score's quality normalization to silently drift if the
 * sub-scores module ever changes semantics.
 */
function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return MATCH_SCORE_MIN;
  if (n < MATCH_SCORE_MIN) return MATCH_SCORE_MIN;
  if (n > MATCH_SCORE_MAX) return MATCH_SCORE_MAX;
  return n;
}

/**
 * Per-signal contribution to the final score. Sorted by `contribution`
 * descending in `MatchScoreBreakdown.contributions`. The prospect view
 * renders the top N as "Why this lead qualifies" wedges.
 */
export interface MatchScoreContribution {
  /** Stable key from the signal registry — matches the FilterRow.signalKey. */
  readonly signalKey: string;
  /**
   * Human-readable label from the signal registry's `label` field, or the
   * signalKey if the registry has no entry (defensive — should be rare).
   */
  readonly label: string;
  /** True if this row's comparator matched. False otherwise. */
  readonly matched: boolean;
  /**
   * True if this row is an exclusion (lives in `spec.exclusions`).
   * Excluded matches contribute 0 to the score (and trigger excluded=true);
   * unmatched exclusions contribute 0 either.
   */
  readonly isExclusion: boolean;
  /**
   * Contribution to the final score in [0, MATCH_SCORE_MAX]. Equal-weighted
   * across all non-exclusion rows in this MVP: every matched row
   * contributes `MATCH_SCORE_MAX / totalCount × qualityMultiplier`.
   * The shape leaves room for per-signal weighting later (signal-engineering.md
   * already reserves `costPerRefreshUsd` and could reserve `matchWeight`).
   */
  readonly contribution: number;
}

/**
 * The full breakdown returned by {@link computeMatchScore}. The cron path
 * stores only `.score` on `Lead.matchScore`; the prospect view re-derives
 * the breakdown on demand from the latest EvaluationRow + spec.
 */
export interface MatchScoreBreakdown {
  /** Final 0–100 score (clamped). 0 if excluded or no filter rows. */
  readonly score: number;
  /** Matched rows / total rows in [0, 1]. 0 if total === 0 or excluded. */
  readonly matchRatio: number;
  /** Count of matched non-exclusion rows. */
  readonly matchedCount: number;
  /** Count of non-exclusion rows considered. */
  readonly totalCount: number;
  /** True iff at least one exclusion row matched. */
  readonly excluded: boolean;
  /** Mapsly Score actually used (after null → NEUTRAL fallback + clamp). */
  readonly mapslyScoreUsed: number;
  /**
   * Per-row contributions sorted by `contribution` desc (matched first),
   * then by `signalKey` ascending for stable order on ties.
   */
  readonly contributions: readonly MatchScoreContribution[];
}

/**
 * Input to {@link computeMatchScore}. Mirrors the Hunter evaluator's
 * `EvaluationRow` shape so callers can pass the same object they
 * already built for `evaluateSpec`.
 */
export interface MatchScoreInput {
  readonly row: EvaluationRow;
  readonly spec: FilterSpec;
  /**
   * Mapsly Score in [0, 10]. null/undefined → NEUTRAL_MAPSLY_SCORE fallback.
   * Out-of-range values are clamped (negative → 0, > 10 → 10).
   */
  readonly mapslyScore?: number | null;
}

/**
 * Compute a single business's match score against a list's filter spec.
 *
 * Two-step delegation: we call {@link evaluateSpecWithTrace} from the
 * Hunter module to get per-row match verdicts (DRY — don't re-implement
 * comparator semantics), then aggregate into a 0–100 score weighted by
 * Mapsly Score.
 */
export function computeMatchScore(input: MatchScoreInput): MatchScoreBreakdown {
  const { row, spec } = input;

  // 1. Normalize Mapsly Score to a quality multiplier in [0, 1].
  //    Out-of-range / non-finite / null falls back to NEUTRAL.
  const mapslyScoreUsed = clampMapslyScore(input.mapslyScore);
  const quality = mapslyScoreUsed / 10; // 0..1
  const qualityMultiplier = QUALITY_FLOOR + QUALITY_LIFT * clampUnit(quality);

  // 2. Delegate to the Hunter evaluator for per-row verdicts.
  const verdict = evaluateSpecWithTrace(row, spec);
  const trace = verdict.trace ?? [];

  // 3. Partition into exclusion vs. ordinary rows.
  const exclusionTraces = trace.filter((t) => t.isExclusion);
  const rowTraces = trace.filter((t) => !t.isExclusion);

  const excluded = exclusionTraces.some((t) => t.matched);
  const totalCount = rowTraces.length;
  const matchedCount = rowTraces.filter((t) => t.matched).length;

  // 4. Score arithmetic.
  //    - If excluded: score = 0 (do NOT credit any match).
  //    - If no rows considered: score = 0 (cannot meaningfully rank).
  //    - Else: matchRatio × MAX × qualityMultiplier.
  const matchRatio =
    excluded || totalCount === 0 ? 0 : matchedCount / totalCount;
  const scoreRaw =
    excluded || totalCount === 0
      ? 0
      : matchRatio * MATCH_SCORE_MAX * qualityMultiplier;
  const score = clampScore(scoreRaw);

  // 5. Per-signal contributions for the UI. Each matched ordinary row
  //    earns (MAX × qualityMultiplier / totalCount); unmatched earns 0.
  //    Exclusion rows always contribute 0 (their effect is binary on `excluded`).
  const perRowValue =
    excluded || totalCount === 0
      ? 0
      : (MATCH_SCORE_MAX * qualityMultiplier) / totalCount;
  const contributions = buildContributions(trace, perRowValue, excluded);

  return {
    score,
    matchRatio,
    matchedCount,
    totalCount,
    excluded,
    mapslyScoreUsed,
    contributions,
  };
}

/** Normalize a Mapsly Score input to a clean number in [0, 10]. */
function clampMapslyScore(n: number | null | undefined): number {
  if (n == null || !Number.isFinite(n)) return NEUTRAL_MAPSLY_SCORE;
  if (n < 0) return 0;
  if (n > 10) return 10;
  return n;
}

function buildContributions(
  trace: readonly RowVerdictTrace[],
  perRowValue: number,
  excluded: boolean,
): readonly MatchScoreContribution[] {
  const contributions: MatchScoreContribution[] = trace.map((t) => {
    const def = getSignal(t.signalKey);
    const isExclusion = t.isExclusion;
    // Exclusions contribute 0. Unmatched contribute 0. Matched contribute perRowValue.
    // If the whole spec is excluded, even matched non-exclusion rows contribute 0
    // because the score is 0 — but we DO mark them matched=true so the UI can
    // still show "would have matched this signal, but excluded by X".
    const contribution =
      isExclusion || !t.matched || excluded ? 0 : perRowValue;
    return {
      signalKey: t.signalKey,
      label: def?.label ?? t.signalKey,
      matched: t.matched,
      isExclusion,
      contribution,
    };
  });

  // Stable sort: contribution desc, then signalKey asc.
  contributions.sort((a, b) => {
    if (b.contribution !== a.contribution) {
      return b.contribution - a.contribution;
    }
    return a.signalKey.localeCompare(b.signalKey);
  });

  return Object.freeze(contributions);
}

/**
 * Convenience: compute match score for an evaluation row using a raw
 * `mapslyScore` Number column read straight from BusinessSnapshot. Just a
 * thin wrapper that hides the field name for callers reading from Prisma
 * shape (sql columns).
 */
export function computeMatchScoreFromSnapshot(args: {
  readonly row: EvaluationRow;
  readonly spec: FilterSpec;
  readonly snapshot:
    | { readonly mapslyScore?: number | null }
    | null
    | undefined;
}): MatchScoreBreakdown {
  return computeMatchScore({
    row: args.row,
    spec: args.spec,
    mapslyScore: args.snapshot?.mapslyScore ?? null,
  });
}

/**
 * Ranked result for a single evaluation row. Returned by
 * {@link rankByMatchScore}.
 */
export interface RankedMatch {
  readonly id: string;
  readonly score: number;
  readonly breakdown: MatchScoreBreakdown;
}

/**
 * Optional per-row override of the Mapsly Score (e.g. when ranking
 * against a snapshot table by ID). If a row's id is missing here, falls
 * back to NEUTRAL.
 */
export interface RankByMatchScoreOptions {
  readonly mapslyScores?: ReadonlyMap<string, number | null>;
  /**
   * Drop excluded rows from the output. Default `false` — they're kept
   * with `score === 0` so the cron-side delta logic can still see them.
   */
  readonly dropExcluded?: boolean;
}

/**
 * Rank a batch of evaluation rows by match score (descending).
 *
 * Stable tie-break order:
 *   1. score desc
 *   2. mapslyScoreUsed desc (so higher-quality wins on equal match ratio)
 *   3. id asc (so the order is reproducible across calls)
 *
 * O(n log n) over input length. Allocates one breakdown per row — keep
 * the input array bounded (the cron-side list refresh handler already
 * batches at ~200 rows per cron tick).
 */
export function rankByMatchScore(
  rows: readonly EvaluationRow[],
  spec: FilterSpec,
  options: RankByMatchScoreOptions = {},
): RankedMatch[] {
  const ranked: RankedMatch[] = rows.map((row) => {
    const breakdown = computeMatchScore({
      row,
      spec,
      mapslyScore: options.mapslyScores?.get(row.id) ?? null,
    });
    return { id: row.id, score: breakdown.score, breakdown };
  });

  const filtered = options.dropExcluded
    ? ranked.filter((r) => !r.breakdown.excluded)
    : ranked;

  filtered.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aq = a.breakdown.mapslyScoreUsed;
    const bq = b.breakdown.mapslyScoreUsed;
    if (bq !== aq) return bq - aq;
    return a.id.localeCompare(b.id);
  });

  return filtered;
}
