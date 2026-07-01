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

import { after } from "next/server";

import { auth } from "@/lib/auth";
import prisma, { Prisma } from "@/lib/prisma";
import { rawListWhere } from "./raw-list";
import { kickDispatch } from "@/modules/enrichment/kick-dispatch";
import {
  createCostEstimate,
  authorizeEstimate,
  holdCredits,
  grantFreeTierIfNew,
  WalletError,
} from "@/modules/cost/server";
import {
  ALL_ENRICHMENT_TYPES,
  enrichmentNeedsWebsite,
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

/**
 * The run action takes ONLY the estimateId. The scope (businesses, cells,
 * families) is reconstructed from the AUTHORIZED estimate server-side — a
 * tampered client can't enrich a larger/different set than was quoted.
 */
const RunEnrichInput = z.object({
  estimateId: z.string().min(1).max(64),
});

export type RunEnrichActionInput = z.input<typeof RunEnrichInput>;

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
  | { status: "needs_requote"; netUsd: number; netCredits: number }
  | { status: "needs_approval"; netUsd: number; netCredits: number }
  | { status: "quote_expired" }
  | { status: "insufficient_credits"; netCredits: number }
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
    // "Enrich the market" passes cellKeys with no explicit businessIds —
    // resolve the cells' enrichable businesses here so the estimate, the stored
    // scope (re-quote on run), and the fan-out all price/enrich the SAME real
    // set. Without this the per-business cost was 0 → nothing billed or enriched.
    // Resolve via rawListWhere so the enriched set is EXACTLY the visible raw
    // market: excludes hidden/unreachable AND permanently-closed listings (a
    // plain `isHidden: { not: true }` would wrongly include CLOSED_FOREVER rows,
    // paying to enrich dead businesses).
    let businessIds = parsed.data.businessIds;
    if (businessIds.length === 0 && parsed.data.cellKeys.length > 0) {
      // Scope to website-havers when ANY selected family needs a live site
      // (Lighthouse/contacts/tech/services/AI can't run without one). This is
      // the authoritative gate: `businessIds` here becomes the estimate's
      // stored scope, which runEnrichAction reconstructs from (anti-tamper),
      // so the priced set, the held credits, AND the fanned-out jobs all become
      // the enrichable subset in one place — no website-less business is ever
      // charged for or queued for a research it can't complete.
      const needsWebsite = enrichmentNeedsWebsite(parsed.data.enrichments);
      const inCell = await prisma.business.findMany({
        where: rawListWhere({
          cellKeys: parsed.data.cellKeys,
          filters: needsWebsite ? { hasWebsite: true } : undefined,
        }),
        select: { id: true },
        take: 5000,
      });
      businessIds = inCell.map((b) => b.id);
    }
    const freshByEnrichment = await countFreshForRun({
      enrichments: parsed.data.enrichments,
      businessIds,
      cellKeys: parsed.data.cellKeys,
      now,
    });
    const lines = buildEnrichLines({
      enrichments: parsed.data.enrichments,
      businessCount: businessIds.length,
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
          businessIds,
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
 * Enqueue an enrichment run from an authorized estimate. Authorizes the quote
 * (server re-quote + anti-tamper + gate), holds the credits, creates a PENDING
 * EnrichmentRun, and marks the estimate CONSUMED (single-use). The internal
 * dispatch cron executes the families + settles the hold; this action NEVER
 * calls external APIs and never charges above the held amount.
 */
export async function runEnrichAction(
  input: unknown,
): Promise<RunEnrichResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = RunEnrichInput.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    const agencyId = await callerAgencyId(session.user.id);
    if (!agencyId) return { status: "forbidden" };

    await grantFreeTierIfNew(agencyId);

    // Authorize: server re-quotes from the stored inputs (ignores any client
    // number) and flips the estimate AUTHORIZED, or tells us to re-quote.
    const authz = await authorizeEstimate(
      parsed.data.estimateId,
      session.user.id,
    );
    switch (authz.status) {
      case "not_found":
        return { status: "invalid_input", message: "estimate not found" };
      case "forbidden":
        return { status: "forbidden" };
      case "expired":
        return { status: "quote_expired" };
      case "already_consumed":
        return { status: "invalid_input", message: "estimate already used" };
      case "needs_requote":
        return {
          status: "needs_requote",
          netUsd: authz.result.netUsd,
          netCredits: authz.result.netCredits,
        };
    }
    const result = authz.result;
    // $5 rule: spends above the approval threshold need owner/Viktor sign-off,
    // not self-serve. Enforced server-side, not just in the UI.
    if (result.gate === "approval") {
      return {
        status: "needs_approval",
        netUsd: result.netUsd,
        netCredits: result.netCredits,
      };
    }

    // Reconstruct the run scope from the AUTHORIZED estimate (anti-tamper).
    const est = await prisma.costEstimate.findUnique({
      where: { id: parsed.data.estimateId },
      select: { enrichmentsJson: true, scopeRefsJson: true },
    });
    if (!est) return { status: "invalid_input", message: "estimate not found" };

    const families = (
      Array.isArray(est.enrichmentsJson) ? est.enrichmentsJson : []
    ) as EnrichmentType[];
    const scope = (est.scopeRefsJson ?? {}) as {
      businessIds?: string[];
      cellKeys?: string[];
      lines?: { total?: number; fresh?: number }[];
    };
    const businessIds = scope.businessIds ?? [];
    const cellKeys = scope.cellKeys ?? [];
    const lines = Array.isArray(scope.lines) ? scope.lines : [];
    const unitsRequested = lines.reduce((s, l) => s + (l.total ?? 0), 0);
    const unitsSkippedFresh = lines.reduce(
      (s, l) => s + Math.min(l.fresh ?? 0, l.total ?? 0),
      0,
    );

    const run = await prisma.enrichmentRun.create({
      data: {
        agencyId,
        triggeredByUserId: session.user.id,
        estimateId: parsed.data.estimateId,
        enrichmentsJson: families as unknown as Prisma.InputJsonValue,
        scopeKind: "enrichment",
        scopeRefsJson: {
          kind: "enrichment",
          businessIds,
          cellKeys,
        } as Prisma.InputJsonValue,
        status: "PENDING",
        estimatedUsd: result.netUsd,
        creditsHeld: result.netCredits,
        unitsRequested,
        unitsSkippedFresh,
      },
      select: { id: true },
    });

    // Reserve credits. A $0 run (everything fresh) needs no hold.
    if (result.netCredits > 0) {
      try {
        await holdCredits(agencyId, result.netCredits, run.id, result.netUsd);
      } catch (err) {
        if (err instanceof WalletError && err.code === "insufficient_credits") {
          await prisma.enrichmentRun
            .delete({ where: { id: run.id } })
            .catch(() => {});
          return {
            status: "insufficient_credits",
            netCredits: result.netCredits,
          };
        }
        throw err;
      }
    }

    // Single-use: mark the estimate consumed so it can't be replayed.
    await prisma.costEstimate.update({
      where: { id: parsed.data.estimateId },
      data: { status: "CONSUMED", consumedByRunId: run.id },
    });

    // Kick the dispatch drain post-response so enrichment starts near-instantly
    // instead of waiting for the */2 cron. Best-effort (see kickDispatch).
    // Guarded: `after()` throws outside a request scope (e.g. unit tests).
    try {
      after(() => kickDispatch());
    } catch {
      /* no request scope — the cron drains it */
    }

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
