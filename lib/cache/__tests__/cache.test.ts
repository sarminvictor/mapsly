// Tests for the kvCache wrapper + invalidateCacheTag.
//
// Strategy: install an in-memory KV fake via __setKvClientForTest, mock
// @/lib/prisma so cacheHits counting doesn't need a DB, and exercise the
// observable behaviors:
//
//   - hit returns cached value without re-running fn
//   - miss runs fn and caches the result
//   - identical args (different key order) hash to the same key
//   - KV unavailable → fn runs every time, never crashes
//   - KV runtime error during get → fn runs, never crashes
//   - KV runtime error during set → caller still gets the value
//   - invalidateCacheTag drops all keys written under the tag
//   - cacheHits is bumped on CronRun.meta when a CronRun is open

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// vi.hoisted lifts these refs above the vi.mock factory calls so the factory
// closures can capture them without triggering "cannot access before
// initialization." This is the canonical Vitest pattern.
const mocks = vi.hoisted(() => {
  return {
    prismaExecuteRaw: vi.fn(
      async (_strings: TemplateStringsArray, ..._values: unknown[]) => 1,
    ),
    currentRun: {
      value: null as null | { id: string; job: string; startedAt: Date },
    },
  };
});

vi.mock("@/lib/prisma", () => ({
  default: {
    $executeRaw: mocks.prismaExecuteRaw,
  },
}));

vi.mock("@/lib/cost/cost-counter", () => ({
  getCurrentCronRun: () => mocks.currentRun.value,
}));

import { __setKvClientForTest, type KvClient } from "@/lib/cache/kv";
import {
  kvCache,
  invalidateCacheTag,
  stableHashArgs,
  __resetCacheWarningsForTest,
} from "@/lib/cache";

interface KvEntry {
  value: unknown;
  expiresAt: number | null;
}

function makeFake(): {
  client: KvClient;
  store: Map<string, KvEntry>;
  counters: { get: number; set: number; del: number; scan: number };
} {
  const store = new Map<string, KvEntry>();
  const counters = { get: 0, set: 0, del: 0, scan: 0 };

  function notExpired(key: string): boolean {
    const e = store.get(key);
    if (!e) return false;
    if (e.expiresAt != null && e.expiresAt < Date.now()) {
      store.delete(key);
      return false;
    }
    return true;
  }

  const client: KvClient = {
    async get<T>(key: string): Promise<T | null> {
      counters.get++;
      if (!notExpired(key)) return null;
      const e = store.get(key)!;
      return e.value as T;
    },
    async set(key, value, opts) {
      counters.set++;
      const ex = opts?.ex;
      const px = opts?.px;
      const expiresAt =
        ex != null
          ? Date.now() + ex * 1000
          : px != null
            ? Date.now() + px
            : null;
      store.set(key, { value, expiresAt });
      return "OK";
    },
    async del(...keys) {
      counters.del++;
      let n = 0;
      for (const k of keys) if (store.delete(k)) n++;
      return n;
    },
    async scan(_cursor, opts) {
      counters.scan++;
      const match = opts?.match ?? "*";
      // Convert MATCH glob to regex (only * supported, no ? or [])
      const re = new RegExp(
        "^" +
          match.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*") +
          "$",
      );
      const keys: string[] = [];
      for (const k of store.keys()) if (re.test(k)) keys.push(k);
      // Always return cursor "0" (we don't bother emulating pagination)
      return ["0", keys];
    },
  };

  return { client, store, counters };
}

let fake: ReturnType<typeof makeFake>;

beforeEach(() => {
  fake = makeFake();
  __setKvClientForTest(fake.client);
  __resetCacheWarningsForTest();
  mocks.prismaExecuteRaw.mockClear();
  mocks.currentRun.value = null;
});

afterEach(() => {
  __setKvClientForTest(null);
});

// ---- Tests ---------------------------------------------------------------

