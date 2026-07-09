// modules/agency-portal/team/seats.ts · seat caps for the flat-plan seat
// model (WP5-8, per docs/seat-model.md).
//
// Caps, not metering: the gate is a simple count-vs-cap check at invite AND
// accept time. `Agency.maxSeats` (WP0-6) overrides; otherwise the cap derives
// from the plan. docs/seat-model.md's ladder (Free 1 / Starter 2 / Growth 5 /
// Scale 15) maps onto the live AgencyPlan enum via the same bridge the billing
// cards use (modules/cost/pricing.ts PLAN_TIER_MAP: starter→SOLO,
// growth→GROWTH, scale→BOUTIQUE; AGENCY_PRO is the legacy internal tier —
// WP0-6's "Pro 10"). An agency without an active subscription is the Free
// state → 1 seat, regardless of the default SOLO enum value.

import prisma from "@/lib/prisma";

/** Seat cap per PAID plan tier. Repriced 2026-07-09
 *  (docs/billing-repricing-2026-07-09.html · decision F-5). */
export const PLAN_SEAT_CAPS: Record<string, number> = {
  SOLO: 1, // display "Starter" ($19)
  AGENCY_PRO: 1, // display "Solo" ($49)
  GROWTH: 3, // display "Growth" ($99)
  BOUTIQUE: 10, // display "Pro" ($299)
};

/** The Free-state cap (no active subscription). */
export const FREE_SEAT_CAP = 1;

// ─── Discovery map-depth guard (decision F-8, 2026-07-09) ───────────────────
//
// Discovery (mapping a market) is $0 to the agency but costs US DfS $ per
// never-seen cell — a big market (~3,000 listings) is ~$1.20 out of pocket.
// To protect the thin margin on the near-free tiers we cap how DEEP the map
// goes: Free + Starter ($19) fetch a shallow slice (~500 rows ≈ $0.20/market);
// Solo ($49) and up fetch the full market. This is the COGS guard, not a
// customer charge (docs/billing-repricing-2026-07-09.html · Part-discovery).

/** Full per-cell map depth — the fetch ceiling for Solo ($49) and above. */
export const DISCOVERY_DEPTH_FULL = 3000;
/** Shallow per-cell map depth — the fetch ceiling for Free + Starter ($19). */
export const DISCOVERY_DEPTH_ENTRY = 500;

// ─── Monthly cost-incurring map cap (review Part B2 · uncapped discovery) ────
//
// Discovery is $0 to the agency but costs US DfS $ per never-seen/stale cell.
// The depth cap bounds cost PER map; this bounds the COUNT of cost-incurring
// maps per calendar month, replacing the old WARN-only soft ceiling with a hard
// block. These are anti-abuse CEILINGS, not revenue matches — a normal agency
// maps a handful of markets/month and never approaches them; they exist so a
// hostile/farming account can't burn unbounded vendor spend (previously ∞).
// Keyed by AgencyPlan enum; Free (no active sub) is the tightest.
export const MONTHLY_MAP_CAP_FREE = 5;
export const MONTHLY_MAP_CAPS: Record<string, number> = {
  SOLO: 25, // display "Starter" ($19)
  AGENCY_PRO: 75, // display "Solo" ($49)
  GROWTH: 200, // display "Growth" ($99)
  BOUTIQUE: 500, // display "Pro" ($299)
};

/**
 * Max cost-incurring maps an agency may run per calendar month. Free (no active
 * sub) → the tight free ceiling; paid tiers → their generous plan ceiling. Pure
 * — no DB. The caller counts this month's cost-incurring Discovery rows and
 * blocks the enqueue at/over this number.
 */
export function monthlyMapCapFor(agency: {
  plan: string | null;
  stripeStatus: string | null;
}): number {
  if (!isPaidAgency(agency.stripeStatus)) return MONTHLY_MAP_CAP_FREE;
  return MONTHLY_MAP_CAPS[agency.plan ?? ""] ?? MONTHLY_MAP_CAP_FREE;
}

/**
 * Per-cell discovery map-depth cap for an agency. Free (no active sub) and the
 * SOLO enum (display "Starter", $19) map shallow; every paid tier above Starter
 * (AGENCY_PRO="Solo", GROWTH, BOUTIQUE) maps the full market. Pure — no DB.
 */
export function discoveryDepthCapFor(agency: {
  plan: string | null;
  stripeStatus: string | null;
}): number {
  if (!isPaidAgency(agency.stripeStatus)) return DISCOVERY_DEPTH_ENTRY; // Free
  // SOLO enum = display "Starter" ($19) → shallow. Everything above → full.
  return (agency.plan ?? "") === "SOLO"
    ? DISCOVERY_DEPTH_ENTRY
    : DISCOVERY_DEPTH_FULL;
}

/** Stripe statuses that count as an active paid subscription. */
const ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/**
 * True when the agency has an active paid subscription. WP7-5 uses this as the
 * free-tier upgrade wall (e.g. contacts are visible in-app but excluded from the
 * CSV export until paid). Same `stripeStatus` semantics as the seat-cap gate.
 */
export function isPaidAgency(stripeStatus: string | null): boolean {
  return stripeStatus != null && ACTIVE_STATUSES.has(stripeStatus);
}

export interface SeatCapInput {
  maxSeats: number | null;
  plan: string | null;
  stripeStatus: string | null;
}

/** The agency's seat cap: explicit maxSeats wins, else plan default. */
export function seatCapFor(agency: SeatCapInput): number {
  if (agency.maxSeats != null && agency.maxSeats > 0) return agency.maxSeats;
  const paid =
    agency.stripeStatus != null && ACTIVE_STATUSES.has(agency.stripeStatus);
  if (!paid) return FREE_SEAT_CAP;
  return PLAN_SEAT_CAPS[agency.plan ?? ""] ?? FREE_SEAT_CAP;
}

export interface SeatState {
  cap: number;
  used: number;
  open: number;
}

/** Current seat usage for an agency (one agency read + one member count). */
export async function seatStateFor(agencyId: string): Promise<SeatState> {
  const [agency, used] = await Promise.all([
    prisma.agency.findUnique({
      where: { id: agencyId },
      select: { maxSeats: true, plan: true, stripeStatus: true },
    }),
    prisma.agencyMember.count({ where: { agencyId } }),
  ]);
  const cap = agency ? seatCapFor(agency) : FREE_SEAT_CAP;
  return { cap, used, open: Math.max(0, cap - used) };
}
