// Billing · Stripe checkout session creator.
//
// Why this lives in the user request path (vs cron-only per
// `.claude/rules/cost-discipline.md` "no live API in user path"):
//
//   The rule's intent is to prevent uncached per-user data-pull calls
//   (DataForSEO, Lighthouse, etc.) charging us per page view. Stripe
//   checkout creation is the OPPOSITE: it's the user-initiated billing
//   handshake. There is no cron path for "create the customer + open
//   the checkout session" — by definition this happens when the user
//   clicks "Subscribe". CronRun cost tracking does not apply; Stripe's
//   own dashboard is the cost-of-record for billing API calls.
//
// What this creates:
//   - A Stripe Customer (idempotent — reuses User.stripeCustomerId or
//     Agency.stripeCustomerId if already set).
//   - A Stripe Checkout Session in `subscription` mode pointing at the
//     plan's price ID.
//
// What this does NOT do:
//   - Persist a Subscription row to our DB. The Stripe webhook handler
//     (G.2/G.3, separate task) listens for `checkout.session.completed`
//     and `customer.subscription.*` events and updates DB state then.
//   - Apply rate limiting / auth checks. That's the route handler's job.

import type Stripe from "stripe";

import prisma from "@/lib/prisma";
import stripeClient from "@/lib/stripe";

import { getPriceId, planAudience, type Plan } from "./plans";

/** Input contract — `userId` is the authenticated session's user.id. */
export interface CreateCheckoutInput {
  /** The signed-in User.id from `await auth()`. */
  userId: string;
  /** Plan the user wants to subscribe to. */
  plan: Plan;
  /**
   * Absolute URL where Stripe redirects after success or cancellation.
   * Success URL receives `?checkout=success` appended; cancel URL receives
   * `?canceled=1`. The caller picks the route (e.g. `/billing/return`).
   *
   * Hosts are allow-listed (see `validateReturnUrl`) to defend against
   * open-redirect attacks via Stripe-mediated post-checkout redirects.
   */
  returnUrl: string;
  /**
   * Optional landing-page token (16-digit) when this checkout originated from
   * a personalized `/l/[token]` proposal. Carried into Stripe metadata so the
   * webhook can attribute the conversion (SUBSCRIPTION_BOUGHT) to the landing's
   * funnel. SMB plan only — ignored for agency checkouts.
   */
  landingToken?: string;
}

export interface CreateCheckoutResult {
  /** Stripe-hosted checkout URL — redirect the user here. */
  sessionUrl: string;
  /** Session id, useful for client-side telemetry / dedup. */
  sessionId: string;
  /** Stripe Customer id (newly created or reused). */
  customerId: string;
}

/**
 * Domain error: surfaces back to the route handler as a 4xx with a stable
 * `code`. Anything that escapes this class is treated as a 5xx by callers.
 */
export class CheckoutError extends Error {
  constructor(
    readonly code:
      | "user_not_found"
      | "agency_required"
      | "agency_not_found"
      | "agency_role_required"
      | "invalid_return_url",
    message: string,
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}

// ─── Internal shapes (derived from the Prisma select below) ────────────────

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
  email: string;
  name: string | null;
  stripeCustomerId: string | null;
  agencyMembers: MembershipRow[];
}

/**
 * Create a Stripe Checkout Session for the given user + plan.
 *
 * Side effects (idempotent within Stripe's API):
 *   - Creates a Stripe Customer if the User (SMB) or Agency (agency tier)
 *     doesn't already have a `stripeCustomerId`. Persists the new id.
 *   - Creates a brand-new checkout Session every call. Stripe doesn't
 *     support "reuse the existing open session for this customer", so
 *     repeated calls to this function will create multiple sessions —
 *     that's expected. They expire after 24h if unused.
 *
 * Caller responsibilities (NOT done here):
 *   - Auth check (`await auth()`).
 *   - Zod validation of `plan` and `returnUrl`.
 *   - Rate limiting.
 */
