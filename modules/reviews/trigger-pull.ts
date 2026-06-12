// modules/reviews/trigger-pull.ts
//
// Submit a DataForSEO Standard-queue review-pull task for one business.
// Used by:
//   - R.2 qualify-time hook · runs after every qualifyBusiness() success
//   - R.9 manual admin trigger ("Collect reviews now" button)
//   - R.3 weekly delta cron · with `mode: "delta"`
//
// Idempotency / cost discipline guards:
//   - Skip if Business.pendingReviewsTaskId is set (in-flight pull)
//   - Skip if Business.googleCid is missing (can't query DfS)
//   - For initial-pull mode: skip if Business.reviewsFirstPulledAt is set
//   - Paid-location gate via lib/reviews/should-collect
//
// MUST be called inside an open CronRun (assertCronContext via the
// downstream `reviewsTaskPost` → `dataforSeoPost` chain). The caller —
// qualify-one route or admin action — is responsible for wrapping.

import prisma from "@/lib/prisma";
import { reviewsTaskPost } from "@/services/dataforseo";
import { shouldCollectReviewsForBusiness } from "@/lib/reviews/should-collect";
import { locationCodeForCountry } from "./persist-helpers";

export interface TriggerReviewPullOptions {
  /** "initial" — fired by qualify-one. Hard-skips if reviewsFirstPulledAt
   *  is already set (one-time pull per business · weekly cron handles
   *  deltas after that).
   *  "delta" — fired by weekly cron. Skips only if a pull is in-flight.
   *  "manual" — fired by admin action. Skips only if in-flight. */
  mode: "initial" | "delta" | "manual";
  /** Override default depth · default 500 for initial, 50 for delta. */
  depth?: number;
}

export type TriggerReviewPullResult =
  | { triggered: true; taskId: string; mode: TriggerReviewPullOptions["mode"] }
  | { triggered: false; reason: TriggerSkipReason };

export type TriggerSkipReason =
  | "not_found"
  | "no_cid"
  | "in_flight"
  | "already_pulled"
  | "no_paid_in_location"
  | "task_post_failed";

const DEFAULT_DEPTH = {
  initial: 500,
  delta: 50,
  manual: 500,
} as const;

/**
 * Submit a DfS task_post for one business. Returns whether the task
 * was actually submitted (and the task_id) or a skip reason.
 *
 * On success, `Business.pendingReviewsTaskId` is set so the pingback
 * handler can find this business when results arrive (up to 45 min later).
 */
export async function triggerReviewPullForBusiness(
  businessId: string,
  options: TriggerReviewPullOptions,
): Promise<TriggerReviewPullResult> {
  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      googleCid: true,
      country: true,
      reviewsFirstPulledAt: true,
      pendingReviewsTaskId: true,
    },
  });
  if (!biz) return { triggered: false, reason: "not_found" };
  if (!biz.googleCid) return { triggered: false, reason: "no_cid" };
  if (biz.pendingReviewsTaskId) {
    return { triggered: false, reason: "in_flight" };
  }
  if (options.mode === "initial" && biz.reviewsFirstPulledAt) {
    return { triggered: false, reason: "already_pulled" };
  }

  // Paid-location gate · saves money in cells with no paid relationship.
  // Bypassable via MAPSLY_COLLECT_REVIEWS_ALLOW_ALL=1.
  // Manual admin pulls bypass it entirely: the gate guards *automatic* bulk
  // collection (qualify-time + weekly cron), not a deliberate one-business
  // admin click. An admin pressing "Pull reviews" should never be silently
  // skipped because the cell has no paying customer yet (e.g. pre-launch).
  if (options.mode !== "manual") {
    const eligible = await shouldCollectReviewsForBusiness(businessId);
    if (!eligible) {
      return { triggered: false, reason: "no_paid_in_location" };
    }
  }

  // Submit the task. dataforSeoPost's assertCronContext will throw if
  // we're not in a CronRun — that's the desired "no live API in user
  // path" enforcement.
  try {
    const { taskId } = await reviewsTaskPost({
      cid: biz.googleCid,
      location_code: locationCodeForCountry(biz.country),
      language_code: "en",
      depth: options.depth ?? DEFAULT_DEPTH[options.mode],
      sort_by: "newest",
      tag: `mapsly:${options.mode}:biz_${businessId}`,
      priority: 1,
    });

    // Persist the in-flight cursor so the pingback can resolve the biz.
    await prisma.business.update({
      where: { id: businessId },
      data: { pendingReviewsTaskId: taskId },
    });

    return { triggered: true, taskId, mode: options.mode };
  } catch (err) {
    console.warn(
      `[reviews:trigger-pull ${businessId}] task_post failed (mode=${options.mode}): ${err instanceof Error ? err.message : String(err)}`,
    );
    return { triggered: false, reason: "task_post_failed" };
  }
}
