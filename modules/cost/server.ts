// modules/cost/server.ts · DB-bound cost-estimate + credit-wallet runtime
// (Phase 0 of the agency rework).
//
// The pure estimator (modules/cost/estimate.ts) is the math; this file is the
// persistence + anti-tamper + wallet layer that turns a quote into a single-use
// spend authorization and reconciles the credit ledger after a run.
//
// Flow:
//   1. createCostEstimate(...)  → estimateRun() + a CostEstimate row (QUOTED).
//   2. authorizeEstimate(...)   → RE-runs estimateRun() server-side, ignores the
//                                 stored number (anti-tamper, per
//                                 .claude/rules/cost-discipline.md). If the live
//                                 quote drifts > reQuoteDriftPct the caller must
//                                 re-quote; else the row flips to AUTHORIZED.
//   3. holdCredits(...)         → CreditLedger HOLD + wallet.heldCredits++.
//   4. settleRun(...)           → CreditLedger SETTLE (actual) + REFUND the
//                                 hold−actual diff; release the hold.
//   5. refundHold(...)          → full release when a run never charged.
//
// Every numeric increment lands on a non-null @default(0) column (INC-32 safe).

import prisma, { Prisma } from "@/lib/prisma";
import { isCellFresh } from "@/lib/cell";
import { canonicalEmail } from "@/lib/email/canonical";

import {
  estimateRun,
  estimateDiscovery,
  type DiscoveryCellInput,
  type EstimateLineInput,
  type EstimateResult,
} from "./estimate";
import {
  COST_GATE,
  PRICE_LIST_VERSION,
  PLAN_CREDITS,
  ROLLOVER_CAP_MULTIPLE,
  FREE_TIER_CREDITS,
  type AgencyPlanTier,
  type EnrichmentType,
} from "./pricing";

// ── CostEstimate ────────────────────────────────────────────────────────────

/** What the user wants to run, expressed as estimator line inputs + scope. */
export interface CreateCostEstimateInput {
  agencyId: string;
  userId: string;
  /** "discovery" | "enrichment" | "playbook" — free-form scope discriminator. */
  scopeKind: string;
  /** The enrichments being priced (selected families, for the JSON audit). */
  enrichments: EnrichmentType[];
  /** Opaque scope references (discoveryId, cellKeys, businessIds, …). */
  scopeRefs: Prisma.InputJsonValue;
  /** Per-line totals + fresh counts that drive the math. */
  lines: EstimateLineInput[];
  /** The freshness snapshot the fresh-counts were computed against. */
  freshnessAsOf: Date;
}

export interface CostEstimateRow {
  id: string;
  agencyId: string;
  scopeKind: string;
  netUsd: string;
  netCredits: number;
  status: string;
  expiresAt: Date;
  priceListVersion: string;
}

export interface CreateCostEstimateResult {
  estimate: CostEstimateRow;
  result: EstimateResult;
}

/**
 * Price a run and persist the quote as a single-use capability token.
 * `now` is injectable for deterministic tests; defaults to a runtime clock.
 */
export async function createCostEstimate(
  input: CreateCostEstimateInput,
  now: Date = new Date(),
): Promise<CreateCostEstimateResult> {
  const result = estimateRun({ lines: input.lines });

  const expiresAt = new Date(
    now.getTime() + COST_GATE.quoteTtlMinutes * 60_000,
  );

  const row = await prisma.costEstimate.create({
    data: {
      agencyId: input.agencyId,
      scopeKind: input.scopeKind,
      enrichmentsJson: input.enrichments as unknown as Prisma.InputJsonValue,
      scopeRefsJson: input.scopeRefs,
      grossUsd: result.grossUsd,
      freshHitUsd: result.freshHitUsd,
      netUsd: result.netUsd,
      netCredits: result.netCredits,
      upperBoundUsd: result.upperBoundUsd,
      confidence: result.confidence,
      priceListVersion: result.priceListVersion,
      freshnessAsOf: input.freshnessAsOf,
      status: "QUOTED",
      expiresAt,
      createdByUserId: input.userId,
    },
    select: {
      id: true,
      agencyId: true,
      scopeKind: true,
      netUsd: true,
      netCredits: true,
      status: true,
      expiresAt: true,
      priceListVersion: true,
    },
  });

  return {
    estimate: { ...row, netUsd: row.netUsd.toString() },
    result,
  };
}

