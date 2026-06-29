"use server";

/**
 * Discovery server actions (Phase 2).
 *
 * Two actions, both auth-gated + Zod-validated per `.claude/rules/security.md`:
 *
 *   - preflightDiscoveryAction · prices the requested cells (fresh-vs-refetch +
 *     pre-flight cost) and mints a CostEstimate. Pure read + a quote row; no
 *     external API.
 *   - runDiscoveryAction · ENQUEUES the run by creating a PENDING Discovery row
 *     and returns its id. The heavy `mapsSearch` work runs in
 *     /api/internal/run-discovery (cron context), NOT here — so the "no live
 *     API in user request path" invariant holds
 *     (.claude/rules/cost-discipline.md).
 *
 * The caller (or a follow-on worker dispatch) hits the internal route with the
 * Discovery id to execute it.
 */

import { z } from "zod";

import { cellKey as makeCellKey } from "@/lib/cell";
import { auth } from "@/lib/auth";
import { metroBySlug } from "@/lib/geo/resolve-metro";
import prisma from "@/lib/prisma";
import {
  createCostEstimate,
  authorizeEstimate,
  holdCredits,
  grantFreeTierIfNew,
  WalletError,
} from "@/modules/cost/server";
import { decideDiscoveryPlan } from "@/modules/discovery/freshness-decision";
import {
  discoveryIdempotencyKey,
  type RunDiscoverySummary,
} from "@/modules/discovery/run-discovery";

const CellInput = z.object({
  categorySlug: z.string().min(1).max(120),
  categoryId: z.string().min(1).max(64),
  metroSlug: z.string().min(1).max(120),
  country: z.string().min(2).max(3).optional(),
});

const DiscoveryInput = z.object({
  cells: z.array(CellInput).min(1).max(50),
  limitPerCell: z.number().int().min(1).max(1000).optional(),
});

export type DiscoveryActionInput = z.input<typeof DiscoveryInput>;

export type PreflightDiscoveryResult =
  | {
      status: "ok";
      estimateId: string;
      netUsd: string;
      netCredits: number;
      freshCount: number;
      refetchCount: number;
    }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

/** The run action takes ONLY the estimateId — the cell scope is reconstructed
 *  from the AUTHORIZED estimate server-side (anti-tamper). */
const RunDiscoveryInput = z.object({
  estimateId: z.string().min(1).max(64),
});

export type RunDiscoveryActionResult =
  | { status: "ok"; discoveryId: string }
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
 * Price a discovery request and mint a CostEstimate. The estimator line inputs
 * are stored in scopeRefsJson so authorizeEstimate can re-quote server-side.
 */
