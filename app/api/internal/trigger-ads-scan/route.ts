/**
 * /api/internal/trigger-ads-scan · Boxly Worker callback for the ads
 * intelligence DFS/Google pass. One job per business · payload: { businessId }.
 *
 * Runs `collectAdsForBatch([businessId], { dfs: true, meta: false })` — keyword
 * costs (CPC/competition) + Google Ads Transparency for the business + its
 * same-market competitors. Mirrors /api/internal/trigger-search-scan.
 *
 * Why meta:false here — the Meta Ad Library run (Apify, ~2-3 min) exceeds the
 * worker's 120s per-job cap, so it CANNOT be a worker job. Meta market data is
 * collected by the dedicated weekly `ads-meta` cron (one cell per tick,
 * cell-deduped). This callback covers only the fast DataForSEO/Google half.
 *
 * Auth: shared `BOXLY_WORKER_AUTH_TOKEN` Bearer. Cost: own CronRun
 * ("worker:ads-scan"). Idempotency: collectAdsForBatch upserts keyword costs +
 * Google ad rows, so a worker retry refreshes idempotently.
 */

import { z } from "zod";

import { verifyBoxlyWorkerAuth } from "@/lib/boxly-worker/client";
import { withCronRun } from "@/lib/cost/cost-counter";
import { collectAdsForBatch } from "@/modules/ads-intel/collect-ads-intel";

// DataForSEO keyword costs + Google Transparency for the biz + competitors is
// ~30-60s. 120s headroom; Meta (the slow part) is NOT run here.
export const maxDuration = 120;

const PayloadSchema = z.object({
  businessId: z.string().min(1).max(128),
});

export async function POST(request: Request): Promise<Response> {
  if (!verifyBoxlyWorkerAuth(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let businessId: string;
  try {
    const json = (await request.json()) as unknown;
    const result = PayloadSchema.safeParse(json);
    if (!result.success) {
      return Response.json(
        { error: "invalid_input", details: result.error.flatten() },
        { status: 400 },
      );
    }
    businessId = result.data.businessId;
  } catch {
    return Response.json({ error: "malformed_json" }, { status: 400 });
  }

  try {
    const outcome = await withCronRun("worker:ads-scan", async () =>
      collectAdsForBatch([businessId], { dfs: true, meta: false }),
    );
    return Response.json(
      {
        ok: true,
        businesses: outcome.businesses,
        keywordsUpserted: outcome.keywordsUpserted,
        errors: outcome.errors.length,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error(
      "[/api/internal/trigger-ads-scan] threw:",
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
