#!/usr/bin/env tsx
/**
 * One-off · run recomputeReviewAggregates() for The Injectionist after
 * the upsert.ts fix lands. The reviews already exist in the DB (95 rows
 * from the pingback that recovered via tag); we just need the aggregate
 * recompute that crashed on the empty `_sum: {}` Prisma invocation.
 *
 * Invoke after the fix is deployed:
 *   pnpm dotenv -e .env.local -- tsx scripts/recompute-injectionist-aggregates.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../lib/generated/prisma/client";

// NOTE: importing recomputeReviewAggregates would pull in the full
// upsert module + its dependency graph. For this tiny one-off we inline
// the logic against a local Prisma instance (script-friendly · no env
// quirks). Matches the fixed shape in modules/reviews/upsert.ts.

const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  const biz = await prisma.business.findFirst({
    where: { slug: "the-injectionist-aesthetics" },
    select: {
      id: true,
      name: true,
      rating: true,
      reviewCount: true,
      _count: { select: { reviews: true } },
    },
  });
  if (!biz) {
    console.log("[recompute] business not found");
    return;
  }

  console.log(`=== Before ===`);
  console.log(`  rating       : ${biz.rating}`);
  console.log(`  reviewCount  : ${biz.reviewCount}`);
  console.log(`  rows in DB   : ${biz._count.reviews}`);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [total, last30d, replied, dbAvg] = await Promise.all([
    prisma.review.count({ where: { businessId: biz.id } }),
    prisma.review.count({
      where: { businessId: biz.id, postedAt: { gte: thirtyDaysAgo } },
    }),
    prisma.review.count({
      where: { businessId: biz.id, ownerReplied: true },
    }),
    prisma.review.aggregate({
      where: { businessId: biz.id },
      _avg: { stars: true },
    }),
  ]);

  const replyRate = total === 0 ? 0 : replied / total;
  const localAvgRating = dbAvg._avg.stars;

  console.log(`\n=== Computed ===`);
  console.log(`  total reviews  : ${total}`);
  console.log(`  last 30d       : ${last30d}`);
  console.log(`  replied        : ${replied}`);
  console.log(`  replyRate      : ${(replyRate * 100).toFixed(1)}%`);
  console.log(`  local avgStars : ${localAvgRating?.toFixed(2)}`);
  console.log(
    `  (DfS aggregate values preserved · biz.reviewCount=${biz.reviewCount}, biz.rating=${biz.rating})`,
  );

  // Today's BusinessSnapshot · upsert with the freshly-computed values.
  const today = startOfUtcDay(new Date());
  await prisma.businessSnapshot.upsert({
    where: {
      businessId_snapshotDate: { businessId: biz.id, snapshotDate: today },
    },
    create: {
      businessId: biz.id,
      snapshotDate: today,
      reviewCount: biz.reviewCount,
      rating: biz.rating,
      replyRate,
      velocityLast30d: last30d,
    },
    update: {
      reviewCount: biz.reviewCount,
      rating: biz.rating,
      replyRate,
      velocityLast30d: last30d,
    },
  });

  console.log(`\n[recompute] BusinessSnapshot upserted for ${today.toISOString().slice(0, 10)}`);
}

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}

main()
  .catch((err) => {
    console.error("[recompute] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
