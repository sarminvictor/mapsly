// Auth/role gate for setPlanCancellation (F-6 native cancel/resume).
//
// Payments + auth = MUST-TEST (.claude/rules/testing.md). Every redirect path is
// exercised: unauthenticated, non-OWNER/ADMIN (STAFF), no live subscription, and
// the happy cancel + resume — asserting Stripe is called ONLY on the authorized
// happy path, never on a gated one, and with the correct cancel_at_period_end.

import { beforeEach, describe, expect, test, vi } from "vitest";

// redirect() throws NEXT_REDIRECT in Next; model it as a catchable sentinel that
// carries the target URL AND a `digest` starting with "NEXT_REDIRECT" — the
// action's try/catch re-throws only errors `isNextRedirect` recognises, so the
// digest is required for the happy-path redirects to escape the catch.
class RedirectError extends Error {
  digest: string;
  constructor(public url: string) {
    super(`REDIRECT:${url}`);
    this.digest = `NEXT_REDIRECT;replace;${url};`;
  }
}

const auth = vi.fn();
const stripeUpdate = vi.fn(async (..._a: unknown[]) => ({}));
const agencyFindUnique = vi.fn(async (_a?: unknown) => ({}) as unknown);
const agencyUpdate = vi.fn(async (_a?: unknown) => ({}));
const userFindUnique = vi.fn(async (_a?: unknown) => ({}) as unknown);
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
    subscriptions: { update: (...a: unknown[]) => stripeUpdate(...a) },
  },
}));
vi.mock("@/lib/prisma", () => ({
  default: {
    user: { findUnique: (a: unknown) => userFindUnique(a) },
    agency: {
      findUnique: (a: unknown) => agencyFindUnique(a),
      update: (a: unknown) => agencyUpdate(a),
    },
  },
}));
vi.mock("@/lib/middleware/rate-limit", () => ({
  ACTION_ENQUEUE_LIMIT: { tokens: 10, window: "1 m" },
  rateLimitAction: (...a: unknown[]) => rateLimitAction(...a),
}));

import { setPlanCancellation } from "../credit-checkout";

/** Seat an authenticated user with a given role + agency sub state. */
function seat(opts: {
  role: string;
  stripeSubscriptionId: string | null;
}): void {
  auth.mockResolvedValue({ user: { id: "u1" } });
  userFindUnique.mockResolvedValue({
    id: "u1",
    email: "owner@agency.com",
    agencyMembers: [
      {
        role: opts.role,
        agency: { id: "a1", name: "Anchor Local", stripeCustomerId: "cus_1" },
      },
    ],
  });
  agencyFindUnique.mockResolvedValue({
    stripeSubscriptionId: opts.stripeSubscriptionId,
  });
}

function form(cancel: "true" | "false", locale = "en"): FormData {
  const fd = new FormData();
  fd.set("cancel", cancel);
  fd.set("locale", locale);
  return fd;
}

/** Run the action and return the redirect URL it threw. */
async function runExpectingRedirect(fd: FormData): Promise<string> {
  try {
    await setPlanCancellation(fd);
  } catch (e) {
    if (e instanceof RedirectError) return e.url;
    throw e;
  }
  throw new Error("expected a redirect");
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimitAction.mockResolvedValue({ limited: false, retryAfter: 0 });
});

describe("setPlanCancellation · auth + role gate", () => {
  test("unauthenticated → redirects with an error, never calls Stripe", async () => {
    auth.mockResolvedValue(null);
    const url = await runExpectingRedirect(form("true"));
    expect(url).toContain("billing_error=unauthorized");
    expect(stripeUpdate).not.toHaveBeenCalled();
    expect(agencyUpdate).not.toHaveBeenCalled();
  });

  test("STAFF (not OWNER/ADMIN) → role_required, never calls Stripe", async () => {
    seat({ role: "STAFF", stripeSubscriptionId: "sub_1" });
    const url = await runExpectingRedirect(form("true"));
    expect(url).toContain("billing_error=role_required");
    expect(stripeUpdate).not.toHaveBeenCalled();
  });

  test("no live subscription → no_subscription, never calls Stripe", async () => {
    seat({ role: "OWNER", stripeSubscriptionId: null });
    const url = await runExpectingRedirect(form("true"));
    expect(url).toContain("billing_error=no_subscription");
    expect(stripeUpdate).not.toHaveBeenCalled();
  });

  test("OWNER + active sub → cancels at period end + optimistic write", async () => {
    seat({ role: "OWNER", stripeSubscriptionId: "sub_1" });
    const url = await runExpectingRedirect(form("true"));
    expect(stripeUpdate).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: true,
    });
    expect(agencyUpdate).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { cancelAtPeriodEnd: true },
    });
    expect(url).toContain("plan_canceled=1");
  });

  test("ADMIN + resume → clears cancel_at_period_end", async () => {
    seat({ role: "ADMIN", stripeSubscriptionId: "sub_1" });
    const url = await runExpectingRedirect(form("false"));
    expect(stripeUpdate).toHaveBeenCalledWith("sub_1", {
      cancel_at_period_end: false,
    });
    expect(agencyUpdate).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { cancelAtPeriodEnd: false },
    });
    expect(url).toContain("plan_resumed=1");
  });

  test("rate-limited → backs off before touching Stripe", async () => {
    seat({ role: "OWNER", stripeSubscriptionId: "sub_1" });
    rateLimitAction.mockResolvedValue({ limited: true, retryAfter: 30 });
    const url = await runExpectingRedirect(form("true"));
    expect(url).toContain("billing_error=rate_limited");
    expect(stripeUpdate).not.toHaveBeenCalled();
  });

  test("invalid input (bad cancel value) → invalid_input, never calls Stripe", async () => {
    const fd = new FormData();
    fd.set("cancel", "maybe");
    fd.set("locale", "en");
    const url = await runExpectingRedirect(fd);
    expect(url).toContain("billing_error=invalid_input");
    expect(stripeUpdate).not.toHaveBeenCalled();
  });
});
