// Billing · plan registry.
//
// Five Stripe price IDs map to five plan literals. Env-var driven so
// production / preview / test environments can hold distinct price IDs
// without code changes. See `.env.example` § STRIPE_PRICE_*.

import { z } from "zod";

/**
 * Canonical plan identifiers. SMB has one paid tier ($29). Agency has four
 * tiers ($49 / $99 / $249 / $499). The free tier is implicit — no Stripe
 * subscription, no plan literal.
 */
export const PLANS = [
  "smb_paid",
  "agency_solo",
  "agency_growth",
  "agency_pro",
  "agency_boutique",
] as const;

export type Plan = (typeof PLANS)[number];

/** Zod enum gating user-supplied plan strings at the API boundary. */
export const PlanSchema = z.enum(PLANS);

/**
 * Audience for a plan — drives whether the Stripe customer is attached to
 * the User (SMB) or to the Agency (agency tiers). Used by the checkout
 * session creator to know which DB row carries the `stripeCustomerId`.
 */
export function planAudience(plan: Plan): "smb" | "agency" {
  return plan === "smb_paid" ? "smb" : "agency";
}

/**
 * Map a plan literal to the env-var name holding its Stripe price ID.
 * Kept as a small object (not a switch) so tests can iterate.
 */
const PLAN_ENV: Record<Plan, string> = {
  smb_paid: "STRIPE_PRICE_SMB_PAID",
  agency_solo: "STRIPE_PRICE_AGENCY_SOLO",
  agency_growth: "STRIPE_PRICE_AGENCY_GROWTH",
  agency_pro: "STRIPE_PRICE_AGENCY_PRO",
  agency_boutique: "STRIPE_PRICE_AGENCY_BOUTIQUE",
};

/**
 * Resolve the Stripe price ID for a plan at request time. Throws with a
 * clear message if the env var is missing — surfaces config drift early
 * rather than letting Stripe reject the checkout creation with a generic
 * "No such price" error.
 *
 * Read at call-time, not module-load — same INC-07 discipline as the
 * Stripe client itself.
 */
export function getPriceId(plan: Plan): string {
  const envVar = PLAN_ENV[plan];
  const value = process.env[envVar];
  if (!value || value.length === 0) {
    throw new Error(
      `Missing Stripe price ID for plan "${plan}": env var ${envVar} is not set.`,
    );
  }
  return value;
}