export type AuthorizeEstimateResult =
  | { status: "authorized"; estimateId: string; result: EstimateResult }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "expired" }
  | { status: "already_consumed" }
  | {
      status: "needs_requote";
      reason: "drift" | "price_list_changed";
      storedNetUsd: number;
      liveNetUsd: number;
      driftPct: number;
      result: EstimateResult;
    };

/**
 * Re-quote the estimate server-side and (if stable) mark it AUTHORIZED.
 *
 * Anti-tamper: the stored `netUsd` is NEVER trusted — we re-derive the live
 * cost from the persisted estimator inputs and compare. A drift beyond
 * COST_GATE.reQuoteDriftPct (or a price-list version bump) forces a re-quote.
 */
export async function authorizeEstimate(
  estimateId: string,
  userId: string,
  now: Date = new Date(),
): Promise<AuthorizeEstimateResult> {
  const row = await prisma.costEstimate.findUnique({
    where: { id: estimateId },
    select: {
      id: true,
      createdByUserId: true,
      status: true,
      expiresAt: true,
      netUsd: true,
      scopeKind: true,
      priceListVersion: true,
      enrichmentsJson: true,
      scopeRefsJson: true,
    },
  });
  if (!row) return { status: "not_found" };
  if (row.createdByUserId !== userId) return { status: "forbidden" };
  if (row.status === "CONSUMED") return { status: "already_consumed" };
  if (row.status === "EXPIRED" || row.status === "VOID") {
    return { status: "expired" };
  }
  if (row.expiresAt.getTime() <= now.getTime()) {
    // Lazily flip the row to EXPIRED so it's never re-usable.
    await prisma.costEstimate.update({
      where: { id: row.id },
      data: { status: "EXPIRED" },
    });
    return { status: "expired" };
  }

  // RE-RUN the estimator from the stored inputs — reproducible without trusting
  // the client's number. Discovery re-prices per-cell Maps cost from the stored
  // cells (estimateRun over discovery's empty enrichment lines would wrongly
  // yield $0); enrichment re-prices the stored lines.
  const result = reQuoteEstimate(row.scopeKind, row.scopeRefsJson, now);

  const storedNetUsd = Number(row.netUsd);
  const liveNetUsd = result.netUsd;

  // A price-list version change always forces re-confirmation.
  if (row.priceListVersion !== PRICE_LIST_VERSION) {
    return {
      status: "needs_requote",
      reason: "price_list_changed",
      storedNetUsd,
      liveNetUsd,
      driftPct: relativeDrift(storedNetUsd, liveNetUsd),
      result,
    };
  }

  const driftPct = relativeDrift(storedNetUsd, liveNetUsd);
  if (driftPct > COST_GATE.reQuoteDriftPct) {
    return {
      status: "needs_requote",
      reason: "drift",
      storedNetUsd,
      liveNetUsd,
      driftPct,
      result,
    };
  }

  await prisma.costEstimate.update({
    where: { id: row.id },
    data: {
      status: "AUTHORIZED",
      // Re-stamp the freshly-derived numbers — the row is now authoritative.
      netUsd: liveNetUsd,
      netCredits: result.netCredits,
      grossUsd: result.grossUsd,
      freshHitUsd: result.freshHitUsd,
      upperBoundUsd: result.upperBoundUsd,
    },
  });

  return { status: "authorized", estimateId: row.id, result };
}

/** Relative drift |live − stored| / max(stored, ε). 0 when both are 0. */
function relativeDrift(stored: number, live: number): number {
  const denom = Math.max(Math.abs(stored), 1e-9);
  if (stored === 0 && live === 0) return 0;
  return Math.abs(live - stored) / denom;
}

