// Unit tests for handleStripeEvent — the pure webhook dispatcher.
//
// We pass a fake PrismaSeam so each test fully observes the writes the
// handler attempts. The webhook handler is intentionally split from the
// route layer (which deals with signature verification + idempotency)
// so this file covers ONLY the event → DB-state mapping.

import { describe, expect, test, vi } from "vitest";
import type Stripe from "stripe";

import {
  handleStripeEvent,
  resolveGrantPeriodEnd,
  type PrismaSeam,
} from "../webhook";

// ─── Fake Prisma ────────────────────────────────────────────────────────────

interface FakeUser {
  id: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}
interface FakeAgency extends FakeUser {
  plan: "SOLO" | "GROWTH" | "AGENCY_PRO" | "BOUTIQUE";
}

function makePrisma(
  opts: { users?: FakeUser[]; agencies?: FakeAgency[] } = {},
) {
  const users = new Map<string, FakeUser>(
    (opts.users ?? []).map((u) => [u.id, u]),
  );
  const agencies = new Map<string, FakeAgency>(
    (opts.agencies ?? []).map((a) => [a.id, a]),
  );
  const userUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const agencyUpdates: Array<{ id: string; data: Record<string, unknown> }> =
    [];

  const seam: PrismaSeam = {
    user: {
      findFirst: vi.fn(async ({ where }) => {
        for (const u of users.values()) {
          if (
            where.stripeSubscriptionId &&
            u.stripeSubscriptionId === where.stripeSubscriptionId
          ) {
            return { id: u.id, stripeSubscriptionId: u.stripeSubscriptionId };
          }
          if (
            where.stripeCustomerId &&
            u.stripeCustomerId === where.stripeCustomerId
          ) {
            return { id: u.id, stripeSubscriptionId: u.stripeSubscriptionId };
          }
        }
        return null;
      }),
      update: vi.fn(async ({ where, data }) => {
        userUpdates.push({
          id: where.id,
          data: data as Record<string, unknown>,
        });
        const u = users.get(where.id);
        if (u && typeof data.stripeSubscriptionId !== "undefined") {
          u.stripeSubscriptionId = data.stripeSubscriptionId ?? null;
        }
        return u as unknown;
      }),
    },
    agency: {
      findFirst: vi.fn(async ({ where }) => {
        for (const a of agencies.values()) {
          if (
            where.stripeSubscriptionId &&
            a.stripeSubscriptionId === where.stripeSubscriptionId
          ) {
            return { id: a.id, stripeSubscriptionId: a.stripeSubscriptionId };
          }
          if (
            where.stripeCustomerId &&
            a.stripeCustomerId === where.stripeCustomerId
          ) {
            return { id: a.id, stripeSubscriptionId: a.stripeSubscriptionId };
          }
        }
        return null;
      }),
      update: vi.fn(async ({ where, data }) => {
        agencyUpdates.push({
          id: where.id,
          data: data as Record<string, unknown>,
        });
        const a = agencies.get(where.id);
        if (a && typeof data.stripeSubscriptionId !== "undefined") {
          a.stripeSubscriptionId = data.stripeSubscriptionId ?? null;
        }
        if (a && typeof data.plan !== "undefined") {
          a.plan = data.plan as FakeAgency["plan"];
        }
        return a as unknown;
      }),
    },
  };

  return { seam, userUpdates, agencyUpdates, users, agencies };
}

// ─── Event factories ────────────────────────────────────────────────────────

function checkoutCompleted(
  over: Partial<{
    subscription: string;
    customer: string;
    metadata: Record<string, string>;
    mode: string;
  }> = {},
): Stripe.Event {
  return {
    id: "evt_co_1",
    type: "checkout.session.completed",
    api_version: "2024-12-18.acacia",
    livemode: false,
    created: 1716220000,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    object: "event",
    data: {
      object: {
        id: "cs_test_1",
        object: "checkout.session",
        mode: over.mode ?? "subscription",
        customer: over.customer ?? "cus_test_1",
        subscription: over.subscription ?? "sub_test_1",
        metadata: over.metadata ?? {
          userId: "u1",
          plan: "smb_paid",
          audience: "smb",
        },
      } as unknown as Stripe.Checkout.Session,
    },
  } as Stripe.Event;
}

