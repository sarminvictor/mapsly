/**
 * Scoring v2 · cell-metrics (the market reference)
 *
 * Builds the `CellMetric` rows that make scoring MARKET-RELATIVE: one row per
 * (category × city × country) cell holding the DISTRIBUTION of every scoreable
 * signal across the cell's active businesses. Computed purely from existing
 * `BusinessSnapshot` rows — ZERO external-API cost.
 *
 * Read by pillar scoring (`modules/market/pillar-scoring.ts` → `computePillars`)
 * and the `/admin/cells` page. Written by the `weekly:cell-aggregate` cron and
 * the admin "Recompute references" trigger.
 *
 * `runCellAggregation` is the one shared entry point both call sites use, so the
 * cron and the manual trigger can never diverge.
 */

import prisma, { Prisma } from "@/lib/prisma";
import type {
  Breakpoints,
  CellDistributions,
  CellReference,
  PillarSignals,
} from "@/modules/scoring";
import { loadTrackedMarkets, resolveMarketCell } from "./market-category";

/** Cells below this sample size are flagged `confidence: "low"`. */
export const CELL_MIN_SAMPLE = 8;

/** A distribution needs at least this many values to be worth forming. Small
 * cells still get a median (degenerate spreads fall back to absolute scoring
 * via isUsableBp). */
const MIN_VALUES_FOR_DISTRIBUTION = 1;

/** Default cap on businesses scanned per aggregation run (scale guard). */
const DEFAULT_SCAN_LIMIT = 5000;

/** Canonical cell key · matches AdMarketAdvertiser / Keyword cell shape. */
export function cellKeyOf(
  category: string,
  city: string,
  country: string,
): string {
  return `${category}|${city}|${country}`;
}

// ── JSON-safe readers (no risky casts) ──────────────────────────────────────
function asObj(v: unknown): Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}
function nOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function bOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/**
 * 5-point breakpoints from a list of values via linear interpolation. Returns
 * null when there aren't enough finite values to form a meaningful spread.
 */
export function quantiles(values: readonly number[]): Breakpoints | null {
  const v = values
    .filter((x) => Number.isFinite(x))
    .slice()
    .sort((a, b) => a - b);
  if (v.length < MIN_VALUES_FOR_DISTRIBUTION) return null;
  const q = (p: number): number => {
    const idx = (v.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    const t = idx - lo;
    return v[lo]! + (v[hi]! - v[lo]!) * t;
  };
  return { p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9) };
}

/**
 * Reconstruct the pillar-signal bag for a business from its latest snapshot —
 * preferring the v2 `signalsJson` bag, falling back to the legacy scalar
 * columns so cells/scores still compute before the first v2 snapshot lands.
 */
export function signalsFromSnapshot(row: {
  signalsJson: Prisma.JsonValue | null;
  rating: number | null;
  reviewCount: number | null;
  photosCount: number | null;
  replyRate: number | null;
  velocityLast30d: number | null;
}): PillarSignals {
  const j = asObj(row.signalsJson);
  return {
    rating: nOrNull(j.rating) ?? row.rating,
    reviewCount: nOrNull(j.reviewCount) ?? row.reviewCount,
    velocityLast30d: nOrNull(j.velocityLast30d) ?? row.velocityLast30d,
    replyRate: nOrNull(j.replyRate) ?? row.replyRate,
    localPackRank: nOrNull(j.localPackRank),
    organicRankBest: nOrNull(j.organicRankBest),
    shareOfVoice: nOrNull(j.shareOfVoice),
    keywordsRanked: nOrNull(j.keywordsRanked),
    hasPhone: bOrNull(j.hasPhone),
    hasWebsite: bOrNull(j.hasWebsite),
    hasHours: bOrNull(j.hasHours),
    isClaimed: bOrNull(j.isClaimed),
    photoCount: nOrNull(j.photoCount) ?? row.photosCount,
    categoryCount: nOrNull(j.categoryCount),
    lighthousePerformance: nOrNull(j.lighthousePerformance),
    lighthouseSeo: nOrNull(j.lighthouseSeo),
    lcpSeconds: nOrNull(j.lcpSeconds),
    hasSchema: bOrNull(j.hasSchema),
    hasBookingCta: bOrNull(j.hasBookingCta),
    hasPhoneAboveFold: bOrNull(j.hasPhoneAboveFold),
    napConsistent: bOrNull(j.napConsistent),
    hasActiveAds: bOrNull(j.hasActiveAds),
    hasActiveGoogleAds: bOrNull(j.hasActiveGoogleAds),
    hasActiveMetaAds: bOrNull(j.hasActiveMetaAds),
    metaAdCount: nOrNull(j.metaAdCount),
    estMonthlyAdSpend: nOrNull(j.estMonthlyAdSpend),
    brandHijack: bOrNull(j.brandHijack),
  };
}

