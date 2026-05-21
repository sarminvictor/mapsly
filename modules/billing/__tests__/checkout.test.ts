// Unit tests for createCheckoutSession.
//
// Mocks `@/lib/prisma` (in-memory user/agency store) + `@/lib/stripe` (records
// every call) so we cover the contract without hitting Neon or Stripe.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ─── In-memory DB seam ─────────────────────────────────────────────────────

type AgencyRole = "OWNER" | "ADMIN" | "STAFF";

interface FakeUser {
  id: string;
  email: string;
  name: string | null;
  stripeCustomerId: string | null;
  agencyId: string | null;
  agencyRole: AgencyRole | null;
}
interface FakeAgency {
  id: string;
  name: string;
  stripeCustomerId: string | null;
}
const db = {
  users: new Map<string, FakeUser>(),
  agencies: new Map<string, FakeAgency>(),
  reset() {
    this.users.clear();
    this.agencies.clear();
  },
};

vi.mock("@/lib/prisma", () => ({
  default: {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const u = db.users.get(where.id);
        if (!u) return null;
        const agency = u.agencyId ? db.agencies.get(u.agencyId) : undefined;
        return {
          id: u.id,
          email: u.email,
          name: u.name,
          stripeCustomerId: u.stripeCustomerId,
          agencyMembers: u.agencyId
            ? [
                {
                  agencyId: u.agencyId,
                  role: u.agencyRole ?? "OWNER",
                  agency: agency
                    ? {
                        id: agency.id,
                        name: agency.name,
                        stripeCustomerId: agency.stripeCustomerId,
                      }
                    : null,
                },
              ]
            : [],
        };
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { stripeCustomerId?: string };
        }) => {
          const u = db.users.get(where.id);
          if (!u) throw new Error("user not found");
          if (data.stripeCustomerId !== undefined) {
            u.stripeCustomerId = data.stripeCustomerId;
          }
          return u;
        },
      ),
    },
    agency: {
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { stripeCustomerId?: string };
        }) => {
          const a = db.agencies.get(where.id);
          if (!a) throw new Error("agency not found");
          if (data.stripeCustomerId !== undefined) {
            a.stripeCustomerId = data.stripeCustomerId;
          }
          return a;
        },
      ),
    },
  },
}));

// ─── Stripe seam ───────────────────────────────────────────────────────────

interface RecordedCustomerCreate {
  email?: string;
  name?: string;
  metadata?: Record<string, string>;
}
interface RecordedSessionCreate {
  mode: string;
  customer: string;
  client_reference_id: string;
  line_items: Array<{ price: string; quantity: number }>;
  success_url: string;
  cancel_url: string;
  metadata: Record<string, string>;
  subscription_data?: { metadata: Record<string, string> };
  allow_promotion_codes?: boolean;
}

const stripeCalls = {
  customers: [] as RecordedCustomerCreate[],
  sessions: [] as RecordedSessionCreate[],
  nextCustomerId: 1,
  nextSessionId: 1,
  reset() {
    this.customers = [];
    this.sessions = [];
    this.nextCustomerId = 1;
    this.nextSessionId = 1;
  },
};

vi.mock("@/lib/stripe", () => ({
  default: {
    customers: {
      create: vi.fn(async (params: RecordedCustomerCreate) => {
        stripeCalls.customers.push(params);
        const id = `cus_test_${stripeCalls.nextCustomerId++}`;
        return { id, email: params.email, name: params.name };
      }),
    },
    checkout: {
      sessions: {
        create: vi.fn(async (params: RecordedSessionCreate) => {
          stripeCalls.sessions.push(params);
          const id = `cs_test_${stripeCalls.nextSessionId++}`;
          return {
            id,
            url: `https://checkout.stripe.com/c/pay/${id}`,
            customer: params.customer,
          };
        }),
      },
    },
  },
}));

// ─── Set test price IDs (consumed lazily by getPriceId at call time) ───────

