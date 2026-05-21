// Daily · new-reviews-delta
//
// Cheap delta-check: pull the latest 20 reviews per business, compare each
// `review_id` against `Review.externalId` in our DB, insert only the new
// ones. Update `Business.rating` + `Business.reviewCount` from the
// adapter's aggregate fields so the dashboard's top-line numbers stay
// fresh between the heavier weekly `reviews-full-pull` (C.9).
//
// Source: `services/dataforseo/reviews` (Live tier, `sort_by=newest`,
// `depth=20`). DataForSEO caches per-CID for 6h internally; same-day reruns
// hit cache and bill $0.
//
// Cadence: daily 11:45 UTC per `vercel.json`. Bounded to 50 businesses per
// run. Only businesses with `googleCid` set are eligible — keyword fallback
// is reserved for the weekly pull where the deeper read justifies the
// fuzziness.

import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import { reviewsPull } from "@/services/dataforseo";
import type { ReviewItem } from "@/services/dataforseo";
import { runBatch, statusFromOutcome } from "../_lib/batch";

const JOB = "daily:new-reviews-delta";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const REVIEW_DEPTH = 20;
/** Skip businesses pulled within this window — the daily cadence runs once
 *  per UTC day; this catches retries triggered manually within the same day. */
const REVIEW_FRESH_MS = 18 * 60 * 60 * 1000;

interface BusinessRow {
  id: string;
  slug: string;
  googleCid: string;
  reviewCount: number | null;
  rating: number | null;
  country: string | null;
}

export const GET = cronHandler(JOB, async ({ runId }) => {
  const limit = clampLimitFromEnv(DEFAULT_LIMIT, MAX_LIMIT);
  const cutoff = new Date(Date.now() - REVIEW_FRESH_MS);

  const candidates = (await prisma.business.findMany({
    where: {
      isActive: true,
      googleCid: { not: null },
      NOT: { reviews: { some: { collectedAt: { gte: cutoff } } } },
    },
    select: {
      id: true,
      slug: true,
      googleCid: true,
      reviewCount: true,
      rating: true,
      country: true,
    },
    take: limit,
    orderBy: { lastRefreshedAt: { sort: "asc", nulls: "first" } },
    // Prisma's nullable `googleCid` is fine — we filtered `not: null`
    // above; TS still sees it as `string | null` so we narrow below.
  })) as Array<{
    id: string;
    slug: string;
    googleCid: string | null;
    reviewCount: number | null;
    rating: number | null;
    country: string | null;
  }>;

  const rows: BusinessRow[] = candidates
    .filter((c): c is BusinessRow => c.googleCid != null)
    .map((c) => ({ ...c, googleCid: c.googleCid as string }));

  const revalidatedSlugs = new Set<string>();
  let newReviews = 0;
  let businessesWithNewReviews = 0;

  const outcome = await runBatch(rows, async (biz: BusinessRow) => {
    const result = await reviewsPull({
      cid: biz.googleCid,
      depth: REVIEW_DEPTH,
      sort_by: "newest",
      location_code: locationCodeForCountry(biz.country),
      language_code: "en",
    });

    // Cheap optimization: if the adapter's aggregate `reviews_count` equals
    // what we have on Business, no NEW reviews are possible — skip the
    // per-review insert loop entirely. Still update rating in case it drifted.
    const remoteCount = result.totalReviewsCount ?? null;
    const remoteRating = result.aggregateRating ?? null;

    if (
      remoteCount != null &&
      biz.reviewCount != null &&
      remoteCount === biz.reviewCount &&
      // Rating may have shifted even if count didn't (edited reviews).
      remoteRating === biz.rating
    ) {
      return; // nothing to do
    }

    // Process newest-first; insert only those whose externalId is not in DB.
    const items = result.items ?? [];
    const externalIds = items
      .map((i) => i.review_id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);

    const knownExternal = externalIds.length
      ? await prisma.review.findMany({
          where: { businessId: biz.id, externalId: { in: externalIds } },
          select: { externalId: true },
        })
      : [];
    const known = new Set(knownExternal.map((r) => r.externalId));

    let addedHere = 0;
    for (const item of items) {
      if (!item.review_id || known.has(item.review_id)) continue;
      const row = reviewItemToPersist(item, biz.id);
      if (!row) continue; // missing required fields → skip silently
      try {
        await prisma.review.create({ data: row });
        addedHere += 1;
      } catch {
        // Likely a race with concurrent insert — skip.
      }
    }

    if (addedHere > 0) {
      businessesWithNewReviews += 1;
      newReviews += addedHere;
    }

    // Always bump Business aggregate fields when adapter returned them — keeps
    // dashboard counts fresh even when there are no new individual reviews.
    if (remoteCount != null || remoteRating != null) {
      await prisma.business.update({
        where: { id: biz.id },
        data: {
          ...(remoteCount != null ? { reviewCount: remoteCount } : {}),
          ...(remoteRating != null ? { rating: remoteRating } : {}),
        },
      });
    }

    revalidatedSlugs.add(biz.slug);
  });

  for (const slug of revalidatedSlugs) {
    revalidateTag(`business-${slug}-reviews`, "hours");
    revalidateTag(`business-${slug}`, "hours");
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
      newReviews,
      businessesWithNewReviews,
      failureSample: outcome.failures.slice(0, 5).map((f) => ({
        businessId: (f.item as BusinessRow).id,
        error: f.error,
      })),
    },
  };
});

