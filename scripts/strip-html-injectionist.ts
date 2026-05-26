#!/usr/bin/env tsx
/**
 * Backfill: strip HTML tags from existing Injectionist reviews
 * (text + ownerReplyText). New reviews go through stripHtml at
 * persist time; this script cleans rows that landed before the fix.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../lib/generated/prisma/client";
import { stripHtml } from "../modules/reviews/persist-helpers";

const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  const biz = await prisma.business.findFirst({
    where: { slug: "the-injectionist-aesthetics" },
    select: { id: true },
  });
  if (!biz) return;

  const reviews = await prisma.review.findMany({
    where: {
      businessId: biz.id,
      OR: [{ text: { contains: "<" } }, { ownerReplyText: { contains: "<" } }],
    },
    select: { id: true, text: true, ownerReplyText: true },
  });
  console.log(`[strip-html] found ${reviews.length} reviews with HTML markers`);

  let updated = 0;
  for (const r of reviews) {
    const newText = r.text ? stripHtml(r.text) : r.text;
    const newReply = r.ownerReplyText
      ? stripHtml(r.ownerReplyText)
      : r.ownerReplyText;
    if (newText !== r.text || newReply !== r.ownerReplyText) {
      await prisma.review.update({
        where: { id: r.id },
        data: { text: newText, ownerReplyText: newReply },
      });
      updated += 1;
    }
  }
  console.log(`[strip-html] updated ${updated} reviews`);
}

main()
  .catch((err) => {
    console.error("failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
