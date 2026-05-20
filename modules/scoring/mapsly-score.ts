/**
 * Mapsly Score · D.2
 *
 * The headline number on Maria's dashboard ("6.2/10") and the primary sort
 * key on Tom's prospect tables. A 6-dimensional weighted composite of
 * pre-normalized sub-scores.
 *
 * The composite is intentionally simple: weighted average, scaled to a
 * 0–10 range. Sophistication lives in the sub-score derivations
 * (`sub-scores.ts`) and in Match Score (D.5, per-list per-prospect).
 *
 * Invariants enforced by tests:
 *   1. WEIGHTS sum to exactly 1.0.
 *   2. all-zero sub-scores → score = 0.
 *   3. all-one sub-scores → score = 10.
 *   4. score is always in [0, 10] for any input shape, including NaN /
 *      Infinity / negative / above-1 sub-scores.
 *   5. each dimension contributes (weight × 10) to the total when isolated.
 *
 * See:
 *   - CLAUDE.md §"Mapsly Score" — product contract
 *   - .claude/rules/testing.md §"Signal scoring" — required coverage
 *   - prisma/schema.prisma `BusinessSnapshot.mapslyScore` — persistence
 */

import { clamp01 } from "./sub-scores";
import {
  MAPSLY_SCORE_DIMENSIONS,
  type MapslyScoreDimension,
  type MapslyScoreSubScores,
} from "./types";

/**
 * Score range bounds. Inclusive on both ends. The composite function
 * clamps to these.
 */
export const MAPSLY_SCORE_MIN = 0;
export const MAPSLY_SCORE_MAX = 10;

/**
 * Dimension weights · MUST SUM TO 1.0 (asserted at module load and in
 * the unit tests).
 *
 * Rationale:
 *   - Reputation is the largest because consumer trust gates everything
 *     else. A 5-star business with 1000 reviews wins customers even with
 *     a slow website.
 *   - Brand presence is second because in 2026 a local business without a
 *     working website + ads + schema is invisible to most discovery paths.
 *   - Communication / Profile / Trust are middle-tier — necessary but
 *     not differentiating.
 *   - Pricing transparency is smallest but non-zero — it correlates with
 *     conversion intent and is easy to fix (Maria can add prices in 10
 *     minutes).
 *
 * Adjust here, never inline. The `process-enhancer` agent monitors score
 * distributions and may surface "weights drift" signals for tuning.
 */
export const MAPSLY_SCORE_WEIGHTS: Readonly<
  Record<MapslyScoreDimension, number>
> = Object.freeze({
  reputation: 0.25,
  communication: 0.15,
  profileCompleteness: 0.15,
  trust: 0.15,
  pricingTransparency: 0.1,
  brandPresence: 0.2,
});

// Self-check: weights must sum to 1.0 (within floating-point tolerance).
{
  const total = MAPSLY_SCORE_DIMENSIONS.reduce(
    (acc, dim) => acc + MAPSLY_SCORE_WEIGHTS[dim],
    0,
  );
  if (Math.abs(total - 1) > 1e-9) {
    throw new Error(
      `[mapsly-score] MAPSLY_SCORE_WEIGHTS must sum to 1.0; got ${total}. ` +
        `Edit modules/scoring/mapsly-score.ts and adjust to balance.`,
    );
  }
}

/**
 * Compute the 0–10 Mapsly Score from pre-normalized 0–1 sub-scores.
 *
 * Sub-scores outside [0, 1] are clamped (defensive against bad upstream
 * data). NaN / Infinity collapse to 0.
 *
 * Pure function, no side effects, no I/O. Safe to call from anywhere.
 */
