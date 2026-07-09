// Money-path gates added 2026-07-09 (review Part E/F):
//   - startPlanCheckout: an agency with a LIVE subscription is routed to the
//     Stripe portal to change tier, never a 2nd checkout (double-subscription).
//   - startTopUpCheckout: top-ups require an active PAID plan (no free-tier
//     credit stacking).
// Payments = MUST-TEST (.claude/rules/testing.md): assert the gate redirects
// and NEVER creates a checkout session on the blocked path.

import { beforeEach, describe, expect, test, vi } from "vitest";

class RedirectError extends Error {
  digest: string;
  constructor(public url: string) {
    super(`REDIRECT:${url}`);
    this.digest = `NEXT_REDIRECT;replace;${url};`;
  }
}

const auth = vi.fn();
const userFindUnique = vi.fn(async (_a?: unknown) => ({}) as unknown);
const agencyUpdate = vi.fn(async (_a?: unknown) => ({}));
const checkoutCreate = vi.fn(async (..._a: unknown[]) => ({
  url: "https://checkout.stripe/session",
}));
const customersCreate = vi.fn(async (..._a: unknown[]) => ({ id: "cus_new" }));
const createPortalSession = vi.fn(async (..._a: unknown[]) => ({
  url: "https://portal.stripe/session",
}));
const rateLimitAction = vi.fn(async (..._a: unknown[]) => ({
  limited: false,
  retryAfter: 0,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));
vi.mock("@/lib/auth", () => ({ auth: () => auth() }));
vi.mock("@/lib/stripe", () => ({
  default: {
    checkout: {
      sessions: { create: (...a: unknown[]) => checkoutCreate(...a) },
    },
    customers: { create: (...a: unknown[]) => customersCreate(...a) },
  },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findUnique: (a: unknown) => userFindUnique(a) },
    agency: { update: (a: unknown) => agencyUpdate(a) },
  },
}));
vi.mock("@/lib/middleware/rate-limit", () => ({
  ACTION_ENQUEUE_LIMIT: { tokens: 10, window: "1 m" },
  rateLimitAction: (...a: unknown[]) => rateLimitAction(...a),
}));
vi.mock("../portal", () => ({
  createPortalSession: (...a: unknown[]) => createPortalSession(...a),
  PortalError: class PortalError extends Error {},
}));

import { startPlanCheckout, startTopUpCheckout } from "../credit-checkout";

/** Seat an authenticated OWNER with a given Stripe subscription state. */
function seat(opts: {
  stripeSubscriptionId: string | null;
  stripeStatus: string | null;
}): void {
  auth.mockResolvedValue({ user: { id: "u1" } });
  userFindUnique.mockResolvedValue({
    id: "u1",
    email: "owner@agency.com",
    agencyMembers: [
      {
        role: "OWNER",
        agency: {
          id: "a1",
          name: "Anchor Local",
          stripeCustomerId: "cus_1",
          stripeSubscriptionId: opts.stripeSubscriptionId,
          stripeStatus: opts.stripeStatus,
        },
      },
    ],
  });
}

async function runExpectingRedirect(fn: () => Promise<void>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof RedirectError) return e.url;
    throw e;
  }
  throw new Error("expected a redirect");
}

function planForm(plan: string, locale = "en"): FormData {
  const fd = new FormData();
  fd.set("plan", plan);
  fd.set("locale", locale);
  return fd;
}
function topUpForm(pack: string, locale = "en"): FormData {
  const fd = new FormData();
  fd.set("pack", pack);
  fd.set("locale", locale);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitAction.mockResolvedValue({ limited: false, retryAfter: 0 });
  process.env.STRIPE_PRICE_PLAN_GROWTH = "price_growth";
  process.env.STRIPE_PRICE_TOPUP_1000 = "price_topup_1000";
});

describe("startPlanCheckout · double-subscription guard", () => {
  test("live subscription → portal, never a fresh checkout", async () => {
    seat({ stripeSubscriptionId: "sub_1", stripeStatus: "active" });
    const url = await runExpectingRedirect(() =>
      startPlanCheckout(planForm("growth")),
    );
    expect(createPortalSession).toHaveBeenCalledTimes(1);
    expect(url).toBe("https://portal.stripe/session");
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  test("past_due subscriber is still a subscriber → portal, no 2nd checkout", async () => {
    seat({ stripeSubscriptionId: "sub_1", stripeStatus: "past_due" });
    await runExpectingRedirect(() => startPlanCheckout(planForm("growth")));
    expect(createPortalSession).toHaveBeenCalledTimes(1);
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  test("no subscription → fresh checkout is allowed", async () => {
    seat({ stripeSubscriptionId: null, stripeStatus: null });
    const url = await runExpectingRedirect(() =>
      startPlanCheckout(planForm("growth")),
    );
    expect(createPortalSession).not.toHaveBeenCalled();
    expect(checkoutCreate).toHaveBeenCalledTimes(1);
    expect(url).toBe("https://checkout.stripe/session");
  });

  test("canceled subscription is terminal → fresh checkout allowed", async () => {
    seat({ stripeSubscriptionId: "sub_old", stripeStatus: "canceled" });
    await runExpectingRedirect(() => startPlanCheckout(planForm("growth")));
    expect(createPortalSession).not.toHaveBeenCalled();
    expect(checkoutCreate).toHaveBeenCalledTimes(1);
  });
});

describe("startTopUpCheckout · paid-plan gate", () => {
  test("free agency → plan_required, never creates a checkout", async () => {
    seat({ stripeSubscriptionId: null, stripeStatus: null });
    const url = await runExpectingRedirect(() =>
      startTopUpCheckout(topUpForm("pack_1000")),
    );
    expect(url).toContain("billing_error=plan_required");
    expect(checkoutCreate).not.toHaveBeenCalled();
  });

  test("paid agency → top-up checkout proceeds", async () => {
    seat({ stripeSubscriptionId: "sub_1", stripeStatus: "active" });
    const url = await runExpectingRedirect(() =>
      startTopUpCheckout(topUpForm("pack_1000")),
    );
    expect(checkoutCreate).toHaveBeenCalledTimes(1);
    expect(url).toBe("https://checkout.stripe/session");
  });
});
