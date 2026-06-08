// GET /api/checkout/start?landing=<token>&term=monthly|annual
//
// The direct-from-landing checkout entry point. A prospect clicks "Start
// tracking" on /l/[token] and lands here (no sign-in). We validate the landing
// token, resolve its prospect Business, create an ANONYMOUS Stripe subscription
// Checkout Session (email prefilled from the discovered Business email), and
// 303-redirect the browser to Stripe. After payment, success_url lands on
// /checkout/return which mints the session (auto-login) + the webhook claims
// the business.
//
// Rate-limited per-IP (PUBLIC_LIMIT) — this creates a Stripe object on each
// hit. Bad/expired tokens redirect home rather than erroring.

import { NextResponse } from "next/server";

import prisma from "@/lib/prisma";
import { ipKey, PUBLIC_LIMIT, rateLimit } from "@/lib/middleware/rate-limit";
import { createAnonymousSmbCheckout } from "@/modules/billing/checkout";
import { parseBillingTerm } from "@/modules/billing/plans";
import { recordCheckoutOpened } from "@/modules/smb-landing/conversion";
import { isValidLandingToken } from "@/modules/smb-landing/token";

export async function GET(req: Request): Promise<Response> {
  const limited = await rateLimit(req, PUBLIC_LIMIT, ipKey(req));
  if (limited) return limited;

  const url = new URL(req.url);
  const token = url.searchParams.get("landing") ?? "";
  const term = parseBillingTerm(url.searchParams.get("term"));
  // Public origin for Stripe redirect URLs (must be the deployed host, not the
  // internal request URL behind Vercel's proxy).
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? url.origin;

  const home = NextResponse.redirect(new URL("/", origin), { status: 303 });
  if (!isValidLandingToken(token)) return home;

  let lp;
  try {
    lp = await prisma.landingPage.findUnique({
      where: { token },
      select: {
        isActive: true,
        slug: true,
        business: { select: { id: true, email: true, emailDiscovered: true } },
      },
    });
  } catch {
    return home;
  }
  if (!lp || !lp.isActive) return home;

  const customerEmail =
    lp.business.email ?? lp.business.emailDiscovered ?? null;

  // Reuse the Stripe customer if the prefill email already belongs to a
  // subscriber — avoids minting a duplicate Customer for a returning user.
  let existingCustomerId: string | null = null;
  if (customerEmail) {
    const existing = await prisma.user
      .findUnique({
        where: { email: customerEmail.toLowerCase() },
        select: { stripeCustomerId: true },
      })
      .catch(() => null);
    existingCustomerId = existing?.stripeCustomerId ?? null;
  }

  // One-time nonce binding the post-payment auto-login to THIS browser. Stored
  // both in the Stripe session metadata and an httpOnly cookie; /checkout/return
  // proves the login came from the browser that started checkout.
  const nonce = crypto.randomUUID();

  try {
    const result = await createAnonymousSmbCheckout({
      customerEmail,
      existingCustomerId,
      landingToken: token,
      landingSlug: lp.slug,
      businessId: lp.business.id,
      term,
      origin,
      nonce,
    });
    // Best-effort funnel attribution — never block the redirect.
    await recordCheckoutOpened(token, result.sessionId, null).catch(() => {});
    const res = NextResponse.redirect(result.sessionUrl, { status: 303 });
    res.cookies.set("mapsly_checkout_nonce", nonce, {
      httpOnly: true,
      sameSite: "lax", // survives the top-level GET redirect back from Stripe
      secure: process.env.NODE_ENV === "production",
      path: "/checkout",
      maxAge: 60 * 30, // 30m
    });
    return res;
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "checkout.start.failed",
        token,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    // Send them back to the landing with a soft error flag.
    return NextResponse.redirect(
      new URL(`/l/${lp.slug}-${token}?error=checkout`, origin),
      { status: 303 },
    );
  }
}
