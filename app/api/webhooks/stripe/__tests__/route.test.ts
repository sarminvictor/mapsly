// Integration tests for the Stripe webhook route handler.
//
// Validates the OUTER layer (signature verify + idempotency + 200/400/500
// status codes). The inner dispatch is covered by
// `modules/billing/__tests__/webhook.test.ts` so we keep this file focused
// on contract behaviour: what the route returns to Stripe, in which order
// it talks to Prisma, and that duplicate deliveries short-circuit.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ─── Mocks (must be registered before the route is imported) ────────────────

const stripeCalls = {
  constructEvent: vi.fn(),
};
vi.mock("@/lib/stripe", () => ({
  default: {
    webhooks: {
      constructEvent: (...args: unknown[]) =>
        stripeCalls.constructEvent(...args),
    },
  },
}));

interface FakeRow {
  id: string;
  eventId: string;
  type: string;
  processedAt: Date | null;
  error: string | null;
}
const db = {
  rows: new Map<string, FakeRow>(),
  reset() {
    this.rows.clear();
  },
};
vi.mock("@/lib/prisma", () => ({
  default: {
    stripeWebhookEvent: {
      create: vi.fn(
        async ({
          data,
          select,
        }: {
          data: { eventId: string; type: string };
          select: { id: true };
        }) => {
          if (
            Array.from(db.rows.values()).some((r) => r.eventId === data.eventId)
          ) {
            // Mimic Prisma's P2002 unique constraint error shape
            const err = new Error(
              "Unique constraint failed on the fields: (`eventId`)",
            ) as Error & { code?: string };
            err.code = "P2002";
            throw err;
          }
          const id = `whk_${db.rows.size + 1}`;
          db.rows.set(id, {
            id,
            eventId: data.eventId,
            type: data.type,
            processedAt: null,
            error: null,
          });
          return select ? { id } : (db.rows.get(id) as unknown);
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: { processedAt?: Date; error?: string | null };
        }) => {
          const r = db.rows.get(where.id);
          if (!r) throw new Error("row not found");
          if (typeof data.processedAt !== "undefined")
            r.processedAt = data.processedAt;
          if (typeof data.error !== "undefined") r.error = data.error;
          return r as unknown;
        },
      ),
    },
    user: {
      findFirst: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
    },
    agency: {
      findFirst: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
    },
  },
}));

// Rate-limit: always allow (avoid pulling in @vercel/kv during tests)
vi.mock("@/lib/middleware/rate-limit", () => ({
  rateLimit: vi.fn(async () => null),
  WEBHOOK_LIMIT: { limit: 200, window: "1 m", prefix: "rl:webhook:stripe" },
}));

const ENV_KEYS = ["STRIPE_WEBHOOK_SECRET"] as const;
const envSnapshot: Partial<
  Record<(typeof ENV_KEYS)[number], string | undefined>
> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) envSnapshot[k] = process.env[k];
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_super_secret";
  db.reset();
  stripeCalls.constructEvent.mockReset();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = envSnapshot[k];
    if (v === undefined) delete process.env[k];
    else (process.env as Record<string, string | undefined>)[k] = v;
  }
  vi.clearAllMocks();
});

// ─── Import the route after mocks are wired ─────────────────────────────────

import { POST } from "../route";

// ─── Helpers ────────────────────────────────────────────────────────────────

function req(body: string, signature: string | null) {
  const headers = new Headers();
  if (signature !== null) headers.set("stripe-signature", signature);
  headers.set("content-type", "application/json");
  return new Request("https://example.com/api/webhooks/stripe", {
    method: "POST",
    body,
    headers,
  });
}

function stubEvent(eventId: string, type: string) {
  return {
    id: eventId,
    type,
    api_version: "2024-12-18.acacia",
    livemode: false,
    created: 1716220000,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    object: "event",
    data: {
      object: {
        id: "cs_unused",
        object: "checkout.session",
        mode: "payment",
        customer: null,
        subscription: null,
        metadata: {},
      },
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/webhooks/stripe · signature verification", () => {
  test("400 missing_signature when header absent", async () => {
    const res = await POST(req("{}", null));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing_signature" });
    expect(stripeCalls.constructEvent).not.toHaveBeenCalled();
  });

  test("400 bad_signature when Stripe SDK rejects", async () => {
    stripeCalls.constructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });
    const res = await POST(req("{}", "t=12345,v1=deadbeef"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "bad_signature" });
  });

  test("500 internal_error when STRIPE_WEBHOOK_SECRET missing", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await POST(req("{}", "t=12345,v1=deadbeef"));
    expect(res.status).toBe(500);
  });
});

describe("POST /api/webhooks/stripe · idempotency", () => {
  test("first delivery → 200 ok, second delivery (same eventId) → 200 duplicate", async () => {
    stripeCalls.constructEvent.mockImplementation(() =>
      stubEvent("evt_dup_1", "checkout.session.completed"),
    );

    const r1 = await POST(req("{}", "t=12345,v1=abc"));
    const r2 = await POST(req("{}", "t=12345,v1=abc"));

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    const j1 = await r1.json();
    const j2 = await r2.json();
    expect(j1.outcome).toBe("ignored"); // mode=payment in stub → ignored by handler
    expect(j2.outcome).toBe("duplicate");
    // Row count stays at 1 (second attempt hit unique-violation)
    expect(db.rows.size).toBe(1);
  });
});

describe("POST /api/webhooks/stripe · happy path", () => {
  test("ok=true with handler outcome and stamps processedAt", async () => {
    stripeCalls.constructEvent.mockImplementation(() =>
      stubEvent("evt_ok_1", "charge.refunded"),
    );
    const res = await POST(req("{}", "t=12345,v1=abc"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, outcome: "ignored" });
    const stored = Array.from(db.rows.values())[0];
    expect(stored.processedAt).toBeInstanceOf(Date);
    expect(stored.error).toBeNull();
  });
});