function subscriptionEvent(
  type:
    | "customer.subscription.created"
    | "customer.subscription.updated"
    | "customer.subscription.deleted",
  over: Partial<{
    id: string;
    customer: string;
    status: string;
    priceId: string;
    periodEnd: number;
    cancelAtPeriodEnd: boolean;
    metadata: Record<string, string>;
  }> = {},
): Stripe.Event {
  return {
    id: `evt_sub_${type}_1`,
    type,
    api_version: "2024-12-18.acacia",
    livemode: false,
    created: 1716220000,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    object: "event",
    data: {
      object: {
        id: over.id ?? "sub_test_1",
        object: "subscription",
        customer: over.customer ?? "cus_test_1",
        status: over.status ?? "active",
        cancel_at_period_end: over.cancelAtPeriodEnd ?? false,
        current_period_end: over.periodEnd ?? 1717000000,
        items: { data: [{ price: { id: over.priceId ?? "price_smb_29" } }] },
        metadata: over.metadata ?? {
          userId: "u1",
          plan: "smb_paid",
          audience: "smb",
        },
      } as unknown as Stripe.Subscription,
    },
  } as Stripe.Event;
}

function invoiceEvent(
  type: "invoice.paid" | "invoice.payment_failed",
  over: Partial<{
    customer: string;
    subscription: string;
    periodEnd: number;
    audience: string;
  }> = {},
): Stripe.Event {
  return {
    id: `evt_${type}_1`,
    type,
    api_version: "2024-12-18.acacia",
    livemode: false,
    created: 1716220000,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    object: "event",
    data: {
      object: {
        id: "in_test_1",
        object: "invoice",
        customer: over.customer ?? "cus_test_1",
        subscription: over.subscription ?? "sub_test_1",
        subscription_details: {
          metadata: { audience: over.audience ?? "smb" },
        },
        lines: {
          data: [
            {
              period: { end: over.periodEnd ?? 1717000000, start: 0 },
              description: "Mapsly SMB",
            },
          ],
        },
      } as unknown as Stripe.Invoice,
    },
  } as Stripe.Event;
}

// ─── checkout.session.completed ─────────────────────────────────────────────

