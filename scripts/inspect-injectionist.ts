#!/usr/bin/env tsx
/**
 * One-off · audit The Injectionist's review-pull state.
 * Shows: pendingReviewsTaskId · recent CronRuns · review row count.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../lib/generated/prisma/client";

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
      slug: true,
      googleCid: true,
      reviewCount: true,
      rating: true,
      ownerUserId: true,
      isClaimed: true,
      pendingReviewsTaskId: true,
      reviewsFirstPulledAt: true,
      reviewsLastDeltaAt: true,
      latestReviewExternalId: true,
      _count: { select: { reviews: true } },
    },
  });

  if (!biz) {
    console.log("[inspect] business not found");
    return;
  }

  console.log("=== Business ===");
  console.log(`name                  : ${biz.name}`);
  console.log(`id                    : ${biz.id}`);
  console.log(`googleCid             : ${biz.googleCid}`);
  console.log(`reviewCount (DfS)     : ${biz.reviewCount}`);
  console.log(`rating                : ${biz.rating}`);
  console.log(`isClaimed             : ${biz.isClaimed}`);
  console.log(`ownerUserId           : ${biz.ownerUserId?.slice(0, 12)}…`);
  console.log("");
  console.log("=== Review-pull state ===");
  console.log(
    `pendingReviewsTaskId  : ${biz.pendingReviewsTaskId ?? "(null · no pull in flight)"}`,
  );
  console.log(
    `reviewsFirstPulledAt  : ${biz.reviewsFirstPulledAt?.toISOString() ?? "(null · never pulled)"}`,
  );
  console.log(
    `reviewsLastDeltaAt    : ${biz.reviewsLastDeltaAt?.toISOString() ?? "(null · never delta'd)"}`,
  );
  console.log(
    `latestReviewExternalId: ${biz.latestReviewExternalId ?? "(null)"}`,
  );
  console.log(`Review rows in DB     : ${biz._count.reviews}`);
  console.log("");

  // Recent CronRuns related to reviews + admin triggers
  const recent = await prisma.cronRun.findMany({
    where: {
      OR: [
        { job: { startsWith: "admin:reviews" } },
        { job: { startsWith: "reviews:" } },
        { job: { startsWith: "weekly:reviews" } },
        { job: { startsWith: "dataforseo.reviews" } },
      ],
    },
    orderBy: { startedAt: "desc" },
    take: 15,
    select: {
      id: true,
      job: true,
      status: true,
      itemsProcessed: true,
      costUsd: true,
      startedAt: true,
      finishedAt: true,
      errorMessage: true,
      meta: true,
    },
  });

  console.log("=== Recent CronRuns (review-related) ===");
  if (recent.length === 0) {
    console.log("(none)");
  } else {
    for (const r of recent) {
      const dur =
        r.finishedAt && r.startedAt
          ? `${Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000)}s`
          : "running";
      console.log(
        `${r.startedAt.toISOString()}  ${r.status.padEnd(7)} ${r.job.padEnd(30)} items=${r.itemsProcessed} cost=$${(r.costUsd ?? 0).toFixed(5)} ${dur}`,
      );
      if (r.errorMessage) {
        console.log(`    error: ${r.errorMessage.slice(0, 200)}`);
      }
      if (r.meta) {
        const metaStr = JSON.stringify(r.meta).slice(0, 200);
        console.log(`    meta : ${metaStr}`);
      }
    }
  }
}

main()
  .catch((err) => {
    console.error("[inspect] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
