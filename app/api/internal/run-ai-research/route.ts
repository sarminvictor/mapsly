// /api/internal/run-ai-research · the 5-stage AI research (ER) enrichment cron.
//
// POST, guarded by CRON_SECRET. Runs runAiResearchForBusiness over a bounded
// batch inside withCronRun("enrich:ai-research") so every gpt-5.4-nano call is
// cost-attributed (cost-discipline.md · no live API outside an open CronRun).
//
// Each stage self-gates on per-stage freshness (ER-1 180d · ER-2 90d ·
// ER-3/4/5 30d), so a re-run of a recently-enriched batch is mostly $0 (fresh
// stages serve their prior output to the rollup without a model call).
//
// Batch source: an explicit `businessIds` array in the body, OR the N
// least-recently-enriched active businesses (those with no BusinessEnrichment
// row come first via the left-join ordering). Bounded per scalability.md —
// never "all businesses in one invocation".
//
// Auth: Authorization: Bearer ${CRON_SECRET}. Validation: Zod on the body.

import { z } from "zod";

import { verifyCronAuth } from "@/lib/auth/cron-secret";
import { withCronRun } from "@/lib/cost/cost-counter";
import prisma from "@/lib/prisma";
import { runAiResearchForBusiness } from "@/modules/ai-research/pipeline";

const JOB = "enrich:ai-research";
const DEFAULT_BATCH = 25;
const MAX_BATCH = 100;

// Five nano calls per business in the worst (cold) case; allow headroom for a
// full batch where every stage is stale.
export const maxDuration = 300;

const BodySchema = z
  .object({
    businessIds: z.array(z.string().min(1).max(128)).max(MAX_BATCH).optional(),
    limit: z.number().int().positive().max(MAX_BATCH).optional(),
    /** Bypass per-stage freshness · re-run every stage. Use sparingly. */
    force: z.boolean().optional(),
  })
  .optional();

/**
 * Pick the next batch: active businesses ordered by their enrichment recency —
 * never-enriched first (NULL computedAt sorts first), then stalest. Uses a raw
 * left join so businesses without a BusinessEnrichment row are included.
 */
async function pickBatch(limit: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT b.id
    FROM "Business" b
    LEFT JOIN "BusinessEnrichment" e ON e."businessId" = b.id
    WHERE b."isActive" = true
    ORDER BY e."computedAt" ASC NULLS FIRST
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}

export async function POST(request: Request): Promise<Response> {
  // Preserve the existing shape: 401 on any auth failure (including a missing
  // CRON_SECRET, which the original `Bearer undefined` compare also rejected).
  if (!verifyCronAuth(request).ok) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    const json = request.headers.get("content-length")
      ? ((await request.json()) as unknown)
      : undefined;
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return Response.json(
        { error: "invalid_input", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    body = parsed.data;
  } catch {
    return Response.json({ error: "malformed_json" }, { status: 400 });
  }

  try {
    const summary = await withCronRun(JOB, async () => {
      const limit = body?.limit ?? DEFAULT_BATCH;
      const force = body?.force ?? false;
      const ids = body?.businessIds ?? (await pickBatch(limit));

      let processed = 0;
      let rolledUp = 0;
      let stagesComputed = 0;
      let stagesFresh = 0;
      let stagesFailed = 0;
      const errors: { businessId: string; message: string }[] = [];

      for (const businessId of ids) {
        try {
          const res = await runAiResearchForBusiness(businessId, { force });
          processed += 1;
          if (res.rolledUp) rolledUp += 1;
          for (const status of Object.values(res.stages)) {
            if (status === "computed") stagesComputed += 1;
            else if (status === "fresh") stagesFresh += 1;
            else stagesFailed += 1;
          }
        } catch (err) {
          errors.push({
            businessId,
            message: err instanceof Error ? err.message : "unknown",
          });
        }
      }

      return {
        requested: ids.length,
        processed,
        rolledUp,
        stagesComputed,
        stagesFresh,
        stagesFailed,
        errors,
        itemsProcessed: processed,
      };
    });

    return Response.json({ ok: true, ...summary }, { status: 200 });
  } catch (err) {
    console.error(
      "[/api/internal/run-ai-research] threw:",
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
