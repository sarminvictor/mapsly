// Internal cron · meta:reconcile (P5 · 2026-07-10)
//
// Two-duty sweep over recent META AdMarketRun rows (see
// modules/cell-intel/meta-reconcile.ts):
//   A · backfill FINALIZED Apify usage onto rows whose cost was an
//       elapsed×memory estimate (detailJson.costEstimated · INC-56), and
//   B · finish budget-stopped chunked collections (detailJson.pendingTargets)
//       by re-running the collector with the freshness gate bypassed.
//
// Poll-continuation per .claude/rules/realtime-runs-adr.md — no Apify webhook.
// Auth: Bearer CRON_SECRET. Cost: continuations spend real vendor $ —
// attributed to the CronRun opened by withCronRun("meta:reconcile").
// Bounded per tick (≤20 backfills · ≤2 continuations); the 10-min cadence
// drains the rest. Also POST-triggerable for a manual admin kick.

import { verifyCronAuth } from "@/lib/auth/cron-secret";
import { withCronRun } from "@/lib/cost/cost-counter";
import { reconcileMetaRuns } from "@/modules/cell-intel/meta-reconcile";

const JOB = "meta:reconcile";

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

  try {
    const summary = await withCronRun(JOB, async () => reconcileMetaRuns());
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