describe("handleStripeEvent · checkout.session.completed", () => {
  test("wires subscription id + plan onto an SMB user (matched by customerId)", async () => {
    const ctx = makePrisma({
      users: [
        {
          id: "u1",
          stripeCustomerId: "cus_test_1",
          stripeSubscriptionId: null,
        },
      ],
    });

    const out = await handleStripeEvent(checkoutCompleted(), ctx.seam);

    expect(out).toEqual({
      kind: "handled",
      event: "checkout.session.completed",
      targetType: "user",
      targetId: "u1",
    });
    expect(ctx.userUpdates).toHaveLength(1);
    expect(ctx.userUpdates[0].data).toMatchObject({
      stripeSubscriptionId: "sub_test_1",
      stripePlan: "smb_paid",
      cancelAtPeriodEnd: false,
    });
  });

  test("agency plan also updates Agency.plan tier", async () => {
    const ctx = makePrisma({
      agencies: [
        {
          id: "a1",
          stripeCustomerId: "cus_agency_1",
          stripeSubscriptionId: null,
          plan: "SOLO",
        },
      ],
    });

    const out = await handleStripeEvent(
      checkoutCompleted({
        customer: "cus_agency_1",
        subscription: "sub_agency_1",
        metadata: { agencyId: "a1", plan: "agency_growth", audience: "agency" },
      }),
      ctx.seam,
    );

    expect(out.kind).toBe("handled");
    expect(ctx.agencyUpdates).toHaveLength(1);
    expect(ctx.agencyUpdates[0].data).toMatchObject({
      stripeSubscriptionId: "sub_agency_1",
      stripePlan: "agency_growth",
      plan: "GROWTH",
    });
  });

  // B1 · the new credit-billing checkout writes metadata.planKey (display key),
  // NOT metadata.plan (legacy literal). Before the fix these mapped to no plan →
  // the upsert was skipped → Agency.plan stayed SOLO → a Scale buyer got 900
  // credits. Each display key must resolve to the right tier.
  test.each([
    ["starter", "SOLO", "agency_solo"],
    ["solo", "AGENCY_PRO", "agency_pro"], // $49 tier added 2026-07-09
    ["growth", "GROWTH", "agency_growth"],
    ["scale", "BOUTIQUE", "agency_boutique"],
  ] as const)(
    "planKey=%s resolves Agency.plan → %s",
    async (planKey, tier, legacyLiteral) => {
      const ctx = makePrisma({
        agencies: [
          {
            id: "a1",
            stripeCustomerId: "cus_agency_1",
            stripeSubscriptionId: null,
            plan: "SOLO",
          },
        ],
      });

      const out = await handleStripeEvent(
        checkoutCompleted({
          customer: "cus_agency_1",
          subscription: "sub_agency_1",
          // NOTE: no `plan` key — only the new `planKey`.
          metadata: { agencyId: "a1", planKey, audience: "agency" },
        }),
        ctx.seam,
      );

      expect(out.kind).toBe("handled");
      expect(ctx.agencyUpdates[0].data).toMatchObject({
        plan: tier,
        stripePlan: legacyLiteral,
      });
    },
  );

  test("planKey also flows through subscription.updated (renewal/upgrade)", async () => {
    const ctx = makePrisma({
      agencies: [
        {
          id: "a1",
          stripeCustomerId: "cus_agency_1",
          stripeSubscriptionId: "sub_agency_1",
          plan: "SOLO",
        },
      ],
    });

    const out = await handleStripeEvent(
      subscriptionEvent("customer.subscription.updated", {
        id: "sub_agency_1",
        customer: "cus_agency_1",
        metadata: { agencyId: "a1", planKey: "scale", audience: "agency" },
      }),
      ctx.seam,
    );

    expect(out.kind).toBe("handled");
    expect(ctx.agencyUpdates[0].data).toMatchObject({ plan: "BOUTIQUE" });
  });

  test("ignores non-subscription mode sessions (one-time payment)", async () => {
    const ctx = makePrisma({
      users: [
        {
          id: "u1",
          stripeCustomerId: "cus_test_1",
          stripeSubscriptionId: null,
        },
      ],
    });

    const out = await handleStripeEvent(
      checkoutCompleted({ mode: "payment" }),
      ctx.seam,
    );

    expect(out.kind).toBe("ignored");
    expect(ctx.userUpdates).toHaveLength(0);
  });

  test("skips when plan literal is unknown (logs no write)", async () => {
    const ctx = makePrisma({
      users: [
        {
          id: "u1",
          stripeCustomerId: "cus_test_1",
          stripeSubscriptionId: null,
        },
      ],
    });
    const out = await handleStripeEvent(
      checkoutCompleted({
        metadata: { userId: "u1", plan: "vip_supreme", audience: "smb" },
      }),
      ctx.seam,
    );
    expect(out.kind).toBe("skipped");
    expect(out.event).toBe("checkout.session.completed");
    expect(ctx.userUpdates).toHaveLength(0);
  });

  test("skips when no matching user/agency for the customer", async () => {
    const ctx = makePrisma({}); // no rows
    const out = await handleStripeEvent(checkoutCompleted(), ctx.seam);
    expect(out.kind).toBe("skipped");
    expect(ctx.userUpdates).toHaveLength(0);
    expect(ctx.agencyUpdates).toHaveLength(0);
  });

  test("regression · metadata.agencyId alone does NOT match an unrelated agency (must require customer/subscription correspondence)", async () => {
    // An agency exists in DB but its stripeCustomerId does NOT match the
    // session.customer that arrived. Even if metadata.agencyId points at
    // this row, we must NOT write to it — the customer correspondence is
    // the safety net (see findTarget docstring).
    const ctx = makePrisma({
      agencies: [
        {
          id: "a1",
          stripeCustomerId: "cus_OTHER_AGENCY",
          stripeSubscriptionId: null,
          plan: "SOLO",
        },
      ],
    });

    const out = await handleStripeEvent(
      checkoutCompleted({
        customer: "cus_ATTACKER_CONTROLLED",
        subscription: "sub_attacker_1",
        metadata: { agencyId: "a1", plan: "agency_pro", audience: "agency" },
      }),
      ctx.seam,
    );

    expect(out.kind).toBe("skipped");
    expect(ctx.agencyUpdates).toHaveLength(0);
    // Verify the underlying agency was NOT touched
    expect(ctx.agencies.get("a1")?.plan).toBe("SOLO");
    expect(ctx.agencies.get("a1")?.stripeSubscriptionId).toBeNull();
  });
});

// ─── customer.subscription.created / updated ────────────────────────────────

