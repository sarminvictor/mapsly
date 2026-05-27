// modules/reviews/dispatch-bulk-pull.ts
//
// Shared dispatcher for bulk review-pulls. Used by:
//   - app/(admin)/admin/businesses/actions.ts → admin bulk button
//   - app/api/cron/weekly/reviews-delta/route.ts → weekly delta cron
//
// Strategy (Task #81):
//   - If BOXLY_WORKER_BASE_URL is set → enqueue all jobs to Worker, return
//     immediately. Worker handles concurrency (5 parallel), retries, and
//     per-row failures. Mapsly stays responsive even at 500+ rows.
//   - If not set (local dev / preview without worker) → sequential fallback
//     using the same triggerReviewPullForBusiness() loop. Keeps `pnpm dev`
//     usable without standing up the worker.
//
// Per `.claude/rules/scalability.md`: bounded batch (DEFAULT_BATCH_MAX
// = 500 on the Worker side). Callers should chunk if they have more.

import {
  enqueueCallbackWebhooks,
  BoxlyWorkerError,
  type WorkerJob,
} from "@/lib/boxly-worker/client";
import { getMapslyPublicUrl } from "@/lib/url/mapsly-public-url";
import { triggerReviewPullForBusiness } from "./trigger-pull";
import type {
  TriggerReviewPullOptions,
  TriggerSkipReason,
} from "./trigger-pull";

export interface DispatchBulkPullInput {
  businessIds: string[];
  mode: TriggerReviewPullOptions["mode"];
  /** Optional depth override (forwarded to each per-business task_post). */
  depth?: number;
}

export interface DispatchBulkPullResult {
  /** Path taken · helpful in cron meta + admin toast wording. */
  strategy: "worker-enqueue" | "sequential-fallback";
  /** Total IDs the caller passed in. */
  requested: number;
  /** Worker path: jobs the worker accepted into its queue.
   *  Sequential path: trigger calls that returned `{triggered: true}`. */
  queuedOrTriggered: number;
  /** Worker path: jobs the worker rejected (bad URL, validation, etc.).
   *  Sequential path: trigger calls that returned `{triggered: false}`
   *  or threw. */
  failedOrSkipped: number;
  /** Sequential path only · per-reason histogram for observability.
   *  Worker path: undefined (we don't yet pipe worker outcomes back). */
  skipReasons?: Record<string, number>;
  /** Worker path only · first 5 taskIds for log correlation. */
  taskIdSample?: string[];
}

/**
 * Dispatch a bulk review-pull. Returns immediately on the worker path
 * (single fetch to the worker); blocks ~1s per business on the sequential
 * fallback. Caller is expected to be inside withCronRun().
 */
export async function dispatchBulkReviewPull(
  input: DispatchBulkPullInput,
): Promise<DispatchBulkPullResult> {
  const requested = input.businessIds.length;
  if (requested === 0) {
    return {
      strategy: workerAvailable() ? "worker-enqueue" : "sequential-fallback",
      requested: 0,
      queuedOrTriggered: 0,
      failedOrSkipped: 0,
    };
  }

  if (workerAvailable()) {
    return dispatchViaWorker(input);
  }
  return dispatchSequential(input);
}

function workerAvailable(): boolean {
  return Boolean(
    process.env.BOXLY_WORKER_BASE_URL && process.env.BOXLY_WORKER_AUTH_TOKEN,
  );
}

async function dispatchViaWorker(
  input: DispatchBulkPullInput,
): Promise<DispatchBulkPullResult> {
  const callbackBase = getMapslyPublicUrl();
  const callbackUrl = `${callbackBase}/api/internal/trigger-review-pull`;
  const ts = Date.now();

  const jobs: WorkerJob[] = input.businessIds.map((businessId) => ({
    // Idempotency-friendly taskId · includes business + timestamp so the
    // worker dedupes within its retention window if the same callback
    // fires twice.
    taskId: `mapsly-reviews-trigger-${businessId}-${ts}`,
    url: callbackUrl,
    payload: {
      businessId,
      mode: input.mode,
      ...(input.depth != null ? { depth: input.depth } : {}),
    },
    callerLabel: `mapsly:reviews-${input.mode}`,
    // task_post is ~1s; allow worker headroom for retry + slow Neon.
    timeoutSec: 30,
  }));

  try {
    const result = await enqueueCallbackWebhooks(jobs);
    return {
      strategy: "worker-enqueue",
      requested: input.businessIds.length,
      queuedOrTriggered: result.queued,
      failedOrSkipped: result.failed,
      taskIdSample: result.taskIds.slice(0, 5),
    };
  } catch (err) {
    // Worker unreachable / config bad · fall back to sequential rather
    // than fail the whole batch. Logged at WARN so we notice the
    // degraded path.
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[reviews:dispatch-bulk] worker enqueue failed (${err instanceof BoxlyWorkerError ? "BoxlyWorkerError" : "unknown"}): ${message} · falling back to sequential`,
    );
    return dispatchSequential(input);
  }
}

async function dispatchSequential(
  input: DispatchBulkPullInput,
): Promise<DispatchBulkPullResult> {
  let triggered = 0;
  let skipped = 0;
  const skipReasons: Record<TriggerSkipReason | "threw", number> = {
    not_found: 0,
    no_cid: 0,
    in_flight: 0,
    already_pulled: 0,
    no_paid_in_location: 0,
    task_post_failed: 0,
    threw: 0,
  };

  for (const businessId of input.businessIds) {
    try {
      const r = await triggerReviewPullForBusiness(businessId, {
        mode: input.mode,
        depth: input.depth,
      });
      if (r.triggered) {
        triggered += 1;
      } else {
        skipped += 1;
        skipReasons[r.reason] += 1;
      }
    } catch (err) {
      skipped += 1;
      skipReasons.threw += 1;
      console.warn(
        `[reviews:dispatch-bulk] sequential ${businessId} threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Strip zero-count keys so the meta payload stays compact.
  const compactReasons: Record<string, number> = {};
  for (const [key, n] of Object.entries(skipReasons)) {
    if (n > 0) compactReasons[key] = n;
  }

  return {
    strategy: "sequential-fallback",
    requested: input.businessIds.length,
    queuedOrTriggered: triggered,
    failedOrSkipped: skipped,
    skipReasons: compactReasons,
  };
}
