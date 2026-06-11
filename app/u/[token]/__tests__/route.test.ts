/**
 * Tests · /u/[token] cold-email unsubscribe (decision log #17c).
 *
 * Load-bearing invariants (mirrors the /r "GET confirm-only" suite):
 *   1. GET NEVER writes — security scanners prefetch every emailed link, so
 *      an instant-honor GET let them mass-unsubscribe recipients.
 *   2. RFC 8058 one-click POST (body `List-Unsubscribe=One-Click`) still
 *      executes instantly with zero human interaction → bare 200.
 *   3. The confirm-card button POST executes the same write → done card.
 *   4. Idempotent: already-suppressed → done card on GET, no writes.
 *
 * Tokens are REAL HMAC tokens (modules/cold/token with a test secret), so
 * the Zod-shape + verify path is exercised, not mocked.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { updateManyMock, suppressMock, isSuppressedMock } = vi.hoisted(() => ({
  updateManyMock: vi.fn(),
  suppressMock: vi.fn(),
  isSuppressedMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: { coldRecipient: { updateMany: updateManyMock } },
}));

vi.mock("@/modules/cold/suppression", () => ({
  suppress: suppressMock,
  isSuppressed: isSuppressedMock,
}));

// Rate limiting is fail-soft without KV anyway; mock it out so tests stay
// deterministic and log-free.
vi.mock("@/lib/middleware/rate-limit", () => ({
  PUBLIC_LIMIT: { name: "public", limit: 60, window: "1 m", prefix: "rl:p" },
  ipKey: () => "test-ip",
  rateLimit: vi.fn(async () => null),
}));

import { makeUnsubscribeToken } from "@/modules/cold/token";

import { GET, POST } from "../route";

const SECRET_KEY = "COLD_UNSUBSCRIBE_SECRET";
let savedSecret: string | undefined;

const EMAIL = "owner@spa.com";

function ctx(token: string) {
  return { params: Promise.resolve({ token }) };
}

function getReq(token: string): Request {
  return new Request(`https://www.mapsly.ai/u/${token}`, { method: "GET" });
}

function postReq(token: string, body?: string): Request {
  return new Request(`https://www.mapsly.ai/u/${token}`, {
    method: "POST",
    ...(body != null
      ? {
          body,
          headers: { "content-type": "application/x-www-form-urlencoded" },
        }
      : {}),
  });
}

function expectNoWrites() {
  expect(suppressMock).not.toHaveBeenCalled();
  expect(updateManyMock).not.toHaveBeenCalled();
}

function expectUnsubscribed() {
  expect(suppressMock).toHaveBeenCalledWith(EMAIL, "UNSUBSCRIBE");
  expect(updateManyMock).toHaveBeenCalledWith({
    where: { email: EMAIL },
    data: {
      status: "UNSUBSCRIBED",
      stopReason: "unsubscribed",
      nextRunAt: null,
    },
  });
}

beforeEach(() => {
  savedSecret = process.env[SECRET_KEY];
  process.env[SECRET_KEY] = "test-secret-for-u-route-tests";
  updateManyMock.mockReset().mockResolvedValue({ count: 1 });
  suppressMock.mockReset().mockResolvedValue(undefined);
  isSuppressedMock.mockReset().mockResolvedValue(false);
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env[SECRET_KEY];
  else process.env[SECRET_KEY] = savedSecret;
});

describe("GET /u/[token] · scanner safety (confirm-only)", () => {
  test("valid token → confirm card with POST button, NO writes", async () => {
    const token = makeUnsubscribeToken(EMAIL);
    const res = await GET(getReq(token), ctx(token));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("Unsubscribe?");
    expect(body).toContain(EMAIL);
    expect(body).toContain(`<form method="post" action="/u/${token}"`);
    expectNoWrites();
  });

  test("malformed token → 400, no suppression lookup, no writes", async () => {
    const res = await GET(getReq("not a token!"), ctx("not a token!"));
    expect(res.status).toBe(400);
    expect(isSuppressedMock).not.toHaveBeenCalled();
    expectNoWrites();
  });

  test("tampered signature → 400, no writes", async () => {
    const token = makeUnsubscribeToken(EMAIL);
    const [payload = ""] = token.split(".");
    const forged = `${payload}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    const res = await GET(getReq(forged), ctx(forged));
    expect(res.status).toBe(400);
    expectNoWrites();
  });

  test("already-suppressed address → done card, no writes (idempotent)", async () => {
    isSuppressedMock.mockResolvedValueOnce(true);
    const token = makeUnsubscribeToken(EMAIL);
    const res = await GET(getReq(token), ctx(token));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("You're unsubscribed.");
    expectNoWrites();
  });

  test("email is HTML-escaped on the confirm card", async () => {
    const evil = '<img src=x>"@spa.com';
    const token = makeUnsubscribeToken(evil);
    const res = await GET(getReq(token), ctx(token));
    const body = await res.text();
    expect(body).not.toContain("<img src=x>");
    expect(body).toContain("&lt;img src=x&gt;");
    expectNoWrites();
  });
});

describe("POST /u/[token] · executes the opt-out", () => {
  test("RFC 8058 one-click body → instant write, bare 200 (no card)", async () => {
    const token = makeUnsubscribeToken(EMAIL);
    const res = await POST(
      postReq(token, "List-Unsubscribe=One-Click"),
      ctx(token),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expectUnsubscribed();
  });

  test("confirm-card button POST → same write, done card", async () => {
    const token = makeUnsubscribeToken(EMAIL);
    const res = await POST(postReq(token), ctx(token));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("You're unsubscribed.");
    expectUnsubscribed();
  });

  test("malformed token → 400, no writes", async () => {
    const res = await POST(postReq("garbage"), ctx("garbage"));
    expect(res.status).toBe(400);
    expectNoWrites();
  });

  test("repeat POST stays 200 (suppress is an upsert — idempotent)", async () => {
    const token = makeUnsubscribeToken(EMAIL);
    await POST(postReq(token), ctx(token));
    const res = await POST(postReq(token), ctx(token));
    expect(res.status).toBe(200);
    expect(suppressMock).toHaveBeenCalledTimes(2);
  });
});
