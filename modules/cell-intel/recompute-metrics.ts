// modules/cell-intel/recompute-metrics.ts · Cell Standards recompute (§4.20)
//
// `recomputeCellMetric(cellKey)` rebuilds ONE cell's market-reference row from
// the latest `BusinessSnapshot` per active business in the cell. It aggregates
// each scoreable signal into a {p10,p25,p50,p75,p90} distribution, writes the
// headline scalar medians, sets `sampleSize` + `confidence` (high if ≥8), stamps
// `lastSnapshotAt`, and clears the `metricsDirty` flag.
//
// ZERO external-API cost — pure Postgres aggregation. This is the per-cell
// recompute companion to the bulk `weekly:cell-aggregate` cron
// (modules/market/cell-metrics.ts). It reuses that module's `quantiles` +
// `signalsFromSnapshot` percentile math so the two paths can never diverge.
//
// The bulk cron groups by Discovery market geo; this per-cell recompute keys off
// `Business.cellKey` directly (the §4.20 Cell-Standards layer stamps cellKey on
// every business), so it's the right tool for "this one cell went dirty,
// recompute just it" without rescanning the whole index.

import prisma, { Prisma } from "@/lib/prisma";
import type { Breakpoints, CellDistributions } from "@/modules/scoring";
import { parseCellKey } from "@/lib/cell";
import {
  CELL_MIN_SAMPLE,
  organicDistributionsForBusinesses,
  quantiles,
  signalsFromSnapshot,
} from "@/modules/market/cell-metrics";

/** Highest snapshot date among the cell's businesses · drives lastSnapshotAt. */
function latestSnapshotDate(dates: readonly (Date | null)[]): Date | null {
  let max: Date | null = null;
  for (const d of dates) {
    if (d && (!max || d.getTime() > max.getTime())) max = d;
  }
  return max;
}

export interface RecomputeCellMetricResult {
  cellKey: string;
  /** "written" if a CellMetric row was upserted, "empty" if the cell had no
   *  qualifying snapshots (no row written). */
  outcome: "written" | "empty";
  sampleSize: number;
  confidence: "high" | "low";
}

/** Max snapshots scanned per cell (bounds memory; a single cell is small). */
const MAX_CELL_SNAPSHOTS = 2000;

/**
 * Recompute a single cell's `CellMetric` market reference from the latest
 * snapshot per active business in the cell. Idempotent upsert.
 *
 * `cellKey` is the canonical "categorySlug|metroSlug|country" form. The
 * (category, city, country) the row keys on are derived from the parsed cellKey
 * (category=categorySlug, city=metroSlug) so the per-cell recompute and the
 * §4.20 dirty-flag pipeline agree on identity.
 */
