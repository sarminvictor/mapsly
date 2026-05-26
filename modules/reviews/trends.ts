// modules/reviews/trends.ts
//
// R.6 · Review aggregates for the trend graph + insight cards on
// /(smb)/reviews. All queries are read-only SQL over the Review table
// (indexed on businessId + postedAt). Zero AI / external API cost.
//
// Returns:
//   - monthly histogram (last 12 months · count + avg stars per bucket)
//   - delta count (new reviews since last week's pull)
//   - service mention aggregates (which services were mentioned / when)
//   - top mentioned people (name + count)

"use cache";

import { cacheLife, cacheTag } from "next/cache";
import prisma from "@/lib/prisma";

export interface MonthlyBucket {
  /** ISO month label · "2026-03" */
  month: string;
  /** Count of reviews posted in that month. */
  count: number;
  /** Average star rating across that month's reviews. Null if no reviews. */
  avgStars: number | null;
}

export interface ServiceMention {
  /** Canonical service name (from BusinessService.name). */
  name: string;
  /** Total mentions across all 12-month reviews. */
  count: number;
  /** Last time any review mentioned this service. Null if never. */
  lastMentionedAt: Date | null;
  /** True iff lastMentionedAt is older than 90 days (or null). */
  isStale: boolean;
}

export interface PersonMention {
  /** Name as extracted by the AI (post-normalized). */
  name: string;
  /** Number of reviews mentioning this person. */
  count: number;
}

export interface ReviewTrendsData {
  /** 12 monthly buckets, oldest first. Always exactly 12 items. */
  monthly: MonthlyBucket[];
  /** Count of reviews posted in the trailing 30 days. */
  rolling30d: number;
  /** Count of reviews posted in days 31-60 (for "vs prior 30d" comparison). */
  rolling30dPrior: number;
  /** Count of reviews inserted since last weekly delta (Business.reviewsLastDeltaAt).
   *  Null when no prior delta has run. */
  deltaSinceLastWeek: number | null;
  /** Service-mention catalog · all active services + their mention state. */
  services: ServiceMention[];
  /** Top 10 mentioned people from the trailing 12 months. */
  topPeople: PersonMention[];
  /** ISO timestamp of the last pingback / delta · drives "last updated" line. */
  lastUpdatedAt: string | null;
}

const EMPTY_TRENDS: ReviewTrendsData = {
  monthly: buildEmpty12Months(),
  rolling30d: 0,
  rolling30dPrior: 0,
  deltaSinceLastWeek: null,
  services: [],
  topPeople: [],
  lastUpdatedAt: null,
};

/**
 * Pull all trend data for one business in a single cacheable call.
 * Per `.claude/rules/data-fetching.md` Pattern 2 + cache-components
 * Pattern 1 (NEXT_PHASE guard).
 */
