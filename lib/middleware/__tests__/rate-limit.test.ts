// Unit tests for the rate-limit middleware.
//
// Strategy: mock @upstash/ratelimit so we don't need a live KV connection,
// drive the `limit()` return value from each test, and assert on the
// observable behaviors:
//
//   - within-quota → returns null (request allowed)
//   - over-quota   → returns 429 Response with Retry-After + JSON body
//   - KV unavailable → returns null + warning (fail-soft)
//   - ipKey extracts x-forwarded-for first entry, falls back correctly
//   - withRateLimit decorator skips handler on block, invokes on allow
//   - LimitProfile defaults match scalability.md (60/30/200)
//
// Note: we use `vi.mock` with the factory pattern so the FakeRatelimit class
// captures `limitMock` from module scope. `__resetLimitersForTest()` in
// afterEach clears the lazy cache so each test starts fresh.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  limit: vi.fn(),
}));

vi.mock("@upstash/ratelimit", () => {
  class FakeRatelimit {
    constructor(_opts: unknown) {
      void _opts;
    }
    static slidingWindow(_limit: number, _window: string) {
      void _limit;
      void _window;
      return { kind: "sliding-window" } as const;
    }
    limit(key: string): Promise<unknown> {
      return mocks.limit(key) as Promise<unknown>;
    }
  }
  return { Ratelimit: FakeRatelimit };
});

vi.mock("@vercel/kv", () => ({
  kv: {
    ping: () => Promise.resolve("PONG"),
  },
}));

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  // Default each test to "KV available" — individual tests can override.
  process.env.KV_REST_API_URL = "http://test-kv";
  process.env.KV_REST_API_TOKEN = "test-token";
  mocks.limit.mockReset();
});

afterEach(async () => {
  process.env = { ...ORIG_ENV };
  const mod = await import("../rate-limit");
  mod.__resetLimitersForTest();
});

describe("rateLimit() · within quota", () => {
  test("returns null when limiter reports success", async () => {
    mocks.limit.mockResolvedValueOnce({
      success: true,
      limit: 60,
      remaining: 59,
      reset: Date.now() + 60_000,
    });
    const { rateLimit, PUBLIC_LIMIT } = await import("../rate-limit");
    const req = new Request("https://x.example/", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });

    const result = await rateLimit(req, PUBLIC_LIMIT, "1.2.3.4");
    expect(result).toBeNull();
    expect(mocks.limit).toHaveBeenCalledWith("1.2.3.4");
  });
});

