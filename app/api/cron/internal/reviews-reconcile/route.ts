// Internal cron · reviews:reconcile
//
// Sweeps durable ReviewJob rows whose DataForSEO pingback never arrived (still
// AWAITING_PINGBACK / SUBMITTED past the staleness threshold) and resolves them:
// ready tasks are finished (persist + escalate gate); tasks past the 24h hard
// ceiling are FAILED + RECONCILED-tagged + console.error'd so the loss is never
// silent. Closes the "no reconciliation sweep" gap in the Phase 5 reviews
// runtime. See modules/reviews/review-job.ts.
//
// Auth: Bearer CRON_SECRET (server-to-server only · not rate-limited per
// .claude/rules/scalability.md). Cost: reviewsTaskGet bills per items returned
// for jobs that turn out ready — attributed to the open CronRun opened by
// withCronRun("reviews:reconcile").
//
// Schedule this hourly via Vercel cron; also POST-triggerable from the admin
// tool without changing the schedule.

import { verifyCronAuth } from "@/lib/auth/cron-secret";
import { withCronRun } from "@/lib/cost/cost-counter";
import { reconcileStuckReviewJobs } from "@/modules/reviews/review-job";

const JOB = "reviews:reconcile";

/** Minutes a job must be stale before the sweep tries to resolve it. */
const DEFAULT_OLDER_THAN_MINUTES = 120;

export async function GET(req: Request): Promise<Response> {
  const authResult = verifyCronAuth(req);
  if (!authResult.ok) {
    if (authResult.reason === "not_configured") {
      return Response.json(
        { error: "internal_error", message: "CRON_SECRET not configured" },
        { status: 500 },
      );
    }
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const olderThanMinutes = olderThanFromEnv(DEFAULT_OLDER_THAN_MINUTES);

  try {
    const summary = await withCronRun(JOB, async () =>
      reconcileStuckReviewJobs(olderThanMinutes),
    );
    return Response.json({ ok: true, ...summary }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        level: "error",
        event: "cron.handler.failed",
        job: JOB,
        message,
      }),
    );
    return Response.json(
      { error: "internal_error", job: JOB },
      { status: 500 },
    );
  }
}

// Allow manual admin trigger without altering the schedule.
export const POST = GET;

function olderThanFromEnv(fallback: number): number {
  const raw = process.env.CRON_REVIEWS_RECONCILE_OLDER_THAN_MIN;
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export const __test = { JOB, DEFAULT_OLDER_THAN_MINUTES, olderThanFromEnv };