export async function getReviewTrends(
  businessId: string,
): Promise<ReviewTrendsData> {
  cacheLife("minutes");
  cacheTag(`review-trends-${businessId}`);

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_TRENDS;
  }

  try {
    return await computeTrends(businessId);
  } catch (err) {
    console.warn(
      `[review-trends] failed for ${businessId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return EMPTY_TRENDS;
  }
}

async function computeTrends(businessId: string): Promise<ReviewTrendsData> {
  const now = new Date();
  const twelveMonthsAgo = monthFloor(addMonths(now, -11)); // include current month → 12 buckets
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 86_400_000);
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000);

  const [
    monthlyRows,
    rolling30d,
    rolling30dPrior,
    biz,
    serviceRows,
    peopleRows,
    lastReview,
  ] = await Promise.all([
    // Monthly histogram via raw SQL — Postgres date_trunc grouping is
    // cheaper than fetching all rows + bucketing in JS.
    prisma.$queryRaw<
      { month: Date; count: bigint; avg_stars: number | null }[]
    >`
      SELECT date_trunc('month', "postedAt") AS month,
             COUNT(*)::bigint AS count,
             AVG(stars)::float AS avg_stars
      FROM "Review"
      WHERE "businessId" = ${businessId}
        AND "postedAt" >= ${twelveMonthsAgo}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
    prisma.review.count({
      where: { businessId, postedAt: { gte: thirtyDaysAgo } },
    }),
    prisma.review.count({
      where: {
        businessId,
        postedAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
      },
    }),
    prisma.business.findUnique({
      where: { id: businessId },
      select: { reviewsLastDeltaAt: true },
    }),
    prisma.businessService.findMany({
      where: { businessId, isActive: true },
      select: { name: true, lastMentionedAt: true },
      orderBy: { sortOrder: "asc" },
    }),
    // People mentions · unnest the array column + group.
    prisma.$queryRaw<{ name: string; count: bigint }[]>`
      SELECT name, COUNT(*)::bigint AS count
      FROM "Review", unnest("mentionedPeople") AS name
      WHERE "businessId" = ${businessId}
        AND "postedAt" >= ${twelveMonthsAgo}
      GROUP BY name
      ORDER BY count DESC
      LIMIT 10
    `,
    prisma.review.findFirst({
      where: { businessId },
      orderBy: { collectedAt: "desc" },
      select: { collectedAt: true },
    }),
  ]);

  // Build the 12-month skeleton + fill in actual data.
  const monthly = buildEmpty12Months(now);
  const byMonth = new Map<string, { count: number; avgStars: number | null }>();
  for (const row of monthlyRows) {
    byMonth.set(toMonthKey(row.month), {
      count: Number(row.count),
      avgStars: row.avg_stars,
    });
  }
  for (const bucket of monthly) {
    const hit = byMonth.get(bucket.month);
    if (hit) {
      bucket.count = hit.count;
      bucket.avgStars = hit.avgStars;
    }
  }

  // Service-mention status · cross-reference last-mentioned dates.
  const services: ServiceMention[] = serviceRows.map((s) => ({
    name: s.name,
    count: 0, // populated below from per-service unnest
    lastMentionedAt: s.lastMentionedAt,
    isStale:
      s.lastMentionedAt == null ||
      s.lastMentionedAt.getTime() < ninetyDaysAgo.getTime(),
  }));

  // Per-service count via a single grouped unnest query.
  const mentionCounts = await prisma.$queryRaw<
    { name: string; count: bigint }[]
  >`
    SELECT name, COUNT(*)::bigint AS count
    FROM "Review", unnest("mentionedServices") AS name
    WHERE "businessId" = ${businessId}
      AND "postedAt" >= ${twelveMonthsAgo}
    GROUP BY name
  `;
  const countByService = new Map(
    mentionCounts.map((r) => [r.name, Number(r.count)]),
  );
  for (const s of services) {
    s.count = countByService.get(s.name) ?? 0;
  }

  const topPeople: PersonMention[] = peopleRows.map((r) => ({
    name: r.name,
    count: Number(r.count),
  }));

  // Delta-since-last-week · count Review.collectedAt > Business.reviewsLastDeltaAt.
  const deltaSinceLastWeek = biz?.reviewsLastDeltaAt
    ? await prisma.review.count({
        where: {
          businessId,
          collectedAt: { gt: biz.reviewsLastDeltaAt },
        },
      })
    : null;

  return {
    monthly,
    rolling30d,
    rolling30dPrior,
    deltaSinceLastWeek,
    services,
    topPeople,
    lastUpdatedAt: lastReview?.collectedAt
      ? lastReview.collectedAt.toISOString()
      : null,
  };
}

// ---- Helpers -------------------------------------------------------------

function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCMonth(x.getUTCMonth() + n);
  return x;
}

function monthFloor(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function toMonthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildEmpty12Months(now: Date = new Date()): MonthlyBucket[] {
  const out: MonthlyBucket[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = monthFloor(addMonths(now, -i));
    out.push({ month: toMonthKey(d), count: 0, avgStars: null });
  }
  return out;
}
