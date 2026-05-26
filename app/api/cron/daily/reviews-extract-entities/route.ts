// Daily · reviews-extract-entities
//
// R.4 backfill cron · runs services/ai/extract-entities over Review
// rows that haven't been processed yet (entitiesExtractedAt IS NULL)
// AND have text content. Persists:
//   - Review.mentionedPeople[]
//   - Review.mentionedServices[]
//   - Review.entitiesExtractedAt
//   - BusinessService.lastMentionedAt (when a service was mentioned)
//
// Cost discipline:
//   - gpt-5.4-nano @ ~$0.00002/review (50 input tokens, 30 output)
//   - Bounded batch: default 200/run (cap MAX_LIMIT=500)
//   - Total daily cost at 1000 paid businesses × ~5 new reviews/day:
//     5000 × $0.00002 = $0.10/day = $36/year
//
// Selection rules:
//   - Review.entitiesExtractedAt IS NULL · never processed
//   - Review.text IS NOT NULL · text is required for extraction
//   - Order by collectedAt DESC · newest first so /reviews UI is fresh
//
// Performance:
//   - N+1 mitigated by grouping reviews by businessId · one Business +
//     BusinessService fetch per group, not per review
//   - Sequential AI calls (gpt-5.4-nano rate limit · 50 req/min on the
//     starter tier · sequential at ~1s each fits comfortably within
//     the 300s cron budget for 200 reviews)

import prisma from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import { extractReviewEntities } from "@/services/ai";

const JOB = "daily:reviews-extract-entities";
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export const GET = cronHandler(JOB, async ({ runId }) => {
  const limit = clampLimitFromEnv(DEFAULT_LIMIT, MAX_LIMIT);

  // 1. Candidates · reviews needing extraction, newest first.
  const candidates = await prisma.review.findMany({
    where: {
      entitiesExtractedAt: null,
      text: { not: null },
    },
    select: {
      id: true,
      businessId: true,
      text: true,
    },
    take: limit,
    orderBy: { postedAt: "desc" },
  });

  if (candidates.length === 0) {
    return {
      itemsProcessed: 0,
      meta: { runId, message: "no_reviews_pending_extraction" },
    };
  }

  // 2. Group by businessId so we fetch each Business + its services once.
  const byBusiness = new Map<string, typeof candidates>();
  for (const r of candidates) {
    const list = byBusiness.get(r.businessId);
    if (list) list.push(r);
    else byBusiness.set(r.businessId, [r]);
  }

  // 3. Fetch business context (name + category + active services) per group.
  const businessIds = Array.from(byBusiness.keys());
  const businesses = await prisma.business.findMany({
    where: { id: { in: businessIds } },
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
  const bizContext = new Map(businesses.map((b) => [b.id, b]));

  // Track which services were mentioned (for lastMentionedAt update).
  const serviceNameMentioned = new Map<string, Set<string>>(); // businessId → set of canonical service names

  let processed = 0;
  let failed = 0;
  let withPeople = 0;
  let withServices = 0;

  for (const [businessId, reviews] of byBusiness) {
    const biz = bizContext.get(businessId);
    if (!biz) {
      // Business gone — mark these reviews extracted-with-empty to skip
      // them next time. Shouldn't happen often (cascade delete would
      // also drop the reviews) but defensive.
      await prisma.review.updateMany({
        where: { id: { in: reviews.map((r) => r.id) } },
        data: {
          mentionedPeople: [],
          mentionedServices: [],
          entitiesExtractedAt: new Date(),
        },
      });
      continue;
    }

    const serviceNames = biz.services.map((s) => s.name);

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
          // Stage service-mention updates for the lastMentionedAt sweep.
          const set = serviceNameMentioned.get(businessId) ?? new Set<string>();
          for (const s of result.services) set.add(s);
          serviceNameMentioned.set(businessId, set);
        }
        processed += 1;
      } catch (err) {
        failed += 1;
        console.warn(
          `[${JOB}] extract failed for review ${review.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Don't mark entitiesExtractedAt · the row will be retried next
        // cron tick. After 3 consecutive failures the loop's daily
        // cost-audit will surface the recurring failure.
      }
    }
  }

  // 4. Bulk update BusinessService.lastMentionedAt for any service that
  //    was mentioned in this batch. Use updateMany per business (cheap).
  const now = new Date();
  for (const [businessId, mentionedNames] of serviceNameMentioned) {
    if (mentionedNames.size === 0) continue;
    await prisma.businessService.updateMany({
      where: {
        businessId,
        name: { in: Array.from(mentionedNames) },
      },
      data: { lastMentionedAt: now },
    });
  }

  return {
    itemsProcessed: processed,
    status: failed > 0 && processed === 0 ? ("PARTIAL" as const) : undefined,
    meta: {
      runId,
      candidates: candidates.length,
      businesses: byBusiness.size,
      processed,
      failed,
      withPeople,
      withServices,
      servicesMentionedByBusinessSample: Array.from(serviceNameMentioned)
        .slice(0, 5)
        .map(([bid, set]) => ({ businessId: bid, services: Array.from(set) })),
    },
  };
});

// Allow manual trigger via POST.
export const POST = GET;

function clampLimitFromEnv(defaultLimit: number, max: number): number {
  const raw = process.env.CRON_DAILY_EXTRACT_LIMIT;
  if (!raw) return defaultLimit;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultLimit;
  return Math.max(1, Math.min(parsed, max));
}

export const __test = {
  JOB,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  clampLimitFromEnv,
};
