#!/usr/bin/env tsx
/**
 * Audit why ServiceMentionsCard + MentionedNamesCard + ThemesCard are
 * empty for The Injectionist. Outputs:
 *   1. BusinessService rows (the canonical service list to match against)
 *   2. Review.themes status across all 95 reviews
 *   3. Review.mentionedPeople + mentionedServices status
 *   4. Review.entitiesExtractedAt status (has the daily cron run?)
 *   5. Business.placeTopics (DfS-extracted theme keywords · alternative
 *      source for ThemesCard)
 *   6. Sample of 5 reviews with actual text so we can eyeball whether
 *      services + names are obviously present in the text but missed
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
      placeTopics: true,
      services: {
        where: { isActive: true },
        select: { name: true, source: true, lastMentionedAt: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  if (!biz) {
    console.log("business not found");
    return;
  }

  console.log("=== BusinessService rows (canonical list) ===");
  console.log(`  ${biz.services.length} active services:`);
  for (const s of biz.services) {
    console.log(
      `    - "${s.name}" (source=${s.source} · lastMentionedAt=${s.lastMentionedAt?.toISOString() ?? "never"})`,
    );
  }

  console.log("\n=== Review.entitiesExtractedAt status ===");
  const [neverExtracted, alreadyExtracted, totalRows] = await Promise.all([
    prisma.review.count({
      where: { businessId: biz.id, entitiesExtractedAt: null },
    }),
    prisma.review.count({
      where: { businessId: biz.id, entitiesExtractedAt: { not: null } },
    }),
    prisma.review.count({ where: { businessId: biz.id } }),
  ]);
  console.log(`  Total reviews          : ${totalRows}`);
  console.log(`  Already extracted      : ${alreadyExtracted}`);
  console.log(`  Never extracted (cron not yet run) : ${neverExtracted}`);

  console.log("\n=== Review.themes / mentionedPeople / mentionedServices ===");
  const reviewStats = await prisma.review.findMany({
    where: { businessId: biz.id },
    select: {
      themes: true,
      mentionedPeople: true,
      mentionedServices: true,
    },
  });
  const themesNonEmpty = reviewStats.filter((r) => r.themes.length > 0).length;
  const peopleNonEmpty = reviewStats.filter(
    (r) => r.mentionedPeople.length > 0,
  ).length;
  const servicesNonEmpty = reviewStats.filter(
    (r) => r.mentionedServices.length > 0,
  ).length;
  console.log(`  Reviews with themes[]            : ${themesNonEmpty}`);
  console.log(`  Reviews with mentionedPeople[]   : ${peopleNonEmpty}`);
  console.log(`  Reviews with mentionedServices[] : ${servicesNonEmpty}`);

  console.log("\n=== Business.placeTopics (DfS-extracted themes · alt source) ===");
  if (biz.placeTopics) {
    const topics = biz.placeTopics as Record<string, number>;
    const entries = Object.entries(topics).slice(0, 15);
    if (entries.length === 0) {
      console.log("  (empty object)");
    } else {
      for (const [k, v] of entries) {
        console.log(`    - "${k}" : ${v}`);
      }
    }
  } else {
    console.log("  (null · DfS didn't surface place_topics for this business)");
  }

  console.log("\n=== Sample reviews (5 random with text) ===");
  const samples = await prisma.review.findMany({
    where: { businessId: biz.id, text: { not: null } },
    select: {
      stars: true,
      reviewerName: true,
      text: true,
      postedAt: true,
      mentionedPeople: true,
      mentionedServices: true,
      themes: true,
    },
    orderBy: { postedAt: "desc" },
    take: 5,
  });
  for (const [i, r] of samples.entries()) {
    console.log(
      `\n  [${i + 1}] ${r.postedAt.toISOString().slice(0, 10)} · ${r.stars}★ · ${r.reviewerName}`,
    );
    console.log(`     text   : "${r.text?.slice(0, 220) ?? ""}${r.text && r.text.length > 220 ? "…" : ""}"`);
    console.log(`     people : [${r.mentionedPeople.join(", ")}]`);
    console.log(`     services: [${r.mentionedServices.join(", ")}]`);
    console.log(`     themes  : [${r.themes.join(", ")}]`);
  }
}

main()
  .catch((err) => {
    console.error("[audit] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
