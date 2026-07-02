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

/** Seat cap per PAID plan tier (docs/seat-model.md mapped onto the enum). */
export const PLAN_SEAT_CAPS: Record<string, number> = {
  SOLO: 2, // display "Starter" ($19)
  GROWTH: 5, // display "Growth" ($99)
  AGENCY_PRO: 10, // legacy internal tier (WP0-6 comment)
  BOUTIQUE: 15, // display "Scale" ($299)
};

/** The Free-state cap (no active subscription). */
export const FREE_SEAT_CAP = 1;

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
