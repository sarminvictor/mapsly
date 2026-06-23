// modules/cost/estimate.ts · pure pre-flight cost estimator.
//
// Phase 0. Given what the user wants to run (which enrichments, over how many
// businesses/cells, and how many of those are already fresh), return the
// expected net USD, the upper bound, the credit cost, and the cost gate.
//
// Pure + deterministic → unit-testable with golden values; no DB, no clock.
// The caller supplies `fresh` counts (computed from freshness windows in DB);
// fresh units are deduped to $0 — this is how "serve from DB = free" surfaces
// in the quote ("120 already fresh — not charged").
//
// The result becomes a CostEstimate row (the single-use spend authorization).
// The server RE-runs estimateRun at authorize time and ignores the client's
// number (anti-tamper, per .claude/rules/cost-discipline.md).

import {
  ENRICHMENT_PRICES,
  DISCOVERY_PRICE,
  CREDIT_USD,
  COST_GATE,
  PRICE_LIST_VERSION,
  type EnrichmentType,
  type ScopeUnit,
} from "./pricing";

export type CostGate = "auto" | "confirm" | "approval";
export type EstimateConfidence = "exact" | "bounded";

export interface EstimateLineInput {
  enrichment: EnrichmentType;
  /** Total units in scope (businesses for per-business, cells for per-cell). */
  total: number;
  /** Units already fresh in the DB (charged $0). Clamped to [0, total]. */
  fresh?: number;
}

export interface EstimateLine {
  enrichment: EnrichmentType;
  label: string;
  unit: ScopeUnit;
  usdPerUnit: number;
  total: number;
  fresh: number;
  billable: number;
  grossUsd: number;
  freshHitUsd: number;
  netUsd: number;
  upperBoundUsd: number;
}

export interface EstimateResult {
  lines: EstimateLine[];
  grossUsd: number;
  /** What the fresh-cache saved (gross − net). Surfaced as a delight. */
  freshHitUsd: number;
  netUsd: number;
  netCredits: number;
  upperBoundUsd: number;
  confidence: EstimateConfidence;
  gate: CostGate;
  priceListVersion: string;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 1e2) / 1e2;

function assertCount(name: string, n: number): number {
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
    throw new Error(
      `[cost/estimate] ${name} must be a non-negative integer, got ${n}`,
    );
  }
  return n;
}

/** Which gate a net-USD figure falls into. */
export function gateFor(netUsd: number): CostGate {
  if (netUsd > COST_GATE.approvalMinUsd) return "approval";
  if (netUsd >= COST_GATE.autoMaxUsd) return "confirm";
  return "auto";
}

/** Convert USD to whole credits (round up — never under-charge). */
export function usdToCredits(usd: number): number {
  if (usd <= 0) return 0;
  return Math.ceil(round4(usd) / CREDIT_USD);
}

/**
 * Estimate the cost of an enrichment run.
 *
 * @throws if any total/fresh is not a non-negative integer or an enrichment
 *         key is unknown.
 */
export function estimateRun(input: {
  lines: EstimateLineInput[];
}): EstimateResult {
  const lines: EstimateLine[] = input.lines.map((raw) => {
    const price = ENRICHMENT_PRICES[raw.enrichment];
    if (!price) {
      throw new Error(`[cost/estimate] unknown enrichment "${raw.enrichment}"`);
    }
    const total = assertCount(`${raw.enrichment}.total`, raw.total);
    const freshRaw = assertCount(`${raw.enrichment}.fresh`, raw.fresh ?? 0);
    const fresh = Math.min(freshRaw, total);
    const billable = total - fresh;

    const grossUsd = round4(total * price.usdPerUnit);
    const freshHitUsd = round4(fresh * price.usdPerUnit);
    const netUsd = round4(billable * price.usdPerUnit);
    const upperBoundUsd = round4(
      billable * price.usdPerUnit * price.upperMultiplier,
    );

    return {
      enrichment: raw.enrichment,
      label: price.label,
      unit: price.unit,
      usdPerUnit: price.usdPerUnit,
      total,
      fresh,
      billable,
      grossUsd,
      freshHitUsd,
      netUsd,
      upperBoundUsd,
    };
  });

  const grossUsd = round4(lines.reduce((s, l) => s + l.grossUsd, 0));
  const freshHitUsd = round4(lines.reduce((s, l) => s + l.freshHitUsd, 0));
  const netUsd = round4(lines.reduce((s, l) => s + l.netUsd, 0));
  const upperBoundUsd = round4(lines.reduce((s, l) => s + l.upperBoundUsd, 0));

  // Bounded if any BILLABLE line has variable cost (upperMultiplier > 1).
  const confidence: EstimateConfidence = lines.some(
    (l) =>
      l.billable > 0 && ENRICHMENT_PRICES[l.enrichment].upperMultiplier > 1,
  )
    ? "bounded"
    : "exact";

  return {
    lines,
    grossUsd,
    freshHitUsd,
    netUsd,
    netCredits: usdToCredits(netUsd),
    upperBoundUsd,
    confidence,
    gate: gateFor(netUsd),
    priceListVersion: PRICE_LIST_VERSION,
  };
}

export interface DiscoveryCellInput {
  /** Already discovered within the 6-month window → served from DB ($0). */
  fresh: boolean;
  /** DfS total_count (or our last-known) — drives the per-listing fee. */
  expectedListings: number;
}

export interface DiscoveryEstimate {
  freshCells: number;
  fetchCells: number;
  grossUsd: number;
  freshHitUsd: number;
  netUsd: number;
  netCredits: number;
  gate: CostGate;
  priceListVersion: string;
}

/** Per-cell Google Maps discovery cost. Fresh cells serve from DB for $0. */
export function estimateDiscovery(
  cells: DiscoveryCellInput[],
): DiscoveryEstimate {
  let grossUsd = 0;
  let freshHitUsd = 0;
  let netUsd = 0;
  let freshCells = 0;
  let fetchCells = 0;

  for (const cell of cells) {
    const listings = assertCount("expectedListings", cell.expectedListings);
    const cellUsd =
      DISCOVERY_PRICE.baseUsd + listings * DISCOVERY_PRICE.perListingUsd;
    grossUsd += cellUsd;
    if (cell.fresh) {
      freshHitUsd += cellUsd;
      freshCells += 1;
    } else {
      netUsd += cellUsd;
      fetchCells += 1;
    }
  }

  grossUsd = round4(grossUsd);
  freshHitUsd = round4(freshHitUsd);
  netUsd = round4(netUsd);

  return {
    freshCells,
    fetchCells,
    grossUsd,
    freshHitUsd,
    netUsd,
    netCredits: usdToCredits(netUsd),
    gate: gateFor(netUsd),
    priceListVersion: PRICE_LIST_VERSION,
  };
}

/** Human-readable one-liner for the UI quote bar. */
export function quoteSummary(r: EstimateResult, walletUsd?: number): string {
  const parts = [`This will cost $${round2(r.netUsd).toFixed(2)}`];
  if (r.freshHitUsd > 0) {
    parts.push(`${round2(r.freshHitUsd).toFixed(2)} saved from fresh cache`);
  }
  if (walletUsd != null) {
    parts.push(
      `wallet $${round2(walletUsd).toFixed(2)} → $${round2(walletUsd - r.netUsd).toFixed(2)}`,
    );
  }
  return parts.join(" · ");
}
