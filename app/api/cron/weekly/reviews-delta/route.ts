// Weekly · reviews-delta
//
// Replaces the old daily/new-reviews-delta + weekly/reviews-full-pull.
// Both were Live-tier synchronous pulls that bogged down inside the
// 300s Vercel function budget. The new flow uses DataForSEO Standard
// queue + pingback so this cron just FIRES task_posts and returns
// immediately. The actual review upserts happen asynchronously when
// DfS pings /api/webhooks/dataforseo/reviews per task.
//
// Selection rules:
//   - Must have googleCid (otherwise we can't query DfS)
//   - reviewsFirstPulledAt IS NOT NULL · only deltas for businesses
//     that had an initial pull (qualify-time R.2 hook handles that)
//   - pendingReviewsTaskId IS NULL · not already in-flight
//   - reviewsLastDeltaAt < now-7d OR NULL · skip recently-delta'd
//   - Paid-location gate (lib/reviews/should-collect) · only paid cells
//
// Bounded batch (default 100 businesses per run, override via
// CRON_WEEKLY_REVIEWS_LIMIT) so a misconfiguration can't bill 2k
// task_posts in one tick.
//
// Cost: task_post itself ~$0.00075. Real cost lands later when each
// pingback fires task_get + bills per items returned. Typical delta
// week: 1-5 new reviews per business (depth=50 walks newest until
// hitting cursor or 12-month cutoff).

import prisma from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import { triggerReviewPullForBusiness } from "@/modules/reviews/trigger-pull";
import { filterEligibleBusinesses } from "@/lib/reviews/should-collect";

const JOB = "weekly:reviews-delta";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const DELTA_FRESH_DAYS = 7;

export const GET = cronHandler(JOB, async ({ runId }) => {
  const limit = clampLimitFromEnv(DEFAULT_LIMIT, MAX_LIMIT);
  const freshCutoff = new Date(
    Date.now() - DELTA_FRESH_DAYS * 24 * 60 * 60 * 1000,
  );

  // 1. Candidate selection · cheap WHERE on indexed columns.
  const candidates = await prisma.business.findMany({
    where: {
      isActive: true,
      googleCid: { not: null },
      reviewsFirstPulledAt: { not: null },
      pendingReviewsTaskId: null,
      OR: [
        { reviewsLastDeltaAt: null },
        { reviewsLastDeltaAt: { lt: freshCutoff } },
      ],
    },
    select: { id: true },
    take: limit,
    orderBy: { reviewsLastDeltaAt: { sort: "asc", nulls: "first" } },
  });

  if (candidates.length === 0) {
    return {
      itemsProcessed: 0,
      meta: { runId, candidates: 0, message: "no_eligible_businesses" },
    };
  }

  // 2. Paid-location gate · group-aware (one query per cell, not per biz).
  const eligibleIds = await filterEligibleBusinesses(
    candidates.map((c) => c.id),
  );

  // 3. Fire task_posts. Each is fast (~1s) — sequential is fine and avoids
  //    DfS rate-limit thundering. For 100 businesses this is ~100s, within
  //    the 300s cron budget.
  let triggered = 0;
  let skipped = 0;
  const skipReasons: Record<string, number> = {};
  const taskIds: string[] = [];

  for (const businessId of eligibleIds) {
    try {
      const result = await triggerReviewPullForBusiness(businessId, {
        mode: "delta",
      });
      if (result.triggered) {
        triggered += 1;
        taskIds.push(result.taskId);
      } else {
        skipped += 1;
        skipReasons[result.reason] = (skipReasons[result.reason] ?? 0) + 1;
      }
    } catch (err) {
      // triggerReviewPullForBusiness already catches inside; defense in
      // depth — if its return contract changes, we still don't crash
      // the whole cron.
      skipped += 1;
      skipReasons["threw"] = (skipReasons["threw"] ?? 0) + 1;
      console.warn(
        `[${JOB}] trigger threw for ${businessId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return {
    itemsProcessed: triggered,
    meta: {
      runId,
      candidatesFound: candidates.length,
      eligibleAfterGate: eligibleIds.length,
      filteredOutByGate: candidates.length - eligibleIds.length,
      triggered,
      skipped,
      skipReasons,
      taskIdSample: taskIds.slice(0, 5),
    },
  };
});

// Allow manual trigger via POST (admin tool) without changing the schedule.
export const POST = GET;

function clampLimitFromEnv(defaultLimit: number, max: number): number {
  const raw = process.env.CRON_WEEKLY_REVIEWS_LIMIT;
  if (!raw) return defaultLimit;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultLimit;
  return Math.max(1, Math.min(parsed, max));
}

export const __test = {
  JOB,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  DELTA_FRESH_DAYS,
  clampLimitFromEnv,
};
