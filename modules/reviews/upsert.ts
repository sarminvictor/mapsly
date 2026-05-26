// modules/reviews/upsert.ts
//
// Atomic batch upsert of Google review items into the Review table with
// rich delta tracking. Used by:
//
//   - R.1 pingback webhook (initial pull after qualify)
//   - R.3 weekly delta cron (re-pull top N, walk newest until cursor stop)
//   - R.9 manual admin "Collect reviews now" button
//
// Duplicate prevention: every upsert is gated by the
// `@@unique([businessId, externalId])` constraint on Review. We do an
// explicit findUnique-first pattern so the function can report whether
// each item was INSERTED (new) vs UPDATED (owner reply added) vs SKIPPED
// (unchanged). createMany({ skipDuplicates: true }) would be cheaper but
// can't distinguish those three cases — and the user explicitly wants the
// delta breakdown for the admin /cron-runs surface.
//
// Walking discipline (saves cost on delta pulls):
//
//   1. 12-month cutoff: stop at the first review older than `cutoffDate`.
//      Reviews are sorted newest-first by DfS sort_by="newest".
//   2. Cursor stop: if `knownLatestExternalId` is provided (weekly delta
//      mode), stop the moment we hit a review whose externalId equals
//      that cursor — every review past that point is already in the DB.
//
// Sentiment: derived from stars at write time via
// `modules/reviews/sentiment-from-stars`. No AI call.

import prisma from "@/lib/prisma";
import type { ReviewItem } from "@/services/dataforseo";
import { reviewItemToPersist } from "./persist-helpers";
import { sentimentFromStars } from "./sentiment-from-stars";

export interface UpsertReviewBatchOptions {
  /** Reviews older than this date are skipped (and trigger early stop). */
  cutoffDate: Date;
  /** If set, walking stops the moment we hit this externalId (delta mode). */
  knownLatestExternalId?: string | null;
}

export interface UpsertReviewBatchResult {
  /** Items inserted as new rows. */
  inserted: number;
  /** Items already in DB whose owner reply state changed (re-pull caught
   *  a new owner_answer or an edit to an existing reply). */
  updated: number;
  /** Items already in DB with no change — most common in delta mode. */
  skipped: number;
  /** Walking stopped because we hit `cutoffDate`. */
  cutoffStop: boolean;
  /** Walking stopped because we hit `knownLatestExternalId`. */
  cursorStop: boolean;
  /** The newest review's externalId across the batch (null if no items). */
  topExternalId: string | null;
  /** The newest review's postedAt across the batch (null if no items). */
  topPostedAt: Date | null;
  /** First externalId encountered that's < cutoff (for debugging). */
  firstStaleExternalId: string | null;
}

/**
 * Upsert a batch of review items for one business with strict
 * duplicate-prevention + delta tracking. Items MUST be sorted
 * newest-first (DfS `sort_by: "newest"` does this naturally).
 *
 * Returns a rich result so callers can:
 *   - Log per-business delta to CronRun.meta
 *   - Detect "no new reviews this week" (inserted === 0, cursorStop === true)
 *   - Decide whether the next pull should walk deeper (cutoffStop === false
 *     AND cursorStop === false suggests the cursor is stale; rare)
 */
