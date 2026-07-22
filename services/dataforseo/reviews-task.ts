// services/dataforseo/reviews-task.ts · Standard-queue Google reviews pull.
//
// Endpoint pair: /v3/business_data/google/reviews/task_post (submit) +
// /v3/business_data/google/reviews/task_get/{task_id} (retrieve).
//
// Why Standard queue (not Live):
//   - 50% cheaper ($0.00075 vs $0.0015 per 10 reviews returned)
//   - DfS handles the 45-minute computation window themselves
//   - We avoid Vercel's 300s function timeout by using DfS pingback
//
// Pingback architecture:
//   1. We POST task_post with `pingback_url` pointing at our webhook
//   2. DfS computes the task asynchronously (up to 45 min)
//   3. When ready, DfS pings our webhook with the task_id
//   4. Our webhook calls reviewsTaskGet(taskId) to fetch results
//   5. Our webhook upserts reviews via modules/reviews/upsert
//
// Cost attribution (variable, per-10-reviews):
//   - task_post itself: usually ~$0.00075 (tiny task setup fee)
//   - task_get: bills based on items_count returned
//   - Both call incrementCost with the rawCostUsd reported by DfS
//
// Why no kvCache here: pingback flow is one-shot per (businessId, weekStart).
// The caller (qualify-time pull / weekly cron) is responsible for not
// double-posting; we rely on Business.pendingReviewsTaskId as the in-flight
// guard.

import { z } from "zod";
import { incrementCost } from "@/lib/cost/cost-counter";
import { getMapslyPublicUrl } from "@/lib/url/mapsly-public-url";
import { dataforSeoPost, DataForSeoError } from "./client";
import type { DataForSeoEnvelope } from "./client";
import { DATAFORSEO_UNIT_COST_USD } from "./pricing";
import { ReviewItemSchema, type ReviewItem } from "./reviews";

// ---- Public helpers ------------------------------------------------------

/**
 * Build a pingback URL that DfS will substitute and call when the task
 * completes. DfS replaces `$id` with the task_id and `$tag` with the
 * caller-supplied tag.
 *
 * The URL includes:
 *   - id=$id            · so the webhook knows which task fired
 *   - tag=$tag          · so the webhook can verify it matches our records
 *   - token=<secret>    · so the webhook can verify the request came from
 *                         us (shared-secret · simpler than HMAC for this
 *                         low-stakes signal)
 *
 * Reads `MAPSLY_PUBLIC_URL` for the base origin (same convention as the
 * Boxly Worker callback URL builder). Throws if not set.
 *
 * Reads `DATAFORSEO_PINGBACK_TOKEN` for the shared secret. Throws if not
 * set — DfS pingback flow requires it for security.
 */
export function buildReviewsPingbackUrl(): string {
  const base = getMapslyPublicUrl();
  const token = process.env.DATAFORSEO_PINGBACK_TOKEN;
  if (!token) {
    throw new Error(
      "DATAFORSEO_PINGBACK_TOKEN not set — required to verify pingback authenticity.",
    );
  }
  // DfS replaces $id and $tag literally; we URL-encode the static parts only.
  return `${base}/api/webhooks/dataforseo/reviews?id=$id&tag=$tag&token=${encodeURIComponent(token)}`;
}

// ---- task_post schema + adapter ------------------------------------------

export const ReviewsTaskPostQuerySchema = z
  .object({
    /** Google CID (preferred — exact business match). */
    cid: z.string().min(1).optional(),
    /** Google place_id (fallback). */
    place_id: z.string().min(1).optional(),
    /** Business keyword (last-resort when no CID/place_id available). */
    keyword: z.string().min(1).optional(),
    location_code: z.number().int().positive().default(2840),
    language_code: z.string().min(2).default("en"),
    /** Max reviews to return. DfS hard-cap is 4490; default 500 covers a
     *  typical med-spa's 12-month window (10-30 reviews/month). For higher-
     *  volume verticals (restaurants), callers may bump to 1500. */
    depth: z.number().int().min(10).max(4490).default(500),
    /** Sort: newest is the only sane choice for delta walking + cutoff. */
    sort_by: z
      .enum(["newest", "rating_high", "rating_low", "relevant"])
      .default("newest"),
    /** Caller-supplied tag · echoed back in pingback as $tag. We use it to
     *  carry the businessId (e.g. "mapsly:initial:biz_abc123"). */
    tag: z.string().min(1).max(255).optional(),
    /** Priority: 1 = Standard (cheaper, ≤45min); 2 = Priority (1min, 2× cost). */
    priority: z.union([z.literal(1), z.literal(2)]).default(1),
  })
  .refine(
    (q) =>
      q.cid !== undefined ||
      q.place_id !== undefined ||
      q.keyword !== undefined,
    { message: "one of cid, place_id, keyword is required" },
  );
