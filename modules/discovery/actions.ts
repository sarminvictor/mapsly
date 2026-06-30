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

import { cellKey as makeCellKey, cellFreshnessState } from "@/lib/cell";
import { auth } from "@/lib/auth";
import { metroBySlug } from "@/lib/geo/resolve-metro";
import prisma, { Prisma } from "@/lib/prisma";
import { rawListWhere } from "@/modules/discovery/raw-list";
import { parseDiscoverySignals } from "@/modules/agency-portal/discover/discovery-signals";
import {
  createCostEstimate,
  authorizeEstimate,
  holdCredits,
  grantFreeTierIfNew,
  WalletError,
} from "@/modules/cost/server";
import { decideDiscoveryPlan } from "@/modules/discovery/freshness-decision";
import { discoveryIdempotencyKey } from "@/modules/discovery/run-discovery";

const CellInput = z.object({
  categorySlug: z.string().min(1).max(120),
  categoryId: z.string().min(1).max(64),
  metroSlug: z.string().min(1).max(120),
  country: z.string().min(2).max(3).optional(),
});

/** The active goal signals, threaded from the journey so the run can persist
 *  them on `Discovery.signalsJson` for the workbench evaluator (P3). Only the
 *  SIG_META key + the user's tune/conds/match are carried; comparator/value/
 *  registryKey are re-derived from SIG_META at read time. Loosely validated
 *  (the eval layer guards every field again) but bounded for safety. */
const PersistedSignalInput = z.object({
  key: z.string().min(1).max(120),
  tune: z.unknown().optional(),
  conds: z.record(z.string(), z.boolean()).optional(),
  match: z.enum(["all", "any"]).optional(),
});

const DiscoveryInput = z.object({
  cells: z.array(CellInput).min(1).max(50),
  limitPerCell: z.number().int().min(1).max(1000).optional(),
  /** Active goal signal registry keys — used to count "Match your signals"
   *  over the REAL businesses of in-DB cells (flagged PlaybookFindings). */
  signalKeys: z.array(z.string().min(1).max(120)).max(40).optional(),
  /** Active goal signals (SIG_META key + tune/conds/match) — persisted onto the
   *  Discovery so the workbench can evaluate each lead for a REAL match%. */
  signals: z.array(PersistedSignalInput).max(40).optional(),
});

export type DiscoveryActionInput = z.input<typeof DiscoveryInput>;

/** Per-cell preview row: REAL business count for in-DB cells, estimate else. */
export interface PreviewCell {
  cellKey: string;
  /** UI freshness chip state (never / fresh / aging / stale). */
  freshness: "never" | "fresh" | "aging" | "stale";
  /** Businesses in this cell — REAL Prisma count when isEstimate=false. */
  existingBizCount: number;
  /** False = real count from the DB; true = deterministic new-cell estimate. */
  isEstimate: boolean;
}

/** Aggregate KPI inputs for the Preview cards. `*Real` come from in-DB cells'
 *  real businesses; `*Estimate` add the new-cell deterministic contribution so
 *  the cards can show a "~" total only when estimates are mixed in. */
export interface PreviewKpis {
  /** REAL businesses summed across in-DB cells. */
  localBusinessesReal: number;
  /** Estimated businesses summed across never-discovered cells. */
  localBusinessesEstimate: number;
  /** REAL businesses with a reachable contact channel (in-DB cells). */
  haveContactsReal: number;
  /** REAL "active on Google" businesses (in-DB cells). */
  activeOnGoogleReal: number;
  /** REAL businesses with a flagged finding for an active signal (in-DB cells). */
  matchSignalsReal: number;
  /** True when any requested cell is a new-cell estimate (drives "~"). */
  hasEstimateCells: boolean;
}