describe("handleStripeEvent · customer.subscription.updated", () => {
  test("syncs status + priceId + currentPeriodEnd onto matching user", async () => {
    const ctx = makePrisma({
      users: [
        {
          id: "u1",
          stripeCustomerId: "cus_test_1",
          stripeSubscriptionId: "sub_test_1",
        },
      ],
    });

    const out = await handleStripeEvent(
      subscriptionEvent("customer.subscription.updated", {
        status: "active",
        priceId: "price_smb_29",
        periodEnd: 1717000000,
        cancelAtPeriodEnd: true,
      }),
      ctx.seam,
    );

    expect(out.kind).toBe("handled");
    expect(ctx.userUpdates).toHaveLength(1);
    expect(ctx.userUpdates[0].data).toMatchObject({
      stripeStatus: "active",
      stripePriceId: "price_smb_29",
      cancelAtPeriodEnd: true,
    });
    // currentPeriodEnd was converted from unix seconds to Date
    expect(ctx.userUpdates[0].data.currentPeriodEnd).toBeInstanceOf(Date);
    expect((ctx.userUpdates[0].data.currentPeriodEnd as Date).getTime()).toBe(
      1717000000 * 1000,
    );
  });

  test("agency upgrade flips Agency.plan enum", async () => {
    const ctx = makePrisma({
      agencies: [
        {
          id: "a1",
          stripeCustomerId: "cus_agency_1",
          stripeSubscriptionId: "sub_agency_1",
          plan: "SOLO",
        },
      ],
    });

    await handleStripeEvent(
      subscriptionEvent("customer.subscription.updated", {
        id: "sub_agency_1",
        customer: "cus_agency_1",
        priceId: "price_agency_249",
        metadata: { agencyId: "a1", plan: "agency_pro", audience: "agency" },
      }),
      ctx.seam,
    );

    expect(ctx.agencyUpdates[0].data).toMatchObject({
      plan: "AGENCY_PRO",
      stripePlan: "agency_pro",
      stripePriceId: "price_agency_249",
    });
  });
});

// ─── customer.subscription.deleted ──────────────────────────────────────────

describe("handleStripeEvent · customer.subscription.deleted", () => {
  test("clears subscription state on user", async () => {
    const ctx = makePrisma({
      users: [
        {
          id: "u1",
          stripeCustomerId: "cus_test_1",
          stripeSubscriptionId: "sub_test_1",
        },
      ],
    });

    await handleStripeEvent(
      subscriptionEvent("customer.subscription.deleted", {
        status: "canceled",
      }),
      ctx.seam,
    );

    expect(ctx.userUpdates[0].data).toMatchObject({
      stripeSubscriptionId: null,
      stripeStatus: "canceled",
      stripePriceId: null,
      stripePlan: null,
      cancelAtPeriodEnd: false,
    });
  });

  test("downgrades agency to SOLO sentinel", async () => {
    const ctx = makePrisma({
      agencies: [
        {
          id: "a1",
          stripeCustomerId: "cus_agency_1",
          stripeSubscriptionId: "sub_agency_1",
          plan: "BOUTIQUE",
        },
      ],
    });

    await handleStripeEvent(
      subscriptionEvent("customer.subscription.deleted", {
        id: "sub_agency_1",
        customer: "cus_agency_1",
        status: "canceled",
        metadata: {
          agencyId: "a1",
          plan: "agency_boutique",
          audience: "agency",
        },
      }),
      ctx.seam,
    );

    expect(ctx.agencyUpdates[0].data).toMatchObject({
      stripeSubscriptionId: null,
      plan: "SOLO",
    });
  });
});

// ─── invoice.paid ───────────────────────────────────────────────────────────

describe("handleStripeEvent · invoice.paid", () => {
  test("refreshes currentPeriodEnd from the line-item period.end", async () => {
    const ctx = makePrisma({
      users: [
        {
          id: "u1",
          stripeCustomerId: "cus_test_1",
          stripeSubscriptionId: "sub_test_1",
        },
      ],
    });

    const out = await handleStripeEvent(
      invoiceEvent("invoice.paid", { periodEnd: 1717999999 }),
      ctx.seam,
    );

    expect(out.kind).toBe("handled");
    expect(ctx.userUpdates[0].data).toMatchObject({ stripeStatus: "active" });
    expect((ctx.userUpdates[0].data.currentPeriodEnd as Date).getTime()).toBe(
      1717999999 * 1000,
    );
  });

  test("ignores invoices with no subscription (one-off charges)", async () => {
    const ctx = makePrisma({});
    const out = await handleStripeEvent(
      invoiceEvent("invoice.paid", { subscription: "" }),
      ctx.seam,
    );
    expect(out.kind).toBe("ignored");
  });
});

// ─── invoice.payment_failed ─────────────────────────────────────────────────

describe("handleStripeEvent · invoice.payment_failed", () => {
  test("marks status past_due without revoking subscription id", async () => {
    const ctx = makePrisma({
      users: [
        {
          id: "u1",
          stripeCustomerId: "cus_test_1",
          stripeSubscriptionId: "sub_test_1",
        },
      ],
    });

    await handleStripeEvent(invoiceEvent("invoice.payment_failed"), ctx.seam);

    expect(ctx.userUpdates[0].data).toEqual({ stripeStatus: "past_due" });
  });
});