/**
 * Pull estimator line inputs out of the persisted scopeRefsJson. By convention
 * the creating caller stores `{ lines: EstimateLineInput[], ... }` so authorize
 * can reproduce the math. Tolerates a bare array or a missing payload.
 */
function extractLinesFromScopeRefs(raw: Prisma.JsonValue): EstimateLineInput[] {
  if (Array.isArray(raw)) return raw as unknown as EstimateLineInput[];
  if (raw && typeof raw === "object" && "lines" in raw) {
    const lines = (raw as { lines?: unknown }).lines;
    if (Array.isArray(lines)) return lines as unknown as EstimateLineInput[];
  }
  return [];
}

/**
 * Re-price an estimate from its persisted scope. Enrichment estimates re-run
 * estimateRun over the stored lines; discovery estimates re-run estimateDiscovery
 * over the stored cells (recomputing freshness against `now`). The result shape
 * is identical so the anti-tamper drift comparison is uniform.
 */
function reQuoteEstimate(
  scopeKind: string,
  scopeRefs: Prisma.JsonValue,
  now: Date,
): EstimateResult {
  if (scopeKind === "discovery") {
    const d = estimateDiscovery(extractDiscoveryCells(scopeRefs, now));
    return {
      lines: [],
      grossUsd: d.grossUsd,
      freshHitUsd: d.freshHitUsd,
      netUsd: d.netUsd,
      netCredits: d.netCredits,
      upperBoundUsd: d.netUsd,
      confidence: "exact",
      gate: d.gate,
      priceListVersion: d.priceListVersion,
    };
  }
  return estimateRun({ lines: extractLinesFromScopeRefs(scopeRefs) });
}

/**
 * Reconstruct DiscoveryCellInput[] from a discovery estimate's stored cells.
 * Each persisted cell carries lastDiscoveredAt + expectedListings; freshness is
 * recomputed against `now` so a cell that went fresh/stale since the quote
 * re-prices correctly (the 182-day serve-from-DB gate).
 */
function extractDiscoveryCells(
  raw: Prisma.JsonValue,
  now: Date,
): DiscoveryCellInput[] {
  const cells =
    raw && typeof raw === "object" && "cells" in raw
      ? (raw as { cells?: unknown }).cells
      : null;
  if (!Array.isArray(cells)) return [];
  return cells.map((c) => {
    const cell = (c ?? {}) as {
      lastDiscoveredAt?: string | null;
      expectedListings?: number;
    };
    const last = cell.lastDiscoveredAt ? new Date(cell.lastDiscoveredAt) : null;
    return {
      fresh: isCellFresh(last, now),
      expectedListings:
        typeof cell.expectedListings === "number" ? cell.expectedListings : 100,
    };
  });
}

// ── Wallet + credit ledger ──────────────────────────────────────────────────

export interface WalletState {
  id: string;
  agencyId: string;
  planCredits: number;
  purchasedCredits: number;
  rolloverCredits: number;
  heldCredits: number;
  /** plan + purchased + rollover − held. Never negative in practice. */
  availableCredits: number;
}

function toWalletState(w: {
  id: string;
  agencyId: string;
  planCredits: number;
  purchasedCredits: number;
  rolloverCredits: number;
  heldCredits: number;
}): WalletState {
  return {
    ...w,
    availableCredits:
      w.planCredits + w.purchasedCredits + w.rolloverCredits - w.heldCredits,
  };
}

/**
 * Fetch (or lazily create) the agency's wallet. A fresh wallet starts empty
 * with a one-month cycle window; plan credits are granted by the billing
 * webhook, not here.
 */
