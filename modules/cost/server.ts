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

import {
  estimateRun,
  type EstimateLineInput,
  type EstimateResult,
} from "./estimate";
import { COST_GATE, PRICE_LIST_VERSION, type EnrichmentType } from "./pricing";

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

  // RE-RUN the estimator from the stored inputs. The scopeRefsJson carries the
  // estimator lines (see createCostEstimate caller convention) so the live
  // re-quote is reproducible without the client's number.
  const lines = extractLinesFromScopeRefs(row.scopeRefsJson);
  const result = estimateRun({ lines });

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

  // Read inside the transaction would be ideal, but the Neon adapter doesn't
  // support interactive locks here; we read-then-conditionally-write and rely
  // on the available-balance check. A concurrent over-hold is bounded by the
  // run-level idempotency (one EnrichmentRun → one hold).
  const wallet = await getOrCreateWallet(agencyId);
  if (credits > wallet.availableCredits) {
    throw new WalletError(
      "insufficient_credits",
      `hold of ${credits} exceeds available ${wallet.availableCredits}`,
    );
  }

  const [ledger, updated] = await prisma.$transaction([
    prisma.creditLedger.create({
      data: {
        agencyId,
        type: "HOLD",
        credits,
        usd,
        runId,
        note: "hold for run",
      },
      select: { id: true },
    }),
    prisma.agencyWallet.update({
      where: { agencyId },
      data: { heldCredits: { increment: credits } },
      select: {
        id: true,
        agencyId: true,
        planCredits: true,
        purchasedCredits: true,
        rolloverCredits: true,
        heldCredits: true,
      },
    }),
  ]);

  return { wallet: toWalletState(updated), ledgerId: ledger.id, held: credits };
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
  const alreadySettled = await ledgerSum(runId, "SETTLE");
  const alreadyRefunded = await ledgerSum(runId, "REFUND");
  const alreadyReleased = alreadySettled + alreadyRefunded;

  // Clamp the actual charge to what remains of the hold (never over-charge).
  const remaining = Math.max(0, held - alreadyReleased);
  const charge = Math.min(actualCredits, remaining);
  const refund = Math.max(0, remaining - charge);

  const agencyId = await runAgencyId(runId);

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
  // Release the hold + draw the charged credits down from purchasedCredits.
  ops.push(
    prisma.agencyWallet.update({
      where: { agencyId },
      data: {
        heldCredits: { decrement: charge + refund },
        purchasedCredits: { decrement: charge },
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