export function computeMapslyScore(subScores: MapslyScoreSubScores): number {
  let weighted = 0;
  for (const dim of MAPSLY_SCORE_DIMENSIONS) {
    weighted += clamp01(subScores[dim]) * MAPSLY_SCORE_WEIGHTS[dim];
  }
  const score = weighted * MAPSLY_SCORE_MAX;
  // Final clamp belt-and-suspenders even though clamp01 + weight-sum=1.0
  // mathematically guarantees [0, 10].
  if (!Number.isFinite(score)) return MAPSLY_SCORE_MIN;
  if (score < MAPSLY_SCORE_MIN) return MAPSLY_SCORE_MIN;
  if (score > MAPSLY_SCORE_MAX) return MAPSLY_SCORE_MAX;
  return score;
}

/**
 * Sub-scores read from a row-like object — typically a
 * `BusinessSnapshot` returned by Prisma. Tolerant of `null`s because
 * Prisma nullable Float columns can be null when a dimension hasn't been
 * computed yet (e.g. before the first weekly cron has run for a new
 * business).
 *
 * Any null dimension contributes 0 to the composite (conservative — a
 * business with no Lighthouse audit yet shouldn't get credit for brand
 * presence).
 */
export interface SnapshotLikeSubScores {
  readonly reputationScore: number | null;
  readonly communicationScore: number | null;
  readonly profileCompletenessScore: number | null;
  readonly trustScore: number | null;
  readonly pricingTransparencyScore: number | null;
  readonly brandPresenceScore: number | null;
}

/**
 * Convenience: compute the Mapsly Score directly from a snapshot row.
 * Null dimensions are treated as 0 — the score is conservative when data
 * is missing.
 */
export function computeMapslyScoreFromSnapshot(
  snapshot: SnapshotLikeSubScores,
): number {
  return computeMapslyScore({
    reputation: snapshot.reputationScore ?? 0,
    communication: snapshot.communicationScore ?? 0,
    profileCompleteness: snapshot.profileCompletenessScore ?? 0,
    trust: snapshot.trustScore ?? 0,
    pricingTransparency: snapshot.pricingTransparencyScore ?? 0,
    brandPresence: snapshot.brandPresenceScore ?? 0,
  });
}

/**
 * Per-dimension breakdown returned for UI rendering. Maria's dashboard
 * `ScoreBreakdown` component reads these directly to render the 6 bars.
 *
 * `contribution` is the dimension's contribution to the total score in
 * 0–10 units (i.e. `subScore × weight × 10`). Sum of contributions across
 * dimensions equals the total score.
 */
export interface MapslyScoreDimensionBreakdown {
  readonly dimension: MapslyScoreDimension;
  readonly subScore: number; // 0–1
  readonly weight: number; // 0–1
  readonly contribution: number; // 0–(weight × 10)
}

export interface MapslyScoreBreakdown {
  readonly total: number; // 0–10
  readonly dimensions: readonly MapslyScoreDimensionBreakdown[];
}

/**
 * Same as `computeMapslyScore` but also returns the per-dimension
 * contribution table. Used by the SMB dashboard's ScoreBreakdown bars.
 */
export function computeMapslyScoreBreakdown(
  subScores: MapslyScoreSubScores,
): MapslyScoreBreakdown {
  // Frozen for symmetry with MAPSLY_SCORE_WEIGHTS — callers receive an
  // immutable breakdown so dashboards / charts that hold onto it across
  // renders can't accidentally mutate per-dim values.
  const dimensions = Object.freeze(
    MAPSLY_SCORE_DIMENSIONS.map((dim) => {
      const subScore = clamp01(subScores[dim]);
      const weight = MAPSLY_SCORE_WEIGHTS[dim];
      return Object.freeze({
        dimension: dim,
        subScore,
        weight,
        contribution: subScore * weight * MAPSLY_SCORE_MAX,
      });
    }),
  );
  const total = dimensions.reduce((acc, d) => acc + d.contribution, 0);
  // Use the same clamp path as the scalar fn for parity.
  const clamped =
    total > MAPSLY_SCORE_MAX
      ? MAPSLY_SCORE_MAX
      : total < MAPSLY_SCORE_MIN
        ? MAPSLY_SCORE_MIN
        : total;
  return { total: clamped, dimensions };
}
