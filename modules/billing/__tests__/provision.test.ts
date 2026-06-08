// Unit tests for provisionSmbFromCheckout — the find-or-create + claim logic
// behind both the post-payment auto-login and the webhook. Security-critical:
// the `matchedBy` discriminator gates whether the login path may auto-login.

import { beforeEach, describe, expect, test, vi } from "vitest";

// vi.hoisted so the mock factory (hoisted above imports) can reference `db`.
const db = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  landingPage: { findUnique: vi.fn() },
  business: { findUnique: vi.fn(), update: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ default: db }));

import { provisionSmbFromCheckout } from "../provision";

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockResolvedValue(null);
  db.user.create.mockImplementation(
    async ({ data }: { data: { stripeCustomerId: string } }) => ({
      id: "u_new",
      stripeCustomerId: data.stripeCustomerId,
    }),
  );
  db.user.update.mockResolvedValue({});
  db.landingPage.findUnique.mockResolvedValue(null);
  db.business.findUnique.mockResolvedValue(null);
  db.business.update.mockResolvedValue({});
});

describe("provisionSmbFromCheckout · user resolution", () => {
  test("new email → creates user, matchedBy 'new', lowercases the email", async () => {
    const r = await provisionSmbFromCheckout({
      email: "Maria@Example.com",
      customerId: "cus_1",
    });
    expect(db.user.create).toHaveBeenCalledOnce();
    expect(db.user.create.mock.calls[0][0].data.email).toBe(
      "maria@example.com",
    );
    expect(r.created).toBe(true);
    expect(r.matchedBy).toBe("new");
    expect(r.userId).toBe("u_new");
  });

  test("existing by stripeCustomerId → matchedBy 'customer', no create", async () => {
    db.user.findUnique.mockImplementation(
      async ({ where }: { where: { stripeCustomerId?: string } }) =>
        where.stripeCustomerId === "cus_1"
          ? { id: "u1", stripeCustomerId: "cus_1" }
          : null,
    );
    const r = await provisionSmbFromCheckout({
      email: "a@x.com",
      customerId: "cus_1",
    });
    expect(db.user.create).not.toHaveBeenCalled();
    expect(r.matchedBy).toBe("customer");
    expect(r.userId).toBe("u1");
  });

  test("existing by email (no customerId) → matchedBy 'email' + links the customer", async () => {
    db.user.findUnique.mockImplementation(
      async ({ where }: { where: { email?: string } }) =>
        where.email === "a@x.com" ? { id: "u2", stripeCustomerId: null } : null,
    );
    const r = await provisionSmbFromCheckout({
      email: "a@x.com",
      customerId: "cus_2",
    });
    expect(r.matchedBy).toBe("email"); // login path must refuse this
    expect(db.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u2" },
        data: { stripeCustomerId: "cus_2" },
      }),
    );
  });

  test("P2002 race on create → re-finds the winner instead of throwing", async () => {
    db.user.findUnique
      .mockResolvedValueOnce(null) // by customerId
      .mockResolvedValueOnce(null) // by email
      .mockResolvedValueOnce({ id: "u_winner", stripeCustomerId: "cus_6" }); // re-find
    db.user.create.mockRejectedValue({ code: "P2002" });
    const r = await provisionSmbFromCheckout({
      email: "race@x.com",
      customerId: "cus_6",
    });
    expect(r.userId).toBe("u_winner");
    expect(r.matchedBy).toBe("customer");
  });
});

describe("provisionSmbFromCheckout · business claim", () => {
  test("claims an unclaimed business via landingToken", async () => {
    db.landingPage.findUnique.mockResolvedValue({ businessId: "b1" });
    db.business.findUnique.mockResolvedValue({ ownerUserId: null });
    const r = await provisionSmbFromCheckout({
      email: "n@x.com",
      customerId: "cus_3",
      landingToken: "1234567890123456",
    });
    expect(db.business.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "b1" },
        data: { ownerUserId: "u_new", isClaimed: true },
      }),
    );
    expect(r.claimed).toBe(true);
    expect(r.businessId).toBe("b1");
  });

  test("NEVER steals an already-claimed business", async () => {
    db.landingPage.findUnique.mockResolvedValue({ businessId: "b1" });
    db.business.findUnique.mockResolvedValue({ ownerUserId: "someone-else" });
    const r = await provisionSmbFromCheckout({
      email: "n@x.com",
      customerId: "cus_4",
      landingToken: "1234567890123456",
    });
    expect(db.business.update).not.toHaveBeenCalled();
    expect(r.claimed).toBe(false);
    expect(r.businessId).toBe("b1");
  });

  test("no landingToken → no claim, businessId null", async () => {
    const r = await provisionSmbFromCheckout({
      email: "n@x.com",
      customerId: "cus_5",
    });
    expect(db.landingPage.findUnique).not.toHaveBeenCalled();
    expect(r.businessId).toBeNull();
    expect(r.claimed).toBe(false);
  });

  test("landingToken with no LandingPage → no throw, no claim", async () => {
    db.landingPage.findUnique.mockResolvedValue(null);
    const r = await provisionSmbFromCheckout({
      email: "n@x.com",
      customerId: "cus_7",
      landingToken: "1234567890123456",
    });
    expect(db.business.update).not.toHaveBeenCalled();
    expect(r.claimed).toBe(false);
  });
});
