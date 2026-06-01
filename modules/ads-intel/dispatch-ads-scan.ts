// modules/ads-intel/dispatch-ads-scan.ts
//
// Bulk-scan dispatcher for ads intelligence. Used by the admin "Run Ads"
// single + bulk buttons. Same shape as reviews + search + website dispatchers.
//
// Strategy:
//   - Worker available → enqueue one job per business to
//     /api/internal/trigger-ads-scan (the fast DataForSEO/Google pass), return
//     at once. The worker runs them with concurrency + retries.
//       · Meta (Apify) is NOT enqueued — its ~2-3 min run exceeds the worker's
//         120s per-job cap. Meta market cells are collected by the dedicated
//         weekly `ads-meta` cron (cell-deduped). This is the same reason Meta
//         already lives on its own cron, not inline.
//   - Worker unset (local dev / preview) → sequential fallback via
//     `collectAdsForBatch(ids, { dfs: true, meta: true })` — byte-for-byte the
//     prior inline behavior (DFS/Google for all + up to one Meta cell inline).
//
// Net: in prod the button returns instantly (DFS via worker, Meta via cron);
// locally it runs inline exactly as before.

import {
  enqueueCallbackWebhooks,
  BoxlyWorkerError,
  type WorkerJob,
} from "@/lib/boxly-worker/client";
import { getMapslyPublicUrl } from "@/lib/url/mapsly-public-url";
import { collectAdsForBatch } from "./collect-ads-intel";

export interface DispatchAdsScanInput {
  businessIds: string[];
  /** Trigger source · "manual" (single) | "bulk" | "cron". */
  mode: "manual" | "bulk" | "cron";
}

export interface DispatchAdsScanResult {
  strategy: "worker-enqueue" | "sequential-fallback";
  /** Total ids the caller passed in. */
  requested: number;
  /** Worker: jobs the worker accepted · Sequential: businesses processed. */
  queuedOrTriggered: number;
  /** Worker: jobs rejected · Sequential: per-business error count. */
  failedOrSkipped: number;
  /** Worker path only · first 5 taskIds for log correlation. */
  taskIdSample?: string[];
  /** Sequential path only · keyword costs upserted. */
  keywordsUpserted?: number;
  /** Sequential path only · Meta advertisers collected inline. */
  metaAds?: number;
}

function workerAvailable(): boolean {
  return Boolean(
    process.env.BOXLY_WORKER_BASE_URL && process.env.BOXLY_WORKER_AUTH_TOKEN,
  );
}

/**
 * Dispatch an ads-scan batch. Returns immediately on the worker path; blocks
 * (DFS + up to one Meta cell) on the sequential fallback. Caller is expected
 * to be inside withCronRun() so the sequential path's spend is tracked.
 */
export async function dispatchAdsScan(
  input: DispatchAdsScanInput,
): Promise<DispatchAdsScanResult> {
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
    const result = await dispatchViaWorker(input, requested);
    if (result) return result;
    // enqueue threw → fall through to sequential
  }
  return dispatchSequential(requested, input.businessIds);
}

async function dispatchViaWorker(
  input: DispatchAdsScanInput,
  requested: number,
): Promise<DispatchAdsScanResult | null> {
  const callbackUrl = `${getMapslyPublicUrl()}/api/internal/trigger-ads-scan`;
  const ts = Date.now();
  // One job per business — the DFS/Google pass. Meta refreshes via the weekly
  // ads-meta cron (can't fit the worker's 120s cap).
  const jobs: WorkerJob[] = input.businessIds.map((businessId) => ({
    taskId: `mapsly-ads-${businessId}-${ts}`,
    url: callbackUrl,
    payload: { businessId },
    callerLabel: `mapsly:ads-${input.mode}`,
    timeoutSec: 90,
  }));

  try {
    const result = await enqueueCallbackWebhooks(jobs);
    return {
      strategy: "worker-enqueue",
      requested,
      queuedOrTriggered: result.queued,
      failedOrSkipped: result.failed,
      taskIdSample: result.taskIds.slice(0, 5),
    };
  } catch (err) {
    console.warn(
      `[ads-intel:dispatch] worker enqueue failed (${err instanceof BoxlyWorkerError ? "BoxlyWorkerError" : "unknown"}): ${err instanceof Error ? err.message : String(err)} · falling back to sequential`,
    );
    return null;
  }
}

async function dispatchSequential(
  requested: number,
  businessIds: string[],
): Promise<DispatchAdsScanResult> {
  // Identical to the prior inline behavior: DFS/Google for all + up to one Meta
  // cell inline (collectAdsForBatch caps cells at MAX_CELLS_PER_RUN internally).
  const out = await collectAdsForBatch(businessIds, { dfs: true, meta: true });
  return {
    strategy: "sequential-fallback",
    requested,
    queuedOrTriggered: out.businesses,
    failedOrSkipped: out.errors.length,
    keywordsUpserted: out.keywordsUpserted,
    metaAds: out.metaAds,
  };
}
