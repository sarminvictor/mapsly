// modules/website-intel/dispatch-website-scan.ts
//
// Bulk-scan dispatcher for website audits. Used by:
//   - Admin "Run Website" single-row button → 1-business input
//   - Admin bulk action → N-business input
//   - (future) weekly lighthouse-audit cron could route through here too
//
// Strategy — identical shape to reviews + search dispatchers:
//   - Worker available (BOXLY_WORKER_BASE_URL + _AUTH_TOKEN set) → enqueue one
//     job per business to /api/internal/trigger-website-scan, return at once.
//     The worker runs them with concurrency + retries; each lands a
//     LighthouseAudit row on its own 120s budget. Mapsly stays responsive even
//     for hundreds of rows (Lighthouse is ~15-40s each — far too slow to run
//     inline for a bulk).
//   - Worker unset (local dev / preview) → sequential fallback via the shared
//     `collectWebsiteForBatch`, the same inline path the button used before.
//
// Businesses without a `website` are filtered out up front (nothing to audit).

import {
  enqueueCallbackWebhooks,
  BoxlyWorkerError,
  type WorkerJob,
} from "@/lib/boxly-worker/client";
import { getMapslyPublicUrl } from "@/lib/url/mapsly-public-url";
import prisma from "@/lib/prisma";
import { collectWebsiteForBatch } from "./collect-website-intel";

export interface DispatchWebsiteScanInput {
  businessIds: string[];
  /** Trigger source · "manual" (single) | "bulk" | "cron". */
  mode: "manual" | "bulk" | "cron";
}

export interface DispatchWebsiteScanResult {
  strategy: "worker-enqueue" | "sequential-fallback";
  /** Total ids the caller passed in. */
  requested: number;
  /** Of those, the ones with a website (auditable). */
  eligibleBusinesses: number;
  /** Worker: jobs the worker accepted · Sequential: audits inserted. */
  queuedOrTriggered: number;
  /** Worker: jobs rejected · Sequential: per-business failures. */
  failedOrSkipped: number;
  /** Worker path only · first 5 taskIds for log correlation. */
  taskIdSample?: string[];
}

function workerAvailable(): boolean {
  return Boolean(
    process.env.BOXLY_WORKER_BASE_URL && process.env.BOXLY_WORKER_AUTH_TOKEN,
  );
}

/**
 * Dispatch a website-audit batch. Returns immediately on the worker path;
 * blocks ~15-40s per business on the sequential fallback. Caller is expected
 * to be inside withCronRun() (so the sequential path's spend is tracked).
 */
export async function dispatchWebsiteScan(
  input: DispatchWebsiteScanInput,
): Promise<DispatchWebsiteScanResult> {
  const requested = input.businessIds.length;
  if (requested === 0) return zeroResult();

  // Only businesses with a website can be audited.
  const eligible = await prisma.business.findMany({
    where: { id: { in: input.businessIds }, website: { not: null } },
    select: { id: true },
  });
  const eligibleIds = eligible.map((b) => b.id);
  if (eligibleIds.length === 0) {
    return { ...zeroResult(), requested, eligibleBusinesses: 0 };
  }

  // Manual single-row scans run inline — a direct DataForSEO Lighthouse Live
  // call (~15-40s) whose LighthouseAudit row lands synchronously. The worker
  // path is for bulk, where inline would be too slow; routing a manual click
  // through it means the audit silently never lands if the worker is down.
  if (input.mode === "manual") {
    return dispatchSequential(requested, eligibleIds);
  }

  if (workerAvailable()) {
    const result = await dispatchViaWorker(input, requested, eligibleIds);
    if (result) return result;
    // enqueue threw → fall through to sequential
  }
  return dispatchSequential(requested, eligibleIds);
}

async function dispatchViaWorker(
  input: DispatchWebsiteScanInput,
  requested: number,
  eligibleIds: string[],
): Promise<DispatchWebsiteScanResult | null> {
  const callbackUrl = `${getMapslyPublicUrl()}/api/internal/trigger-website-scan`;
  const ts = Date.now();
  const jobs: WorkerJob[] = eligibleIds.map((businessId) => ({
    taskId: `mapsly-website-${businessId}-${ts}`,
    url: callbackUrl,
    payload: { businessId },
    callerLabel: `mapsly:website-${input.mode}`,
    // Lighthouse Live + DOM fetch ~15-40s; 90s leaves retry headroom under the
    // worker's 120s per-job cap.
    timeoutSec: 90,
  }));

  try {
    const result = await enqueueCallbackWebhooks(jobs);
    return {
      strategy: "worker-enqueue",
      requested,
      eligibleBusinesses: eligibleIds.length,
      queuedOrTriggered: result.queued,
      failedOrSkipped: result.failed,
      taskIdSample: result.taskIds.slice(0, 5),
    };
  } catch (err) {
    console.warn(
      `[website-intel:dispatch] worker enqueue failed (${err instanceof BoxlyWorkerError ? "BoxlyWorkerError" : "unknown"}): ${err instanceof Error ? err.message : String(err)} · falling back to sequential`,
    );
    return null;
  }
}

async function dispatchSequential(
  requested: number,
  eligibleIds: string[],
): Promise<DispatchWebsiteScanResult> {
  const out = await collectWebsiteForBatch(eligibleIds);
  return {
    strategy: "sequential-fallback",
    requested,
    eligibleBusinesses: eligibleIds.length,
    queuedOrTriggered: out.audited,
    failedOrSkipped: out.errors.length,
  };
}

function zeroResult(): DispatchWebsiteScanResult {
  return {
    strategy: workerAvailable() ? "worker-enqueue" : "sequential-fallback",
    requested: 0,
    eligibleBusinesses: 0,
    queuedOrTriggered: 0,
    failedOrSkipped: 0,
  };
}