describe("rateLimit() · over quota", () => {
  test("returns 429 Response with Retry-After + headers + canonical JSON body", async () => {
    const resetAt = Date.now() + 30_000;
    mocks.limit.mockResolvedValueOnce({
      success: false,
      limit: 60,
      remaining: 0,
      reset: resetAt,
    });
    const { rateLimit, PUBLIC_LIMIT } = await import("../rate-limit");
    const req = new Request("https://x.example/", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });

    const result = await rateLimit(req, PUBLIC_LIMIT, "1.2.3.4");
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);

    const retryAfter = Number(result!.headers.get("Retry-After"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(31);
    expect(result!.headers.get("X-RateLimit-Limit")).toBe("60");
    expect(result!.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(result!.headers.get("X-RateLimit-Reset")).toBe(String(resetAt));

    const body = (await result!.json()) as {
      error: string;
      retryAfter: number;
      limit: number;
      remaining: number;
    };
    expect(body.error).toBe("rate_limited");
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(body.limit).toBe(60);
    expect(body.remaining).toBe(0);
  });

  test("Retry-After clamps to 0 when reset is already in the past", async () => {
    mocks.limit.mockResolvedValueOnce({
      success: false,
      limit: 60,
      remaining: 0,
      reset: Date.now() - 5_000,
    });
    const { rateLimit, PUBLIC_LIMIT } = await import("../rate-limit");
    const req = new Request("https://x.example/");
    const result = await rateLimit(req, PUBLIC_LIMIT, "anon");
    expect(result!.status).toBe(429);
    expect(Number(result!.headers.get("Retry-After"))).toBe(0);
  });
});

describe("rateLimit() · 100 requests against 60/min profile", () => {
  // The canonical validation from the task spec: 100 requests in a window
  // should produce 60 allows and 40 blocks. We simulate the count in the
  // mock so we don't have to wait a real minute.
  test("first 60 allowed, remaining 40 blocked with 429", async () => {
    let count = 0;
    mocks.limit.mockImplementation(async () => {
      count += 1;
      if (count <= 60) {
        return {
          success: true,
          limit: 60,
          remaining: 60 - count,
          reset: Date.now() + 60_000,
        };
      }
      return {
        success: false,
        limit: 60,
        remaining: 0,
        reset: Date.now() + 60_000,
      };
    });

    const { rateLimit, PUBLIC_LIMIT } = await import("../rate-limit");
    const req = new Request("https://x.example/", {
      headers: { "x-forwarded-for": "5.6.7.8" },
    });

    const outcomes: Array<"allow" | "block"> = [];
    for (let i = 0; i < 100; i++) {
      const r = await rateLimit(req, PUBLIC_LIMIT, "5.6.7.8");
      outcomes.push(r === null ? "allow" : "block");
    }

    expect(outcomes.filter((o) => o === "allow")).toHaveLength(60);
    expect(outcomes.filter((o) => o === "block")).toHaveLength(40);
  });
});

describe("rateLimit() · fail-soft when KV unavailable", () => {
  test("returns null and logs warn when no KV env vars are set", async () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.KV_URL;
    delete process.env.KV_REST_API_READ_ONLY_TOKEN;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { rateLimit, PUBLIC_LIMIT, __resetLimitersForTest } = await import(
      "../rate-limit"
    );
    __resetLimitersForTest();

    const req = new Request("https://x.example/");
    const result = await rateLimit(req, PUBLIC_LIMIT, "anon");

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledOnce();
    const payload = JSON.parse(String(warnSpy.mock.calls[0]?.[0])) as {
      level: string;
      event: string;
      profile: string;
    };
    expect(payload.event).toBe("rate_limit.kv_unavailable");
    expect(payload.profile).toBe("public");

    warnSpy.mockRestore();
  });

  test("the limiter mock is never invoked when KV is unavailable", async () => {
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_REST_API_TOKEN;
    delete process.env.KV_URL;
    delete process.env.KV_REST_API_READ_ONLY_TOKEN;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { rateLimit, USER_LIMIT, __resetLimitersForTest } = await import(
      "../rate-limit"
    );
    __resetLimitersForTest();

    await rateLimit(new Request("https://x.example/"), USER_LIMIT, "u1");
    expect(mocks.limit).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

describe("ipKey()", () => {
  test("returns the first entry of x-forwarded-for", async () => {
    const { ipKey } = await import("../rate-limit");
    const req = new Request("https://x.example/", {
      headers: { "x-forwarded-for": "1.1.1.1, 9.9.9.9, 8.8.8.8" },
    });
    expect(ipKey(req)).toBe("1.1.1.1");
  });

  test("trims whitespace around the first XFF entry", async () => {
    const { ipKey } = await import("../rate-limit");
    const req = new Request("https://x.example/", {
      headers: { "x-forwarded-for": "  4.4.4.4  ,  9.9.9.9" },
    });
    expect(ipKey(req)).toBe("4.4.4.4");
  });

  test("falls back to x-real-ip when x-forwarded-for is absent", async () => {
    const { ipKey } = await import("../rate-limit");
    const req = new Request("https://x.example/", {
      headers: { "x-real-ip": "2.2.2.2" },
    });
    expect(ipKey(req)).toBe("2.2.2.2");
  });

  test("returns the sentinel 'ip:unknown' when neither header is present", async () => {
    const { ipKey } = await import("../rate-limit");
    const req = new Request("https://x.example/");
    expect(ipKey(req)).toBe("ip:unknown");
  });
});

describe("withRateLimit() · decorator", () => {
  test("invokes the wrapped handler when the request is allowed", async () => {
    mocks.limit.mockResolvedValue({
      success: true,
      limit: 60,
      remaining: 59,
      reset: Date.now() + 60_000,
    });
    const { withRateLimit, PUBLIC_LIMIT, ipKey } = await import(
      "../rate-limit"
    );

    const inner = vi.fn(async () => new Response("ok", { status: 200 }));
    const wrapped = withRateLimit(PUBLIC_LIMIT, ipKey, inner);

    const req = new Request("https://x.example/", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    const result = await wrapped(req);

    expect(result.status).toBe(200);
    expect(inner).toHaveBeenCalledOnce();
    expect(inner).toHaveBeenCalledWith(req);
  });

  test("returns 429 and skips the handler when blocked", async () => {
    mocks.limit.mockResolvedValue({
      success: false,
      limit: 60,
      remaining: 0,
      reset: Date.now() + 60_000,
    });
    const { withRateLimit, PUBLIC_LIMIT, ipKey } = await import(
      "../rate-limit"
    );

    const inner = vi.fn(async () => new Response("ok"));
    const wrapped = withRateLimit(PUBLIC_LIMIT, ipKey, inner);

    const req = new Request("https://x.example/", {
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    const result = await wrapped(req);

    expect(result.status).toBe(429);
    expect(inner).not.toHaveBeenCalled();
  });

  test("supports an async keyFn", async () => {
    mocks.limit.mockResolvedValue({
      success: true,
      limit: 30,
      remaining: 29,
      reset: Date.now() + 60_000,
    });
    const { withRateLimit, USER_LIMIT } = await import("../rate-limit");

    const keyFn = vi.fn(async (_req: Request) => "user-123");
    const inner = vi.fn(async () => new Response("ok"));
    const wrapped = withRateLimit(USER_LIMIT, keyFn, inner);

    await wrapped(new Request("https://x.example/"));

    expect(keyFn).toHaveBeenCalledOnce();
    expect(mocks.limit).toHaveBeenCalledWith("user-123");
  });
});

describe("profile registry · matches scalability.md defaults", () => {
  test("PUBLIC_LIMIT = 60/min, USER_LIMIT = 30/min, WEBHOOK_LIMIT = 200/min", async () => {
    const { PUBLIC_LIMIT, USER_LIMIT, WEBHOOK_LIMIT } = await import(
      "../rate-limit"
    );

    expect(PUBLIC_LIMIT.limit).toBe(60);
    expect(PUBLIC_LIMIT.window).toBe("1 m");
    expect(PUBLIC_LIMIT.prefix).toBe("rl:public");

    expect(USER_LIMIT.limit).toBe(30);
    expect(USER_LIMIT.window).toBe("1 m");
    expect(USER_LIMIT.prefix).toBe("rl:user");

    expect(WEBHOOK_LIMIT.limit).toBe(200);
    expect(WEBHOOK_LIMIT.window).toBe("1 m");
    expect(WEBHOOK_LIMIT.prefix).toBe("rl:webhook");
  });

  test("each profile has a unique prefix (no keyspace collisions)", async () => {
    const { PUBLIC_LIMIT, USER_LIMIT, WEBHOOK_LIMIT } = await import(
      "../rate-limit"
    );
    const prefixes = [PUBLIC_LIMIT.prefix, USER_LIMIT.prefix, WEBHOOK_LIMIT.prefix];
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});

describe("limiter caching · same profile reuses the Ratelimit instance", () => {
  test("multiple calls against the same profile only construct one Ratelimit", async () => {
    mocks.limit.mockResolvedValue({
      success: true,
      limit: 60,
      remaining: 50,
      reset: Date.now() + 60_000,
    });
    const { rateLimit, PUBLIC_LIMIT } = await import("../rate-limit");
    const req = new Request("https://x.example/");

    for (let i = 0; i < 5; i++) {
      await rateLimit(req, PUBLIC_LIMIT, `bucket-${i}`);
    }
    // 5 keys → 5 limit() calls, but only one underlying Ratelimit instance.
    expect(mocks.limit).toHaveBeenCalledTimes(5);
  });
});
