// modules/reviews/harvest-pending.ts
//
// Poll-harvest a business's in-flight DataForSEO review task DIRECTLY via
// task_get — the pingback-independent path.
//
// The normal flow (modules/reviews/trigger-pull) posts a Standard-queue task
// and waits for DataForSEO to call our pingback webhook. When that pingback
// never arrives (observed in prod · the recovery that pulled 7,151 reviews
// polled task_get instead), the reviews sit unharvested with
// Business.pendingReviewsTaskId still set, and the next delta pull skips with
// reason "in_flight" — so reviews never refresh for that business.
//
// This fetches the task result directly and writes it — the exact
// orchestration the pingback handler runs (app/api/webhooks/dataforseo/reviews),
// keyed by businessId instead of a pingback lookup. Used by the admin
// "Harvest" button; safe to fold into the weekly reviews-delta cron as a
// self-healing pre-step.
//
// MUST run inside an open CronRun (reviewsTaskGet → dataforSeoGet bills the
// pull). The caller wraps with withCronRun.

import { revalidateTag } from "next/cache";

import prisma from "@/lib/prisma";
import { reviewsTaskGet } from "@/services/dataforseo";
import {
  upsertReviewBatch,
  recomputeReviewAggregates,
} from "@/modules/reviews/upsert";
import { extractEntitiesForBusiness } from "@/modules/reviews/extract-entities-for-business";

const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;

export type HarvestReviewsResult =
  | { harvested: true; taskId: string; items: number; inserted: number }
  | {
      harvested: false;
      reason: "not_found" | "nothing_pending" | "not_ready" | "task_get_failed";
    };

/**
 * Directly fetch + persist a business's pending review task (no pingback).
 * Leaves the task pending on "not ready" so a later harvest (or a late
 * pingback) can still resolve it; clears the cursor only after a successful
 * write.
 */
export async function harvestPendingReviewsForBusiness(
  businessId: string,
): Promise<HarvestReviewsResult> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      slug: true,
      ownerUserId: true,
      latestReviewExternalId: true,
      reviewsFirstPulledAt: true,
      pendingReviewsTaskId: true,
    },
  });
  if (!business) return { harvested: false, reason: "not_found" };
  if (!business.pendingReviewsTaskId) {
    return { harvested: false, reason: "nothing_pending" };
  }
  const taskId = business.pendingReviewsTaskId;

  let result: Awaited<ReturnType<typeof reviewsTaskGet>>;
  try {
    result = await reviewsTaskGet(taskId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Task still processing in the DfS Standard queue · leave it pending so a
    // later harvest (or the pingback) resolves it.
    if (/status_code\s*40602|not ready/i.test(message)) {
      return { harvested: false, reason: "not_ready" };
    }
    console.warn(
      `[reviews:harvest ${businessId}] task_get failed (taskId=${taskId.slice(0, 8)}): ${message}`,
    );
    return { harvested: false, reason: "task_get_failed" };
  }

  const cutoffDate = new Date(Date.now() - TWELVE_MONTHS_MS);
  const upsertResult = await upsertReviewBatch(business.id, result.items, {
    cutoffDate,
    knownLatestExternalId: business.latestReviewExternalId,
  });

  // Update Business cursor + clear pending task_id (mirrors the pingback
  // handler · the cleared cursor also makes a later pingback a no-op).
  const now = new Date();
  await prisma.business.update({
    where: { id: business.id },
    data: {
      pendingReviewsTaskId: null,
      reviewsFirstPulledAt: business.reviewsFirstPulledAt ?? now,
      reviewsLastDeltaAt: now,
      latestReviewExternalId:
        upsertResult.topExternalId ?? business.latestReviewExternalId,
      latestReviewPostedAt: upsertResult.topPostedAt ?? undefined,
      lastRefreshedAt: now,
    },
  });

  await recomputeReviewAggregates(
    business.id,
    result.totalReviewsCount,
    result.aggregateRating,
  );

  if (upsertResult.insertedIds.length > 0) {
    await extractEntitiesForBusiness(business.id, upsertResult.insertedIds);
  }

  try {
    revalidateTag(`business-${business.slug}-reviews`, "hours");
    revalidateTag(`business-${business.slug}`, "hours");
    if (business.ownerUserId) {
      revalidateTag(`smb-reviews-${business.ownerUserId}`, "minutes");
    }
    revalidateTag(`review-trends-${business.id}`, "minutes");
  } catch {
    // Non-request scope (e.g. cron pre-step) · revalidate is best-effort.
  }

  return {
    harvested: true,
    taskId,
    items: result.items.length,
    inserted: upsertResult.insertedIds.length,
  };
}
