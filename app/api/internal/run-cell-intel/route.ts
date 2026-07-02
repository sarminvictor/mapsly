/**
 * /api/internal/run-cell-intel · run the per-cell intelligence collectors.
 *
 * POST { cellKey: string, layers?: ("meta"|"google"|"serp")[] }
 *
 * Runs the chosen Phase-6 collectors for one cell inside a single open CronRun
 * ("enrich:cell-intel") so every external vendor call is cost-attributed. Each
 * collector self-gates on a 30-day freshness window (AdMarketRun marker) and
 * serves from the DB at $0 when fresh.
 *
 * Auth: Authorization Bearer CRON_SECRET (server-to-server only).
 * Idempotency: collectors upsert; a re-run inside 30 days is served-from-db.
 */

import { z } from "zod";

import { verifyCronAuth } from "@/lib/auth/cron-secret";
import { withCronRun } from "@/lib/cost/cost-counter";
import { runMetaAdsForCell } from "@/modules/cell-intel/meta-ads";
import { runGoogleAdsForCell } from "@/modules/cell-intel/google-ads";
import { runSerpForCell } from "@/modules/cell-intel/serp";

// Meta (Apify, ~2-3 min) is the long pole; allow generous headroom.
export const maxDuration = 300;

const PayloadSchema = z.object({
  cellKey: z.string().min(3).max(256),
  layers: z
    .array(z.enum(["meta", "google", "serp"]))
    .min(1)
    .default(["meta", "google", "serp"]),
});

export async function POST(request: Request): Promise<Response> {
  // Preserve the existing shape: this route returns 401 for both a missing
  // CRON_SECRET and a bad/absent token (no separate 500 branch).
  if (!verifyCronAuth(request).ok) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let cellKey: string;
  let layers: Array<"meta" | "google" | "serp">;
  try {
    const json = (await request.json()) as unknown;
    const parsed = PayloadSchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { error: "invalid_input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    cellKey = parsed.data.cellKey;
    layers = parsed.data.layers;
  } catch {
    return Response.json({ error: "malformed_json" }, { status: 400 });
  }

  try {
    const outcome = await withCronRun("enrich:cell-intel", async () => {
      const now = new Date();
      const results: Record<string, unknown> = {};
      // Sequential: each layer hits a distinct vendor; running them in series
      // keeps a single cell well inside the function budget + vendor rate caps.
      if (layers.includes("meta")) {
        results.meta = await runMetaAdsForCell(cellKey, now);
      }
      if (layers.includes("google")) {
        results.google = await runGoogleAdsForCell(cellKey, now);
      }
      if (layers.includes("serp")) {
        results.serp = await runSerpForCell(cellKey, now);
      }
      return results;
    });

    return Response.json({ ok: true, cellKey, layers, results: outcome });
  } catch (err) {
    console.error(
      "[/api/internal/run-cell-intel] threw:",
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