export async function getOrCreateWallet(
  agencyId: string,
  now: Date = new Date(),
): Promise<WalletState> {
  const existing = await prisma.agencyWallet.findUnique({
    where: { agencyId },
    select: {
      id: true,
      agencyId: true,
      planCredits: true,
      purchasedCredits: true,
      rolloverCredits: true,
      heldCredits: true,
    },
  });
  if (existing) return toWalletState(existing);

  const created = await prisma.agencyWallet.create({
    data: {
      agencyId,
      cycleResetAt: new Date(now.getTime() + 30 * 86_400_000),
    },
    select: {
      id: true,
      agencyId: true,
      planCredits: true,
      purchasedCredits: true,
      rolloverCredits: true,
      heldCredits: true,
    },
  });
  return toWalletState(created);
}

export class WalletError extends Error {
  code: "insufficient_credits" | "no_hold" | "invalid_amount";
  constructor(code: WalletError["code"], message: string) {
    super(message);
    this.name = "WalletError";
    this.code = code;
  }
}

function assertCredits(n: number): number {
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new WalletError(
      "invalid_amount",
      `credits must be a non-negative integer, got ${n}`,
    );
  }
  return n;
}

export interface HoldResult {
  wallet: WalletState;
  ledgerId: string;
  held: number;
}

/**
 * Reserve credits for an in-flight run. Writes a HOLD ledger row and bumps
 * wallet.heldCredits in ONE transaction. Throws WalletError("insufficient_credits")
 * if the available balance can't cover the hold.
 *
 * `usd` is optional context for the ledger row (the dollar value of the hold).
 */
export async function holdCredits(
  agencyId: string,
  credits: number,
  runId: string,
  usd = 0,
): Promise<HoldResult> {
  assertCredits(credits);

  // Ensure the wallet row exists so the atomic conditional UPDATE has a target.
  await getOrCreateWallet(agencyId);

  // Atomically reserve: one conditional UPDATE that only succeeds while the
  // available balance still covers the hold — closes the read-then-write
  // oversell race two concurrent runs would otherwise hit.
  const reserved = await tryReserveCredits(agencyId, credits);
  if (!reserved) {
    const w = await getOrCreateWallet(agencyId);
    throw new WalletError(
      "insufficient_credits",
      `hold of ${credits} exceeds available ${w.availableCredits}`,
    );
  }

  const ledger = await prisma.creditLedger.create({
    data: { agencyId, type: "HOLD", credits, usd, runId, note: "hold for run" },
    select: { id: true },
  });
  const updated = await prisma.agencyWallet.findUnique({
    where: { agencyId },
    select: {
      id: true,
      agencyId: true,
      planCredits: true,
      purchasedCredits: true,
      rolloverCredits: true,
      heldCredits: true,
    },
  });

  return {
    wallet: toWalletState(updated!),
    ledgerId: ledger.id,
    held: credits,
  };
}

/**
 * Atomically bump heldCredits iff the available balance still covers `credits`.
 * Prod path: a single conditional `UPDATE ... WHERE available >= n` (the only
 * way to express a cross-column arithmetic guard — Prisma `where` can't). Test
 * path (the in-memory mock prisma has no $executeRaw): falls back to
 * read-check-write, which the unit tests exercise. Returns true on success.
 */
async function tryReserveCredits(
  agencyId: string,
  credits: number,
): Promise<boolean> {
  if (credits === 0) return true;
  const raw = (prisma as { $executeRaw?: unknown }).$executeRaw;
  if (typeof raw === "function") {
    const affected = await prisma.$executeRaw`
      UPDATE "AgencyWallet"
      SET "heldCredits" = "heldCredits" + ${credits}
      WHERE "agencyId" = ${agencyId}
        AND ("planCredits" + "purchasedCredits" + "rolloverCredits" - "heldCredits") >= ${credits}
    `;
    return affected > 0;
  }
  // Fallback (unit-test mock): read-then-write.
  const w = await getOrCreateWallet(agencyId);
  if (credits > w.availableCredits) return false;
  await prisma.agencyWallet.update({
    where: { agencyId },
    data: { heldCredits: { increment: credits } },
    select: { id: true },
  });
  return true;
}