export type ReviewsTaskPostQuery = z.input<typeof ReviewsTaskPostQuerySchema>;

const OPERATION_POST = "dataforseo.reviews.task_post";
const OPERATION_GET = "dataforseo.reviews.task_get";

/**
 * Submit a Google reviews pull to the DataForSEO Standard queue. Returns
 * the task_id immediately. The actual reviews arrive via pingback to
 * `/api/webhooks/dataforseo/reviews?id=<task_id>&tag=<tag>`.
 *
 * Bills the small task-post cost (~$0.00075) to the open CronRun.
 *
 * Caller MUST set `Business.pendingReviewsTaskId = result.taskId` so the
 * pingback can resolve which business the result belongs to.
 */
export async function reviewsTaskPost(
  query: ReviewsTaskPostQuery,
): Promise<{ taskId: string; postedCostUsd: number }> {
  const parsed = ReviewsTaskPostQuerySchema.parse(query);
  // Script mode (MAPSLY_REVIEWS_NO_PINGBACK=1): omit the pingback so results
  // stay retrievable via task_get. Pingback-registered tasks answer task_get
  // with 40601 "Task Handed" once the pingback fires — which LOSES the result
  // when the pingback can't be ingested (standalone scripts run outside prod;
  // prod rejects their token). Poll-harvest (harvestPendingReviewsForBusiness)
  // is the retrieval path in that mode. Same env-gated escape-hatch pattern as
  // MAPSLY_COLLECT_REVIEWS_ALLOW_ALL (lib/reviews/should-collect.ts). Unset in
  // prod, so cron/webhook behavior is unchanged.
  const body = {
    ...parsed,
    ...(process.env.MAPSLY_REVIEWS_NO_PINGBACK === "1"
      ? {}
      : { pingback_url: buildReviewsPingbackUrl() }),
  };

  const { rawCostUsd, taskId } = await dataforSeoPost<unknown>({
    path: "/v3/business_data/google/reviews/task_post",
    operation: OPERATION_POST,
    body: body as Record<string, unknown>,
    // Standard-queue task_post returns 20100 ("Task Created") on success
    // · the task is queued for async processing, results arrive via
    // pingback. 20000 also accepted in case DfS standardizes (defense in
    // depth).
    acceptableTaskStatusCodes: [20000, 20100],
  });

  if (!taskId) {
    throw new DataForSeoError({
      operation: OPERATION_POST,
      message: "task_post returned no task_id",
    });
  }

  // Bill the post step. Some envelopes omit task.cost on the post (the
  // billing lands on task_get); fall back to the per-10-reviews unit so
  // we never silently miss spend.
  const cost = rawCostUsd ?? 0;
  if (cost > 0) {
    await incrementCost(cost, OPERATION_POST);
  }

  return { taskId, postedCostUsd: cost };
}

// ---- task_get schema + adapter -------------------------------------------

