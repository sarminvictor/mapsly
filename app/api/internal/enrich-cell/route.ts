// /api/internal/enrich-cell · Boxly Worker callback for ONE per-cell family
// collection (WP3-2 / WP1-5).
//
// fanOutRun enqueues one job per (cell × cell-family) that needs collecting
// (payload { runId, cellKey, family }) so the slow Apify/DfS cell call runs on
// the worker's budget — NOT inside the 300s Vercel fanOutRun tick (WP1-5's 10/10
// clause). This route collects the cell (freshness-gated inside the collector)
// and accrues the OUTCOME-based cost onto the run's actualUsd (WP1-6), exactly
// like the inline fallback in fanOutRun.
//
// Idempotent: the collector's own 30-day freshness gate makes a worker retry a
// $0 served-from-db no-op, and a FAILED cell run bills nothing + doesn't gate
// the retry (latestAdMarketRun ignores FAILED rows). A double delivery therefore
// never double-bills.
//
// Auth: EITHER the Boxly worker token OR CRON_SECRET. Cost: its own
// CronRun("worker:enrich-cell").

import { z } from "zod";

import { verifyCronAuth } from "@/lib/auth/cron-secret";
import { verifyBoxlyWorkerAuth } from "@/lib/boxly-worker/client";
import { withCronRun } from "@/lib/cost/cost-counter";
import { runEnrichCellForRun } from "@/modules/enrichment/dispatch";

// A cell collection is one Apify actor run (~minutes) or a DfS SERP batch —
// give it the full 300s (well under the worker's own per-job budget too).
export const maxDuration = 300;

const PayloadSchema = z.object({
  runId: z.string().min(1).max(128),
  cellKey: z.string().min(1).max(256),
  // B1 · google_ads is no longer a per-cell family — it dispatches as a
  // per-business GOOGLE_ADS EnrichmentJob (routed through /api/internal/enrich-job).
  // Only meta_ads + serp remain per-cell.
  family: z.enum(["meta_ads", "serp"]),
});

async function handle(req: Request): Promise<Response> {
  const workerOk = verifyBoxlyWorkerAuth(req.headers.get("authorization"));
  const cronOk = verifyCronAuth(req).ok;
  if (!workerOk && !cronOk) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: z.infer<typeof PayloadSchema>;
  try {
    const json = (await req.json()) as unknown;
    const parsed = PayloadSchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { error: "invalid_input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    payload = parsed.data;
  } catch {
    return Response.json({ error: "malformed_json" }, { status: 400 });
  }

  try {
    const accruedUsd = await withCronRun("worker:enrich-cell", () =>
      runEnrichCellForRun(payload.runId, payload.cellKey, payload.family),
    );
    return Response.json({ ok: true, accruedUsd }, { status: 200 });
  } catch (err) {
    console.error(
      "[/api/internal/enrich-cell] threw:",
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

export async function POST(req: Request): Promise<Response> {
  return handle(req);
}