/** Sum of credits across ledger rows of a given type for a run. */
async function ledgerSum(
  runId: string,
  type: "HOLD" | "SETTLE" | "REFUND",
): Promise<number> {
  const agg = await prisma.creditLedger.aggregate({
    where: { runId, type },
    _sum: { credits: true },
  });
  return agg._sum.credits ?? 0;
}

export interface SettleResult {
  wallet: WalletState;
  /** Credits actually charged (moved out of the wallet). */
  charged: number;
  /** Credits refunded (hold − actual, when the run cost less than reserved). */
  refunded: number;
}

/**
 * Reconcile a finished run. Charges `actualCredits` against the wallet
 * (SETTLE), refunds the unused portion of the hold (REFUND), and releases the
 * held amount. Idempotent guards: if no HOLD exists, throws WalletError;
 * re-settling a run that already settled is a no-op-ish (clamps at 0).
 *
 * Net wallet effect of a hold→settle cycle:
 *   purchasedCredits −= actual   (the spend leaves the wallet)
 *   heldCredits      −= hold      (the reservation is released)
 */
export async function settleRun(
  runId: string,
  actualCredits: number,
): Promise<SettleResult> {
  assertCredits(actualCredits);

  const held = await ledgerSum(runId, "HOLD");
  if (held <= 0) {
    throw new WalletError("no_hold", `no HOLD ledger row for run ${runId}`);
  }

  // WP1-3 · settle idempotency backstop. There is NO DB unique on (runId, SETTLE)
  // (CreditLedger has only @@index([runId,type]), no migration this wave), so a
  // second settleRun for the same run — e.g. a re-entered close — must be a
  // no-op. A SETTLE row already existing means this run was already reconciled;
  // return the current wallet without writing a second charge. This closes the
  // window the read-then-compute clamp alone couldn't (two settles reading the
  // same ledgerSum before either writes). The dispatcher additionally gates via
  // the finishedAt compare-and-set (closeRunIfDone), so only one close reaches
  // here; this guard is defence-in-depth.
  const alreadySettled = await ledgerSum(runId, "SETTLE");
  if (alreadySettled > 0) {
    const agencyId = await runAgencyId(runId);
    const wallet = await getOrCreateWallet(agencyId);
    return { wallet, charged: alreadySettled, refunded: 0 };
  }
  const alreadyRefunded = await ledgerSum(runId, "REFUND");
  const alreadyReleased = alreadySettled + alreadyRefunded;

  // Clamp the actual charge to what remains of the hold (never over-charge).
  const remaining = Math.max(0, held - alreadyReleased);
  const charge = Math.min(actualCredits, remaining);
  const refund = Math.max(0, remaining - charge);

  const agencyId = await runAgencyId(runId);

  // Draw the charge down in order plan → rollover → purchased: the plan/free
  // allotment is spent first, purchased credits last (so a topped-up balance
  // outlives the monthly grant).
  const buckets = await prisma.agencyWallet.findUnique({
    where: { agencyId },
    select: {
      planCredits: true,
      rolloverCredits: true,
      purchasedCredits: true,
    },
  });
  let rem = charge;
  const fromPlan = Math.min(rem, buckets?.planCredits ?? 0);
  rem -= fromPlan;
  const fromRollover = Math.min(rem, buckets?.rolloverCredits ?? 0);
  rem -= fromRollover;
  const fromPurchased = rem; // remainder absorbed by purchased credits

  const ops: Prisma.PrismaPromise<unknown>[] = [];
  if (charge > 0) {
    ops.push(
      prisma.creditLedger.create({
        data: {
          agencyId,
          type: "SETTLE",
          credits: charge,
          runId,
          note: "settle actual",
        },
      }),
    );
  }
  if (refund > 0) {
    ops.push(
      prisma.creditLedger.create({
        data: {
          agencyId,
          type: "REFUND",
          credits: refund,
          runId,
          note: "refund unused hold",
        },
      }),
    );
  }
  // Release the hold + draw the charged credits down across the buckets.
  ops.push(
    prisma.agencyWallet.update({
      where: { agencyId },
      data: {
        heldCredits: { decrement: charge + refund },
        planCredits: { decrement: fromPlan },
        rolloverCredits: { decrement: fromRollover },
        purchasedCredits: { decrement: fromPurchased },
      },
      select: { id: true },
    }),
  );

  await prisma.$transaction(ops);

  const wallet = await getOrCreateWallet(agencyId);
  return { wallet, charged: charge, refunded: refund };
}