export async function preflightDiscoveryAction(
  input: unknown,
): Promise<PreflightDiscoveryResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = DiscoveryInput.safeParse(input);
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
    const cellKeys = parsed.data.cells.map((c) =>
      makeCellKey(
        c.categorySlug,
        c.metroSlug,
        (c.country ?? "US").toUpperCase(),
      ),
    );

    // Pull each cell's freshness anchor from its TrackedLocation (if any).
    const planInputs = await Promise.all(
      parsed.data.cells.map(async (c, i) => {
        const metro = metroBySlug(c.metroSlug);
        const tracked = metro
          ? await prisma.trackedLocation.findFirst({
              where: {
                categoryId: c.categoryId,
                city: metro.name,
                province: null,
                country: (c.country ?? "US").toUpperCase(),
              },
              select: { lastDiscoveredAt: true, lastTotalAvailable: true },
            })
          : null;
        return {
          cellKey: cellKeys[i],
          lastDiscoveredAt: tracked?.lastDiscoveredAt ?? null,
          expectedListings:
            tracked?.lastTotalAvailable ?? parsed.data.limitPerCell ?? 100,
        };
      }),
    );

    const plan = decideDiscoveryPlan(planInputs, now);

    // The discovery cost is one cell-priced line ("serp"-style is per-cell, but
    // Maps discovery has its own model in estimateDiscovery). We carry the
    // per-cell discovery estimate through scopeRefs for the re-quote, and use
    // the plan.estimate numbers directly on the CostEstimate row via a single
    // synthesized "meta_ads"-shaped cell line is NOT correct — instead we store
    // the discovery cells and persist the plan estimate verbatim. The
    // CostEstimate row carries net/credits already computed by the plan.
    const { estimate } = await createCostEstimate(
      {
        agencyId,
        userId: session.user.id,
        scopeKind: "discovery",
        enrichments: [],
        scopeRefs: {
          kind: "discovery",
          cells: planInputs,
          lines: [],
          planNetUsd: plan.estimate.netUsd,
          planNetCredits: plan.estimate.netCredits,
        },
        lines: [],
        freshnessAsOf: now,
      },
      now,
    );

    // Overwrite the empty-line estimate with the discovery plan's numbers so
    // the quote reflects per-cell Maps cost (estimateRun over [] yields $0).
    await prisma.costEstimate.update({
      where: { id: estimate.id },
      data: {
        grossUsd: plan.estimate.grossUsd,
        freshHitUsd: plan.estimate.freshHitUsd,
        netUsd: plan.estimate.netUsd,
        netCredits: plan.estimate.netCredits,
      },
    });

    return {
      status: "ok",
      estimateId: estimate.id,
      netUsd: plan.estimate.netUsd.toFixed(4),
      netCredits: plan.estimate.netCredits,
      freshCount: plan.freshCount,
      refetchCount: plan.refetchCount,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "discovery.preflight.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}

/**
 * Enqueue a discovery run from an authorized estimate. Authorizes the quote
 * (server re-quote + gate), creates/updates a PENDING Discovery (idempotent by
 * sorted cellKeys + requester), holds the credits, and marks the estimate
 * CONSUMED. The dispatch cron executes maps-search + settles the hold against
 * the actual fetch cost (fresh cells refund to $0).
 */
export async function runDiscoveryAction(
  input: unknown,
): Promise<RunDiscoveryActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = RunDiscoveryInput.safeParse(input);
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
    if (result.gate === "approval") {
      return {
        status: "needs_approval",
        netUsd: result.netUsd,
        netCredits: result.netCredits,
      };
    }

    // Reconstruct cell scope from the AUTHORIZED estimate (anti-tamper).
    const est = await prisma.costEstimate.findUnique({
      where: { id: parsed.data.estimateId },
      select: { scopeRefsJson: true },
    });
    const scope = (est?.scopeRefsJson ?? {}) as {
      cells?: { cellKey?: string }[];
    };
    const cellKeys = (scope.cells ?? [])
      .map((c) => c.cellKey)
      .filter((k): k is string => typeof k === "string" && k.length > 0);
    if (cellKeys.length === 0) {
      return { status: "invalid_input", message: "estimate has no cells" };
    }

    const idempotencyKey = discoveryIdempotencyKey(cellKeys, session.user.id);

    const discovery = await prisma.discovery.upsert({
      where: { idempotencyKey },
      create: {
        agencyId,
        requestedByUserId: session.user.id,
        idempotencyKey,
        status: "PENDING",
        cellKeys,
        cellCount: cellKeys.length,
      },
      update: {},
      select: { id: true },
    });

    // Reserve credits (idempotent: skip if this discovery already has a hold,
    // e.g. an idempotent re-submit). A $0 (all-fresh) discovery needs no hold.
    if (result.netCredits > 0) {
      const existingHold = await prisma.creditLedger.findFirst({
        where: { runId: discovery.id, type: "HOLD" },
        select: { id: true },
      });
      if (!existingHold) {
        try {
          await holdCredits(
            agencyId,
            result.netCredits,
            discovery.id,
            result.netUsd,
          );
        } catch (err) {
          if (
            err instanceof WalletError &&
            err.code === "insufficient_credits"
          ) {
            await prisma.discovery
              .update({
                where: { id: discovery.id },
                data: { status: "FAILED" },
              })
              .catch(() => {});
            return {
              status: "insufficient_credits",
              netCredits: result.netCredits,
            };
          }
          throw err;
        }
      }
    }

    await prisma.costEstimate.update({
      where: { id: parsed.data.estimateId },
      data: { status: "CONSUMED", consumedByRunId: discovery.id },
    });

    return { status: "ok", discoveryId: discovery.id };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "discovery.enqueue.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}

// Re-export the summary type so callers of the internal route can type results.
export type { RunDiscoverySummary };
