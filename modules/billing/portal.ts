// Billing · Stripe customer-portal session creator.
//
// Why this lives in the user request path (vs cron-only per
// `.claude/rules/cost-discipline.md`):
//
//   Same rationale as `checkout.ts` — the customer portal is the user's
//   billing self-service surface (update card, view invoices, change tier,
//   cancel). There is no cron path for "open the user's portal session";
//   it's invoked synchronously when they click "Manage subscription".
//
// What this creates:
//   - A Stripe Billing Portal Session bound to the user's (or agency's)
//     existing `stripeCustomerId`. No DB writes; pure handshake.
//
// What this does NOT do:
//   - Create a Customer (user must already have a stripeCustomerId from
//     a prior checkout). Callers handle the missing-customer case with a
//     `no_customer` error code.
//   - Apply auth checks or rate limiting — the caller (server action or
//     route handler) is responsible.

import prisma from "@/lib/prisma";
import stripeClient from "@/lib/stripe";

export interface CreatePortalInput {
  /** Authenticated User.id from `await auth()`. */
  userId: string;
  /**
   * Absolute URL Stripe redirects to when the user closes the portal.
   * Host-allow-listed for open-redirect defense (mirrors checkout.ts).
   */
  returnUrl: string;
}

export interface CreatePortalResult {
  /** Stripe-hosted billing-portal URL — redirect the user here. */
  url: string;
  /** Session id, useful for telemetry. */
  sessionId: string;
  /** Stripe Customer id the session is bound to. */
  customerId: string;
  /** Whether the customer belongs to the User (smb) or the Agency. */
  audience: "smb" | "agency";
}

/**
 * Domain error. Same shape as `CheckoutError` so route handlers can
 * map codes uniformly.
 */
export class PortalError extends Error {
  constructor(
    readonly code:
      | "user_not_found"
      | "no_customer"
      | "agency_role_required"
      | "invalid_return_url",
    message: string,
  ) {
    super(message);
    this.name = "PortalError";
  }
}

interface AgencyRow {
  id: string;
  name: string;
  stripeCustomerId: string | null;
}

interface MembershipRow {
  agencyId: string;
  role: "OWNER" | "ADMIN" | "STAFF";
  agency: AgencyRow | null;
}

interface UserRow {
  id: string;
  stripeCustomerId: string | null;
  agencyMembers: MembershipRow[];
}

/**
 * Create a Stripe Billing Portal Session for the authenticated user.
 *
 * Customer resolution order:
 *   1. If the user is an OWNER/ADMIN on an Agency with `stripeCustomerId`,
 *      we open the portal for the AGENCY customer (Tom self-manages the
 *      agency's tier). STAFF role gets `agency_role_required`.
 *   2. Else if the user has a personal `User.stripeCustomerId`, open the
 *      portal for that (Maria self-manages her $29 SMB plan).
 *   3. Else `no_customer` — user has never subscribed; UI should hide the
 *      "Manage subscription" CTA and show a "Subscribe" path instead.
 */
export async function createPortalSession(
  input: CreatePortalInput,
): Promise<CreatePortalResult> {
  validateReturnUrl(input.returnUrl);

  const user = (await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      stripeCustomerId: true,
      agencyMembers: {
        select: {
          agencyId: true,
          role: true,
          agency: {
            select: { id: true, name: true, stripeCustomerId: true },
          },
        },
        take: 1,
      },
    },
  })) as UserRow | null;

  if (!user) {
    throw new PortalError("user_not_found", `User ${input.userId} not found`);
  }

  const membership = user.agencyMembers[0];
  const agency = membership?.agency ?? null;

  // Prefer agency customer if the user is OWNER/ADMIN and the agency has
  // already paid through Stripe.
  if (agency?.stripeCustomerId) {
    if (membership!.role === "STAFF") {
      // STAFF on a paying agency shouldn't open the billing portal —
      // they can't change the tier or update payment methods.
      throw new PortalError(
        "agency_role_required",
        `Opening the billing portal requires OWNER or ADMIN role (got ${membership!.role}).`,
      );
    }
    const session = await stripeClient.billingPortal.sessions.create({
      customer: agency.stripeCustomerId,
      return_url: input.returnUrl,
    });
    return {
      url: requireUrl(session.url),
      sessionId: session.id,
      customerId: agency.stripeCustomerId,
      audience: "agency",
    };
  }

  // Fall back to personal SMB customer.
  if (user.stripeCustomerId) {
    const session = await stripeClient.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: input.returnUrl,
    });
    return {
      url: requireUrl(session.url),
      sessionId: session.id,
      customerId: user.stripeCustomerId,
      audience: "smb",
    };
  }

  // No Stripe customer at all — caller decides how to surface (likely
  // redirect to the subscribe CTA).
  throw new PortalError(
    "no_customer",
    `User ${input.userId} has no Stripe customer to open the portal for.`,
  );
}

function requireUrl(url: string | null): string {
  if (!url || url.length === 0) {
    throw new Error("Stripe billing-portal session created without a URL");
  }
  return url;
}

/**
 * Mirrors `checkout.ts` validateReturnUrl. Kept duplicated rather than
 * extracted to avoid a circular dependency on a shared module — both
 * validators are short and self-contained.
 */
function validateReturnUrl(returnUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(returnUrl);
  } catch {
    throw new PortalError(
      "invalid_return_url",
      `returnUrl "${returnUrl}" is not a valid absolute URL.`,
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new PortalError(
      "invalid_return_url",
      `returnUrl protocol "${parsed.protocol}" is not allowed.`,
    );
  }
  const host = parsed.hostname.toLowerCase();
  const isLocalhost = host === "localhost" || host === "127.0.0.1";
  if (parsed.protocol === "http:" && !isLocalhost) {
    throw new PortalError(
      "invalid_return_url",
      `returnUrl must use https for non-localhost hosts (got "${returnUrl}").`,
    );
  }
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new PortalError(
      "invalid_return_url",
      `returnUrl must use https in production (got "${returnUrl}").`,
    );
  }
  if (isAllowedReturnHost(host)) return;
  throw new PortalError(
    "invalid_return_url",
    `returnUrl host "${host}" is not on the allow-list.`,
  );
}

function isAllowedReturnHost(host: string): boolean {
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (host === "vercel.app" || host.endsWith(".vercel.app")) return true;
  const appHost = appUrlHost();
  if (appHost) {
    if (host === appHost) return true;
    if (host === `www.${appHost}`) return true;
    if (appHost.startsWith("www.") && host === appHost.slice(4)) return true;
  }
  return false;
}

function appUrlHost(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}
