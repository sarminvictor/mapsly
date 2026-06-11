/**
 * Tests · /o/[token] open-tracking pixel (plan #7).
 *
 * Load-bearing contract: the route ALWAYS answers 200 with the transparent
 * 1x1 GIF — valid open, invalid token, unknown send, DB error, rate-limited.
 * A status difference would leak token validity and show broken images in
 * mail clients. Recording is best-effort and classification follows
 * lib/bot-detect.isPrefetchOpen (<5s after sentAt OR proxy/scanner UA):
 *   - first open sets firstOpenedAt / firstOpenUserAgent / suspectedPrefetch
 *   - every open bumps openCount + lastOpenedAt
 *   - the first HUMAN-looking open clears suspectedPrefetch
 *
 * Tokens are REAL HMAC tokens (modules/cold/token with a test secret).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { findUniqueMock, updateMock, rateLimitMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
  rateLimitMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: { coldSend: { findUnique: findUniqueMock, update: updateMock } },
  Prisma: {},
}));

vi.mock("@/lib/middleware/rate-limit", () => ({
  PUBLIC_LIMIT: { name: "public", limit: 60, window: "1 m", prefix: "rl:p" },
  ipKey: () => "test-ip",
  rateLimit: rateLimitMock,
}));

import { makeOpenToken, makeUnsubscribeToken } from "@/modules/cold/token";

import { GET } from "../route";

const SECRET_KEY = "COLD_UNSUBSCRIBE_SECRET";
let savedSecret: string | undefined;

const SEND_ID = "clsend123abc";
const HUMAN_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";
const PROXY_UA = "Mozilla/5.0 (via ggpht.com GoogleImageProxy)";

/** sentAt comfortably in the past → the <5s prefetch window can't trip. */
const SENT_LONG_AGO = new Date(Date.now() - 60 * 60 * 1000);

function ctx(token: string) {
  return { params: Promise.resolve({ token }) };
}

function req(token: string, userAgent?: string): Request {
  return new Request(`https://www.mapsly.ai/o/${token}`, {
    method: "GET",
    headers: userAgent ? { "user-agent": userAgent } : {},
  });
}

async function expectGif(res: Response) {
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/gif");
  expect(res.headers.get("cache-control")).toContain("no-store");
  expect(res.headers.get("x-robots-tag")).toBe("noindex");
  const bytes = new Uint8Array(await res.arrayBuffer());
  // GIF89a magic — a real renderable pixel, not an empty body.
  expect(String.fromCharCode(...bytes.slice(0, 6))).toBe("GIF89a");
}

beforeEach(() => {
  savedSecret = process.env[SECRET_KEY];
  process.env[SECRET_KEY] = "test-secret-for-o-route-tests";
  findUniqueMock.mockReset();
  updateMock.mockReset().mockResolvedValue({ id: SEND_ID });
  rateLimitMock.mockReset().mockResolvedValue(null);
});

afterEach(() => {
  if (savedSecret === undefined) delete process.env[SECRET_KEY];
  else process.env[SECRET_KEY] = savedSecret;
});

