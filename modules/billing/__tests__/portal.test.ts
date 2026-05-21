// Unit tests for createPortalSession.
//
// Mocks @/lib/prisma + @/lib/stripe to cover the resolution order
// (agency customer first, fallback to user customer) and the role gate
// (STAFF can't open the portal). Mirrors the structure of checkout.test.ts.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type AgencyRole = "OWNER" | "ADMIN" | "STAFF";

interface FakeUser {
  id: string;
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
    },
  },
}));

interface RecordedPortalCreate {
  customer: string;
  return_url: string;
}

const stripeCalls = {
  portals: [] as RecordedPortalCreate[],
  nextSessionId: 1,
  reset() {
    this.portals = [];
    this.nextSessionId = 1;
  },
};

vi.mock("@/lib/stripe", () => ({
  default: {
    billingPortal: {
      sessions: {
        create: vi.fn(async (params: RecordedPortalCreate) => {
          stripeCalls.portals.push(params);
          const id = `bps_test_${stripeCalls.nextSessionId++}`;
          return {
            id,
            url: `https://billing.stripe.com/p/session/${id}`,
            customer: params.customer,
            return_url: params.return_url,
          };
        }),
      },
    },
  },
}));

const ENV_KEYS = ["NEXT_PUBLIC_APP_URL", "NODE_ENV"] as const;
const snapshot: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
  {};

beforeEach(() => {
  for (const k of ENV_KEYS) snapshot[k] = process.env[k];
  process.env.NEXT_PUBLIC_APP_URL = "https://app.mapsly.ai";
  // @ts-expect-error -- writable for test
  process.env.NODE_ENV = "test";
  db.reset();
  stripeCalls.reset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (snapshot[k] === undefined) delete process.env[k];
    else process.env[k] = snapshot[k]!;
  }
  vi.clearAllMocks();
});

describe("createPortalSession", () => {
  test("opens portal for agency customer when user is OWNER", async () => {
    const { createPortalSession } = await import("../portal");
    db.users.set("u1", {
      id: "u1",
      stripeCustomerId: "cus_user",
      agencyId: "a1",
      agencyRole: "OWNER",
    });
    db.agencies.set("a1", {
      id: "a1",
      name: "Anchor",
      stripeCustomerId: "cus_agency",
    });

    const result = await createPortalSession({
      userId: "u1",
      returnUrl: "https://app.mapsly.ai/settings/billing",
    });

    expect(result.audience).toBe("agency");
    expect(result.customerId).toBe("cus_agency");
    expect(stripeCalls.portals).toHaveLength(1);
    expect(stripeCalls.portals[0]?.customer).toBe("cus_agency");
  });

  test("opens portal for user customer when no agency customer", async () => {
    const { createPortalSession } = await import("../portal");
    db.users.set("u1", {
      id: "u1",
      stripeCustomerId: "cus_user",
      agencyId: null,
      agencyRole: null,
    });

    const result = await createPortalSession({
      userId: "u1",
      returnUrl: "https://app.mapsly.ai/settings/billing",
    });

    expect(result.audience).toBe("smb");
    expect(result.customerId).toBe("cus_user");
  });

  test("STAFF on paying agency gets agency_role_required", async () => {
    const { createPortalSession, PortalError } = await import("../portal");
    db.users.set("u1", {
      id: "u1",
      stripeCustomerId: null,
      agencyId: "a1",
      agencyRole: "STAFF",
    });
    db.agencies.set("a1", {
      id: "a1",
      name: "Anchor",
      stripeCustomerId: "cus_agency",
    });

    await expect(
      createPortalSession({
        userId: "u1",
        returnUrl: "https://app.mapsly.ai/settings/billing",
      }),
    ).rejects.toMatchObject({
      name: "PortalError",
      code: "agency_role_required",
    });
    expect(stripeCalls.portals).toHaveLength(0);
    // Sanity: PortalError is exported
    expect(PortalError).toBeDefined();
  });

  test("no Stripe customer at all throws no_customer", async () => {
    const { createPortalSession } = await import("../portal");
    db.users.set("u1", {
      id: "u1",
      stripeCustomerId: null,
      agencyId: null,
      agencyRole: null,
    });

    await expect(
      createPortalSession({
        userId: "u1",
        returnUrl: "https://app.mapsly.ai/settings/billing",
      }),
    ).rejects.toMatchObject({
      code: "no_customer",
    });
  });

  test("user not in DB throws user_not_found", async () => {
    const { createPortalSession } = await import("../portal");
    await expect(
      createPortalSession({
        userId: "missing",
        returnUrl: "https://app.mapsly.ai/settings/billing",
      }),
    ).rejects.toMatchObject({ code: "user_not_found" });
  });

  test("disallowed host throws invalid_return_url", async () => {
    const { createPortalSession } = await import("../portal");
    db.users.set("u1", {
      id: "u1",
      stripeCustomerId: "cus_user",
      agencyId: null,
      agencyRole: null,
    });

    await expect(
      createPortalSession({
        userId: "u1",
        returnUrl: "https://evil.example.com/foo",
      }),
    ).rejects.toMatchObject({ code: "invalid_return_url" });
    expect(stripeCalls.portals).toHaveLength(0);
  });

  test("vercel.app preview host is allowed", async () => {
    const { createPortalSession } = await import("../portal");
    db.users.set("u1", {
      id: "u1",
      stripeCustomerId: "cus_user",
      agencyId: null,
      agencyRole: null,
    });

    const result = await createPortalSession({
      userId: "u1",
      returnUrl: "https://mapsly-pr-99.vercel.app/settings/billing",
    });
    expect(result.audience).toBe("smb");
  });

  test("ADMIN role allowed to open agency portal", async () => {
    const { createPortalSession } = await import("../portal");
    db.users.set("u1", {
      id: "u1",
      stripeCustomerId: null,
      agencyId: "a1",
      agencyRole: "ADMIN",
    });
    db.agencies.set("a1", {
      id: "a1",
      name: "Anchor",
      stripeCustomerId: "cus_agency",
    });

    const result = await createPortalSession({
      userId: "u1",
      returnUrl: "https://app.mapsly.ai/settings/billing",
    });
    expect(result.audience).toBe("agency");
  });
});
