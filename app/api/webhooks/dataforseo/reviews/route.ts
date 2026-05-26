/**
 * /api/webhooks/dataforseo/reviews · DataForSEO pingback handler.
 *
 * Receives the GET pingback from DataForSEO when a Standard-queue
 * `reviews/task_post` task completes. The URL was built by
 * `buildReviewsPingbackUrl()` in services/dataforseo/reviews-task and
 * includes:
 *   - id    · the DfS task_id ($id placeholder)
 *   - tag   · caller-supplied tag ($tag placeholder, usually
 *             "mapsly:initial:biz_<businessId>")
 *   - token · shared secret (DATAFORSEO_PINGBACK_TOKEN env)
 *
 * Flow on pingback:
 *   1. Verify shared-secret token (anti-replay / anti-spoof)
 *   2. Look up Business by `pendingReviewsTaskId = id`
 *      - If not found · 200 OK (already processed or stale · idempotent)
 *   3. Open a CronRun ("reviews:pingback-handler")
 *   4. Call reviewsTaskGet(id) · pulls + bills the actual review pages
 *   5. Upsert batch via modules/reviews/upsert · 12-month cutoff applied
 *   6. Update Business cursor (clear pendingReviewsTaskId, set
 *      latestReviewExternalId, reviewsFirstPulledAt, etc.)
 *   7. Recompute aggregates (reviewCount/rating/replyRate/velocity30d)
 *   8. Revalidate cache tags
 *
 * Idempotency: clearing pendingReviewsTaskId in step 6 means a duplicate
 * pingback for the same task_id finds no business → 200 already_processed
 * → DfS stops retrying.
 *
 * Vercel function budget: 300s. Pulls up to 4490 reviews + per-item
 * upsert ≈ ~3 min worst case for the largest businesses; well under cap.
 */

import { revalidateTag } from "next/cache";
import { z } from "zod";

import prisma from "@/lib/prisma";
import { withCronRun } from "@/lib/cost/cost-counter";
import { reviewsTaskGet } from "@/services/dataforseo";
import {
  upsertReviewBatch,
  recomputeReviewAggregates,
} from "@/modules/reviews/upsert";

export const maxDuration = 300;

const QuerySchema = z.object({
  id: z.string().min(1).max(128),
  tag: z.string().min(1).max(255).optional(),
  token: z.string().min(1).max(256),
});

const TWELVE_MONTHS_MS = 365 * 24 * 60 * 60 * 1000;

async function handle(request: Request): Promise<Response> {
  // 1. Parse + validate query
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return Response.json({ error: "malformed_url" }, { status: 400 });
  }
  const parsed = QuerySchema.safeParse({
    id: url.searchParams.get("id") ?? "",
    tag: url.searchParams.get("tag") ?? undefined,
    token: url.searchParams.get("token") ?? "",
  });
  if (!parsed.success) {
    return Response.json(
      { error: "invalid_query", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { id: taskId, tag, token } = parsed.data;

  // 2. Verify shared-secret token (constant-time compare)
  const expected = process.env.DATAFORSEO_PINGBACK_TOKEN;
  if (!expected) {
    console.error(
      "[/api/webhooks/dataforseo/reviews] DATAFORSEO_PINGBACK_TOKEN not set — refusing pingback",
    );
    return Response.json({ error: "server_misconfigured" }, { status: 500 });
  }
  if (!constantTimeEquals(token, expected)) {
    console.warn(
      `[/api/webhooks/dataforseo/reviews] token mismatch · taskId=${taskId.slice(0, 8)} tag=${tag ?? "none"}`,
    );
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // 3. Look up Business by pendingReviewsTaskId
  const business = await prisma.business.findUnique({
    where: { pendingReviewsTaskId: taskId },
    select: {
      id: true,
      slug: true,
      latestReviewExternalId: true,
      reviewsFirstPulledAt: true,
    },
  });

  if (!business) {
    // Already processed OR stale task. DfS will stop retrying on 200.
    console.info(
      `[/api/webhooks/dataforseo/reviews] no business with pendingReviewsTaskId=${taskId.slice(0, 8)} (already processed or stale) · tag=${tag ?? "none"}`,
    );
    return Response.json(
      { ok: true, already_processed: true },
      { status: 200 },
    );
  }

  // 4-7. Open CronRun and do all the work inside it so adapter cost is
  //      attributed correctly.
  try {
    const outcome = await withCronRun("reviews:pingback-handler", async () => {
      const result = await reviewsTaskGet(taskId);

      const cutoffDate = new Date(Date.now() - TWELVE_MONTHS_MS);
      const upsertResult = await upsertReviewBatch(business.id, result.items, {
        cutoffDate,
        // First-pull mode (initial qualify-time pull): no cursor stop,
        // walk all reviews until 12-month cutoff. Subsequent delta
        // pulls (R.3) will pass knownLatestExternalId for cursor stop.
        knownLatestExternalId: business.latestReviewExternalId,
      });

      // Update Business cursor + clear pending task_id.
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

      // Recompute aggregates (reviewCount/rating/replyRate/velocity30d).
      await recomputeReviewAggregates(
        business.id,
        result.totalReviewsCount,
        result.aggregateRating,
      );

      // Revalidate cache tags · the /reviews page reads these.
      revalidateTag(`business-${business.slug}-reviews`, "hours");
      revalidateTag(`business-${business.slug}`, "hours");

      return {
        items: result.items.length,
        ...upsertResult,
        totalReviewsCount: result.totalReviewsCount,
        aggregateRating: result.aggregateRating,
      };
    });

    return Response.json(
      {
        ok: true,
        businessId: business.id,
        taskId,
        ...outcome,
      },
      { status: 200 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Task-not-ready (DfS race · rare under pingback): return 503 so DfS
    // retries the pingback. Other errors: 500 with error context.
    const notReady = /status_code\s*40602|not ready/i.test(message);
    const status = notReady ? 503 : 500;
    console.error(
      `[/api/webhooks/dataforseo/reviews] task_get failed (taskId=${taskId.slice(0, 8)}, businessId=${business.id}): ${message}`,
    );
    return Response.json(
      {
        error: notReady ? "task_not_ready" : "internal_error",
        taskId,
        businessId: business.id,
        message,
      },
      { status },
    );
  }
}

// DfS sends pingback as GET by default. Accept POST too in case the task
// is configured with a POST pingback.
export const GET = handle;
export const POST = handle;

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
