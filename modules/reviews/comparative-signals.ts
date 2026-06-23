// modules/reviews/comparative-signals.ts · review-derived comparative signals
// (Phase 6/E5). Raw review counts mean little alone; these classifiers turn
// them into lifecycle/momentum + cell-relative buckets an agency can filter on
// ("dying reputation", "bottom-quartile reply rate"). Pure + testable.

export type ReviewLifecycle =
  | "TRENDING"
  | "STABLE"
  | "DYING"
  | "DORMANT"
  | "NONE";

export const STALE_NO_REVIEWS_DAYS = 120; // ~4 months (per-cell override later)

export interface LifecycleInput {
  reviewCount: number | null;
  velocity30d: number | null; // reviews in last 30d
  velocityPrev30d: number | null; // reviews in the prior 30d
  lastReviewAgeDays: number | null;
}

/**
 * Classify a business's review lifecycle from velocity + recency.
 * DORMANT (no recent reviews) takes precedence over momentum classes.
 */
export function classifyLifecycle(i: LifecycleInput): ReviewLifecycle {
  if (!i.reviewCount || i.reviewCount === 0) return "NONE";
  if ((i.lastReviewAgeDays ?? Infinity) >= STALE_NO_REVIEWS_DAYS)
    return "DORMANT";

  const v = i.velocity30d ?? 0;
  const prev = i.velocityPrev30d ?? 0;
  if (prev > 0 && v < prev * 0.5) return "DYING";
  if (v >= 2 && v > prev * 1.5) return "TRENDING";
  return "STABLE";
}

export interface Momentum {
  delta: number; // v30 − vPrev
  pctChange: number; // (v30 − vPrev) / max(vPrev, 1)
  direction: "up" | "down" | "flat";
}

/** 30-day vs previous-30-day momentum. */
export function reviewMomentum(
  velocity30d: number | null,
  velocityPrev30d: number | null,
): Momentum {
  const v = velocity30d ?? 0;
  const prev = velocityPrev30d ?? 0;
  const delta = v - prev;
  const pctChange = delta / Math.max(prev, 1);
  return {
    delta,
    pctChange,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
  };
}

export type ComparativeBucket =
  | "bottom_decile"
  | "bottom_quartile"
  | "below_median"
  | "above_median"
  | "top_quartile"
  | "top_decile";

/** Map a 0–100 cell percentile to a human bucket for filters/labels. */
export function comparativeBucket(percentile: number): ComparativeBucket {
  const p = Math.max(0, Math.min(100, percentile));
  if (p <= 10) return "bottom_decile";
  if (p <= 25) return "bottom_quartile";
  if (p < 50) return "below_median";
  if (p < 75) return "above_median";
  if (p < 90) return "top_quartile";
  return "top_decile";
}

/** True when a business has had no reviews for the stale threshold. */
export function isStaleNoReviews(
  lastReviewAgeDays: number | null,
  thresholdDays = STALE_NO_REVIEWS_DAYS,
): boolean {
  return (lastReviewAgeDays ?? Infinity) >= thresholdDays;
}
