// modules/outreach/touch-pricing.ts · what touch generation costs (WP5-1/10).
//
// The advertised credit definition (modules/cost/pricing.ts CREDIT_MEANING)
// says "10 credits per 100 first-touch messages" — 0.1 credit per touch. Whole
// credits are the wallet unit, so a run of N touches bills ceil(N / 10)
// (round up, never under-charge — same rule as usdToCredits). Pure + client-
// safe: the WP5-1 overlay imports this for the live estimate; the server
// action recomputes it (never trusts the client number).

import { CREDIT_MEANING } from "@/modules/cost/pricing";

/** Credits per 100 generated touches (the advertised rate). */
export const TOUCH_CREDITS_PER_100 = CREDIT_MEANING.firstTouchPer100;

/** Whole credits a run of `touches` messages bills (round up, min 0). */
export function creditsForTouches(touches: number): number {
  if (!Number.isFinite(touches) || touches <= 0) return 0;
  return Math.ceil((Math.trunc(touches) * TOUCH_CREDITS_PER_100) / 100);
}
