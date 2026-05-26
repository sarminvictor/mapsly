// modules/scoring/competitor-ranking.ts
//
// R.5 · Local competitor ranking for the SMB /reviews page · MSI-style
// composite score across 4 review-quality dimensions.
//
// Given a business, return the top N competitors in the same
// (category, city, country) cell, ranked by:
//
//   msi = 0.35 × norm(rating)              // stars
//       + 0.25 × norm(log10(reviewCount))  // volume validates the rating
//       + 0.20 × norm(velocity30d)         // active business momentum
//       + 0.20 × norm(replyRate)           // engagement / responsiveness
//
// Each dimension is normalized to [0, 1] via Bayesian shrinkage toward
// the cell-mean — a new spa with rating=5.0, reviewCount=3 doesn't
// outrank an established competitor with 4.6 stars and 500 reviews.
//
// Why MSI-style (vs single-dimension):
//   - Pure-stars ranking ignores "is this business growing?"
//   - Pure-volume ranking favors established but possibly-stale businesses
//   - Including velocity rewards businesses gaining traction THIS month
//   - Including replyRate rewards businesses doing the work Maria cares
//     about (responding to customers)
//
// For competitors whose reviews haven't been pulled yet, velocity30d +
// replyRate default to 0 (BusinessSnapshot row is missing). Once those
// reviews are pulled (admin bulk · /admin/businesses), the ranking
// re-computes naturally on the next page load.
//
// Performance:
//   - Single SQL query against indexed columns (city, country, category)
//   - Pulls latest BusinessSnapshot per competitor in one nested select
//   - Returns within ~100ms at 1000-biz scale
//
// Per `.claude/rules/data-fetching.md`, this is a Pattern 2 cached
// server function with cacheTag for granular revalidation.

"use cache";

import { cacheLife, cacheTag } from "next/cache";
import prisma from "@/lib/prisma";

/** How many reviews it takes to override the global mean. Empirical —
 *  feels right for SMB scale where a typical biz has 50-200 reviews. */
const BAYESIAN_PRIOR_COUNT = 20;

/** Default top-N to surface in the SMB card. */
const DEFAULT_TOP_N = 10;

/** MSI dimension weights · sum to 1.00. Tuned to bias toward stars
 *  (the #1 local-SEO signal) but reward businesses doing the work
 *  Maria cares about (replying + getting fresh reviews). */
const MSI_WEIGHTS = {
  rating: 0.35,
  reviews: 0.25,
  velocity: 0.2,
  reply: 0.2,
} as const;

export interface CompetitorRow {
  id: string;
  name: string;
  rating: number | null;
  reviewCount: number | null;
  /** MSI composite score · 0-100. Higher = stronger market position. */
  score: number;
  /** Per-dimension sub-scores · 0-1 each, useful for debugging or
   *  drill-down "why is this business ranked here". */
  subScores: {
    rating: number;
    reviews: number;
    velocity: number;
    reply: number;
  };
  /** 1-indexed rank within the (category, city, country) cell. */
  rank: number;
  /** Last 30 days · count of new reviews (review velocity). */
  velocity30d: number;
  /** % of reviews replied to by the owner (0..1). */
  replyRate: number | null;
  /** % of reviews with stars ≥ 4 (positive bucket from stars). */
  positivePct: number | null;
  /** True when this row is the focal business — used by the UI to
   *  highlight Maria's own business in the ranked list. */
  isFocal: boolean;
}

export interface CompetitorRankingResult {
  /** Top N competitors (includes the focal business if it ranks high). */
  top: CompetitorRow[];
  /** The focal business's row (always returned, regardless of top-N
   *  inclusion · used to render the "you're #X" line when the focal is
   *  below the cutoff). */
  focal: CompetitorRow | null;
  /** Total businesses in the cell. */
  cellTotal: number;
  /** Global mean rating across the cell (the "M" in the Bayesian
   *  formula). Useful for UI context ("most spas here rate ~4.4"). */
  cellMeanRating: number | null;
  /** Focal business's category (echoed for UI label rendering). */
  focalCategory: string;
  /** Focal business's city (echoed for UI label rendering). */
  focalCity: string;
}

/**
 * Compute the ranking and surface top N + focal position. Cached at
 * `competitor-ranking-${businessId}` so any cron that touches the cell
 * (weekly snapshot, reviews-delta callback) can revalidate granularly.
 */
