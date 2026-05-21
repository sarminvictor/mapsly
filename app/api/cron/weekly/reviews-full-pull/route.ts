// Weekly · reviews-full-pull
//
// Deep reviews pull + AI classification. Where the daily `new-reviews-delta`
// pulls only the latest 20 reviews and skips classification, the weekly
// pass:
//
//   1. Pulls `REVIEW_DEPTH` reviews per business (default 100, max 700).
//   2. UPSERTs each review by `externalId` — older reviews can change
//      (owner edits, ratings refined) and the weekly pull is the only
//      handler that captures those edits.
//   3. Classifies sentiment + extracts themes for any review still
//      missing them (`sentiment IS NULL`).
//   4. Drafts EN + ES replies for unanswered 1–3★ reviews aged > 7d
//      (`isUrgent` flag set when drafted).
//
// Source: `services/dataforseo/reviews` (Live tier, cached 6h) +
// `services/ai/sentiment` + `services/ai/reply-draft`.
//
// Cadence: weekly Monday 11:30 UTC per `vercel.json`. Bounded to 25
// businesses per run by default (review depth × AI classification is the
// expensive piece; 25 × 100 reviews + ~20 AI calls per biz fits a 4-min
// budget at our rate limits).

import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import { reviewsPull } from "@/services/dataforseo";
import { classifyReview, draftReply } from "@/services/ai";
import { generateAndPersistReplyDrafts } from "@/modules/scoring/ai-reply";
import { runBatch, statusFromOutcome } from "../../_lib/batch";
import { reviewItemToPersist } from "../../daily/new-reviews-delta/route";

const JOB = "weekly:reviews-full-pull";
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const REVIEW_DEPTH = 100;
const MAX_CLASSIFY_PER_BIZ = 20;
const MAX_DRAFT_PER_BIZ = 10;
const URGENT_STAR_CEILING = 3;
const URGENT_AGE_DAYS = 7;

interface BusinessRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  googleCid: string;
  country: string | null;
}

