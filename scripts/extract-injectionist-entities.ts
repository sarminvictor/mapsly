#!/usr/bin/env tsx
/**
 * Trigger AI entity extraction for The Injectionist's 95 reviews
 * immediately (without waiting for the daily/reviews-extract-entities
 * cron at 13:30 UTC).
 *
 * Inlines the cron's logic against a CronRun so OpenAI cost tracks
 * normally + the per-service lastMentionedAt update lands too.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

if (!process.env.DATAFORSEO_USERNAME && process.env.DATAFORSEO_LOGIN) {
  process.env.DATAFORSEO_USERNAME = process.env.DATAFORSEO_LOGIN;
}

import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../lib/generated/prisma/client";
import { withCronRun } from "@/lib/cost/cost-counter";
import { extractReviewEntities } from "@/services/ai/extract-entities";

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
      category: true,
      services: {
        where: { isActive: true },
        select: { id: true, name: true },
      },
    },
  });
  if (!biz) {
    console.log("[extract] business not found");
    return;
  }
  const serviceNames = biz.services.map((s) => s.name);
  console.log(
    `[extract] business=${biz.name} · ${biz.services.length} services: ${serviceNames.join(", ")}`,
  );

  const reviews = await prisma.review.findMany({
    where: {
      businessId: biz.id,
      entitiesExtractedAt: null,
      text: { not: null },
    },
    select: { id: true, text: true },
    orderBy: { postedAt: "desc" },
  });
  console.log(`[extract] found ${reviews.length} reviews needing extraction`);

  let processed = 0;
  let withPeople = 0;
  let withServices = 0;
  const serviceMentioned = new Set<string>();

  await withCronRun("manual:extract-injectionist-entities", async () => {
    for (const review of reviews) {
      if (!review.text) continue;
      try {
        const result = await extractReviewEntities({
          reviewText: review.text,
          businessName: biz.name,
          businessCategory: biz.category,
          services: serviceNames,
        });
        await prisma.review.update({
          where: { id: review.id },
          data: {
            mentionedPeople: result.people,
            mentionedServices: result.services,
            entitiesExtractedAt: new Date(),
          },
        });
        if (result.people.length > 0) withPeople += 1;
        if (result.services.length > 0) {
          withServices += 1;
          for (const s of result.services) serviceMentioned.add(s);
        }
        processed += 1;
        if (processed % 10 === 0) {
          console.log(
            `[extract] ${processed}/${reviews.length} · withPeople=${withPeople} · withServices=${withServices}`,
          );
        }
      } catch (err) {
        console.warn(
          `[extract] review ${review.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Update BusinessService.lastMentionedAt for any service that was
    // mentioned at least once.
    if (serviceMentioned.size > 0) {
      const now = new Date();
      await prisma.businessService.updateMany({
        where: {
          businessId: biz.id,
          name: { in: Array.from(serviceMentioned) },
        },
        data: { lastMentionedAt: now },
      });
    }
  });

  console.log(`\n=== Done ===`);
  console.log(`  Processed             : ${processed}/${reviews.length}`);
  console.log(`  Reviews with people   : ${withPeople}`);
  console.log(`  Reviews with services : ${withServices}`);
  console.log(`  Services mentioned    : ${Array.from(serviceMentioned).join(", ") || "(none)"}`);

  // Show top 10 people across all reviews now that data is in DB.
  const peopleRows = await prisma.$queryRaw<
    { name: string; count: bigint }[]
  >`
    SELECT name, COUNT(*)::bigint AS count
    FROM "Review", unnest("mentionedPeople") AS name
    WHERE "businessId" = ${biz.id}
    GROUP BY name
    ORDER BY count DESC
    LIMIT 10
  `;
  console.log(`\n=== Top 10 names ===`);
  for (const r of peopleRows) {
    console.log(`  ${r.name} : ${r.count}`);
  }
}

main()
  .catch((err) => {
    console.error("[extract] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