/** Build the `CellReference` pillar scoring grades against, from a CellMetric row. */
export function parseCellReference(
  row: {
    sampleSize: number;
    confidence: string;
    adPrevalence: number | null;
    distributions: Prisma.JsonValue | null;
  } | null,
): CellReference | null {
  if (!row) return null;
  const d = asObj(row.distributions);
  const bp = (key: string): Breakpoints | undefined => {
    const o = asObj(d[key]);
    const p10 = nOrNull(o.p10);
    const p25 = nOrNull(o.p25);
    const p50 = nOrNull(o.p50);
    const p75 = nOrNull(o.p75);
    const p90 = nOrNull(o.p90);
    if (p10 == null || p25 == null || p50 == null || p75 == null || p90 == null)
      return undefined;
    return { p10, p25, p50, p75, p90 };
  };
  return {
    sampleSize: row.sampleSize,
    confidence: row.confidence === "high" ? "high" : "low",
    adPrevalence: row.adPrevalence,
    rating: bp("rating"),
    reviewCount: bp("reviewCount"),
    velocity: bp("velocity"),
    photoCount: bp("photoCount"),
    shareOfVoice: bp("shareOfVoice"),
    lighthousePerformance: bp("lighthousePerformance"),
    estMonthlyAdSpend: bp("estMonthlyAdSpend"),
  };
}

export interface CellAggregationSummary {
  cellsProcessed: number;
  cellsWritten: number;
  businessesScanned: number;
  highConfidenceCells: number;
}

interface CellBucket {
  category: string;
  city: string;
  country: string;
  rows: PillarSignals[];
}

/**
 * Recompute every (category × city × country) cell's market reference from the
 * latest snapshot per active business. Idempotent upsert per cell.
 *
 * Scale note: dev/early-prod loads all rows (bounded by `limit`). At full
 * 2.1M scale this should batch by cell — tracked as a follow-up; the cell key
 * + indexes are already in place for it.
 */
