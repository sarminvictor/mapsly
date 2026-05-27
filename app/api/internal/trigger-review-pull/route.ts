/**
 * /api/internal/trigger-review-pull · per-business callback from Boxly Worker.
 *
 * Flow (Task #81 · worker fan-out for bulk review pull):
 *   Admin clicks "Pull reviews" (1–500 rows) OR weekly cron fires
 *     → server action enqueues N jobs to Boxly Worker
 *     → worker POSTs HERE once per business (concurrency-controlled + retry)
 *     → this endpoint runs triggerReviewPullForBusiness() within Vercel's
 *       300s budget (typical work: ~1s per business · just submits a DfS
 *       Standard-queue task_post)
 *     → returns 200 / 4xx-reject / 5xx-retryable
 *
 * Auth: shared `BOXLY_WORKER_AUTH_TOKEN` Bearer — only the worker (and
 * admin smoke scripts) can call this. Constant-time compare via
 * `verifyBoxlyWorkerAuth`. Mirrors the /api/qualify-one pattern.
 *
 * Idempotency: triggerReviewPullForBusiness() guards via
 * `pendingReviewsTaskId` so a worker retry that lands after the first
 * successful task_post returns `{triggered: false, reason: "in_flight"}`
 * → we return 200 → worker doesn't retry again. Safe.
 *
 * Cost attribution: this endpoint opens its OWN CronRun
 * (`worker:reviews-trigger`) per callback so the small task_post fee
 * (~$0.00075) is billed correctly. The bigger task_get cost lands later
 * inside the DfS pingback handler's `reviews:pingback-handler` CronRun.
 *
 * Per `.claude/rules/security.md` § auth: this is a worker-only route ·
 * NOT user-facing · the verify-token check is the auth boundary.
 */

import { z } from "zod";

import { verifyBoxlyWorkerAuth } from "@/lib/boxly-worker/client";
import { withCronRun } from "@/lib/cost/cost-counter";
import { triggerReviewPullForBusiness } from "@/modules/reviews/trigger-pull";

// task_post is fast (~1s) but allow headroom for retries + slow Neon.
// Far below Vercel default 300s.
export const maxDuration = 60;

const RequestSchema = z.object({
  businessId: z.string().min(1).max(128),
  mode: z.enum(["initial", "delta", "manual"]).default("manual"),
  depth: z.number().int().min(10).max(4490).optional(),
});

export async function POST(request: Request): Promise<Response> {
  // 1. Verify Bearer auth · the worker sends BOXLY_WORKER_AUTH_TOKEN.
  const authHeader = request.headers.get("authorization");
  if (!verifyBoxlyWorkerAuth(authHeader)) {
    const incoming = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
    const expected = process.env.BOXLY_WORKER_AUTH_TOKEN ?? "";
    // Diagnostic logging · safe to ship · length + 4-char fingerprint only
    // (NOT the full token) so config mismatches are obvious in Vercel Logs.
    console.warn(
      `[/api/internal/trigger-review-pull] 401 · incoming-token len=${incoming.length} ` +
        `prefix=${incoming.slice(0, 4)} suffix=${incoming.slice(-4)} · ` +
        `expected len=${expected.length} ` +
        `prefix=${expected.slice(0, 4)} suffix=${expected.slice(-4)} · ` +
        `env-set=${expected.length > 0}`,
    );
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Validate body · 400 tells the worker NOT to retry.
  let parsed: z.infer<typeof RequestSchema>;
  try {
    const json = (await request.json()) as unknown;
    const result = RequestSchema.safeParse(json);
    if (!result.success) {
      return Response.json(
        {
          error: "invalid_input",
          details: result.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }
    parsed = result.data;
  } catch {
    return Response.json({ error: "malformed_json" }, { status: 400 });
  }

  // 3. Run the trigger inside a CronRun so the task_post cost
  //    (~$0.00075) lands on a "worker:reviews-trigger" row visible at
  //    /admin/cron-runs. The bigger task_get spend lands later in the
  //    pingback handler's separate CronRun.
  try {
    const outcome = await withCronRun("worker:reviews-trigger", async () =>
      triggerReviewPullForBusiness(parsed.businessId, {
        mode: parsed.mode,
        depth: parsed.depth,
      }),
    );

    return Response.json(
      {
        ok: true,
        businessId: parsed.businessId,
        mode: parsed.mode,
        ...outcome,
      },
      { status: 200 },
    );
  } catch (err) {
    // Unknown business id → 404 · worker treats 4xx as non-retryable.
    if (err instanceof Error && /not found/i.test(err.message)) {
      return Response.json(
        { error: "business_not_found", businessId: parsed.businessId },
        { status: 404 },
      );
    }
    // Anything else is potentially transient (Neon hiccup, DfS network
    // wobble bubbling up despite client retries, etc.). 500 = "retry me
    // later" to the worker.
    console.error(
      "[/api/internal/trigger-review-pull] threw:",
      err instanceof Error ? err.stack : err,
    );
    return Response.json(
      {
        error: "internal_error",
        message: err instanceof Error ? err.message : "unknown",
        businessId: parsed.businessId,
      },
      { status: 500 },
    );
  }
}