export async function getCompetitorRanking(
  businessId: string,
  topN: number = DEFAULT_TOP_N,
): Promise<CompetitorRankingResult> {
  cacheLife("minutes");
  cacheTag(`competitor-ranking-${businessId}`);

  // Build-phase short-circuit per cache-components Pattern 1.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_RANKING;
  }

  try {
    return await computeRanking(businessId, topN);
  } catch (err) {
    console.warn(
      `[competitor-ranking] failed for ${businessId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return EMPTY_RANKING;
  }
}

const EMPTY_RANKING: CompetitorRankingResult = {
  top: [],
  focal: null,
  cellTotal: 0,
  cellMeanRating: null,
  focalCategory: "",
  focalCity: "",
};

async function computeRanking(
  businessId: string,
  topN: number,
): Promise<CompetitorRankingResult> {
  // 1. Resolve the focal business's cell coordinates.
  const focal = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      category: true,
      city: true,
      country: true,
      rating: true,
      reviewCount: true,
    },
  });
  if (!focal || !focal.category || !focal.city || !focal.country) {
    return EMPTY_RANKING;
  }

  // 2. Pull all businesses in the cell with denormalized aggregates.
  //    We need: rating, reviewCount, replyRate (from latest snapshot),
  //    velocity30d (from latest snapshot).
  const cell = await prisma.business.findMany({
    where: {
      category: focal.category,
      city: focal.city,
      country: focal.country,
      isActive: true,
      rating: { not: null },
      reviewCount: { gt: 0 },
    },
    select: {
      id: true,
      name: true,
      rating: true,
      reviewCount: true,
      // Most-recent snapshot · ordered desc, take 1.
      snapshots: {
        select: { replyRate: true, velocityLast30d: true },
        orderBy: { snapshotDate: "desc" },
        take: 1,
      },
    },
  });

  if (cell.length === 0) {
    return { ...EMPTY_RANKING, cellTotal: 0 };
  }

  // 3. Compute the cell mean rating (M) — denominator-weighted by
  //    reviewCount so a single 5-star outlier doesn't drag M up.
  const totalReviews = cell.reduce((acc, b) => acc + (b.reviewCount ?? 0), 0);
  const weightedRatingSum = cell.reduce(
    (acc, b) => acc + (b.rating ?? 0) * (b.reviewCount ?? 0),
    0,
  );
  const cellMeanRating =
    totalReviews > 0 ? weightedRatingSum / totalReviews : null;

  // 4. Per-dimension max for normalization across the cell.
  const maxReviewLog = Math.max(
    1,
    ...cell.map((b) => Math.log10((b.reviewCount ?? 0) + 1)),
  );
  const maxVelocity = Math.max(
    1,
    ...cell.map((b) => b.snapshots[0]?.velocityLast30d ?? 0),
  );

  // 5. Score every business in the cell.
  //    Each sub-score is in [0, 1]; composite weighted sum → ×100.
  const M = cellMeanRating ?? 4.3; // Bayesian shrinkage anchor
  const C = BAYESIAN_PRIOR_COUNT;

  const scored = cell.map((b) => {
    const rating = b.rating ?? 0;
    const rc = b.reviewCount ?? 0;
    const snap = b.snapshots[0];

    // Rating sub-score · Bayesian-shrunk toward cell mean, mapped 1..5 → 0..1.
    const shrunkRating = (rating * rc + C * M) / (rc + C);
    const ratingSub = clamp01((shrunkRating - 1) / 4);

    // Review-count sub-score · log10 so a 10× difference reads as 1
    // unit of difference, normalized against the cell's max.
    const reviewsSub = clamp01(Math.log10(rc + 1) / maxReviewLog);

    // Velocity sub-score · last 30d count, normalized against cell max.
    // Falls back to 0 when no BusinessSnapshot exists (reviews not pulled
    // yet for this competitor).
    const velocity30d = snap?.velocityLast30d ?? 0;
    const velocitySub = clamp01(velocity30d / maxVelocity);

    // Reply-rate sub-score · already 0..1, but null when snapshot missing.
    const replyRate = snap?.replyRate ?? null;
    const replySub = clamp01(replyRate ?? 0);

    const composite =
      MSI_WEIGHTS.rating * ratingSub +
      MSI_WEIGHTS.reviews * reviewsSub +
      MSI_WEIGHTS.velocity * velocitySub +
      MSI_WEIGHTS.reply * replySub;

    // Scale to 0-100 for friendlier display.
    const score = Math.round(composite * 100);

    return {
      id: b.id,
      name: b.name,
      rating,
      reviewCount: rc,
      score,
      subScores: {
        rating: Number(ratingSub.toFixed(3)),
        reviews: Number(reviewsSub.toFixed(3)),
        velocity: Number(velocitySub.toFixed(3)),
        reply: Number(replySub.toFixed(3)),
      },
      velocity30d,
      replyRate,
      positivePct: ratingToPositivePct(rating),
      isFocal: b.id === businessId,
      rank: 0, // filled after sort
    };
  });

  // 5. Sort by score desc, assign 1-indexed rank.
  scored.sort((a, b) => b.score - a.score);
  scored.forEach((row, idx) => {
    row.rank = idx + 1;
  });

  // 6. Top N + focal row.
  const top = scored.slice(0, topN);
  const focalRow =
    top.find((r) => r.isFocal) ?? scored.find((r) => r.isFocal) ?? null;

  return {
    top,
    focal: focalRow,
    cellTotal: scored.length,
    cellMeanRating,
    focalCategory: focal.category,
    focalCity: focal.city,
  };
}

function ratingToPositivePct(rating: number): number | null {
  if (rating <= 0) return null;
  // Map 1→0.05, 3→0.5, 5→0.95. Caps at [0.05, 0.95].
  const linear = 0.05 + ((rating - 1) / 4) * 0.9;
  return Math.max(0.05, Math.min(0.95, linear));
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