const ReviewsTaskGetResultSchema = z.object({
  cid: z.string().nullable().optional(),
  place_id: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  reviews_count: z.number().nullable().optional(),
  rating: z
    .object({
      value: z.number().nullable().optional(),
      votes_count: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
  items_count: z.number().nullable().optional(),
  items: z.array(ReviewItemSchema).nullable().optional(),
});

export interface ReviewsTaskGetResult {
  items: ReviewItem[];
  aggregateRating: number | null;
  totalReviewsCount: number | null;
  itemsCount: number;
  /** Task status_code reported by DfS (20000 = success). */
  taskStatusCode: number;
}

/**
 * Retrieve the results of a previously-posted task. Called from the
 * pingback webhook handler. Bills the variable cost based on items
 * returned (per-10-reviews).
 *
 * Returns the parsed result OR throws DataForSeoError if:
 *   - The task_id doesn't exist (40400-class)
 *   - The task isn't ready yet (40602 — rare with pingback, possible if
 *     called manually mid-flight)
 *   - Transport / auth fails
 */
export async function reviewsTaskGet(
  taskId: string,
): Promise<ReviewsTaskGetResult> {
  if (!taskId || !/^[a-f0-9-]+$/i.test(taskId)) {
    throw new DataForSeoError({
      operation: OPERATION_GET,
      message: `invalid task_id format: ${JSON.stringify(taskId)}`,
    });
  }

  // task_get is a GET — POST-via-client doesn't fit. Inline the call
  // with the same auth + envelope unwrap pattern.
  const envelope = await dataforSeoGet(
    `/v3/business_data/google/reviews/task_get/${encodeURIComponent(taskId)}`,
    OPERATION_GET,
  );

  if (envelope.status_code !== 20000) {
    throw new DataForSeoError({
      operation: OPERATION_GET,
      message: `envelope status_code ${envelope.status_code}: ${envelope.status_message}`,
      envelopeStatusCode: envelope.status_code,
    });
  }

  const task = envelope.tasks?.[0];
  if (!task) {
    throw new DataForSeoError({
      operation: OPERATION_GET,
      message: "envelope OK but tasks[] is empty",
    });
  }
  if (task.status_code !== 20000) {
    throw new DataForSeoError({
      operation: OPERATION_GET,
      message: `task status_code ${task.status_code}: ${task.status_message}`,
      envelopeStatusCode: task.status_code,
    });
  }

  const result = ReviewsTaskGetResultSchema.parse(task.result?.[0] ?? {});

  // Bill the get step. The result is the "real" billable event for
  // Standard queue (task_post is often nominal). Fall back to the
  // per-10-reviews unit × ceil(items/10) if DfS doesn't report cost.
  const itemsCount = result.items_count ?? result.items?.length ?? 0;
  const reportedCost = task.cost ?? envelope.cost;
  const fallbackCost =
    DATAFORSEO_UNIT_COST_USD.reviewsTask * Math.ceil(itemsCount / 10);
  const billedCost = reportedCost ?? fallbackCost;
  if (billedCost > 0) {
    await incrementCost(billedCost, OPERATION_GET);
  }

  return {
    items: result.items ?? [],
    aggregateRating: result.rating?.value ?? null,
    totalReviewsCount: result.reviews_count ?? null,
    itemsCount,
    taskStatusCode: task.status_code,
  };
}

// ---- Low-level GET helper (private) --------------------------------------

/**
 * Issue a GET to a DataForSEO endpoint. Mirrors the auth + envelope
 * unwrap from `client.ts`'s POST helper but for the GET-style task_get
 * endpoint. Not exported — internal to this adapter only. If other
 * task_get endpoints are added later, promote to client.ts.
 */
async function dataforSeoGet(
  path: string,
  operation: string,
): Promise<DataForSeoEnvelope<unknown>> {
  const username =
    process.env.DATAFORSEO_USERNAME ?? process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!username || !password) {
    throw new DataForSeoError({
      operation,
      message:
        "DATAFORSEO_USERNAME / DATAFORSEO_PASSWORD must be set for task_get",
    });
  }

  const baseUrl =
    process.env.DATAFORSEO_BASE_URL?.replace(/\/+$/, "") ??
    "https://api.dataforseo.com";
  const url = baseUrl + path;
  const authHeader =
    "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new DataForSeoError({
      operation,
      message: `transport error: ${err instanceof Error ? err.message : String(err)}`,
      retryable: true,
    });
  }

  if (!res.ok) {
    const snippet = await res.text().catch(() => "");
    throw new DataForSeoError({
      operation,
      message: `HTTP ${res.status} ${res.statusText}: ${snippet.slice(0, 300)}`,
      httpStatus: res.status,
      retryable: res.status >= 500 || res.status === 408 || res.status === 429,
    });
  }

  return (await res.json()) as DataForSeoEnvelope<unknown>;
}

// ---- Convenience: re-export ReviewItem so callers don't dual-import ------

export type { ReviewItem } from "./reviews";