export type PreflightDiscoveryResult =
  | {
      status: "ok";
      estimateId: string;
      netUsd: string;
      netCredits: number;
      freshCount: number;
      refetchCount: number;
      /** Per-cell preview rows (real where the cell is already in the DB). */
      cells: PreviewCell[];
      /** Aggregate KPI inputs (real from in-DB cells + estimate from new). */
      kpis: PreviewKpis;
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

/** Deterministic new-cell business estimate — mirrors flow-types.estBizCount so
 *  the server estimate matches the client's per-cell estimate for new cells. */
function estBizCount(index: number): number {
  return 120 + ((index * 137) % 341);
}

/** "Active on Google" recency window (~6 months), mirrors getDiscoverySummary. */
const ACTIVE_REVIEW_DAYS = 182;

/**
 * Build the per-cell preview rows + aggregate KPIs. For each requested cell:
 *   - already in the DB (has businesses) → REAL Prisma counts, isEstimate=false
 *   - never discovered (count 0)         → deterministic estimate, isEstimate=true
 *
 * Aggregate KPIs come from the REAL businesses of in-DB cells (+ a clearly-
 * flagged estimate contribution from new cells via localBusinessesEstimate).
 * "Match your signals" counts in-DB businesses with a flagged PlaybookFinding
 * for one of the active signal keys (reuses the same finding store the signals
 * view reads). All pure Prisma reads — no external API in the request path.
 */
async function buildPreview(
  cells: { cellKey: string; lastDiscoveredAt: Date | null; index: number }[],
  signalKeys: string[],
  now: Date,
): Promise<{ previewCells: PreviewCell[]; kpis: PreviewKpis }> {
  const previewCells = await Promise.all(
    cells.map(async (c) => {
      const base = rawListWhere({ cellKeys: [c.cellKey] });
      const real = await prisma.business.count({ where: base });
      const inDb = real > 0;
      return {
        cellKey: c.cellKey,
        freshness: cellFreshnessState(c.lastDiscoveredAt, now),
        existingBizCount: inDb ? real : estBizCount(c.index),
        isEstimate: !inDb,
        _base: base,
      };
    }),
  );

  // The in-DB cells we count real KPIs over.
  const inDbKeys = previewCells
    .filter((c) => !c.isEstimate)
    .map((c) => c.cellKey);

  let haveContactsReal = 0;
  let activeOnGoogleReal = 0;
  let matchSignalsReal = 0;
  let localBusinessesReal = 0;

  if (inDbKeys.length > 0) {
    const base = rawListWhere({ cellKeys: inDbKeys });
    const activeSince = new Date(Date.now() - ACTIVE_REVIEW_DAYS * 86_400_000);

    const businessIds = await prisma.business.findMany({
      where: base,
      select: { id: true },
    });
    const idSet = businessIds.map((b) => b.id);
    localBusinessesReal = idSet.length;

    const [contacts, active] = await prisma.$transaction([
      prisma.business.count({
        where: { ...base, reachableChannelCount: { gt: 0 } },
      }),
      prisma.business.count({
        where: {
          ...base,
          OR: [{ lastReviewAt: { gte: activeSince } }, { openStatus: "OPEN" }],
        },
      }),
    ]);
    haveContactsReal = contacts;
    activeOnGoogleReal = active;

    // "Match your signals" = distinct businesses (in these cells) with a flagged
    // finding for one of the active signal keys. Counted via the same store the
    // signals view reads (PlaybookFinding status="flagged").
    if (signalKeys.length > 0 && idSet.length > 0) {
      const flagged = await prisma.playbookFinding.findMany({
        where: {
          businessId: { in: idSet },
          status: "flagged",
          signalKey: { in: signalKeys },
        },
        select: { businessId: true },
        distinct: ["businessId"],
      });
      matchSignalsReal = flagged.length;
    }
  }

  const localBusinessesEstimate = previewCells
    .filter((c) => c.isEstimate)
    .reduce((s, c) => s + c.existingBizCount, 0);

  const kpis: PreviewKpis = {
    localBusinessesReal,
    localBusinessesEstimate,
    haveContactsReal,
    activeOnGoogleReal,
    matchSignalsReal,
    hasEstimateCells: previewCells.some((c) => c.isEstimate),
  };

  // Strip the internal `_base` field from the returned rows.
  const cleaned: PreviewCell[] = previewCells.map((c) => ({
    cellKey: c.cellKey,
    freshness: c.freshness,
    existingBizCount: c.existingBizCount,
    isEstimate: c.isEstimate,
  }));

  return { previewCells: cleaned, kpis };
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
        // The `signals` carry the goal's tune (typed `unknown` at the Zod
        // boundary), so the literal isn't statically an InputJsonValue; cast at
        // the seam like the other JSON scope payloads (cf. enrichmentsJson).
        scopeRefs: {
          kind: "discovery",
          cells: planInputs,
          lines: [],
          planNetUsd: plan.estimate.netUsd,
          planNetCredits: plan.estimate.netCredits,
          // Carry the active goal signals through the authorized estimate so the
          // run (which only gets the estimateId, anti-tamper) can persist them
          // onto Discovery.signalsJson for the workbench evaluator (P3). Extra
          // scopeRefs keys are ignored by the discovery re-quote (it reads only
          // `cells`), so this is safe alongside the anti-tamper path.
          signals: parsed.data.signals ?? [],
        } as unknown as Prisma.InputJsonValue,
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

    // ── REAL per-cell counts (for cells already in the DB) + KPI aggregation ──
    // A cell's businesses are shared market data keyed by cellKey (exactly what
    // the raw-list + signals views count); the agency scope is the Discovery row
    // (validated above). For a cell already in the DB we COUNT for real; for a
    // never-discovered cell we keep the deterministic estimate (isEstimate=true).
    const { previewCells, kpis } = await buildPreview(
      planInputs.map((p, i) => ({ ...p, index: i })),
      parsed.data.signalKeys ?? [],
      now,
    );

    return {
      status: "ok",
      estimateId: estimate.id,
      netUsd: plan.estimate.netUsd.toFixed(4),
      netCredits: plan.estimate.netCredits,
      freshCount: plan.freshCount,
      refetchCount: plan.refetchCount,
      cells: previewCells,
      kpis,
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
      signals?: unknown;
    };
    const cellKeys = (scope.cells ?? [])
      .map((c) => c.cellKey)
      .filter((k): k is string => typeof k === "string" && k.length > 0);
    if (cellKeys.length === 0) {
      return { status: "invalid_input", message: "estimate has no cells" };
    }

    // The active goal signals carried through the estimate → persisted onto the
    // Discovery so the workbench evaluates each lead against them (P3). Parsed
    // defensively; an empty/absent set stores null so the workbench falls back
    // to the pain-count heuristic.
    const parsedSignals = parseDiscoverySignals({ signals: scope.signals });
    const signalsJson: Prisma.InputJsonValue | undefined =
      parsedSignals && parsedSignals.signals.length > 0
        ? (parsedSignals as unknown as Prisma.InputJsonValue)
        : undefined;

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
        ...(signalsJson ? { signalsJson } : {}),
      },
      // On an idempotent re-submit, refresh the persisted signals (the user may
      // have re-tuned between attempts); leave everything else untouched.
      update: signalsJson ? { signalsJson } : {},
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

// NOTE: do NOT re-export types from this "use server" file — Next's server-action
// transform mishandles `export type { ... }` re-exports and emits a runtime value
// reference (ReferenceError at module eval). Import RunDiscoverySummary directly
// from "@/modules/discovery/run-discovery" instead.