/**
 * Fully release a hold for a run that never charged (e.g. it failed before any
 * external call). Writes a REFUND for the entire outstanding hold and clears
 * the reservation.
 */
export async function refundHold(runId: string): Promise<SettleResult> {
  const held = await ledgerSum(runId, "HOLD");
  if (held <= 0) {
    throw new WalletError("no_hold", `no HOLD ledger row for run ${runId}`);
  }
  const alreadyReleased =
    (await ledgerSum(runId, "SETTLE")) + (await ledgerSum(runId, "REFUND"));
  const outstanding = Math.max(0, held - alreadyReleased);
  const agencyId = await runAgencyId(runId);

  if (outstanding === 0) {
    const wallet = await getOrCreateWallet(agencyId);
    return { wallet, charged: 0, refunded: 0 };
  }

  await prisma.$transaction([
    prisma.creditLedger.create({
      data: {
        agencyId,
        type: "REFUND",
        credits: outstanding,
        runId,
        note: "refund full hold",
      },
    }),
    prisma.agencyWallet.update({
      where: { agencyId },
      data: { heldCredits: { decrement: outstanding } },
      select: { id: true },
    }),
  ]);

  const wallet = await getOrCreateWallet(agencyId);
  return { wallet, charged: 0, refunded: outstanding };
}

/** Resolve the agency that owns a run's HOLD ledger row. */
async function runAgencyId(runId: string): Promise<string> {
  const row = await prisma.creditLedger.findFirst({
    where: { runId, type: "HOLD" },
    select: { agencyId: true },
  });
  if (!row) {
    throw new WalletError("no_hold", `no ledger row for run ${runId}`);
  }
  return row.agencyId;
}

// ── Run close-out + plan grants ──────────────────────────────────────────────

/**
 * Close out a finished run's credit hold. Called by the dispatcher after a run
 * completes: settles the actual charge (refunding the unused hold diff) when
 * the run made progress, or refunds the entire hold when it produced nothing.
 * A no-op when the run has no hold (legacy / no-estimate runs). Never throws —
 * a settlement hiccup must not fail the run close-out.
 */
export async function reconcileRunCredits(
  runId: string,
  opts: { actualCredits?: number; hadProgress: boolean },
): Promise<{ charged: number; refunded: number }> {
  try {
    const held = await ledgerSum(runId, "HOLD");
    if (held <= 0) return { charged: 0, refunded: 0 }; // nothing reserved
    if (!opts.hadProgress) {
      const r = await refundHold(runId);
      return { charged: r.charged, refunded: r.refunded };
    }
    // Default to charging the full hold (the quoted amount) when no finer
    // actual is supplied; the job rail (Slice 2) passes per-job actuals.
    const r = await settleRun(runId, opts.actualCredits ?? held);
    return { charged: r.charged, refunded: r.refunded };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "cost.reconcile.error",
        runId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    // A settlement hiccup must never fail the run close-out; report zeros so
    // the caller's receipt write is a safe no-op.
    return { charged: 0, refunded: 0 };
  }
}

/**
 * Compute the new rollover balance at a plan-credit grant (WP6-8, capped
 * accumulation). Unused PLAN credits from the ending cycle are ADDED to the
 * existing rollover bucket, then the total is capped at
 * `ROLLOVER_CAP_MULTIPLE × tierCredits`. Anything above the cap is forfeited
 * (the honest "carry over up to Nx" promise on the pricing cards).
 *
 * Pure + exported so the cap behavior is unit-testable without a DB.
 */