export const GET = cronHandler(JOB, async ({ runId }) => {
  const limit = clampLimitFromEnv(DEFAULT_LIMIT, MAX_LIMIT);

  const candidates = await prisma.business.findMany({
    where: {
      isActive: true,
      googleCid: { not: null },
    },
    select: {
      id: true,
      slug: true,
      name: true,
      category: true,
      googleCid: true,
      country: true,
    },
    take: limit,
    orderBy: { lastRefreshedAt: { sort: "asc", nulls: "first" } },
  });

  const rows: BusinessRow[] = candidates
    .filter(
      (
        c,
      ): c is {
        id: string;
        slug: string;
        name: string;
        category: string;
        googleCid: string;
        country: string | null;
      } => typeof c.googleCid === "string" && c.googleCid.length > 0,
    )
    .map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      category: c.category ?? "uncategorized",
      googleCid: c.googleCid,
      country: c.country,
    }));

  const revalidatedSlugs = new Set<string>();
  const touchedReviewIds = new Set<string>();
  let insertedReviews = 0;
  let updatedReviews = 0;
  let classifiedReviews = 0;
  let draftedReplies = 0;

  const outcome = await runBatch(rows, async (biz: BusinessRow) => {
    const result = await reviewsPull({
      cid: biz.googleCid,
      depth: REVIEW_DEPTH,
      sort_by: "newest",
      location_code: locationCodeForCountry(biz.country),
      language_code: "en",
    });

    const items = result.items ?? [];
    if (items.length === 0) return;

    const externalIds = items
      .map((i) => i.review_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    const existing = externalIds.length
      ? await prisma.review.findMany({
          where: { businessId: biz.id, externalId: { in: externalIds } },
          select: {
            id: true,
            externalId: true,
            stars: true,
            ownerReplied: true,
          },
        })
      : [];
    const existingByExternalId = new Map<string, (typeof existing)[number]>();
    for (const r of existing) {
      if (r.externalId) existingByExternalId.set(r.externalId, r);
    }

    for (const item of items) {
      const persist = reviewItemToPersist(item, biz.id);
      if (!persist) continue;
      const prior = existingByExternalId.get(persist.externalId);

      if (!prior) {
        try {
          const created = await prisma.review.create({
            data: persist,
            select: { id: true },
          });
          touchedReviewIds.add(created.id);
          insertedReviews += 1;
        } catch {
          // unique race — skip
        }
        continue;
      }

      // Edits we care about: stars / owner reply state. If any
      // changed, update + reset sentiment so it re-classifies below.
      const drift =
        prior.stars !== persist.stars ||
        prior.ownerReplied !== persist.ownerReplied;
      if (drift) {
        await prisma.review.update({
          where: { id: prior.id },
          data: {
            stars: persist.stars,
            ownerReplied: persist.ownerReplied,
            ownerReplyText: persist.ownerReplyText,
            ownerReplyAt: persist.ownerReplyAt,
            text: persist.text,
            // Edited review needs re-classify.
            sentiment: null,
            themes: [],
          },
        });
        touchedReviewIds.add(prior.id);
        updatedReviews += 1;
      }
    }

    // AI classify any review still missing sentiment.
    const needClassify = await prisma.review.findMany({
      where: {
        businessId: biz.id,
        sentiment: null,
        text: { not: null },
      },
      orderBy: { postedAt: "desc" },
      take: MAX_CLASSIFY_PER_BIZ,
      select: { id: true, stars: true, text: true },
    });

    for (const r of needClassify) {
      if (!r.text) continue;
      const verdict = await classifyReview({
        text: r.text,
        stars: r.stars,
      });
      await prisma.review.update({
        where: { id: r.id },
        data: {
          sentiment: verdict.sentiment,
          themes: verdict.themes,
        },
      });
      touchedReviewIds.add(r.id);
      classifiedReviews += 1;
    }

    // AI draft EN + ES replies for unanswered 1–3★ reviews aged > 7d.
    const urgentCutoff = new Date(
      Date.now() - URGENT_AGE_DAYS * 24 * 60 * 60 * 1000,
    );
    const needDrafts = await prisma.review.findMany({
      where: {
        businessId: biz.id,
        ownerReplied: false,
        stars: { lte: URGENT_STAR_CEILING },
        postedAt: { lt: urgentCutoff },
        aiReplyDraftEn: null,
      },
      orderBy: { postedAt: "desc" },
      take: MAX_DRAFT_PER_BIZ,
      select: { id: true, stars: true, text: true },
    });

    for (const r of needDrafts) {
      if (!r.text) continue;
      const drafts = await draftReply({
        text: r.text,
        stars: r.stars,
        businessName: biz.name,
        category: biz.category,
        tone: "warm",
      });
      await prisma.review.update({
        where: { id: r.id },
        data: {
          aiReplyDraftEn: drafts.en,
          aiReplyDraftEs: drafts.es,
          isUrgent: true,
        },
      });
      draftedReplies += 1;
    }

    revalidatedSlugs.add(biz.slug);
  });

  // D.7 · sweep across all touched reviews this run and draft EN+ES for any
  // still missing both languages. The legacy urgent-only draft pass above
  // ran inline per-biz; this is the broader pass and intentionally idempotent
  // — generateAndPersistReplyDrafts skips reviews whose drafts already exist.
  const aiReply = await generateAndPersistReplyDrafts(
    Array.from(touchedReviewIds),
  );

  for (const slug of revalidatedSlugs) {
    revalidateTag(`business-${slug}-reviews`, "days");
    revalidateTag(`business-${slug}`, "days");
  }

  return {
    itemsProcessed: outcome.succeeded,
    status: statusFromOutcome(outcome),
    meta: {
      runId,
      limit,
      attempted: outcome.attempted,
      succeeded: outcome.succeeded,
      failed: outcome.failures.length,
      insertedReviews,
      updatedReviews,
      classifiedReviews,
      draftedReplies,
      aiReply: {
        processed: aiReply.processed,
        skipped: aiReply.skipped,
        failed: aiReply.failed,
      },
      failureSample: outcome.failures.slice(0, 5).map((f) => ({
        businessId: (f.item as BusinessRow).id,
        error: f.error,
      })),
    },
  };
});

function locationCodeForCountry(country: string | null): number {
  switch ((country ?? "").toUpperCase()) {
    case "CA":
    case "CAN":
      return 2124;
    case "UK":
    case "GB":
      return 2826;
    case "AU":
      return 2036;
    default:
      return 2840;
  }
}

function clampLimitFromEnv(defaultLimit: number, max: number): number {
  const raw = process.env.CRON_WEEKLY_LIMIT;
  if (!raw) return defaultLimit;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultLimit;
  return Math.max(1, Math.min(parsed, max));
}

export const __test = {
  JOB,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  REVIEW_DEPTH,
  MAX_CLASSIFY_PER_BIZ,
  MAX_DRAFT_PER_BIZ,
  URGENT_STAR_CEILING,
  URGENT_AGE_DAYS,
  locationCodeForCountry,
  clampLimitFromEnv,
};
