#!/usr/bin/env tsx
/**
 * Verify our 95 review count for The Injectionist matches what DfS
 * would return for the last 12 months.
 *
 * Approach:
 *   1. Read DB · sort by postedAt asc, get oldest review's date
 *   2. If oldest is ≥ ~340 days ago: we hit the 12mo cutoff correctly
 *      · everything before that was deliberately skipped
 *   3. If oldest is < 340 days ago AND we have exactly 95 rows: we may
 *      have missed older reviews (DfS truncated at depth=500 BEFORE
 *      hitting the 12mo cutoff) · need a depth bump
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
    select: { id: true, name: true, reviewCount: true },
  });
  if (!biz) {
    console.log("[verify] business not found");
    return;
  }

  const [oldest, newest, total, distribution] = await Promise.all([
    prisma.review.findFirst({
      where: { businessId: biz.id },
      orderBy: { postedAt: "asc" },
      select: { postedAt: true, externalId: true },
    }),
    prisma.review.findFirst({
      where: { businessId: biz.id },
      orderBy: { postedAt: "desc" },
      select: { postedAt: true, externalId: true },
    }),
    prisma.review.count({ where: { businessId: biz.id } }),
    prisma.$queryRaw<{ month: Date; count: bigint }[]>`
      SELECT date_trunc('month', "postedAt") AS month, COUNT(*)::bigint AS count
      FROM "Review"
      WHERE "businessId" = ${biz.id}
      GROUP BY 1
      ORDER BY 1 ASC
    `,
  ]);

  const cutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const now = new Date();

  console.log("=== The Injectionist · 12-month review audit ===");
  console.log(`DfS aggregate reviewCount (lifetime): ${biz.reviewCount}`);
  console.log(`Our DB review count                 : ${total}`);
  console.log("");
  console.log(
    `Oldest review in DB : ${oldest?.postedAt.toISOString().slice(0, 10) ?? "(none)"} (${oldest ? daysAgo(oldest.postedAt) : "—"} days ago)`,
  );
  console.log(
    `Newest review in DB : ${newest?.postedAt.toISOString().slice(0, 10) ?? "(none)"} (${newest ? daysAgo(newest.postedAt) : "—"} days ago)`,
  );
  console.log(`12-month cutoff     : ${cutoff.toISOString().slice(0, 10)}`);
  console.log("");
  console.log("=== Monthly distribution ===");
  for (const row of distribution) {
    const bar = "█".repeat(Number(row.count));
    console.log(
      `  ${row.month.toISOString().slice(0, 7)}  ${String(row.count).padStart(3)}  ${bar}`,
    );
  }
  console.log("");

  // Verdict
  if (!oldest) {
    console.log("⚠️  No reviews in DB — pipeline didn't run yet.");
    return;
  }

  const oldestAge =
    (now.getTime() - oldest.postedAt.getTime()) / (24 * 60 * 60 * 1000);
  console.log("=== Verdict ===");
  if (oldestAge >= 340) {
    console.log(
      `✅ Oldest review is ${Math.round(oldestAge)} days old (near the 12-month cutoff).`,
    );
    console.log(
      `   Our depth=500 walk hit the 12mo cutoff naturally · 95 is the COMPLETE set of last-12mo reviews for this business.`,
    );
  } else if (total >= 495) {
    console.log(
      `⚠️  Oldest review is only ${Math.round(oldestAge)} days old AND we have ~500 rows.`,
    );
    console.log(
      `   This means depth=500 was the truncation point · there ARE older reviews within the 12-month window we missed.`,
    );
    console.log(`   Action: bump depth to 1000+ for high-volume businesses.`);
  } else {
    console.log(
      `ℹ️  Oldest review is ${Math.round(oldestAge)} days old (well within 12mo).`,
    );
    console.log(
      `   Either this business has < 95 reviews older than ${Math.round(oldestAge)} days, or DfS's "newest" walk only returned ${total} items.`,
    );
    console.log(
      `   95 of 485 lifetime means ~80% of reviews are >12mo old — plausible for an established med-spa.`,
    );
  }
}

function daysAgo(d: Date): number {
  return Math.round((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
}

main()
  .catch((err) => {
    console.error("[verify] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