export async function runCellAggregation(opts?: {
  limit?: number;
}): Promise<CellAggregationSummary> {
  const limit = Math.max(1, opts?.limit ?? DEFAULT_SCAN_LIMIT);

  // Latest snapshot per active, geo-complete, QUALIFIED business. The cell
  // reference (medians/percentiles + sampleSize) is built from QUALIFIED
  // businesses only — junk/unclaimed/review-less listings would skew the
  // market distribution a real business is graded against.
  const snapshots = await prisma.businessSnapshot.findMany({
    where: {
      business: {
        isActive: true,
        qualificationStatus: "QUALIFIED",
        city: { not: null },
        country: { not: null },
      },
    },
    orderBy: [{ businessId: "asc" }, { snapshotDate: "desc" }],
    distinct: ["businessId"],
    take: limit,
    select: {
      signalsJson: true,
      rating: true,
      reviewCount: true,
      photosCount: true,
      replyRate: true,
      velocityLast30d: true,
      business: {
        select: {
          category: true,
          categoryIds: true,
          city: true,
          country: true,
          lat: true,
          lng: true,
        },
      },
    },
  });

  // Group into cells by Discovery MARKET GEO (the radius is the market, not the
  // administrative city) so /admin/cells aligns with /admin/discovery — one
  // discovery (Medical Spa · Miami · 10km · US) = one cell, even though its
  // radius spills into Coral Gables / Miami Beach / etc.
  const markets = await loadTrackedMarkets();
  const buckets = new Map<string, CellBucket>();
  for (const snap of snapshots) {
    const cell = resolveMarketCell(snap.business, markets);
    const { category, city, country } = cell;
    if (!category || !city || !country) continue;
    const key = cellKeyOf(category, city, country);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { category, city, country, rows: [] };
      buckets.set(key, bucket);
    }
    bucket.rows.push(signalsFromSnapshot(snap));
  }

  let cellsWritten = 0;
  let highConfidenceCells = 0;
  const writtenKeys: string[] = [];

  for (const bucket of buckets.values()) {
    const { category, city, country, rows } = bucket;
    const sampleSize = rows.length;
    const confidence = sampleSize >= CELL_MIN_SAMPLE ? "high" : "low";
    if (confidence === "high") highConfidenceCells += 1;

    const vals = (pick: (s: PillarSignals) => number | null): number[] =>
      rows
        .map(pick)
        .filter((x): x is number => x != null && Number.isFinite(x));

    const bpRating = quantiles(vals((s) => s.rating));
    const bpReviewCount = quantiles(vals((s) => s.reviewCount));
    const bpVelocity = quantiles(vals((s) => s.velocityLast30d));
    const bpPhotoCount = quantiles(vals((s) => s.photoCount));
    const bpReplyRate = quantiles(vals((s) => s.replyRate));
    const bpShareOfVoice = quantiles(vals((s) => s.shareOfVoice));
    const bpPerf = quantiles(vals((s) => s.lighthousePerformance));
    const bpSpend = quantiles(vals((s) => s.estMonthlyAdSpend));

    const adFlags = rows
      .map((s) => s.hasActiveAds)
      .filter((x): x is boolean => x != null);
    const adPrevalence =
      adFlags.length > 0
        ? adFlags.filter(Boolean).length / adFlags.length
        : null;

    // Distribution bag consumed by percentileRank in pillar scoring.
    const distributions: CellDistributions = {
      ...(bpRating ? { rating: bpRating } : {}),
      ...(bpReviewCount ? { reviewCount: bpReviewCount } : {}),
      ...(bpVelocity ? { velocity: bpVelocity } : {}),
      ...(bpPhotoCount ? { photoCount: bpPhotoCount } : {}),
      ...(bpShareOfVoice ? { shareOfVoice: bpShareOfVoice } : {}),
      ...(bpPerf ? { lighthousePerformance: bpPerf } : {}),
      ...(bpSpend ? { estMonthlyAdSpend: bpSpend } : {}),
    };

    const cellKey = cellKeyOf(category, city, country);
    const scalars = {
      cellKey,
      sampleSize,
      confidence,
      ratingP50: bpRating?.p50 ?? null,
      reviewCountP50: bpReviewCount ? Math.round(bpReviewCount.p50) : null,
      reviewCountP90: bpReviewCount ? Math.round(bpReviewCount.p90) : null,
      photoCountP50: bpPhotoCount ? Math.round(bpPhotoCount.p50) : null,
      replyRateP50: bpReplyRate?.p50 ?? null,
      velocityP50: bpVelocity?.p50 ?? null,
      lighthousePerfP50: bpPerf ? Math.round(bpPerf.p50) : null,
      shareOfVoiceP50: bpShareOfVoice?.p50 ?? null,
      adPrevalence,
      distributions: distributions as Prisma.InputJsonValue,
      computedAt: new Date(),
    };

    await prisma.cellMetric.upsert({
      where: { category_city_country: { category, city, country } },
      create: { category, city, country, ...scalars },
      update: scalars,
    });
    cellsWritten += 1;
    writtenKeys.push(cellKey);
  }

  // Drop stale cells (raw-category cells from before market grouping, or cells
  // whose businesses moved/closed) so /admin/cells shows only live markets.
  await prisma.cellMetric.deleteMany({
    where: {
      cellKey: { notIn: writtenKeys.length > 0 ? writtenKeys : ["__none__"] },
    },
  });

  return {
    cellsProcessed: buckets.size,
    cellsWritten,
    businessesScanned: snapshots.length,
    highConfidenceCells,
  };
}