describe("GET /o/[token] · recording", () => {
  test("first human-looking open → counts + firstOpened* set, not prefetch", async () => {
    findUniqueMock.mockResolvedValueOnce({
      sentAt: SENT_LONG_AGO,
      firstOpenedAt: null,
      suspectedPrefetch: false,
    });
    const token = makeOpenToken(SEND_ID);
    await expectGif(await GET(req(token, HUMAN_UA), ctx(token)));

    expect(updateMock).toHaveBeenCalledTimes(1);
    const arg = updateMock.mock.calls[0]?.[0];
    expect(arg.where).toEqual({ id: SEND_ID });
    expect(arg.data.openCount).toEqual({ increment: 1 });
    expect(arg.data.lastOpenedAt).toBeInstanceOf(Date);
    expect(arg.data.firstOpenedAt).toBeInstanceOf(Date);
    expect(arg.data.firstOpenUserAgent).toBe(HUMAN_UA);
    expect(arg.data.suspectedPrefetch).toBe(false);
  });

  test("first open <5s after send → suspectedPrefetch true", async () => {
    findUniqueMock.mockResolvedValueOnce({
      sentAt: new Date(), // just sent — inside the prefetch window
      firstOpenedAt: null,
      suspectedPrefetch: false,
    });
    const token = makeOpenToken(SEND_ID);
    await expectGif(await GET(req(token, HUMAN_UA), ctx(token)));
    expect(updateMock.mock.calls[0]?.[0].data.suspectedPrefetch).toBe(true);
  });

  test("first open by image-proxy UA → suspectedPrefetch true", async () => {
    findUniqueMock.mockResolvedValueOnce({
      sentAt: SENT_LONG_AGO,
      firstOpenedAt: null,
      suspectedPrefetch: false,
    });
    const token = makeOpenToken(SEND_ID);
    await expectGif(await GET(req(token, PROXY_UA), ctx(token)));
    expect(updateMock.mock.calls[0]?.[0].data.suspectedPrefetch).toBe(true);
  });

  test("later HUMAN open clears suspectedPrefetch (upgrade)", async () => {
    findUniqueMock.mockResolvedValueOnce({
      sentAt: SENT_LONG_AGO,
      firstOpenedAt: SENT_LONG_AGO,
      suspectedPrefetch: true,
    });
    const token = makeOpenToken(SEND_ID);
    await expectGif(await GET(req(token, HUMAN_UA), ctx(token)));
    const data = updateMock.mock.calls[0]?.[0].data;
    expect(data.suspectedPrefetch).toBe(false);
    expect(data.firstOpenedAt).toBeUndefined(); // first-open fields untouched
    expect(data.firstOpenUserAgent).toBeUndefined();
  });

  test("later machine open does NOT clear suspectedPrefetch", async () => {
    findUniqueMock.mockResolvedValueOnce({
      sentAt: SENT_LONG_AGO,
      firstOpenedAt: SENT_LONG_AGO,
      suspectedPrefetch: true,
    });
    const token = makeOpenToken(SEND_ID);
    await expectGif(await GET(req(token, PROXY_UA), ctx(token)));
    const data = updateMock.mock.calls[0]?.[0].data;
    expect(data.suspectedPrefetch).toBeUndefined();
    expect(data.openCount).toEqual({ increment: 1 }); // still counted raw
  });

  test("missing UA header → recorded as null firstOpenUserAgent, prefetch by window only", async () => {
    findUniqueMock.mockResolvedValueOnce({
      sentAt: SENT_LONG_AGO,
      firstOpenedAt: null,
      suspectedPrefetch: false,
    });
    const token = makeOpenToken(SEND_ID);
    await expectGif(await GET(req(token), ctx(token)));
    const data = updateMock.mock.calls[0]?.[0].data;
    expect(data.firstOpenUserAgent).toBeNull();
    expect(data.suspectedPrefetch).toBe(false);
  });
});

describe("GET /o/[token] · always-a-GIF contract", () => {
  test("invalid token shape → GIF 200, no DB calls", async () => {
    await expectGif(await GET(req("garbage!"), ctx("garbage!")));
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("a /u unsubscribe token never records (domain separation) → GIF 200", async () => {
    const unsub = makeUnsubscribeToken("owner@spa.com");
    await expectGif(await GET(req(unsub, HUMAN_UA), ctx(unsub)));
    expect(findUniqueMock).not.toHaveBeenCalled();
  });

  test("unknown send id → GIF 200, no update", async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    const token = makeOpenToken(SEND_ID);
    await expectGif(await GET(req(token, HUMAN_UA), ctx(token)));
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("DB error → GIF 200 anyway (never 500 a mail client)", async () => {
    findUniqueMock.mockRejectedValueOnce(new Error("neon down"));
    const token = makeOpenToken(SEND_ID);
    await expectGif(await GET(req(token, HUMAN_UA), ctx(token)));
  });

  test("rate-limited → GIF 200, recording skipped (never 429 an image)", async () => {
    rateLimitMock.mockResolvedValueOnce(
      Response.json({ error: "rate_limited" }, { status: 429 }),
    );
    const token = makeOpenToken(SEND_ID);
    await expectGif(await GET(req(token, HUMAN_UA), ctx(token)));
    expect(findUniqueMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
