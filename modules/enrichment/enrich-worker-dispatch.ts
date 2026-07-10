// modules/enrichment/enrich-worker-dispatch.ts · route enrichment work through
// the DigitalOcean Boxly worker (WP3-2, folds WP1-5).
//
// Two lanes, both mirroring modules/website-intel/dispatch-website-scan.ts:
//
//   1. ROOT-FAMILY JOBS (CONTACTS/REVIEWS/LIGHTHOUSE + the DOM-dependent
//      SERVICES/AI_RESEARCH). After fanOutRun creates the QUEUED EnrichmentJob
//      rows, we enqueue one worker job per QUEUED root-family job to
//      /api/internal/enrich-job with taskId=job.id (idempotent — the WP1 atomic
//      claim makes a double delivery a no-op) and payload { jobId }. The worker
//      runs each on its own 300s budget with concurrency + retry, so a 500-lead
//      run drains in ~25-30 min instead of waiting on 2-min cron ticks.
//
//   2. PER-CELL FAMILIES (meta_ads/serp). B1 · google_ads moved to a per-business
//      GOOGLE_ADS root job (lane 1 above), so it's no longer collected per-cell.
//      WP1-5's remaining 10/10 clause is "no inline Apify/DfS call inside the
//      300s Vercel fanOutRun tick". The EnrichmentFamily enum DOES carry
//      META_ADS/GOOGLE_ADS/SERP, but
//      turning cells into full per-business EnrichmentJob rows would rewire the
//      DAG, updateRunProgress' distinct-businessId count, and closeRunIfDone's
//      per-job cost accounting (which WP1-4/WP1-6 already got to 10/10). Rather
//      than duplicate that accounting, we keep cell cost billed run-side
//      (outcome-based, as WP1-6 shipped) but MOVE THE COLLECTION off the tick to
//      the worker via /api/internal/enrich-cell (payload { runId, cellKey,
//      family }). The worker has no 300s cap, so the slow Apify/DfS call never
//      runs inside fanOutRun. When the worker is unset (local/preview) the caller
//      falls back to the inline path — identical to the website-scan pattern.
//
// The caller (fanOutRun) is inside withCronRun(), but these enqueues are just
// fast HTTP POSTs (return immediately); the actual spend is attributed on the
// callback route's OWN CronRun. A failed enqueue returns { enqueued: false } so
// the caller runs the inline fallback.

import {
  enqueueCallbackWebhooks,
  BoxlyWorkerError,
  type WorkerJob,
} from "@/lib/boxly-worker/client";
import { getMapslyPublicUrl } from "@/lib/url/mapsly-public-url";

/** True iff both Boxly worker env vars are set (same gate as website-scan). */
export function enrichWorkerAvailable(): boolean {
  return Boolean(
    process.env.BOXLY_WORKER_BASE_URL && process.env.BOXLY_WORKER_AUTH_TOKEN,
  );
}

/** A QUEUED root-family EnrichmentJob, ordered first-screen-first (WP3-4). */
export interface RootJobRef {
  id: string;
  businessId: string;
  family: string;
}

export interface CellJobRef {
  runId: string;
  cellKey: string;
  // B1 · google_ads moved to a per-business GOOGLE_ADS root job (enqueueRootJobs),
  // so it's no longer a cell family here — only meta_ads + serp remain per-cell.
  family: "meta_ads" | "serp";
}

export interface WorkerEnqueueResult {
  enqueued: boolean;
  queued: number;
  failed: number;
}

const NONE: WorkerEnqueueResult = { enqueued: true, queued: 0, failed: 0 };

/**
 * Enqueue one worker job per QUEUED root-family job. taskId=job.id gives
 * end-to-end idempotency (a worker retry re-POSTs /api/internal/enrich-job with
 * the same jobId; the WP1 atomic claim + terminal-guard makes the second run a
 * no-op). Returns { enqueued:false } if the worker rejected the batch so the
 * caller keeps the tick-side drain as the fallback. Batches are chunked to the
 * worker's 500-job cap.
 */
export async function enqueueRootJobs(
  jobs: RootJobRef[],
): Promise<WorkerEnqueueResult> {
  if (jobs.length === 0) return NONE;
  if (!enrichWorkerAvailable())
    return { enqueued: false, queued: 0, failed: 0 };

  const callbackUrl = `${getMapslyPublicUrl()}/api/internal/enrich-job`;
  const workerJobs: WorkerJob[] = jobs.map((j) => ({
    taskId: j.id, // idempotency: the job id IS the task id
    url: callbackUrl,
    payload: { jobId: j.id },
    callerLabel: `mapsly:enrich-${j.family.toLowerCase()}`,
    // A single family worker (Lighthouse walled actor bounded to ~240s, contacts
    // fetch, reviews submit) fits under the worker's 120s per-job cap for the
    // fast families; the callback route sets maxDuration=300 for the long ones.
    // Cap the worker-side timeout at its 120s max; the callback's own budget
    // covers the rest.
    timeoutSec: 120,
  }));

  return enqueueChunked(workerJobs, "enrich-job");
}

/**
 * Enqueue one worker job per (cell × cell-family) that needs collecting. Keeps
 * the slow Apify/DfS cell call OFF the fanOutRun tick (WP1-5's 10/10 clause).
 * Returns { enqueued:false } on worker rejection so the caller runs cells inline.
 */
export async function enqueueCellJobs(
  cells: CellJobRef[],
): Promise<WorkerEnqueueResult> {
  if (cells.length === 0) return NONE;
  if (!enrichWorkerAvailable())
    return { enqueued: false, queued: 0, failed: 0 };

  const callbackUrl = `${getMapslyPublicUrl()}/api/internal/enrich-cell`;
  const ts = Date.now();
  const workerJobs: WorkerJob[] = cells.map((c) => ({
    // cell + family + ts → stable within a fan-out; a retry re-collects (the
    // freshness gate makes a re-run a $0 served-from-db no-op).
    taskId: `mapsly-cell-${c.family}-${c.cellKey}-${ts}`,
    url: callbackUrl,
    payload: { runId: c.runId, cellKey: c.cellKey, family: c.family },
    callerLabel: `mapsly:enrich-cell-${c.family}`,
    // 2026-07-10 · 120→310s: the enrich-cell route runs a Meta collection for
    // up to ~300s (maxDuration). At 120s the worker aborted mid-collection and
    // RETRIED — launching a duplicate actor run while the first still ran
    // (double proxy spend · run-forensics §C). 310s outlives the route budget.
    // Pairs with the worker DTO cap raise (1→360, deployed alongside); an old
    // worker rejects the batch → enqueued:false → cells run inline (the safe
    // pre-worker fallback).
    timeoutSec: 310,
  }));

  return enqueueChunked(workerJobs, "enrich-cell");
}

/** Enqueue in ≤500-sized chunks (the worker's ArrayMaxSize). Any throw → fallback. */
async function enqueueChunked(
  jobs: WorkerJob[],
  lane: string,
): Promise<WorkerEnqueueResult> {
  let queued = 0;
  let failed = 0;
  try {
    for (let i = 0; i < jobs.length; i += 500) {
      const res = await enqueueCallbackWebhooks(jobs.slice(i, i + 500));
      queued += res.queued;
      failed += res.failed;
    }
    return { enqueued: true, queued, failed };
  } catch (err) {
    console.warn(
      `[enrichment:${lane}] worker enqueue failed (${err instanceof BoxlyWorkerError ? "BoxlyWorkerError" : "unknown"}): ${err instanceof Error ? err.message : String(err)} · falling back to inline/tick drain`,
    );
    return { enqueued: false, queued, failed };
  }
}