const ENV_KEYS = [
  "STRIPE_PRICE_SMB_PAID",
  "STRIPE_PRICE_AGENCY_SOLO",
  "STRIPE_PRICE_AGENCY_GROWTH",
  "STRIPE_PRICE_AGENCY_PRO",
  "STRIPE_PRICE_AGENCY_BOUTIQUE",
  "NEXT_PUBLIC_APP_URL",
  "NODE_ENV",
] as const;
const envSnapshot: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) envSnapshot[k] = process.env[k];
  process.env.STRIPE_PRICE_SMB_PAID = "price_smb_29";
  process.env.STRIPE_PRICE_AGENCY_SOLO = "price_agency_49";
  process.env.STRIPE_PRICE_AGENCY_GROWTH = "price_agency_99";
  process.env.STRIPE_PRICE_AGENCY_PRO = "price_agency_249";
  process.env.STRIPE_PRICE_AGENCY_BOUTIQUE = "price_agency_499";
  // Test allow-list anchor — all "happy path" tests use app.mapsly.ai which
  // matches NEXT_PUBLIC_APP_URL=https://app.mapsly.ai.
  process.env.NEXT_PUBLIC_APP_URL = "https://app.mapsly.ai";
  db.reset();
  stripeCalls.reset();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = envSnapshot[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.clearAllMocks();
});

// ─── Import under test AFTER mocks are registered ──────────────────────────

import {
  CheckoutError,
  createCheckoutSession,
} from "../checkout";

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("createCheckoutSession · SMB plan", () => {
  test("creates a Stripe customer + session for a user with no prior customerId", async () => {
    db.users.set("u1", {
      id: "u1",
      email: "maria@spa.example",
      name: "Maria",
      stripeCustomerId: null,
      agencyId: null,
      agencyRole: null,
    });

    const out = await createCheckoutSession({
      userId: "u1",
      plan: "smb_paid",
      returnUrl: "https://app.mapsly.ai/billing/return",
    });

    expect(out.sessionId).toMatch(/^cs_test_/);
    expect(out.sessionUrl).toMatch(/^https:\/\/checkout\.stripe\.com/);
    expect(out.customerId).toMatch(/^cus_test_/);

    expect(stripeCalls.customers).toHaveLength(1);
    expect(stripeCalls.customers[0]).toMatchObject({
      email: "maria@spa.example",
      name: "Maria",
      metadata: { userId: "u1", audience: "smb" },
    });

    expect(stripeCalls.sessions).toHaveLength(1);
    const sess = stripeCalls.sessions[0];
    expect(sess.mode).toBe("subscription");
    expect(sess.line_items).toEqual([
      { price: "price_smb_29", quantity: 1 },
    ]);
    expect(sess.client_reference_id).toBe("u1");
    expect(sess.metadata).toMatchObject({
      userId: "u1",
      plan: "smb_paid",
      audience: "smb",
    });
    expect(sess.subscription_data?.metadata).toEqual(sess.metadata);
    expect(sess.success_url).toContain("checkout=success");
    expect(sess.cancel_url).toContain("canceled=1");

    // Customer id persisted to DB.
    expect(db.users.get("u1")?.stripeCustomerId).toBe(out.customerId);
  });

  test("reuses existing Stripe customerId when User.stripeCustomerId is set", async () => {
    db.users.set("u2", {
      id: "u2",
      email: "carlos@spa.example",
      name: null,
      stripeCustomerId: "cus_existing_smb",
      agencyId: null,
      agencyRole: null,
    });

    const out = await createCheckoutSession({
      userId: "u2",
      plan: "smb_paid",
      returnUrl: "https://app.mapsly.ai/billing/return",
    });

    expect(out.customerId).toBe("cus_existing_smb");
    // Importantly: no new Stripe customer call was made.
    expect(stripeCalls.customers).toHaveLength(0);
    expect(stripeCalls.sessions).toHaveLength(1);
    expect(stripeCalls.sessions[0].customer).toBe("cus_existing_smb");
  });
});

