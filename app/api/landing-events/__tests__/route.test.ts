/**
 * Tests · POST /api/landing-events ingest (plan #17a).
 *
 * Load-bearing invariants:
 *  - Bot classification comes from the SHARED lib/bot-detect vocabulary —
 *    scanner UAs flag `isBot` + botReason "ua-scanner", proxies "ua-proxy",
 *    humans store botReason null. Raw events are ALWAYS stored either way.
 *  - Server-only conversions (FREE_SIGNUP, SUBSCRIPTION_BOUGHT) are rejected
 *    by the Zod enum — a client can't claim a conversion.
 *  - viewCount increments only for non-bot PAGE_OPENED.
 *  - Unknown tokens are silently accepted (don't reveal which exist).
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

const { findUniqueMock, createMock, updateMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  createMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    landingPage: { findUnique: findUniqueMock, update: updateMock },
    landingEvent: { create: createMock },
  },
}));

// Rate limiting is fail-soft without KV anyway; mock it out so tests stay
// deterministic and log-free.
vi.mock("@/lib/middleware/rate-limit", () => ({
  PUBLIC_LIMIT: { name: "public", limit: 60, window: "1 m", prefix: "rl:p" },
  ipKey: () => "203.0.113.7",
  rateLimit: vi.fn(async () => null),
}));

import { POST } from "../route";

const TOKEN = "4820731965540827";
const LANDING = { id: "lp_1", isActive: true };

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const SCANNER_UA = "Mozilla/5.0 (compatible; Barracuda Sentinel)";
const PROXY_UA =
  "Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)";

function req(body: unknown, ua: string = CHROME_UA): Request {
  return new Request("https://mapsly.ai/api/landing-events", {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": ua },
    body: JSON.stringify(body),
  });
}

function event(extra: Record<string, unknown> = {}) {
  return {
    token: TOKEN,
    type: "PAGE_OPENED",
    visitorId: "v_1",
    sessionId: "s_1",
    ...extra,
  };
}

beforeEach(() => {
  findUniqueMock.mockReset();
  createMock.mockReset();
  updateMock.mockReset();
  findUniqueMock.mockResolvedValue(LANDING);
  createMock.mockResolvedValue({ id: "ev_1" });
  updateMock.mockResolvedValue({ id: "lp_1" });
});

describe("bot classification at ingest (shared lib/bot-detect)", () => {
  test("human UA → isBot=false, botReason=null, viewCount increments", async () => {
    const res = await POST(req(event()));
    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledOnce();
    expect(createMock.mock.calls[0][0].data).toMatchObject({
      type: "PAGE_OPENED",
      isBot: false,
      botReason: null,
      userAgent: CHROME_UA,
    });
    expect(updateMock).toHaveBeenCalledOnce(); // viewCount++
  });

  test("scanner UA → isBot=true, botReason='ua-scanner', NO viewCount", async () => {
    const res = await POST(req(event(), SCANNER_UA));
    expect(res.status).toBe(200);
    expect(createMock.mock.calls[0][0].data).toMatchObject({
      isBot: true,
      botReason: "ua-scanner",
    });
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("curl-style CLI fetcher is a scanner too", async () => {
    await POST(req(event(), "curl/8.4.0"));
    expect(createMock.mock.calls[0][0].data).toMatchObject({
      isBot: true,
      botReason: "ua-scanner",
    });
  });

  test("mail image proxy UA → botReason='ua-proxy'", async () => {
    await POST(req(event(), PROXY_UA));
    expect(createMock.mock.calls[0][0].data).toMatchObject({
      isBot: true,
      botReason: "ua-proxy",
    });
  });

  test("bot events are still STORED (raw kept for re-derivation)", async () => {
    await POST(
      req(event({ type: "SECTION_VIEWED", section: "hero" }), SCANNER_UA),
    );
    expect(createMock).toHaveBeenCalledOnce();
    expect(createMock.mock.calls[0][0].data.userAgent).toBe(SCANNER_UA);
  });
});

describe("server-only conversion types are rejected", () => {
  test.each(["FREE_SIGNUP", "SUBSCRIPTION_BOUGHT"])(
    "%s from the client beacon → 400, nothing stored",
    async (type) => {
      const res = await POST(req(event({ type })));
      expect(res.status).toBe(400);
      expect(createMock).not.toHaveBeenCalled();
    },
  );
});

describe("token handling", () => {
  test("unknown token → silent ok, nothing stored", async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    const res = await POST(req(event()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(createMock).not.toHaveBeenCalled();
  });

  test("revoked landing → silent ok, nothing stored", async () => {
    findUniqueMock.mockResolvedValueOnce({ id: "lp_1", isActive: false });
    const res = await POST(req(event()));
    expect(res.status).toBe(200);
    expect(createMock).not.toHaveBeenCalled();
  });

  test("malformed token shape → 400", async () => {
    const res = await POST(req(event({ token: "not-a-token" })));
    expect(res.status).toBe(400);
    expect(createMock).not.toHaveBeenCalled();
  });
});
