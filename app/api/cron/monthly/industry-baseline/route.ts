// Monthly · industry-baseline
//
// Aggregate baseline metrics per (category, country) so SMB dashboards
// can answer "where do I stand vs other med-spas in the US?" without
// recomputing aggregates on every page-load. Pure DB compute — no
// external API calls — so cost is effectively zero (the CronRun still
// opens to enforce orchestration discipline + log duration).
//
// Source: existing `BusinessSnapshot` rows (latest snapshot per business
// per bucket). The job is read-only against external APIs but writes
// summary JSON into `CronRun.meta.baselines[(category, country)] = {
// median_rating, median_reply_rate, ... }`. The dashboard reads the
// latest CronRun row for the JOB to surface the benchmarks.
//
// We persist into CronRun.meta (not a dedicated `IndustryBaseline` table)
// because the data model is intentionally provisional — Phase 4 may add
// a first-class table once we know the read shape SMB dashboards want.
// Until then the latest CronRun row is the canonical baseline source.
//
// Cadence: monthly day-1 09:00 UTC per `vercel.json`. Bounded scan: we
// pull at most MAX_BUCKETS (250) distinct (category, country) buckets
// per run. Higher-frequency / more-granular baselines should live in a
// dedicated model + a different cron — this one is the cross-category
// floor.

import { revalidateTag } from "next/cache";
import { Prisma } from "@/lib/prisma";
import prisma from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import { resolveBatchLimit } from "../../_lib/batch";

const JOB = "monthly:industry-baseline";
const DEFAULT_BUCKET_LIMIT = 250;
const MAX_BUCKET_LIMIT = 1000;
/** Min sample size per bucket — fewer than this and the medians are
 *  noise. A bucket below the floor is recorded with status="thin". */
const MIN_SAMPLE_SIZE = 5;

interface AggregateRow {
  category: string;
  country: string | null;
  sample_size: number;
  median_rating: number | null;
  median_review_count: number | null;
  median_reply_rate: number | null;
  median_mapsly_score: number | null;
  median_reputation: number | null;
  median_communication: number | null;
  median_profile: number | null;
  median_trust: number | null;
  median_pricing: number | null;
  median_brand: number | null;
}

interface BaselineBucket {
  category: string;
  country: string | null;
  sampleSize: number;
  status: "ok" | "thin";
  medianRating: number | null;
  medianReviewCount: number | null;
  medianReplyRate: number | null;
  medianMapslyScore: number | null;
  medianReputationScore: number | null;
  medianCommunicationScore: number | null;
  medianProfileCompletenessScore: number | null;
  medianTrustScore: number | null;
  medianPricingTransparencyScore: number | null;
  medianBrandPresenceScore: number | null;
}

export const GET = cronHandler(JOB, async (ctx) => {
  return await processMonthlyIndustryBaseline(undefined, ctx);
});

/**
 * Implementation entrypoint. Extracted for unit tests.
 */
export async function processMonthlyIndustryBaseline(
  req: Request | undefined,
  ctx: { runId: string; job: string },
) {
  const limit = req
    ? resolveBatchLimit(req, DEFAULT_BUCKET_LIMIT, MAX_BUCKET_LIMIT)
    : DEFAULT_BUCKET_LIMIT;

  // Per (category, country) bucket: aggregate the LATEST BusinessSnapshot
  // per business, then take medians. Postgres' `percentile_cont(0.5)
  // WITHIN GROUP (ORDER BY x)` does the median in one pass; the LATERAL
  // subquery cherry-picks the latest snapshot.
  //
  // We restrict to active businesses with a known category. Country may
  // be NULL for unclassified rows; we surface those as a "(unknown)"
  // bucket rather than silently dropping them.
  const rows = (await prisma.$queryRaw<AggregateRow[]>(Prisma.sql`
    WITH latest_snapshot AS (
      SELECT DISTINCT ON (s."businessId")
        s."businessId",
        s.rating,
        s."reviewCount",
        s."replyRate",
        s."mapslyScore",
        s."reputationScore",
        s."communicationScore",
        s."profileCompletenessScore",
        s."trustScore",
        s."pricingTransparencyScore",
        s."brandPresenceScore"
      FROM "BusinessSnapshot" s
      ORDER BY s."businessId", s."snapshotDate" DESC
    )
    SELECT
      b.category AS category,
      b.country AS country,
      COUNT(*)::int AS sample_size,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ls.rating) AS median_rating,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ls."reviewCount") AS median_review_count,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ls."replyRate") AS median_reply_rate,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ls."mapslyScore") AS median_mapsly_score,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ls."reputationScore") AS median_reputation,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ls."communicationScore") AS median_communication,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ls."profileCompletenessScore") AS median_profile,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ls."trustScore") AS median_trust,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ls."pricingTransparencyScore") AS median_pricing,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY ls."brandPresenceScore") AS median_brand
    FROM "Business" b
    JOIN latest_snapshot ls ON ls."businessId" = b.id
    WHERE b."isActive" = TRUE
      AND b.category IS NOT NULL
      AND b.category <> ''
    GROUP BY b.category, b.country
    ORDER BY COUNT(*) DESC
    LIMIT ${limit}
  `)) as AggregateRow[];

  const baselines: BaselineBucket[] = rows.map((row) => ({
    category: row.category,
    country: row.country,
    sampleSize: row.sample_size,
    status: row.sample_size >= MIN_SAMPLE_SIZE ? "ok" : "thin",
    medianRating: nullableNumber(row.median_rating),
    medianReviewCount:
      row.median_review_count == null
        ? null
        : Math.round(row.median_review_count),
    medianReplyRate: nullableNumber(row.median_reply_rate),
    medianMapslyScore: nullableNumber(row.median_mapsly_score),
    medianReputationScore: nullableNumber(row.median_reputation),
    medianCommunicationScore: nullableNumber(row.median_communication),
    medianProfileCompletenessScore: nullableNumber(row.median_profile),
    medianTrustScore: nullableNumber(row.median_trust),
    medianPricingTransparencyScore: nullableNumber(row.median_pricing),
    medianBrandPresenceScore: nullableNumber(row.median_brand),
  }));

  // SMB dashboard surfaces "you vs the industry"; refresh tag triggers
  // re-render on next page-load for every signed-in SMB.
  if (baselines.length > 0) revalidateTag("industry-baselines", "days");

  const meta: Prisma.InputJsonObject = {
    runId: ctx.runId,
    limit,
    bucketCount: baselines.length,
    okBuckets: baselines.filter((b) => b.status === "ok").length,
    thinBuckets: baselines.filter((b) => b.status === "thin").length,
    minSampleSize: MIN_SAMPLE_SIZE,
    // BaselineBucket has a literal-union `status` field that TS won't
    // structurally accept against Prisma's InputJsonObject index signature.
    // Cast once here — values are JSON-safe by construction.
    baselines: baselines as unknown as Prisma.InputJsonValue,
  };

  return {
    itemsProcessed: baselines.length,
    meta,
  };
}

/**
 * Postgres `percentile_cont` returns numeric, which Prisma surfaces as a
 * JS number (or null when the group was empty). Round to 4 decimals so
 * the CronRun.meta payload stays compact; keep null distinct from 0.
 */
function nullableNumber(v: number | null | undefined): number | null {
  if (v == null) return null;
  if (!Number.isFinite(v)) return null;
  return Math.round(v * 10000) / 10000;
}

export const __test = {
  JOB,
  DEFAULT_BUCKET_LIMIT,
  MAX_BUCKET_LIMIT,
  MIN_SAMPLE_SIZE,
  processMonthlyIndustryBaseline,
  nullableNumber,
};
