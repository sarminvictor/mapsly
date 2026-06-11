/**
 * Tests · free weekly-score subscribe action (plan #7).
 *
 * Load-bearing invariants:
 *   - Zod boundary: bad email / bad token → typed "invalid", zero DB traffic.
 *   - Rate limit enforced BEFORE any lookup (it's a write endpoint).
 *   - Unknown / revoked landing tokens return { ok: true } silently — never
 *     reveal which tokens exist (mirrors /api/landing-events).
 *   - The ONE-transaction write set: EXPRESS ConsentRecord → subscriber
 *     upsert (lowercased email, rotated token + cleared unsubscribedAt on
 *     re-subscribe) → SERVER-emitted FREE_SIGNUP LandingEvent (isBot=false).
 *   - PII: ipHash is a salted hash, never the raw IP.
 *   - Infra failure → honest "unavailable" (never a fake "Done").
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

const {
  findUniqueMock,
  txMock,
  consentCreateMock,
  upsertMock,
  eventCreateMock,
  rateLimitMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  txMock: vi.fn(),
  consentCreateMock: vi.fn(),
  upsertMock: vi.fn(),
  eventCreateMock: vi.fn(),
  rateLimitMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    landingPage: { findUnique: findUniqueMock },
    $transaction: txMock,
  },
}));

vi.mock("@/lib/middleware/rate-limit", () => ({
  PUBLIC_LIMIT: { name: "public", limit: 60, window: "1 m", prefix: "rl:p" },
  rateLimit: rateLimitMock,
}));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
      "user-agent": "vitest-agent/1.0",
    }),
}));

import { subscribeWeeklyScore } from "../subscribe-action";

const TOKEN = "4820731965540827";

const LANDING = {
  id: "lp_1",
  businessId: "biz_1",
  slug: "solea-brickell-spa",
  token: TOKEN,
  isActive: true,
  business: { country: "CA" },
};

function expectNoWrites() {
  expect(txMock).not.toHaveBeenCalled();
  expect(consentCreateMock).not.toHaveBeenCalled();
  expect(upsertMock).not.toHaveBeenCalled();
  expect(eventCreateMock).not.toHaveBeenCalled();
}

beforeEach(() => {
  findUniqueMock.mockReset();
  txMock.mockReset();
  consentCreateMock.mockReset();
  upsertMock.mockReset();
  eventCreateMock.mockReset();
  rateLimitMock.mockReset();

  rateLimitMock.mockResolvedValue(null);
  consentCreateMock.mockResolvedValue({ id: "consent_1" });
  upsertMock.mockResolvedValue({ id: "sub_1" });
  eventCreateMock.mockResolvedValue({ id: "evt_1" });
  txMock.mockImplementation(
    async (fn: (tx: unknown) => Promise<unknown>) =>
      await fn({
        consentRecord: { create: consentCreateMock },
        weeklyScoreSubscriber: { upsert: upsertMock },
        landingEvent: { create: eventCreateMock },
      }),
  );
});

describe("subscribeWeeklyScore · input boundary", () => {
  test("malformed email → invalid, no DB traffic", async () => {
    const res = await subscribeWeeklyScore({
      token: TOKEN,
      email: "not-an-email",
    });
    expect(res).toEqual({ ok: false, error: "invalid" });
    expect(findUniqueMock).not.toHaveBeenCalled();
    expectNoWrites();
  });

  test("malformed token → invalid, no DB traffic", async () => {
    const res = await subscribeWeeklyScore({
      token: "0123",
      email: "maria@spa.com",
    });
    expect(res).toEqual({ ok: false, error: "invalid" });
    expect(findUniqueMock).not.toHaveBeenCalled();
    expectNoWrites();
  });

  test("non-object input → invalid", async () => {
    const res = await subscribeWeeklyScore("garbage");
    expect(res).toEqual({ ok: false, error: "invalid" });
    expectNoWrites();
  });
});

describe("subscribeWeeklyScore · rate limit", () => {
  test("limited → rate_limited, no lookup, no writes", async () => {
    rateLimitMock.mockResolvedValueOnce(
      Response.json({ error: "rate_limited" }, { status: 429 }),
    );
    const res = await subscribeWeeklyScore({
      token: TOKEN,
      email: "maria@spa.com",
    });
    expect(res).toEqual({ ok: false, error: "rate_limited" });
    expect(findUniqueMock).not.toHaveBeenCalled();
    expectNoWrites();
  });

  test("limiter throwing fails soft (allow)", async () => {
    rateLimitMock.mockRejectedValueOnce(new Error("kv down"));
    findUniqueMock.mockResolvedValueOnce(LANDING);
    const res = await subscribeWeeklyScore({
      token: TOKEN,
      email: "maria@spa.com",
    });
    expect(res).toEqual({ ok: true });
    expect(txMock).toHaveBeenCalledTimes(1);
  });
});

describe("subscribeWeeklyScore · token resolution", () => {
  test("unknown token → silent ok, no writes", async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    const res = await subscribeWeeklyScore({
      token: TOKEN,
      email: "maria@spa.com",
    });
    expect(res).toEqual({ ok: true });
    expectNoWrites();
  });

  test("revoked landing → silent ok, no writes", async () => {
    findUniqueMock.mockResolvedValueOnce({ ...LANDING, isActive: false });
    const res = await subscribeWeeklyScore({
      token: TOKEN,
      email: "maria@spa.com",
    });
    expect(res).toEqual({ ok: true });
    expectNoWrites();
  });
});

describe("subscribeWeeklyScore · the transactional write set", () => {
  test("valid signup writes consent + subscriber + FREE_SIGNUP in one tx", async () => {
    findUniqueMock.mockResolvedValueOnce(LANDING);

    const res = await subscribeWeeklyScore({
      token: TOKEN,
      email: "  Maria@Spa.com ",
      visitorId: "vid-123",
      sessionId: "sid-456",
    });
    expect(res).toEqual({ ok: true });
    expect(txMock).toHaveBeenCalledTimes(1);

    // 1 · EXPRESS consent, lowercased email, landing URL as source.
    expect(consentCreateMock).toHaveBeenCalledTimes(1);
    const consent = consentCreateMock.mock.calls[0][0].data;
    expect(consent.email).toBe("maria@spa.com");
    expect(consent.businessId).toBe("biz_1");
    expect(consent.basis).toBe("EXPRESS");
    expect(consent.sourceUrl).toBe(
      `https://www.mapsly.ai/l/solea-brickell-spa-${TOKEN}`,
    );
    expect(consent.country).toBe("CA");

    // 2 · idempotent upsert keyed by (email, businessId).
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const upsert = upsertMock.mock.calls[0][0];
    expect(upsert.where).toEqual({
      email_businessId: { email: "maria@spa.com", businessId: "biz_1" },
    });
    expect(upsert.create.email).toBe("maria@spa.com");
    expect(upsert.create.landingPageId).toBe("lp_1");
    expect(upsert.create.source).toBe("landing");
    expect(upsert.create.consentRecordId).toBe("consent_1");
    // base64url(16 bytes) = 22 chars, no padding.
    expect(upsert.create.unsubToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
    // Re-subscribe path: clears the opt-out + ROTATES the token.
    expect(upsert.update.unsubscribedAt).toBeNull();
    expect(upsert.update.unsubToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(upsert.update.consentRecordId).toBe("consent_1");

    // 3 · server-emitted FREE_SIGNUP, never bot, salted ipHash (not raw IP).
    expect(eventCreateMock).toHaveBeenCalledTimes(1);
    const event = eventCreateMock.mock.calls[0][0].data;
    expect(event.type).toBe("FREE_SIGNUP");
    expect(event.landingPageId).toBe("lp_1");
    expect(event.isBot).toBe(false);
    expect(event.visitorId).toBe("vid-123");
    expect(event.sessionId).toBe("sid-456");
    expect(event.userAgent).toBe("vitest-agent/1.0");
    expect(event.ipHash).toMatch(/^[0-9a-f]{32}$/);
    expect(event.ipHash).not.toContain("203.0.113.7");
  });

  test("create and update mint DIFFERENT unsub tokens (rotation is real)", async () => {
    findUniqueMock.mockResolvedValueOnce(LANDING);
    await subscribeWeeklyScore({ token: TOKEN, email: "maria@spa.com" });
    const upsert = upsertMock.mock.calls[0][0];
    expect(upsert.create.unsubToken).not.toBe(upsert.update.unsubToken);
  });

  test("DB failure → honest unavailable (no fake Done)", async () => {
    findUniqueMock.mockResolvedValueOnce(LANDING);
    txMock.mockRejectedValueOnce(new Error("neon down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await subscribeWeeklyScore({
      token: TOKEN,
      email: "maria@spa.com",
    });
    expect(res).toEqual({ ok: false, error: "unavailable" });
    errSpy.mockRestore();
  });
});
