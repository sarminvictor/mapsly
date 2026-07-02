// /api/internal/enrich-job · Boxly Worker callback for ONE EnrichmentJob (WP3-2).
//
// The worker POSTs one job per QUEUED root-family EnrichmentJob (payload
// { jobId }, taskId=job.id). We claim it atomically and run processJob — which
// already handles freshness re-check, the worker-outcome contract (WP1-2), the
// retry ladder (WP3-6 backoff), and outcome-based billing (WP1-6). Because the
// claim is a conditional updateMany, a DOUBLE DELIVERY (worker retry OR a racing
// dispatch tick) is a no-op: only one caller wins the QUEUED→RUNNING flip.
//
// DOM DAG (worker path): after a CONTACTS job succeeds terminally, this route
// enqueues that business's still-QUEUED DOM-dependent jobs (SERVICES /
// AI_RESEARCH) as their OWN worker jobs — replacing the tick-side blocked-set
// gate for the worker lane. The tick-side gate in dispatch.dispatchPending stays
// as the inline-fallback path (when the worker is unset, the cron drains them in
// dependency order). If this follow-up enqueue is skipped/fails, the every-2-min cron
// still picks the dependents up once the CONTACTS root is terminal — no stall.
//
// Auth: EITHER the Boxly worker token (normal caller) OR CRON_SECRET.
// Cost: opens its own CronRun("worker:enrich-job") so the family's spend is
// attributed there, visible in /admin/cron-runs. Idempotent (WP1 atomic claim).

import { z } from "zod";

import { verifyCronAuth } from "@/lib/auth/cron-secret";
import {
  verifyBoxlyWorkerAuth,
  enqueueCallbackWebhooks,
  type WorkerJob,
} from "@/lib/boxly-worker/client";
import { getMapslyPublicUrl } from "@/lib/url/mapsly-public-url";
import { withCronRun } from "@/lib/cost/cost-counter";
import prisma from "@/lib/prisma";
import { claimAndProcessJob } from "@/modules/enrichment/dispatch";
import { enrichWorkerAvailable } from "@/modules/enrichment/enrich-worker-dispatch";

// A single family worker (walled Lighthouse bounded to ~240s; contacts/reviews
// fast) fits under the 300s cap with headroom.
export const maxDuration = 300;

const PayloadSchema = z.object({
  jobId: z.string().min(1).max(128),
});

/** DOM-dependent families gated behind a business's CONTACTS root (WP3-2). */
const DOM_DEPENDENT_FAMILIES = ["SERVICES", "AI_RESEARCH"] as const;

async function handle(req: Request): Promise<Response> {
  const workerOk = verifyBoxlyWorkerAuth(req.headers.get("authorization"));
  const cronOk = verifyCronAuth(req).ok;
  if (!workerOk && !cronOk) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let jobId: string;
  try {
    const json = (await req.json()) as unknown;
    const parsed = PayloadSchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { error: "invalid_input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    jobId = parsed.data.jobId;
  } catch {
    return Response.json({ error: "malformed_json" }, { status: 400 });
  }

  try {
    // Read the job's family + business + run up front (for the DAG follow-up).
    const job = await prisma.enrichmentJob.findUnique({
      where: { id: jobId },
      select: { id: true, businessId: true, family: true, runId: true },
    });
    if (!job) {
      return Response.json({ ok: true, outcome: "not-found" }, { status: 200 });
    }

    const outcome = await withCronRun("worker:enrich-job", () =>
      claimAndProcessJob(jobId),
    );

    // DOM DAG · a CONTACTS job that just landed terminally unblocks this
    // business's DOM-dependent jobs. Enqueue them as their own worker jobs so
    // the chain runs on the worker lane too (no tick round-trip needed).
    if (
      job.family === "CONTACTS" &&
      outcome === "done" &&
      enrichWorkerAvailable()
    ) {
      await enqueueDependents(job.businessId);
    }

    return Response.json({ ok: true, jobId, outcome }, { status: 200 });
  } catch (err) {
    console.error(
      "[/api/internal/enrich-job] threw:",
      err instanceof Error ? err.stack : err,
    );
    return Response.json(
      {
        error: "internal_error",
        message: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 },
    );
  }
}

/**
 * Enqueue a business's still-QUEUED DOM-dependent jobs to the worker after its
 * CONTACTS root landed. Best-effort: on any failure the every-2-min cron drains them
 * (the tick-side blocked-set no longer blocks them once CONTACTS is terminal).
 */
async function enqueueDependents(businessId: string): Promise<void> {
  try {
    const deps = await prisma.enrichmentJob.findMany({
      where: {
        businessId,
        family: { in: [...DOM_DEPENDENT_FAMILIES] },
        status: "QUEUED",
      },
      select: { id: true, family: true },
    });
    if (deps.length === 0) return;
    const callbackUrl = `${getMapslyPublicUrl()}/api/internal/enrich-job`;
    const jobs: WorkerJob[] = deps.map((d) => ({
      taskId: d.id, // idempotent: the job id IS the task id
      url: callbackUrl,
      payload: { jobId: d.id },
      callerLabel: `mapsly:enrich-${d.family.toLowerCase()}`,
      timeoutSec: 120,
    }));
    await enqueueCallbackWebhooks(jobs);
  } catch (err) {
    console.warn(
      `[/api/internal/enrich-job] dependent enqueue failed for ${businessId}: ${err instanceof Error ? err.message : String(err)} · cron backstop drains them`,
    );
  }
}

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
