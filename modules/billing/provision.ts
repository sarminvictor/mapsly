// Billing · provision an SMB account from a completed Stripe checkout.
//
// The direct-from-landing flow has NO pre-existing User: a prospect pays on
// Stripe before we know them. BOTH the success-redirect login (the Credentials
// `authorize` in lib/auth.ts) AND the webhook (durable state) call this to
// idempotently:
//
//   1. find-or-create the User from the Stripe-confirmed email + customer id, and
//   2. claim the prospect Business the landing was about — ONLY if still
//      unclaimed (we never steal an already-owned business).
//
// Idempotent + race-safe: whichever of {redirect, webhook} runs first wins; the
// other is a no-op. Email + stripeCustomerId are both UNIQUE columns.

import type Stripe from "stripe";

import prisma from "@/lib/prisma";

export interface ProvisionInput {
  /** Email Stripe confirmed at checkout (`customer_details.email`) — source of truth. */
  email: string;
  /** Stripe Customer id from the completed session. */
  customerId: string;
  /** Landing token carried in checkout metadata → which Business to claim. */
  landingToken?: string | null;
}

export interface ProvisionResult {
  userId: string;
  businessId: string | null;
  /** True if this call created the User row (vs found an existing one). */
  created: boolean;
  /** True if this call set Business.ownerUserId (vs already claimed / none). */
  claimed: boolean;
  /**
   * How the User was resolved — a SECURITY discriminator for the login path:
   *   - "new"      → created from this payment (safe to auto-login)
   *   - "customer" → matched by this Stripe customer id, already theirs (safe)
   *   - "email"    → matched a PRE-EXISTING account by the typed email. The
   *     email is NOT verified (Stripe lets the payer type any address), so the
   *     login path MUST NOT auto-login this case — it would be account takeover.
   */
  matchedBy: "new" | "customer" | "email";
}

const USER_SELECT = { id: true, stripeCustomerId: true } as const;

/** Idempotent + race-safe: safe to call from both the return-redirect and the
 * webhook (which fire within ms of each other for the same checkout). */
export async function provisionSmbFromCheckout(
  input: ProvisionInput,
): Promise<ProvisionResult> {
  const email = input.email.trim().toLowerCase();

  // 1 · find-or-create the User. Customer id is the strongest key (UNIQUE),
  //     email is UNIQUE too. Prefer customer-id, then email.
  let matchedBy: "new" | "customer" | "email" = "new";
  let user = await prisma.user.findUnique({
    where: { stripeCustomerId: input.customerId },
    select: USER_SELECT,
  });
  if (user) {
    matchedBy = "customer";
  } else {
    user = await prisma.user.findUnique({
      where: { email },
      select: USER_SELECT,
    });
    if (user) matchedBy = "email";
  }

  let created = false;
  if (!user) {
    try {
      user = await prisma.user.create({
        data: { email, role: "MEMBER", stripeCustomerId: input.customerId },
        select: USER_SELECT,
      });
      created = true;
      matchedBy = "new";
    } catch (err) {
      // Concurrent create (return-redirect + webhook race) lost on UNIQUE —
      // re-read the winner rather than failing the provision.
      if ((err as { code?: string }).code !== "P2002") throw err;
      user =
        (await prisma.user.findUnique({
          where: { stripeCustomerId: input.customerId },
          select: USER_SELECT,
        })) ??
        (await prisma.user.findUnique({
          where: { email },
          select: USER_SELECT,
        }));
      if (!user) throw err;
      matchedBy =
        user.stripeCustomerId === input.customerId ? "customer" : "email";
    }
  } else if (!user.stripeCustomerId) {
    // Link the Stripe customer to a pre-existing user. Guard the UNIQUE
    // constraint defensively. (The login path refuses to auto-login an
    // email-matched user regardless — see lib/auth.ts.)
    await prisma.user
      .update({
        where: { id: user.id },
        data: { stripeCustomerId: input.customerId },
      })
      .catch(() => {
        /* another row already holds this customer id — leave as-is */
      });
  }

  // 2 · claim the prospect Business — ONLY if currently unclaimed.
  let businessId: string | null = null;
  let claimed = false;
  if (input.landingToken) {
    const lp = await prisma.landingPage.findUnique({
      where: { token: input.landingToken },
      select: { businessId: true },
    });
    if (lp) {
      businessId = lp.businessId;
      const biz = await prisma.business.findUnique({
        where: { id: businessId },
        select: { ownerUserId: true },
      });
      if (biz && biz.ownerUserId == null) {
        await prisma.business.update({
          where: { id: businessId },
          data: { ownerUserId: user.id, isClaimed: true },
        });
        claimed = true;
      }
    }
  }

  return { userId: user.id, businessId, created, claimed, matchedBy };
}

/**
 * Record the SMB subscription state on a user DIRECTLY from the (expanded)
 * checkout session — so the post-payment state is correct immediately, without
 * depending on the async webhook (which may lag or, if misconfigured, never
 * arrive). The webhook remains the source of truth for ongoing lifecycle
 * (renewals, cancellations); this just guarantees the initial paid state.
 *
 * Requires the session to have been retrieved with `expand: ["subscription"]`.
 * Best-effort: callers guard — a failure here must never block the login.
 */
export async function recordSmbSubscriptionFromSession(
  session: Stripe.Checkout.Session,
  userId: string,
): Promise<void> {
  const sub = session.subscription;
  if (!sub || typeof sub === "string") return; // not expanded → nothing to write
  const priceId = sub.items?.data?.[0]?.price?.id ?? null;
  // current_period_end: top-level (≤2025-02 API) or item-level (Basil 2025-03+).
  const top = (sub as unknown as { current_period_end?: number })
    .current_period_end;
  const item = (
    sub.items?.data?.[0] as unknown as
      | { current_period_end?: number }
      | undefined
  )?.current_period_end;
  const ts = typeof top === "number" ? top : item;
  await prisma.user.update({
    where: { id: userId },
    data: {
      stripeSubscriptionId: sub.id,
      stripePlan: "smb_paid",
      stripeStatus: sub.status,
      stripePriceId: priceId,
      currentPeriodEnd: typeof ts === "number" ? new Date(ts * 1000) : null,
      cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    },
  });
}
