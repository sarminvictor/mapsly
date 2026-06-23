"use server";

/**
 * Enrichment server actions (Phase 9 · Raw List → Enrich).
 *
 * Two actions, both auth-gated + Zod-validated per `.claude/rules/security.md`:
 *
 *   - preflightEnrichAction · prices the selected enrichments over the selected
 *     businesses (per-business families) + cells (per-cell families), mints a
 *     CostEstimate, and returns the quote. Pure read + a quote row; no external
 *     API (`.claude/rules/cost-discipline.md`).
 *   - runEnrichAction · ENQUEUES the run by creating a PENDING EnrichmentRun and
 *     returns its id. The heavy work runs in the existing `/api/internal/*`
 *     worker routes (cron context), NOT here — so the "no live API in user
 *     request path" invariant holds.
 *
 * Fresh counts are real: every unit (business or cell) already enriched within
 * its family's `freshnessDays` window is deduped to $0 ("served from cache") via
 * `countFreshForRun` → `buildEnrichLines({ freshByEnrichment })`. See
 * `modules/discovery/enrich-fresh.ts` (pure math) + `enrich-fresh-db.ts` (reads).
 */

import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma, { Prisma } from "@/lib/prisma";
import { createCostEstimate } from "@/modules/cost/server";
import {
  ALL_ENRICHMENT_TYPES,
  type EnrichmentType,
} from "@/modules/cost/pricing";
import { buildEnrichLines } from "@/modules/discovery/enrich-lines";
import { countFreshForRun } from "@/modules/discovery/enrich-fresh-db";

// ── Input schema ──────────────────────────────────────────────────────────

const EnrichmentEnum = z.enum(
  ALL_ENRICHMENT_TYPES as [EnrichmentType, ...EnrichmentType[]],
);

const EnrichInput = z.object({
  /** Selected businesses (drives per-business families). Empty → cell-only. */
  businessIds: z.array(z.string().min(1).max(64)).max(5000).default([]),
  /** Cells the run spans (drives per-cell families). */
  cellKeys: z.array(z.string().min(1).max(160)).max(200).default([]),
  /** Enrichment families to run (at least one). */
  enrichments: z.array(EnrichmentEnum).min(1).max(ALL_ENRICHMENT_TYPES.length),
});

export type EnrichActionInput = z.input<typeof EnrichInput>;

// ── Result shapes ───────────────────────────────────────────────────────────

export interface EnrichQuoteLine {
  enrichment: EnrichmentType;
  label: string;
  unit: "business" | "cell";
  total: number;
  netUsd: number;
  upperBoundUsd: number;
}

export type PreflightEnrichResult =
  | {
      status: "ok";
      estimateId: string;
      netUsd: number;
      upperBoundUsd: number;
      freshHitUsd: number;
      netCredits: number;
      gate: "auto" | "confirm" | "approval";
      lines: EnrichQuoteLine[];
    }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

export type RunEnrichResult =
  | { status: "ok"; runId: string }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

async function callerAgencyId(userId: string): Promise<string | null> {
  const member = await prisma.agencyMember.findFirst({
    where: { userId },
    select: { agencyId: true },
  });
  return member?.agencyId ?? null;
}

/**
 * Price an enrichment request and mint a CostEstimate. The estimator line
 * inputs are stored in scopeRefsJson so authorizeEstimate can re-quote
 * server-side (anti-tamper, per `.claude/rules/cost-discipline.md`).
 */
export async function preflightEnrichAction(
  input: unknown,
): Promise<PreflightEnrichResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = EnrichInput.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    const agencyId = await callerAgencyId(session.user.id);
    if (!agencyId) return { status: "forbidden" };

    const now = new Date();
    const freshByEnrichment = await countFreshForRun({
      enrichments: parsed.data.enrichments,
      businessIds: parsed.data.businessIds,
      cellKeys: parsed.data.cellKeys,
      now,
    });
    const lines = buildEnrichLines({
      enrichments: parsed.data.enrichments,
      businessCount: parsed.data.businessIds.length,
      cellCount: parsed.data.cellKeys.length,
      freshByEnrichment,
    });

    const { estimate, result } = await createCostEstimate(
      {
        agencyId,
        userId: session.user.id,
        scopeKind: "enrichment",
        enrichments: parsed.data.enrichments,
        scopeRefs: {
          kind: "enrichment",
          businessIds: parsed.data.businessIds,
          cellKeys: parsed.data.cellKeys,
          // Persist the estimator inputs so authorizeEstimate can re-quote.
          lines: lines as unknown as Prisma.InputJsonValue,
        } as Prisma.InputJsonObject,
        lines,
        freshnessAsOf: now,
      },
      now,
    );

    return {
      status: "ok",
      estimateId: estimate.id,
      netUsd: result.netUsd,
      upperBoundUsd: result.upperBoundUsd,
      freshHitUsd: result.freshHitUsd,
      netCredits: result.netCredits,
      gate: result.gate,
      lines: result.lines.map((l) => ({
        enrichment: l.enrichment,
        label: l.label,
        unit: l.unit,
        total: l.total,
        netUsd: l.netUsd,
        upperBoundUsd: l.upperBoundUsd,
      })),
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "enrich.preflight.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}

/**
 * Enqueue an enrichment run. Creates a PENDING EnrichmentRun row and returns its
 * id. The internal worker routes (`/api/internal/scan-contacts`, etc.) execute
 * the families inside cron context; this action NEVER calls external APIs.
 */
export async function runEnrichAction(
  input: unknown,
): Promise<RunEnrichResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = EnrichInput.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    const agencyId = await callerAgencyId(session.user.id);
    if (!agencyId) return { status: "forbidden" };

    const freshByEnrichment = await countFreshForRun({
      enrichments: parsed.data.enrichments,
      businessIds: parsed.data.businessIds,
      cellKeys: parsed.data.cellKeys,
    });
    const lines = buildEnrichLines({
      enrichments: parsed.data.enrichments,
      businessCount: parsed.data.businessIds.length,
      cellCount: parsed.data.cellKeys.length,
      freshByEnrichment,
    });
    const unitsRequested = lines.reduce((s, l) => s + l.total, 0);
    const unitsSkippedFresh = parsed.data.enrichments.reduce(
      (s, e) => s + Math.min(freshByEnrichment[e] ?? 0, unitsRequested),
      0,
    );

    const run = await prisma.enrichmentRun.create({
      data: {
        agencyId,
        triggeredByUserId: session.user.id,
        enrichmentsJson: parsed.data
          .enrichments as unknown as Prisma.InputJsonValue,
        scopeKind: "enrichment",
        scopeRefsJson: {
          kind: "enrichment",
          businessIds: parsed.data.businessIds,
          cellKeys: parsed.data.cellKeys,
        } as Prisma.InputJsonValue,
        status: "PENDING",
        unitsRequested,
        unitsSkippedFresh,
      },
      select: { id: true },
    });

    return { status: "ok", runId: run.id };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "enrich.enqueue.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}