/**
 * Map a DataForSEO review item into the Review insert shape. Returns null
 * if the row is missing fields we can't synthesize defaults for
 * (`review_id`, `rating.value`, `timestamp`).
 *
 * Reviewer name is anonymized to initials per `.claude/rules/security.md` §
 * PII handling — never store the full profile name. e.g. "John Doe" →
 * "J.D."; single-token names → first letter only.
 */
export function reviewItemToPersist(
  item: ReviewItem,
  businessId: string,
): {
  businessId: string;
  externalId: string;
  reviewerName: string;
  stars: number;
  text: string | null;
  language: string | null;
  postedAt: Date;
  ownerReplied: boolean;
  ownerReplyText: string | null;
  ownerReplyAt: Date | null;
  reviewerProfileReviews: number | null;
} | null {
  const ratingValue =
    typeof item.rating?.value === "number" ? item.rating.value : null;
  const timestamp = item.timestamp ? new Date(item.timestamp) : null;
  if (
    !item.review_id ||
    ratingValue == null ||
    !timestamp ||
    Number.isNaN(timestamp.getTime())
  ) {
    return null;
  }

  const stars = clampStars(ratingValue);
  const reviewerName = anonymizeReviewerName(item.profile_name);

  const ownerReplyText =
    typeof item.owner_answer === "string" && item.owner_answer.trim().length > 0
      ? item.owner_answer.trim()
      : null;
  const ownerReplyAt = item.owner_time_of_answer
    ? safeDate(item.owner_time_of_answer)
    : null;

  return {
    businessId,
    externalId: item.review_id,
    reviewerName,
    stars,
    text: item.review_text?.toString() ?? null,
    language: null, // weekly handler will fill via classifier
    postedAt: timestamp,
    ownerReplied: ownerReplyText != null,
    ownerReplyText,
    ownerReplyAt,
    reviewerProfileReviews:
      typeof item.reviews_count === "number" ? item.reviews_count : null,
  };
}

export function anonymizeReviewerName(raw: string | null | undefined): string {
  if (!raw) return "Anon";
  const parts = raw
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return "Anon";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return parts
    .slice(0, 3)
    .map((p) => p.charAt(0).toUpperCase())
    .join(".");
}

function clampStars(v: number): number {
  // Google rating is 1–5; DataForSEO occasionally surfaces decimals.
  // Clamp + round-to-nearest-integer per Review.stars schema (Int).
  const n = Math.round(v);
  if (n < 1) return 1;
  if (n > 5) return 5;
  return n;
}

function safeDate(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

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
  const raw = process.env.CRON_DAILY_LIMIT;
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
  REVIEW_FRESH_MS,
  reviewItemToPersist,
  anonymizeReviewerName,
  clampStars,
  locationCodeForCountry,
  clampLimitFromEnv,
};
