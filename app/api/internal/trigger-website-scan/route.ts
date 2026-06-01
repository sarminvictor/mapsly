/**
 * /api/internal/trigger-website-scan · Boxly Worker callback for website
 * audits. One job per business · payload: { businessId }.
 *
 * Runs the SAME `collectWebsiteForBatch` the weekly lighthouse-audit cron +
 * the admin "Run Website" button use — Lighthouse (speed + Core Web Vitals) +
 * our DOM checks → a LighthouseAudit row → revalidate the owner's `/website`
 * cache. Mirrors /api/internal/trigger-search-scan + /trigger-review-pull.
 *
 * Auth: shared `BOXLY_WORKER_AUTH_TOKEN` Bearer · only the worker can call it.
 * Cost: opens its own CronRun so the Lighthouse spend (~$0.0025/biz) bills to
 * the "worker:website-scan" job, visible in /admin/cron-runs.
 * Idempotency: `collectWebsiteForBatch` inserts a fresh LighthouseAudit (latest
 * wins) — a worker retry just adds a newer row, never corrupts state.
 */

import { z } from "zod";

import { verifyBoxlyWorkerAuth } from "@/lib/boxly-worker/client";
import { withCronRun } from "@/lib/cost/cost-counter";
import { collectWebsiteForBatch } from "@/modules/website-intel/collect-website-intel";

// One Lighthouse Live call + DOM fetch is ~15-40s. 120s is generous headroom,
// well under Vercel's 300s default and the worker's 120s per-job cap.
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
    const outcome = await withCronRun("worker:website-scan", async () =>
      collectWebsiteForBatch([businessId]),
    );
    return Response.json({ ok: true, ...outcome }, { status: 200 });
  } catch (err) {
    console.error(
      "[/api/internal/trigger-website-scan] threw:",
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