// ─── Unhandled event types ──────────────────────────────────────────────────

describe("handleStripeEvent · unhandled types", () => {
  test("returns ignored for events we don't subscribe to", async () => {
    const ctx = makePrisma({});
    const out = await handleStripeEvent(
      {
        id: "evt_random",
        type: "charge.refunded",
        api_version: "2024-12-18.acacia",
        livemode: false,
        created: 1,
        pending_webhooks: 0,
        request: { id: null, idempotency_key: null },
        object: "event",
        data: { object: {} as unknown as Stripe.Charge },
      } as Stripe.Event,
      ctx.seam,
    );
    expect(out).toEqual({
      kind: "ignored",
      event: "charge.refunded",
      reason: "unhandled_event_type",
    });
    expect(ctx.userUpdates).toHaveLength(0);
    expect(ctx.agencyUpdates).toHaveLength(0);
  });
});

// ─── resolveGrantPeriodEnd · first-purchase dedupe-key alignment ─────────────
//
// The plan-credit grant dedupes on the billing-period anchor. On a FIRST
// purchase, checkout.session.completed arrives before the agency row carries
// currentPeriodEnd — the resolver must fetch the subscription's period from
// Stripe so checkout + subscription.created + invoice.paid all share ONE
// dedupe key (the old event-id fallback wrote a duplicate ledger row).

function checkoutEvent(subscription: string | null): Stripe.Event {
  return {
    id: "evt_checkout_1",
    type: "checkout.session.completed",
    api_version: "2024-12-18.acacia",
    livemode: false,
    created: 1,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    object: "event",
    data: {
      object: { subscription } as unknown as Stripe.Checkout.Session,
    },
  } as Stripe.Event;
}

const PERIOD_END_TS = 1_790_000_000; // unix seconds

describe("resolveGrantPeriodEnd", () => {
  test("agency period wins when present — no Stripe call", async () => {
    const retrieve = vi.fn();
    const anchor = new Date("2026-08-09T00:00:00Z");
    const out = await resolveGrantPeriodEnd(
      checkoutEvent("sub_1"),
      anchor,
      retrieve,
    );
    expect(out).toBe(anchor);
    expect(retrieve).not.toHaveBeenCalled();
  });

  test("checkout-first purchase resolves the period from the subscription", async () => {
    const retrieve = vi.fn(async () => ({
      current_period_end: PERIOD_END_TS,
      items: { data: [] },
    })) as unknown as (id: string) => Promise<Stripe.Subscription>;
    const out = await resolveGrantPeriodEnd(
      checkoutEvent("sub_1"),
      null,
      retrieve,
    );
    expect(out).toEqual(new Date(PERIOD_END_TS * 1000));
    // The invariant: this ISO key equals what invoice.paid later dedupes on,
    // so the first purchase writes exactly ONE plan-grant ledger row.
  });

  test("retrieve failure falls back to null (event-id key) — never throws", async () => {
    const retrieve = vi.fn(async () => {
      throw new Error("stripe down");
    }) as unknown as (id: string) => Promise<Stripe.Subscription>;
    await expect(
      resolveGrantPeriodEnd(checkoutEvent("sub_1"), null, retrieve),
    ).resolves.toBeNull();
  });

  test("checkout with no subscription id → null", async () => {
    const retrieve = vi.fn();
    await expect(
      resolveGrantPeriodEnd(checkoutEvent(null), null, retrieve),
    ).resolves.toBeNull();
    expect(retrieve).not.toHaveBeenCalled();
  });

  test("non-checkout events never trigger a Stripe call", async () => {
    const retrieve = vi.fn();
    const evt = {
      ...checkoutEvent("sub_1"),
      type: "invoice.paid",
    } as Stripe.Event;
    await expect(
      resolveGrantPeriodEnd(evt, null, retrieve),
    ).resolves.toBeNull();
    expect(retrieve).not.toHaveBeenCalled();
  });

  test("Basil API shape: item-level current_period_end is read when top-level is absent", async () => {
    // Stripe 2025-03+ (Basil) moved current_period_end onto items.data[] —
    // subscriptionPeriodEnd reads both; lock the item-level fallback in.
    const retrieve = vi.fn(async () => ({
      items: { data: [{ current_period_end: PERIOD_END_TS }] },
    })) as unknown as (id: string) => Promise<Stripe.Subscription>;
    const out = await resolveGrantPeriodEnd(
      checkoutEvent("sub_1"),
      null,
      retrieve,
    );
    expect(out).toEqual(new Date(PERIOD_END_TS * 1000));
  });
});
