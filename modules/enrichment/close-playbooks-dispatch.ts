// modules/enrichment/close-playbooks-dispatch.ts · run-close playbook execution
// off the critical tick (WP3-12).
//
// closeRunIfDone used to run runPlaybooksForBusiness INLINE in a loop over every
// touched business before returning. On a big run (hundreds of DONE businesses)
// that loop delayed the credit settlement + kept the dispatch tick busy right up
// against the 300s cap. WP3-12 settles credits FIRST (the money-critical step)
// and then hands the ($0, deterministic) playbook execution to the Boxly worker
// via the existing /api/internal/run-playbooks route (which already accepts a
// `businessIds` batch). When the worker is unset (local/preview) OR the enqueue
// throws, we run the playbooks INLINE exactly as before — identical correctness,
// just on the tick. Mirrors dispatch-website-scan.ts's enqueue-with-inline-
// fallback pattern.

import {
  enqueueCallbackWebhooks,
  BoxlyWorkerError,
  type WorkerJob,
} from "@/lib/boxly-worker/client";
import { getMapslyPublicUrl } from "@/lib/url/mapsly-public-url";
import { runPlaybooksForBusiness } from "@/modules/playbooks/run";

const PLAYBOOK_BATCH = 50; // matches /api/internal/run-playbooks DEFAULT_BATCH

/** True iff both Boxly worker env vars are set. */
function workerAvailable(): boolean {
  return Boolean(
    process.env.BOXLY_WORKER_BASE_URL && process.env.BOXLY_WORKER_AUTH_TOKEN,
  );
}

/**
 * Enqueue (or inline-run) the expert-layer playbooks for a run's touched
 * businesses. `runId` is only used to build a stable, correlatable taskId.
 * Best-effort: a playbook failure NEVER blocks the run close (it already
 * settled). Returns how it was handled for logging.
 */
export async function enqueueClosePlaybooks(
  runId: string,
  businessIds: string[],
): Promise<"worker" | "inline" | "none"> {
  const ids = [...new Set(businessIds)].filter(Boolean);
  if (ids.length === 0) return "none";

  if (workerAvailable()) {
    const callbackUrl = `${getMapslyPublicUrl()}/api/internal/run-playbooks`;
    const ts = Date.now();
    const jobs: WorkerJob[] = [];
    for (let i = 0; i < ids.length; i += PLAYBOOK_BATCH) {
      const chunk = ids.slice(i, i + PLAYBOOK_BATCH);
      jobs.push({
        taskId: `mapsly-playbooks-${runId}-${i}-${ts}`,
        url: callbackUrl,
        payload: { businessIds: chunk },
        callerLabel: "mapsly:enrich-close-playbooks",
        timeoutSec: 120,
      });
    }
    try {
      for (let i = 0; i < jobs.length; i += 500) {
        await enqueueCallbackWebhooks(jobs.slice(i, i + 500));
      }
      return "worker";
    } catch (err) {
      console.warn(
        `[enrichment:close-playbooks] worker enqueue failed (${err instanceof BoxlyWorkerError ? "BoxlyWorkerError" : "unknown"}): ${err instanceof Error ? err.message : String(err)} · running inline`,
      );
      // fall through to inline
    }
  }

  // Inline fallback (or no worker configured): run each playbook here. A single
  // playbook throw is isolated so one bad business never aborts the rest.
  for (const id of ids) {
    try {
      await runPlaybooksForBusiness(id);
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "close-playbooks.inline.error",
          runId,
          businessId: id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  return "inline";
}
