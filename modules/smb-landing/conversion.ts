/**
 * Landing funnel · server-side conversion events.
 *
 * `recordLandingConversion` closes the loop: called from the Stripe webhook
 * route on `checkout.session.completed`, it reads the `landingToken` we wrote
 * into the checkout metadata and records a SUBSCRIPTION_BOUGHT LandingEvent —
 * the funnel's terminal step. The webhook route already dedups by event id, so
 * this fires at most once per conversion.
 *
 * `recordCheckoutOpened` records the CHECKOUT_OPENED step when the post-signin
 * intent path creates a Stripe session from a landing.
 *
 * Both are best-effort and fully guarded — a landing side-effect must never
 * break billing or auth.
 */

import type Stripe from "stripe";

import prisma from "@/lib/prisma";

import { isValidLandingToken } from "./token";

async function landingIdForToken(token: string): Promise<string | null> {
  if (!isValidLandingToken(token)) return null;
  const lp = await prisma.landingPage.findUnique({
    where: { token },
    select: { id: true },
  });
  return lp?.id ?? null;
}

/** Webhook attribution: record SUBSCRIPTION_BOUGHT for a completed checkout. */
export async function recordLandingConversion(
  event: Stripe.Event,
): Promise<void> {
  if (event.type !== "checkout.session.completed") return;
  try {
    const session = event.data.object as Stripe.Checkout.Session;
    const md = (session.metadata ?? {}) as Record<string, string | undefined>;
    const token = md.landingToken;
    if (!token) return;
    const landingPageId = await landingIdForToken(token);
    if (!landingPageId) return;
    await prisma.landingEvent.create({
      data: {
        landingPageId,
        type: "SUBSCRIPTION_BOUGHT",
        stripeSessionId: session.id,
        convertedUserId: md.userId ?? null,
        isBot: false,
      },
    });
  } catch {
    // Never break the webhook on a landing side-effect.
  }
}

/** Record CHECKOUT_OPENED when a landing-driven checkout session is created. */
export async function recordCheckoutOpened(
  token: string,
  stripeSessionId: string,
  convertedUserId: string | null,
): Promise<void> {
  try {
    const landingPageId = await landingIdForToken(token);
    if (!landingPageId) return;
    await prisma.landingEvent.create({
      data: {
        landingPageId,
        type: "CHECKOUT_OPENED",
        stripeSessionId,
        convertedUserId,
        isBot: false,
      },
    });
  } catch {
    // best-effort
  }
}
