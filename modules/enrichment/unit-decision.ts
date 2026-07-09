// modules/enrichment/unit-decision.ts · the four-quadrant billing decision
// (entitlement model · Phase 2 · pure, testable core).
//
// Two independent axes (the whole point of the model):
//   owned = does THIS agency hold an entitlement for (unit × family)?  (revenue)
//   fresh = is OUR DB copy within the family's freshness window?        (COGS)
//
//                     │ DB fresh (no vendor)        │ DB stale (run vendor)
//   ──────────────────┼─────────────────────────────┼──────────────────────────
//   owned (bought)    │ SKIPPED_ENTITLED · $0 no-op  │ QUEUED · charge (refresh)
//   NOT owned         │ CHARGED_FROM_DB · charge     │ QUEUED · charge (new buy)
//
// The ONLY free quadrant is owned∧fresh. An owner refreshing STALE data pays
// (D1: "a refresh charges only when the shared data is stale") — same as a new
// buy for billing, differing only in that the grant already exists (upsert).
// A non-owner served a FRESH copy pays full at zero vendor COGS — the
// high-margin path (CHARGED_FROM_DB). D3: CHARGED_FROM_DB is UI-invisible — it
// counts as terminal-success for run-progress like a real run.

export type UnitStatus = "SKIPPED_ENTITLED" | "CHARGED_FROM_DB" | "QUEUED";

export interface UnitDecision {
  status: UnitStatus;
  /** Does this unit charge the agency? */
  billable: boolean;
  /** Enqueue the vendor worker? (false → served from DB or already owned.) */
  run: boolean;
  /** Grant/refresh the entitlement at settle on terminal success? */
  mint: boolean;
}

/**
 * Decide a single (unit × family) outcome from the two axes. Pure.
 *
 * `run = !fresh` (freshness alone gates the vendor). `billable = !(owned &&
 * fresh)` (only the owned-fresh no-op is free). `mint` on every charged outcome
 * so the agency ends up owning what it paid for (upsert = idempotent for an
 * owner refreshing stale data).
 */
export function decideUnit(owned: boolean, fresh: boolean): UnitDecision {
  if (owned && fresh) {
    return {
      status: "SKIPPED_ENTITLED",
      billable: false,
      run: false,
      mint: false,
    };
  }
  if (!owned && fresh) {
    return {
      status: "CHARGED_FROM_DB",
      billable: true,
      run: false,
      mint: true,
    };
  }
  // stale (owned or not) → run the vendor, charge, mint on success.
  return { status: "QUEUED", billable: true, run: true, mint: true };
}

/** The status values that count as terminal-SUCCESS (done) for coverage /
 *  run-progress under the entitlement model — mirrors DONE/SKIPPED_FRESH. */
export const ENTITLEMENT_SUCCESS_STATUSES = [
  "CHARGED_FROM_DB",
  "SKIPPED_ENTITLED",
] as const;