export async function recomputeCellMetric(
  cellKey: string,
  opts?: { now?: Date },
): Promise<RecomputeCellMetricResult> {
  const parsed = parseCellKey(cellKey);
  if (!parsed) {
    throw new Error(
      `[recomputeCellMetric] malformed cellKey "${cellKey}" — expected "category|city|country".`,
    );
  }
  const { categorySlug, metroSlug, country } = parsed;
  const now = opts?.now ?? new Date();

  // Latest snapshot per active business in the cell. distinct on businessId with
  // snapshotDate desc gives the most-recent row per business in one query.
  const snapshots = await prisma.businessSnapshot.findMany({
    where: { cellKey, business: { isActive: true } },
    orderBy: [{ businessId: "asc" }, { snapshotDate: "desc" }],
    distinct: ["businessId"],
    take: MAX_CELL_SNAPSHOTS,
    select: {
      businessId: true,
      snapshotDate: true,
      signalsJson: true,
      rating: true,
      reviewCount: true,
      photosCount: true,
      replyRate: true,
      velocityLast30d: true,
    },
  });

  const sampleSize = snapshots.length;

  if (sampleSize === 0) {
    // Nothing to aggregate — clear dirty so a perpetually-empty cell doesn't
    // re-queue forever, but don't write a meaningless zero-sample row.
    await prisma.cellMetric.updateMany({
      where: { category: categorySlug, city: metroSlug, country },
      data: { metricsDirty: false, lastSnapshotAt: now },
    });
    return { cellKey, outcome: "empty", sampleSize: 0, confidence: "low" };
  }

  const confidence: "high" | "low" =
    sampleSize >= CELL_MIN_SAMPLE ? "high" : "low";

  const rows = snapshots.map(signalsFromSnapshot);

  const vals = (pick: (s: (typeof rows)[number]) => number | null): number[] =>
    rows.map(pick).filter((x): x is number => x != null && Number.isFinite(x));

  const bpRating = quantiles(vals((s) => s.rating));
  const bpReviewCount = quantiles(vals((s) => s.reviewCount));
  const bpVelocity = quantiles(vals((s) => s.velocityLast30d));
  const bpPhotoCount = quantiles(vals((s) => s.photoCount));
  const bpReplyRate = quantiles(vals((s) => s.replyRate));
  const bpShareOfVoice = quantiles(vals((s) => s.shareOfVoice));
  const bpPerf = quantiles(vals((s) => s.lighthousePerformance));
  const bpSpend = quantiles(vals((s) => s.estMonthlyAdSpend));
  // Cluster-C organic distributions from already-stored BusinessKeyword +
  // SerpResult rows (ZERO external cost). One value per business in the cell.
  const { organicTraffic: bpOrganicTraffic, organicRank: bpOrganicRank } =
    await organicDistributionsForBusinesses(snapshots.map((s) => s.businessId));

  const adFlags = rows
    .map((s) => s.hasActiveAds)
    .filter((x): x is boolean => x != null);
  const adPrevalence =
    adFlags.length > 0 ? adFlags.filter(Boolean).length / adFlags.length : null;

  const distributions: CellDistributions = {
    ...(bpRating ? { rating: bpRating } : {}),
    ...(bpReviewCount ? { reviewCount: bpReviewCount } : {}),
    ...(bpVelocity ? { velocity: bpVelocity } : {}),
    ...(bpPhotoCount ? { photoCount: bpPhotoCount } : {}),
    ...(bpShareOfVoice ? { shareOfVoice: bpShareOfVoice } : {}),
    ...(bpPerf ? { lighthousePerformance: bpPerf } : {}),
    ...(bpSpend ? { estMonthlyAdSpend: bpSpend } : {}),
    ...(bpOrganicTraffic ? { organicTraffic: bpOrganicTraffic } : {}),
    ...(bpOrganicRank ? { organicRank: bpOrganicRank } : {}),
  };

  const lastSnapshotAt =
    latestSnapshotDate(snapshots.map((s) => s.snapshotDate)) ?? now;

  const round = (
    bp: Breakpoints | null,
    p: keyof Breakpoints,
  ): number | null => (bp ? Math.round(bp[p]) : null);

  const scalars = {
    cellKey,
    metroSlug,
    sampleSize,
    confidence,
    ratingP50: bpRating?.p50 ?? null,
    reviewCountP50: round(bpReviewCount, "p50"),
    reviewCountP90: round(bpReviewCount, "p90"),
    photoCountP50: round(bpPhotoCount, "p50"),
    replyRateP50: bpReplyRate?.p50 ?? null,
    velocityP50: bpVelocity?.p50 ?? null,
    lighthousePerfP50: round(bpPerf, "p50"),
    shareOfVoiceP50: bpShareOfVoice?.p50 ?? null,
    adPrevalence,
    distributions: distributions as Prisma.InputJsonValue,
    lastSnapshotAt,
    metricsDirty: false,
    computedAt: now,
  };

  await prisma.cellMetric.upsert({
    where: {
      category_city_country: {
        category: categorySlug,
        city: metroSlug,
        country,
      },
    },
    create: { category: categorySlug, city: metroSlug, country, ...scalars },
    update: scalars,
  });

  return { cellKey, outcome: "written", sampleSize, confidence };
}