describe("createCheckoutSession · agency plans", () => {
  test("creates a Stripe customer attached to the Agency, not the User", async () => {
    db.agencies.set("a1", {
      id: "a1",
      name: "Anchor Local",
      stripeCustomerId: null,
    });
    db.users.set("u3", {
      id: "u3",
      email: "tom@anchor.example",
      name: "Tom",
      stripeCustomerId: null,
      agencyId: "a1",
      agencyRole: "OWNER",
    });

    const out = await createCheckoutSession({
      userId: "u3",
      plan: "agency_growth",
      returnUrl: "https://app.mapsly.ai/billing/return",
    });

    expect(stripeCalls.customers).toHaveLength(1);
    expect(stripeCalls.customers[0]).toMatchObject({
      email: "tom@anchor.example",
      name: "Anchor Local",
      metadata: {
        agencyId: "a1",
        audience: "agency",
        initiatedByUserId: "u3",
      },
    });

    // Stored on Agency, NOT on User.
    expect(db.agencies.get("a1")?.stripeCustomerId).toBe(out.customerId);
    expect(db.users.get("u3")?.stripeCustomerId).toBeNull();

    const sess = stripeCalls.sessions[0];
    expect(sess.line_items[0].price).toBe("price_agency_99");
    expect(sess.metadata).toMatchObject({
      userId: "u3",
      agencyId: "a1",
      plan: "agency_growth",
      audience: "agency",
    });
  });

  test("reuses Agency.stripeCustomerId when already set", async () => {
    db.agencies.set("a2", {
      id: "a2",
      name: "Boutique Co",
      stripeCustomerId: "cus_existing_agency",
    });
    db.users.set("u4", {
      id: "u4",
      email: "owner@boutique.example",
      name: "Owner",
      stripeCustomerId: null,
      agencyId: "a2",
      agencyRole: "OWNER",
    });

    const out = await createCheckoutSession({
      userId: "u4",
      plan: "agency_boutique",
      returnUrl: "https://app.mapsly.ai/billing/return",
    });

    expect(out.customerId).toBe("cus_existing_agency");
    expect(stripeCalls.customers).toHaveLength(0);
  });

  test("rejects agency_* plan when user belongs to no agency", async () => {
    db.users.set("u5", {
      id: "u5",
      email: "lonely@example.com",
      name: null,
      stripeCustomerId: null,
      agencyId: null,
      agencyRole: null,
    });

    await expect(
      createCheckoutSession({
        userId: "u5",
        plan: "agency_solo",
        returnUrl: "https://app.mapsly.ai/billing/return",
      }),
    ).rejects.toMatchObject({
      name: "CheckoutError",
      code: "agency_required",
    });

    expect(stripeCalls.customers).toHaveLength(0);
    expect(stripeCalls.sessions).toHaveLength(0);
  });

  test("rejects when user's agency membership has STAFF role", async () => {
    db.agencies.set("a3", {
      id: "a3",
      name: "Anchor Local",
      stripeCustomerId: null,
    });
    db.users.set("u_staff", {
      id: "u_staff",
      email: "staffer@anchor.example",
      name: "Staffer",
      stripeCustomerId: null,
      agencyId: "a3",
      agencyRole: "STAFF",
    });

    await expect(
      createCheckoutSession({
        userId: "u_staff",
        plan: "agency_growth",
        returnUrl: "https://app.mapsly.ai/billing/return",
      }),
    ).rejects.toMatchObject({
      name: "CheckoutError",
      code: "agency_role_required",
    });

    // No Stripe writes should have happened.
    expect(stripeCalls.customers).toHaveLength(0);
    expect(stripeCalls.sessions).toHaveLength(0);
    // And no DB write to Agency.stripeCustomerId either.
    expect(db.agencies.get("a3")?.stripeCustomerId).toBeNull();
  });

  test("ADMIN role is allowed to start agency billing", async () => {
    db.agencies.set("a4", {
      id: "a4",
      name: "Anchor Local",
      stripeCustomerId: null,
    });
    db.users.set("u_admin", {
      id: "u_admin",
      email: "admin@anchor.example",
      name: "Admin",
      stripeCustomerId: null,
      agencyId: "a4",
      agencyRole: "ADMIN",
    });

    const out = await createCheckoutSession({
      userId: "u_admin",
      plan: "agency_solo",
      returnUrl: "https://app.mapsly.ai/billing/return",
    });

    expect(out.sessionId).toMatch(/^cs_test_/);
    expect(stripeCalls.sessions).toHaveLength(1);
  });
});

describe("createCheckoutSession · validation errors", () => {
  test("throws CheckoutError(user_not_found) for unknown userId", async () => {
    await expect(
      createCheckoutSession({
        userId: "ghost",
        plan: "smb_paid",
        returnUrl: "https://app.mapsly.ai/billing/return",
      }),
    ).rejects.toBeInstanceOf(CheckoutError);
  });

  test("rejects non-URL returnUrl", async () => {
    db.users.set("u6", {
      id: "u6",
      email: "x@y.com",
      name: null,
      stripeCustomerId: "cus_1",
      agencyId: null,
      agencyRole: null,
    });
    await expect(
      createCheckoutSession({
        userId: "u6",
        plan: "smb_paid",
        returnUrl: "not-a-url",
      }),
    ).rejects.toMatchObject({ code: "invalid_return_url" });
  });

  test("rejects non-http(s) protocol", async () => {
    db.users.set("u7", {
      id: "u7",
      email: "x@y.com",
      name: null,
      stripeCustomerId: "cus_1",
      agencyId: null,
      agencyRole: null,
    });
    await expect(
      createCheckoutSession({
        userId: "u7",
        plan: "smb_paid",
        returnUrl: "javascript:alert(1)",
      }),
    ).rejects.toMatchObject({ code: "invalid_return_url" });
  });
});