describe("stableHashArgs", () => {
  test("hashes are stable across key order in objects", () => {
    const a = stableHashArgs([{ x: 1, y: 2, z: 3 }]);
    const b = stableHashArgs([{ z: 3, y: 2, x: 1 }]);
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });

  test("different primitive arg lists hash differently", () => {
    expect(stableHashArgs([1])).not.toBe(stableHashArgs([2]));
    expect(stableHashArgs(["foo"])).not.toBe(stableHashArgs(["bar"]));
    expect(stableHashArgs([{ a: 1 }])).not.toBe(stableHashArgs([{ a: 2 }]));
  });

  test("Date instances hash by ISO string, not identity", () => {
    const d1 = new Date("2026-01-01T00:00:00Z");
    const d2 = new Date("2026-01-01T00:00:00Z");
    expect(stableHashArgs([d1])).toBe(stableHashArgs([d2]));
  });

  test("rejects non-serializable arg types", () => {
    expect(() => stableHashArgs([() => 0])).toThrow(/function/);
    expect(() => stableHashArgs([Symbol("x")])).toThrow(/symbol/);
    expect(() => stableHashArgs([1n])).toThrow(/bigint/);
  });
});

describe("kvCache · happy path", () => {
  test("miss runs the fn and writes to KV", async () => {
    const fn = vi.fn(async (n: number) => n * 2);
    const cached = kvCache("test:double", { ttl: 60 }, fn);

    const out = await cached(21);
    expect(out).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fake.counters.set).toBeGreaterThanOrEqual(1);
    expect(
      [...fake.store.keys()].some((k) => k.startsWith("mapsly:test:double:")),
    ).toBe(true);
  });

  test("hit returns cached value without calling fn again", async () => {
    const fn = vi.fn(async (n: number) => n * 2);
    const cached = kvCache("test:double", { ttl: 60 }, fn);

    const first = await cached(21);
    const second = await cached(21);
    expect(first).toBe(42);
    expect(second).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("different args land in different keys", async () => {
    const fn = vi.fn(async (n: number) => n * 2);
    const cached = kvCache("test:double", { ttl: 60 }, fn);

    await cached(1);
    await cached(2);
    await cached(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("identical args with different object key order share a cache entry", async () => {
    const fn = vi.fn(async (params: Record<string, unknown>) => params);
    const cached = kvCache("test:obj", { ttl: 60 }, fn);

    await cached({ a: 1, b: 2 });
    await cached({ b: 2, a: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("kvCache · TTL expiry", () => {
  test("expired entries are re-fetched", async () => {
    const fn = vi.fn(async () => "v1");
    const cached = kvCache("test:exp", { ttl: 1 }, fn);

    await cached();
    expect(fn).toHaveBeenCalledTimes(1);

    for (const [k, v] of fake.store) {
      fake.store.set(k, { ...v, expiresAt: Date.now() - 1 });
    }

    fn.mockResolvedValueOnce("v2");
    const fresh = await cached();
    expect(fresh).toBe("v2");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("kvCache · KV unavailable", () => {
  test("falls through to direct fn calls", async () => {
    __setKvClientForTest(null);
    const savedUrl = process.env.KV_REST_API_URL;
    const savedKvUrl = process.env.KV_URL;
    const savedRo = process.env.KV_REST_API_READ_ONLY_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_URL;
    delete process.env.KV_REST_API_READ_ONLY_TOKEN;

    try {
      const fn = vi.fn(async (n: number) => n + 1);
      const cached = kvCache("test:noredis", { ttl: 60 }, fn);

      const a = await cached(1);
      const b = await cached(1);
      expect(a).toBe(2);
      expect(b).toBe(2);
      expect(fn).toHaveBeenCalledTimes(2);
    } finally {
      if (savedUrl !== undefined) process.env.KV_REST_API_URL = savedUrl;
      if (savedKvUrl !== undefined) process.env.KV_URL = savedKvUrl;
      if (savedRo !== undefined)
        process.env.KV_REST_API_READ_ONLY_TOKEN = savedRo;
    }
  });
});

describe("kvCache · KV runtime errors", () => {
  test("get failure → fn runs, caller still gets value", async () => {
    const exploding: KvClient = {
      async get() {
        throw new Error("connection refused");
      },
      async set() {
        return "OK";
      },
      async del() {
        return 0;
      },
      async scan() {
        return ["0", []];
      },
    };
    __setKvClientForTest(exploding);

    const fn = vi.fn(async () => "the value");
    const cached = kvCache("test:err", { ttl: 60 }, fn);

    const out = await cached();
    expect(out).toBe("the value");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("set failure → caller still gets value, never throws", async () => {
    const halfBroken: KvClient = {
      async get() {
        return null;
      },
      async set() {
        throw new Error("write timeout");
      },
      async del() {
        return 0;
      },
      async scan() {
        return ["0", []];
      },
    };
    __setKvClientForTest(halfBroken);

    const fn = vi.fn(async () => "the value");
    const cached = kvCache("test:err2", { ttl: 60 }, fn);

    const out = await cached();
    expect(out).toBe("the value");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("kvCache · CronRun.meta.cacheHits telemetry", () => {
  test("hit bumps meta.cacheHits via prisma jsonb_set when a CronRun is open", async () => {
    mocks.currentRun.value = {
      id: "run_abc",
      job: "weekly:test",
      startedAt: new Date(),
    };

    const fn = vi.fn(async () => "v");
    const cached = kvCache("test:hit", { ttl: 60 }, fn);

    await cached();
    await cached();

    await new Promise((r) => setTimeout(r, 5));

    expect(mocks.prismaExecuteRaw).toHaveBeenCalledTimes(1);
    const callArgs = mocks.prismaExecuteRaw.mock.calls[0];
    const tail = callArgs.slice(1);
    expect(tail).toContain("run_abc");
  });

  test("no CronRun open → no telemetry write, no error", async () => {
    mocks.currentRun.value = null;

    const fn = vi.fn(async () => "v");
    const cached = kvCache("test:hit2", { ttl: 60 }, fn);

    await cached();
    await cached();
    await new Promise((r) => setTimeout(r, 5));

    expect(mocks.prismaExecuteRaw).not.toHaveBeenCalled();
  });
});

describe("invalidateCacheTag", () => {
  test("drops every key written under the tag", async () => {
    const fnA = vi.fn(async (n: number) => n);
    const fnB = vi.fn(async (n: number) => n + 100);
    const cachedA = kvCache("dfs:maps", { ttl: 60 }, fnA);
    const cachedB = kvCache("dfs:reviews", { ttl: 60 }, fnB);

    await cachedA(1);
    await cachedA(2);
    await cachedB(1);

    const removed = await invalidateCacheTag("dfs:maps");
    expect(removed).toBe(2);

    await cachedA(1);
    expect(fnA).toHaveBeenCalledTimes(3);

    await cachedB(1);
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  test("returns 0 when KV is unavailable", async () => {
    __setKvClientForTest(null);
    const savedUrl = process.env.KV_REST_API_URL;
    const savedKvUrl = process.env.KV_URL;
    const savedRo = process.env.KV_REST_API_READ_ONLY_TOKEN;
    delete process.env.KV_REST_API_URL;
    delete process.env.KV_URL;
    delete process.env.KV_REST_API_READ_ONLY_TOKEN;

    try {
      const removed = await invalidateCacheTag("any-tag");
      expect(removed).toBe(0);
    } finally {
      if (savedUrl !== undefined) process.env.KV_REST_API_URL = savedUrl;
      if (savedKvUrl !== undefined) process.env.KV_URL = savedKvUrl;
      if (savedRo !== undefined)
        process.env.KV_REST_API_READ_ONLY_TOKEN = savedRo;
    }
  });

  test("rejects empty tag", async () => {
    await expect(invalidateCacheTag("")).rejects.toThrow(/non-empty/);
  });
});

describe("kvCache · input validation", () => {
  test("rejects empty keyPrefix", () => {
    expect(() => kvCache("", { ttl: 60 }, async () => 0)).toThrow(/keyPrefix/);
  });

  test("rejects non-positive ttl", () => {
    expect(() => kvCache("ok", { ttl: 0 }, async () => 0)).toThrow(/ttl/);
    expect(() => kvCache("ok", { ttl: -1 }, async () => 0)).toThrow(/ttl/);
    expect(() => kvCache("ok", { ttl: NaN }, async () => 0)).toThrow(/ttl/);
  });
});