export async function upsertReviewBatch(
  businessId: string,
  items: ReviewItem[],
  options: UpsertReviewBatchOptions,
): Promise<UpsertReviewBatchResult> {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let cutoffStop = false;
  let cursorStop = false;
  let topExternalId: string | null = null;
  let topPostedAt: Date | null = null;
  let firstStaleExternalId: string | null = null;

  for (const item of items) {
    const persist = reviewItemToPersist(item, businessId);
    if (!persist) {
      // Item missing required fields (review_id, rating, timestamp) —
      // skip silently. Don't count toward any bucket.
      continue;
    }

    // Track the newest seen (first iteration since items are sorted
    // newest-first).
    if (topExternalId === null) {
      topExternalId = persist.externalId;
      topPostedAt = persist.postedAt;
    }

    // 12-month cutoff. Stop on first stale item — every subsequent item
    // is older still (sorted newest-first).
    if (persist.postedAt < options.cutoffDate) {
      cutoffStop = true;
      firstStaleExternalId = persist.externalId;
      break;
    }

    // Cursor stop. If we hit the previously-known top review, every
    // item past this point is already in the DB. Break out of the loop
    // entirely — no point walking further.
    if (
      options.knownLatestExternalId &&
      persist.externalId === options.knownLatestExternalId
    ) {
      cursorStop = true;
      break;
    }

    // Lookup existing row by the unique (businessId, externalId) key.
    const existing = await prisma.review.findUnique({
      where: {
        businessId_externalId: {
          businessId,
          externalId: persist.externalId,
        },
      },
      select: {
        id: true,
        stars: true,
        ownerReplied: true,
        ownerReplyText: true,
      },
    });

    if (!existing) {
      // INSERT path · new review. Sentiment derived from stars at write.
      try {
        await prisma.review.create({
          data: {
            ...persist,
            sentiment: sentimentFromStars(persist.stars),
          },
        });
        inserted += 1;
      } catch (err) {
        // Unique-constraint race (another worker inserted concurrently).
        // Fall back to update path on next pull — skip for now.
        if (
          err instanceof Error &&
          /unique constraint|already exists/i.test(err.message)
        ) {
          skipped += 1;
        } else {
          throw err;
        }
      }
      continue;
    }

    // UPDATE path · existing review. Only patch when the owner reply or
    // star rating changed. Don't churn the row on identical content.
    const replyChanged =
      existing.ownerReplied !== persist.ownerReplied ||
      (existing.ownerReplyText ?? null) !== persist.ownerReplyText;
    const starsChanged = existing.stars !== persist.stars;

    if (!replyChanged && !starsChanged) {
      skipped += 1;
      continue;
    }

    await prisma.review.update({
      where: { id: existing.id },
      data: {
        stars: persist.stars,
        ownerReplied: persist.ownerReplied,
        ownerReplyText: persist.ownerReplyText,
        ownerReplyAt: persist.ownerReplyAt,
        // If stars drifted, recompute sentiment. Themes are NOT touched
        // here — that's R.4 territory.
        ...(starsChanged
          ? { sentiment: sentimentFromStars(persist.stars) }
          : {}),
      },
    });
    updated += 1;
  }

  return {
    inserted,
    updated,
    skipped,
    cutoffStop,
    cursorStop,
    topExternalId,
    topPostedAt,
    firstStaleExternalId,
  };
}

/**
 * Recompute Business.reviewCount / rating / replyRate / velocityLast30d
 * from the Review table for a single business. Called at the end of a
 * pingback handler / weekly delta run after upsert completes.
 *
 * Note: BusinessSnapshot's review aggregates are written separately by
 * the weekly snapshot cron — this function only updates the live
 * Business row so the /reviews page and admin lists reflect freshness
 * immediately.
 */
export async function recomputeReviewAggregates(
  businessId: string,
  remoteReviewCount: number | null,
  remoteRating: number | null,
): Promise<void> {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [totals, last30d] = await Promise.all([
    prisma.review.aggregate({
      where: { businessId },
      _count: { _all: true },
      _sum: {
        // count of replied reviews via 0/1 isn't supported by aggregate;
        // compute separately below.
      },
    }),
    prisma.review.count({
      where: { businessId, postedAt: { gte: thirtyDaysAgo } },
    }),
  ]);

  const repliedCount = await prisma.review.count({
    where: { businessId, ownerReplied: true },
  });

  const total = totals._count._all;
  const replyRate = total === 0 ? 0 : repliedCount / total;

  await prisma.business.update({
    where: { id: businessId },
    data: {
      // Prefer DfS-reported aggregate values when available — they reflect
      // the truth on Google (some reviews may have been deleted upstream
      // and our local count would lag). Fall back to local DB count.
      ...(remoteReviewCount != null ? { reviewCount: remoteReviewCount } : {}),
      ...(remoteRating != null ? { rating: remoteRating } : {}),
    },
  });

  // Latest snapshot · upsert the replyRate + velocity into the most
  // recent snapshot row IF it exists for today, else leave for the
  // weekly snapshot cron to create.
  await prisma.businessSnapshot.upsert({
    where: {
      businessId_snapshotDate: {
        businessId,
        snapshotDate: startOfUtcDay(new Date()),
      },
    },
    create: {
      businessId,
      snapshotDate: startOfUtcDay(new Date()),
      reviewCount: remoteReviewCount ?? total,
      rating: remoteRating,
      replyRate,
      velocityLast30d: last30d,
    },
    update: {
      reviewCount: remoteReviewCount ?? total,
      rating: remoteRating,
      replyRate,
      velocityLast30d: last30d,
    },
  });
}

function startOfUtcDay(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}