export async function createCheckoutSession(
  input: CreateCheckoutInput,
): Promise<CreateCheckoutResult> {
  validateReturnUrl(input.returnUrl);

  const user = (await prisma.user.findUnique({
    where: { id: input.userId },
    select: {
      id: true,
      email: true,
      name: true,
      stripeCustomerId: true,
      agencyMembers: {
        select: {
          agencyId: true,
          role: true,
          agency: {
            select: { id: true, name: true, stripeCustomerId: true },
          },
        },
        // First-membership wins. Multi-agency UX (a user belonging to two
        // agencies subscribing both) is out of scope for G.1 — when it
        // ships, this becomes an explicit `agencyId` parameter.
        take: 1,
      },
    },
  })) as UserRow | null;

  if (!user) {
    throw new CheckoutError("user_not_found", `User ${input.userId} not found`);
  }

  const audience = planAudience(input.plan);
  if (audience === "agency") {
    return checkoutForAgency(user, input);
  }
  return checkoutForUser(user, input);
}

// ─── Audience-specific session creation ────────────────────────────────────

async function checkoutForUser(
  user: UserRow,
  input: CreateCheckoutInput,
): Promise<CreateCheckoutResult> {
  const customerId = await ensureUserCustomer(user);
  const metadata: Record<string, string> = {
    userId: user.id,
    plan: input.plan,
    audience: "smb",
  };
  // Landing attribution — carried to the subscription so the webhook can
  // close the funnel loop (SUBSCRIPTION_BOUGHT) back to the originating page.
  if (input.landingToken) metadata.landingToken = input.landingToken;
  const session = await createSession({
    customerId,
    priceId: getPriceId(input.plan),
    returnUrl: input.returnUrl,
    clientReferenceId: user.id,
    metadata,
  });
  return {
    sessionUrl: requireSessionUrl(session),
    sessionId: session.id,
    customerId,
  };
}

async function checkoutForAgency(
  user: UserRow,
  input: CreateCheckoutInput,
): Promise<CreateCheckoutResult> {
  const membership = user.agencyMembers[0];
  if (!membership) {
    throw new CheckoutError(
      "agency_required",
      `Plan "${input.plan}" requires the user to belong to an agency.`,
    );
  }
  // Role gate: only OWNER + ADMIN may trigger billing on the agency's
  // behalf. STAFF members can use the agency but must not be able to
  // start, upgrade, or cancel its subscription. Source of truth is
  // `AgencyMemberRole` in prisma/schema.prisma.
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    throw new CheckoutError(
      "agency_role_required",
      `Plan "${input.plan}" requires an OWNER or ADMIN agency role (got ${membership.role}).`,
    );
  }
  const agency = membership.agency;
  if (!agency) {
    throw new CheckoutError(
      "agency_not_found",
      `AgencyMember ${membership.agencyId} references a missing Agency.`,
    );
  }

  const customerId = await ensureAgencyCustomer(user, agency);
  const session = await createSession({
    customerId,
    priceId: getPriceId(input.plan),
    returnUrl: input.returnUrl,
    clientReferenceId: user.id,
    metadata: {
      userId: user.id,
      agencyId: agency.id,
      plan: input.plan,
      audience: "agency",
    },
  });
  return {
    sessionUrl: requireSessionUrl(session),
    sessionId: session.id,
    customerId,
  };
}

// ─── Stripe Customer reconciliation ────────────────────────────────────────

async function ensureUserCustomer(user: UserRow): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripeClient.customers.create({
    email: user.email,
    name: user.name ?? undefined,
    metadata: { userId: user.id, audience: "smb" },
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: customer.id },
  });
  return customer.id;
}

async function ensureAgencyCustomer(
  user: UserRow,
  agency: AgencyRow,
): Promise<string> {
  if (agency.stripeCustomerId) return agency.stripeCustomerId;

  const customer = await stripeClient.customers.create({
    email: user.email,
    name: agency.name,
    metadata: {
      agencyId: agency.id,
      audience: "agency",
      // Capture who initiated the subscription — useful for support but the
      // billing target is the Agency, not the User.
      initiatedByUserId: user.id,
    },
  });
  await prisma.agency.update({
    where: { id: agency.id },
    data: { stripeCustomerId: customer.id },
  });
  return customer.id;
}

