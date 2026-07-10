// /api/internal/run-playbooks · the expert-layer enrichment cron (Phase 7).
//
// POST, guarded by CRON_SECRET. Runs runPlaybooksForBusiness over a bounded
// batch inside withCronRun("enrich:playbooks") so the run is cost-tracked (the
// pipeline is deterministic, so cost stays ~$0 — the CronRun is for telemetry
// + the no-live-API invariant).
//
// Batch source: either an explicit `businessIds` array in the body, or the N
// stalest businesses whose vertical HAS a playbook (resolved cheaply by
// matching the launch playbooks' category slugs). Bounded per the scalability
// rule — never "all businesses in one invocation".
//
// Auth: EITHER the Boxly worker token (the callback caller · CallbackWebhook-
// Processor sends BOXLY_WORKER_AUTH_TOKEN) OR CRON_SECRET (the cron caller).
// Before 2026-07-10 this accepted ONLY CRON_SECRET, so every worker close-sweep
// POST 401'd — the enrich-close-playbooks sweep has been dead since 2026-07-02
// (INC · 55 findings stuck missing-enrichment though their data existed). Mirror
// the dual-auth /api/internal/enrich-job already uses. Validation: Zod on body.
//
// See:
//   - modules/playbooks/run.ts        — runPlaybooksForBusiness
//   - modules/playbooks/registry.ts   — ALL_PLAYBOOKS (category slugs)
//   - lib/cost/cost-counter.ts        — withCronRun
//   - .claude/rules/scalability.md    — bounded per-run work

import { z } from "zod";

import { verifyCronAuth } from "@/lib/auth/cron-secret";
import { verifyBoxlyWorkerAuth } from "@/lib/boxly-worker/client";
import { withCronRun } from "@/lib/cost/cost-counter";
import prisma from "@/lib/prisma";
import { ALL_PLAYBOOKS } from "@/modules/playbooks/registry";
import { runPlaybooksForBusiness } from "@/modules/playbooks/run";

const JOB = "enrich:playbooks";
const DEFAULT_BATCH = 50;
const MAX_BATCH = 200;

const BodySchema = z
  .object({
    businessIds: z.array(z.string().min(1).max(128)).max(MAX_BATCH).optional(),
    limit: z.number().int().positive().max(MAX_BATCH).optional(),
  })
  .optional();

/** All category slugs across the registered playbooks (lowercased, de-duped). */
function playbookCategorySlugs(): string[] {
  return Array.from(
    new Set(
      ALL_PLAYBOOKS.flatMap((p) => p.categorySlugs).map((c) =>
        c.toLowerCase().trim(),
      ),
    ),
  );
}

/**
 * Pick the next batch of businesses whose vertical has a playbook. Matches the
 * playbooks' category slugs against Business.category / categories / categoryIds.
 * Oldest-updated first so the batch rotates across the index.
 */
async function pickBatch(limit: number): Promise<string[]> {
  const slugs = playbookCategorySlugs();
  if (slugs.length === 0) return [];
  const rows = await prisma.business.findMany({
    where: {
      isActive: true,
      OR: [
        { category: { in: slugs, mode: "insensitive" } },
        { categories: { hasSome: slugs } },
        { categoryIds: { hasSome: slugs } },
      ],
    },
    select: { id: true },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
  return rows.map((r) => r.id);
}

export async function POST(request: Request): Promise<Response> {
  // Accept EITHER the Boxly worker token (the callback-webhook caller) OR
  // CRON_SECRET (the cron caller). 401 only when neither matches.
  const workerOk = verifyBoxlyWorkerAuth(request.headers.get("authorization"));
  const cronOk = verifyCronAuth(request).ok;
  if (!workerOk && !cronOk) {
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
      const ids = body?.businessIds ?? (await pickBatch(limit));

      let processed = 0;
      let withPlaybook = 0;
      let flagged = 0;
      let notChecked = 0;
      const errors: { businessId: string; message: string }[] = [];

      for (const businessId of ids) {
        try {
          const res = await runPlaybooksForBusiness(businessId);
          processed += 1;
          if (res.playbookId) {
            withPlaybook += 1;
            flagged += res.persisted?.flagged ?? 0;
            notChecked += res.persisted?.notChecked ?? 0;
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
        withPlaybook,
        flagged,
        notChecked,
        errors,
      };
    });

    return Response.json({ ok: true, ...summary }, { status: 200 });
  } catch (err) {
    console.error(
      "[/api/internal/run-playbooks] threw:",
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