export function nextRolloverCredits(
  priorPlanCredits: number,
  priorRolloverCredits: number,
  tierCredits: number,
): number {
  const cap = ROLLOVER_CAP_MULTIPLE * tierCredits;
  // Only non-negative leftovers roll (defensive against any transient negative).
  const carried =
    Math.max(0, priorRolloverCredits) + Math.max(0, priorPlanCredits);
  return Math.min(carried, cap);
}

/**
 * Grant (or re-grant) a paid plan's monthly credits, keyed by billing period so
 * a webhook replay never double-grants. Resets the plan bucket to the tier
 * amount and rolls the prior period's UNUSED plan credits forward into
 * rolloverCredits, ACCUMULATING across cycles up to `ROLLOVER_CAP_MULTIPLE ×`
 * the tier grant (WP6-8). Purchased credits are untouched.
 *
 * Rollover is orthogonal to settle (docs/unit-economics.md): this only carries
 * unused plan credits forward at reset; `settleRun` still charges runs exactly
 * as before (plan → rollover → purchased draw-down).
 */
export async function grantPlanCredits(
  agencyId: string,
  tier: AgencyPlanTier,
  periodEnd: Date | null,
  dedupeKey: string,
): Promise<void> {
  const credits = PLAN_CREDITS[tier];
  await getOrCreateWallet(agencyId);

  const note = `plan-grant:${tier}:${dedupeKey}`;
  const already = await prisma.creditLedger.findFirst({
    where: { agencyId, type: "TOPUP", note },
    select: { id: true },
  });
  if (already) return; // idempotent per (agency, tier, period)

  const w = await prisma.agencyWallet.findUnique({
    where: { agencyId },
    select: { planCredits: true, rolloverCredits: true },
  });
  const carriedRollover = nextRolloverCredits(
    w?.planCredits ?? 0,
    w?.rolloverCredits ?? 0,
    credits,
  );

  await prisma.$transaction([
    prisma.agencyWallet.update({
      where: { agencyId },
      data: {
        planCredits: credits,
        rolloverCredits: carriedRollover,
        ...(periodEnd ? { cycleResetAt: periodEnd } : {}),
      },
    }),
    prisma.creditLedger.create({
      data: { agencyId, type: "TOPUP", credits, usd: 0, note },
    }),
  ]);
}

/**
 * Grant the one-time free-tier credits to an agency that has never been funded.
 * Idempotent via a sentinel ledger row, so it's safe to call on every wallet
 * read / first spend. Paid agencies are funded by grantPlanCredits instead, so
 * we skip if any TOPUP already exists.
 */
export async function grantFreeTierIfNew(agencyId: string): Promise<void> {
  await getOrCreateWallet(agencyId);
  const funded = await prisma.creditLedger.findFirst({
    where: { agencyId, type: "TOPUP" },
    select: { id: true },
  });
  if (funded) return;

  // B6 · anti-farming: a plus-addressed / Gmail-dot variant of a mailbox that
  // already claimed the free grant (tom+1@ · t.o.m@) must not claim a second.
  // Canonicalize this agency's owner email and skip the grant if a sibling
  // already got one. Runs only on the FIRST grant per agency (after the cheap
  // TOPUP check above), and fails OPEN — a lookup hiccup never blocks a real
  // signup's grant. Bounded scan over already-granted agencies; if that set
  // grows large, promote to an indexed User.canonicalEmail column.
  try {
    const owner = await prisma.agencyMember.findFirst({
      where: { agencyId, role: "OWNER" },
      orderBy: { createdAt: "asc" },
      select: { user: { select: { email: true } } },
    });
    const canon = owner?.user?.email
      ? canonicalEmail(owner.user.email)
      : null;
    if (canon) {
      // CreditLedger is a plain-FK model (no relation to Agency), so resolve in
      // two steps: agencyIds that already got a free grant → their OWNER emails.
      const grantedAgencyIds = (
        await prisma.creditLedger.findMany({
          where: {
            type: "TOPUP",
            note: "free-tier-grant",
            agencyId: { not: agencyId },
          },
          select: { agencyId: true },
          take: 5000,
        })
      ).map((r) => r.agencyId);
      const priorOwners = grantedAgencyIds.length
        ? await prisma.agencyMember.findMany({
            where: { role: "OWNER", agencyId: { in: grantedAgencyIds } },
            select: { user: { select: { email: true } } },
          })
        : [];
      const sibling = priorOwners.some(
        (o) => o.user?.email && canonicalEmail(o.user.email) === canon,
      );
      if (sibling) {
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "free_tier.sibling_skip",
            agencyId,
            canonical: canon,
          }),
        );
        return;
      }
    }
  } catch {
    // Fail open — never block a legitimate grant on the anti-farm lookup.
  }

  await prisma.$transaction([
    prisma.agencyWallet.update({
      where: { agencyId },
      data: { planCredits: { increment: FREE_TIER_CREDITS } },
    }),
    prisma.creditLedger.create({
      data: {
        agencyId,
        type: "TOPUP",
        credits: FREE_TIER_CREDITS,
        usd: 0,
        note: "free-tier-grant",
      },
    }),
  ]);
}