describe("createCheckoutSession · returnUrl host allow-list", () => {
  // Shared SMB user used across these tests — has an existing customer id
  // so no Stripe.customers.create call clutters the recorded sessions.
  function seedUser(id: string) {
    db.users.set(id, {
      id,
      email: `${id}@example.com`,
      name: null,
      stripeCustomerId: `cus_${id}`,
      agencyId: null,
      agencyRole: null,
    });
  }

  test("accepts NEXT_PUBLIC_APP_URL host", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://mapsly.ai";
    seedUser("u_app");
    const out = await createCheckoutSession({
      userId: "u_app",
      plan: "smb_paid",
      returnUrl: "https://mapsly.ai/billing/return",
    });
    expect(out.sessionId).toMatch(/^cs_test_/);
  });

  test("accepts the www. variant of the NEXT_PUBLIC_APP_URL host", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://mapsly.ai";
    seedUser("u_www");
    const out = await createCheckoutSession({
      userId: "u_www",
      plan: "smb_paid",
      returnUrl: "https://www.mapsly.ai/billing/return",
    });
    expect(out.sessionId).toMatch(/^cs_test_/);
  });

  test("accepts *.vercel.app preview URLs", async () => {
    seedUser("u_vercel");
    const out = await createCheckoutSession({
      userId: "u_vercel",
      plan: "smb_paid",
      returnUrl:
        "https://mapsly-git-auto-2026-05-21-g-1-1-mapsly.vercel.app/billing/return",
    });
    expect(out.sessionId).toMatch(/^cs_test_/);
  });

  test("accepts localhost in dev (NODE_ENV !== production)", async () => {
    process.env.NODE_ENV = "development";
    seedUser("u_local");
    const out = await createCheckoutSession({
      userId: "u_local",
      plan: "smb_paid",
      returnUrl: "http://localhost:3000/billing/return",
    });
    expect(out.sessionId).toMatch(/^cs_test_/);
  });

  test("accepts 127.0.0.1 in dev", async () => {
    process.env.NODE_ENV = "development";
    seedUser("u_loopback");
    const out = await createCheckoutSession({
      userId: "u_loopback",
      plan: "smb_paid",
      returnUrl: "http://127.0.0.1:3000/billing/return",
    });
    expect(out.sessionId).toMatch(/^cs_test_/);
  });

  test("rejects attacker-controlled host", async () => {
    seedUser("u_evil");
    await expect(
      createCheckoutSession({
        userId: "u_evil",
        plan: "smb_paid",
        returnUrl: "https://evil.example/phish",
      }),
    ).rejects.toMatchObject({ code: "invalid_return_url" });
    expect(stripeCalls.sessions).toHaveLength(0);
  });

  test("rejects look-alike host containing the app domain as suffix", async () => {
    // Defence against `https://mapsly.ai.evil.com/` — host comparison must be
    // exact, not a substring/suffix check.
    process.env.NEXT_PUBLIC_APP_URL = "https://mapsly.ai";
    seedUser("u_lookalike");
    await expect(
      createCheckoutSession({
        userId: "u_lookalike",
        plan: "smb_paid",
        returnUrl: "https://mapsly.ai.evil.com/billing/return",
      }),
    ).rejects.toMatchObject({ code: "invalid_return_url" });
    expect(stripeCalls.sessions).toHaveLength(0);
  });

  test("rejects http: outside localhost", async () => {
    seedUser("u_http");
    await expect(
      createCheckoutSession({
        userId: "u_http",
        plan: "smb_paid",
        returnUrl: "http://app.mapsly.ai/billing/return",
      }),
    ).rejects.toMatchObject({ code: "invalid_return_url" });
    expect(stripeCalls.sessions).toHaveLength(0);
  });

  test("rejects http://localhost in production", async () => {
    process.env.NODE_ENV = "production";
    seedUser("u_prod_local");
    await expect(
      createCheckoutSession({
        userId: "u_prod_local",
        plan: "smb_paid",
        returnUrl: "http://localhost:3000/billing/return",
      }),
    ).rejects.toMatchObject({ code: "invalid_return_url" });
  });
});