// ─── Session creation primitive ────────────────────────────────────────────

interface CreateSessionParams {
  customerId: string;
  priceId: string;
  returnUrl: string;
  clientReferenceId: string;
  metadata: Record<string, string>;
}

async function createSession(
  p: CreateSessionParams,
): Promise<Stripe.Checkout.Session> {
  const cancelUrl = appendQueryFlag(p.returnUrl, "canceled", "1");
  return stripeClient.checkout.sessions.create({
    mode: "subscription",
    customer: p.customerId,
    client_reference_id: p.clientReferenceId,
    line_items: [{ price: p.priceId, quantity: 1 }],
    success_url: appendQueryFlag(p.returnUrl, "checkout", "success"),
    cancel_url: cancelUrl,
    metadata: p.metadata,
    // Pass metadata onto the resulting subscription too — the webhook
    // handler reads from `subscription.metadata` to wire DB state without
    // a second Stripe round-trip.
    subscription_data: { metadata: p.metadata },
    // Allow promotion codes by default — agencies often arrive via partner
    // discounts. SMB users rarely use them, but the option is harmless.
    allow_promotion_codes: true,
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function requireSessionUrl(session: Stripe.Checkout.Session): string {
  if (!session.url) {
    // Stripe always returns `url` for hosted sessions; absence indicates we
    // accidentally created an embedded-mode session, which we don't use.
    throw new Error("Stripe Checkout session created without a hosted URL");
  }
  return session.url;
}

function appendQueryFlag(url: string, key: string, value: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
}

/**
 * Open-redirect defense for the Stripe post-checkout redirect.
 *
 * Stripe will redirect users to `success_url` / `cancel_url` verbatim — if
 * we accept any `http(s)` URL the attacker can craft a checkout link that
 * lands the user on a phishing page that looks like Mapsly. The allow-list
 * here mirrors the hosts our own UI actually uses:
 *
 *   - The configured `NEXT_PUBLIC_APP_URL` host (production: `mapsly.ai`,
 *     `www.mapsly.ai`).
 *   - Any `*.vercel.app` subdomain (preview deploys).
 *   - `localhost` / `127.0.0.1` (local dev).
 *
 * Protocol rule: only `https:` in production; `http:` is allowed *only*
 * for localhost/127.0.0.1 so dev still works. This guards against the
 * "downgrade to http and MitM the session" path on the public internet.
 */
function validateReturnUrl(returnUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(returnUrl);
  } catch {
    throw new CheckoutError(
      "invalid_return_url",
      `returnUrl "${returnUrl}" is not a valid absolute URL.`,
    );
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new CheckoutError(
      "invalid_return_url",
      `returnUrl protocol "${parsed.protocol}" is not allowed.`,
    );
  }

  const host = parsed.hostname.toLowerCase();
  const isLocalhost = host === "localhost" || host === "127.0.0.1";

  // http: only allowed for localhost; reject http on any public host.
  if (parsed.protocol === "http:" && !isLocalhost) {
    throw new CheckoutError(
      "invalid_return_url",
      `returnUrl must use https for non-localhost hosts (got "${returnUrl}").`,
    );
  }

  // In production, refuse http: entirely (even localhost — there's no
  // legitimate reason a production Stripe checkout lands on localhost).
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new CheckoutError(
      "invalid_return_url",
      `returnUrl must use https in production (got "${returnUrl}").`,
    );
  }

  if (isAllowedReturnHost(host)) return;

  throw new CheckoutError(
    "invalid_return_url",
    `returnUrl host "${host}" is not on the allow-list.`,
  );
}

function isAllowedReturnHost(host: string): boolean {
  if (host === "localhost" || host === "127.0.0.1") return true;

  // Any *.vercel.app preview deploy (and `vercel.app` itself, harmless).
  if (host === "vercel.app" || host.endsWith(".vercel.app")) return true;

  // The configured public app URL host (e.g. mapsly.ai). Also accept
  // the apex/www variant of the same registrable domain so a config of
  // `https://mapsly.ai` still accepts `www.mapsly.ai` and vice versa —
  // both belong to us.
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