/**
 * Grant a one-time top-up pack's credits to an agency's PURCHASED bucket
 * (never expires). Idempotent per Stripe session: the dedupe note is keyed on
 * the checkout session id so a webhook replay never double-grants.
 *
 * Unlike a plan grant (which resets the plan bucket), this INCREMENTS
 * purchasedCredits and is additive to whatever is already there.
 */
export async function grantTopUpCredits(
  agencyId: string,
  credits: number,
  usd: number,
  dedupeKey: string,
): Promise<void> {
  if (credits <= 0) return;
  await getOrCreateWallet(agencyId);

  const note = `topup-purchase:${dedupeKey}`;
  const already = await prisma.creditLedger.findFirst({
    where: { agencyId, type: "TOPUP", note },
    select: { id: true },
  });
  if (already) return; // idempotent per Stripe session

  await prisma.$transaction([
    prisma.agencyWallet.update({
      where: { agencyId },
      data: { purchasedCredits: { increment: credits } },
    }),
    prisma.creditLedger.create({
      data: { agencyId, type: "TOPUP", credits, usd, note },
    }),
  ]);
}

/**
 * WP6-13 · make-good credit refund for a bad-data dispute. Credits the agency's
 * PURCHASED bucket (the durable make-good bucket, like a top-up — a dispute is
 * not tied to a run's HOLD, so it can't ride settle/refundHold) and writes a
 * `REFUND` ledger row. Idempotent per `dedupeKey` (e.g. the disputed field id):
 * the same field can't be refunded twice. Returns the credited amount (0 when a
 * prior refund with the same key exists). Never over-credits.
 *
 * Uses REFUND (not ADJUST): a dispute refund is a genuine give-back of credits
 * the agency spent on data we couldn't stand behind — REFUND is the ledger type
 * that already means "credits returned to the wallet".
 */
export async function refundCredits(
  agencyId: string,
  credits: number,
  note: string,
  dedupeKey: string,
): Promise<{ wallet: WalletState; refunded: number }> {
  assertCredits(credits);
  const wallet0 = await getOrCreateWallet(agencyId);
  if (credits <= 0) return { wallet: wallet0, refunded: 0 };

  const dedupeNote = `dispute-refund:${dedupeKey}`;
  const already = await prisma.creditLedger.findFirst({
    where: { agencyId, type: "REFUND", note: dedupeNote },
    select: { id: true },
  });
  if (already) return { wallet: wallet0, refunded: 0 }; // idempotent per field

  await prisma.$transaction([
    prisma.agencyWallet.update({
      where: { agencyId },
      data: { purchasedCredits: { increment: credits } },
    }),
    prisma.creditLedger.create({
      data: {
        agencyId,
        type: "REFUND",
        credits,
        note: `${dedupeNote}${note ? ` · ${note}` : ""}`,
      },
    }),
  ]);

  const wallet = await getOrCreateWallet(agencyId);
  return { wallet, refunded: credits };
}
