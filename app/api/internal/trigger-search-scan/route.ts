/**
 * /api/internal/trigger-search-scan · Boxly Worker callback for search
 * visibility scans. Dispatches on payload.mode:
 *
 *   - mode=biz   · local-intent keyword discovery for one business
 *                  (S.6 · architecture C · industry × city templates)
 *                  payload: { businessId }
 *
 *   - mode=cell  · cell-aggregated Maps queries for the cell's
 *                  local-intent keyword set
 *                  payload: { city, country, centroidLat, centroidLng }
 *
 * Auth: shared `BOXLY_WORKER_AUTH_TOKEN` Bearer · only the worker can call
 * this. Mirrors /api/qualify-one + /api/internal/trigger-review-pull.
 *
 * Cost attribution: opens its own CronRun per call so the keyword_volume
 * cost (~$0.025/biz) and Maps cost (~$0.002/keyword) bill correctly.
 * Visible in /admin/cron-runs under the "worker" category.
 *
 * Idempotency: the discovery + aggregate modules are upsert-based · a
 * worker retry that lands after a successful run will refresh data
 * idempotently with the same scan timestamp.
 */

import { z } from "zod";

import { verifyBoxlyWorkerAuth } from "@/lib/boxly-worker/client";
import { withCronRun } from "@/lib/cost/cost-counter";
import { discoverLocalIntentForBusiness } from "@/modules/search-visibility/discover-local-intent";
import { aggregateCellMaps } from "@/modules/search-visibility/aggregate-cell-maps";

// ranked_keywords is fast (~2s); Maps × 30 keywords ~60s. 120s budget is
// generous but far under Vercel's 300s default.
export const maxDuration = 120;

const BizPayloadSchema = z.object({
  mode: z.literal("biz"),
  businessId: z.string().min(1).max(128),
});

const CellPayloadSchema = z.object({
  mode: z.literal("cell"),
  city: z.string().min(1).max(120),
  country: z.string().min(2).max(8),
  centroidLat: z.number().gte(-90).lte(90),
  centroidLng: z.number().gte(-180).lte(180),
  topN: z.number().int().min(1).max(100).optional(),
});

const PayloadSchema = z.discriminatedUnion("mode", [
  BizPayloadSchema,
  CellPayloadSchema,
]);

export async function POST(request: Request): Promise<Response> {
  // 1. Verify Bearer auth
  const authHeader = request.headers.get("authorization");
  if (!verifyBoxlyWorkerAuth(authHeader)) {
    const incoming = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
    const expected = process.env.BOXLY_WORKER_AUTH_TOKEN ?? "";
    console.warn(
      `[/api/internal/trigger-search-scan] 401 · incoming-token len=${incoming.length} ` +
        `prefix=${incoming.slice(0, 4)} suffix=${incoming.slice(-4)} · ` +
        `expected len=${expected.length} ` +
        `prefix=${expected.slice(0, 4)} suffix=${expected.slice(-4)} · ` +
        `env-set=${expected.length > 0}`,
    );
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Parse + validate body
  let parsed: z.infer<typeof PayloadSchema>;
  try {
    const json = (await request.json()) as unknown;
    const result = PayloadSchema.safeParse(json);
    if (!result.success) {
      return Response.json(
        {
          error: "invalid_input",
          details: result.error.flatten(),
        },
        { status: 400 },
      );
    }
    parsed = result.data;
  } catch {
    return Response.json({ error: "malformed_json" }, { status: 400 });
  }

  // 3. Dispatch by mode · each opens its own CronRun for cost attribution.
  try {
    if (parsed.mode === "biz") {
      const outcome = await withCronRun(
        "worker:search-discover-local-intent",
        async () => discoverLocalIntentForBusiness(parsed.businessId),
      );
      return Response.json(
        { ok: true, mode: "biz", ...outcome },
        { status: 200 },
      );
    }

    const outcome = await withCronRun(
      "worker:search-aggregate-cell",
      async () =>
        aggregateCellMaps({
          city: parsed.city,
          country: parsed.country,
          centroidLat: parsed.centroidLat,
          centroidLng: parsed.centroidLng,
          topN: parsed.topN,
        }),
    );
    return Response.json(
      { ok: true, mode: "cell", ...outcome },
      { status: 200 },
    );
  } catch (err) {
    if (err instanceof Error && /not found/i.test(err.message)) {
      return Response.json(
        { error: "not_found", message: err.message },
        { status: 404 },
      );
    }
    console.error(
      "[/api/internal/trigger-search-scan] threw:",
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
