// modules/reviews/extract-entities-for-business.ts
//
// Event-driven entity extraction · runs immediately after the pingback
// webhook upserts new reviews. Replaces the retired daily cron
// (app/api/cron/daily/reviews-extract-entities · deleted in this PR).
//
// Why event-driven instead of cron:
//   - 0 latency · names/services appear on /(smb)/reviews seconds after
//     the pingback lands (not next day)
//   - Skip-when-empty · 0 new reviews = 0 AI calls (the previous cron
//     scanned every business with entitiesExtractedAt=null on every
//     tick · wasteful when caught up)
//   - Process JUST the new reviews · weekly delta usually has 0-5 new
//     reviews per business, not 95 · keeps cost predictable
//
// Inline runtime in the pingback handler:
//   - Sequential at ~1s per review on gpt-5.4-nano
//   - 95 new reviews (rare · only on first pull) = ~95s · fits in
//     Vercel's 300s function budget
//   - Cap at MAX_INLINE_EXTRACTIONS as a safety net · anything over
//     waits for the next pingback or admin re-trigger to drain (rare)

import prisma from "@/lib/prisma";
import { extractReviewEntities } from "@/services/ai/extract-entities";

/** Cap on per-pingback inline extractions · keeps Vercel function
 *  timeout headroom. 250 × 1s ≈ 250s + 50s buffer for upsert + recompute
 *  = under 300s. Initial pulls with > 250 new reviews are very rare. */
const MAX_INLINE_EXTRACTIONS = 250;

export interface ExtractForBusinessResult {
  processed: number;
  withPeople: number;
  withServices: number;
  servicesMentioned: string[];
  skippedNoText: number;
  cappedAt: number | null;
  failed: number;
}

/**
 * Run extractReviewEntities on the given Review IDs (typically the
 * insertedIds from upsertReviewBatch) and persist mentionedPeople,
 * mentionedServices, entitiesExtractedAt. Also updates the
 * BusinessService.lastMentionedAt for any service that was mentioned.
 *
 * MUST run inside an open CronRun · the underlying OpenAI call asserts
 * cron context for cost tracking.
 */
export async function extractEntitiesForBusiness(
  businessId: string,
  reviewIds: string[],
): Promise<ExtractForBusinessResult> {
  const result: ExtractForBusinessResult = {
    processed: 0,
    withPeople: 0,
    withServices: 0,
    servicesMentioned: [],
    skippedNoText: 0,
    cappedAt: null,
    failed: 0,
  };
  if (reviewIds.length === 0) return result;

  // Cap input ids if over the inline budget.
  let effectiveIds = reviewIds;
  if (reviewIds.length > MAX_INLINE_EXTRACTIONS) {
    effectiveIds = reviewIds.slice(0, MAX_INLINE_EXTRACTIONS);
    result.cappedAt = MAX_INLINE_EXTRACTIONS;
  }

  // Pull business + canonical service list ONCE for the whole batch.
  const biz = await prisma.business.findUnique({
    where: { id: businessId },
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
  if (!biz) return result;
  const serviceNames = biz.services.map((s) => s.name);

  // Pull just the rows we need extraction for.
  const reviews = await prisma.review.findMany({
    where: { id: { in: effectiveIds }, text: { not: null } },
    select: { id: true, text: true },
  });

  // Anything in effectiveIds but not in reviews has null text · count it.
  result.skippedNoText = effectiveIds.length - reviews.length;

  // Track services mentioned across the batch for lastMentionedAt sweep.
  const serviceMentioned = new Set<string>();

  for (const review of reviews) {
    if (!review.text) continue;
    try {
      const extracted = await extractReviewEntities({
        reviewText: review.text,
        businessName: biz.name,
        businessCategory: biz.category,
        services: serviceNames,
      });
      await prisma.review.update({
        where: { id: review.id },
        data: {
          mentionedPeople: extracted.people,
          mentionedServices: extracted.services,
          entitiesExtractedAt: new Date(),
        },
      });
      if (extracted.people.length > 0) result.withPeople += 1;
      if (extracted.services.length > 0) {
        result.withServices += 1;
        for (const s of extracted.services) serviceMentioned.add(s);
      }
      result.processed += 1;
    } catch (err) {
      result.failed += 1;
      console.warn(
        `[extract-entities] review ${review.id} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Don't mark entitiesExtractedAt · row stays NULL and can be
      // picked up by an admin-triggered re-extraction later if needed.
    }
  }

  // BusinessService.lastMentionedAt · one updateMany per business
  // covering all services mentioned in this batch.
  if (serviceMentioned.size > 0) {
    const now = new Date();
    await prisma.businessService.updateMany({
      where: {
        businessId: biz.id,
        name: { in: Array.from(serviceMentioned) },
      },
      data: { lastMentionedAt: now },
    });
    result.servicesMentioned = Array.from(serviceMentioned);
  }

  return result;
}
