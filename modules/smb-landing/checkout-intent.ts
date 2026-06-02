/**
 * Landing → checkout intent.
 *
 * Called from `/post-signin` when a freshly-authenticated visitor arrived via a
 * landing CTA (`?intent=smb&landing=<token>`). Creates the $29 SMB checkout
 * session (carrying the landing token for attribution), records the
 * CHECKOUT_OPENED funnel step, and returns the Stripe-hosted URL to redirect to.
 *
 * Fully fail-safe: any error (missing price id, Stripe down, invalid token)
 * returns null so the caller falls through to the normal /home destination —
 * a landing intent must never block someone from signing in.
 */

import { createCheckoutSession } from "@/modules/billing/checkout";

import { recordCheckoutOpened } from "./conversion";
import { isValidLandingToken } from "./token";

export async function startSmbCheckoutFromLanding(
  userId: string,
  landingToken: string | undefined,
  origin: string,
): Promise<string | null> {
  try {
    const token =
      landingToken && isValidLandingToken(landingToken)
        ? landingToken
        : undefined;
    const result = await createCheckoutSession({
      userId,
      plan: "smb_paid",
      returnUrl: `${origin}/home`,
      landingToken: token,
    });
    if (token) {
      await recordCheckoutOpened(token, result.sessionId, userId);
    }
    return result.sessionUrl;
  } catch {
    return null;
  }
}
