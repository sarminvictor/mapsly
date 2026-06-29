// Tests for the Redis-backed vendor pacing wrapper. The pure token-bucket math
// is covered in rate-limit.test.ts; here we assert the two glue invariants:
//   - degrade OPEN when Redis is absent (never block a worker on a cache miss);
//   - pace against the bucket (sleep) then proceed once tokens refill.

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/cache/redis-client", () => ({ createRedisKvClient: vi.fn() }));

import { createRedisKvClient } from "@/lib/cache/redis-client";
import { acquireVendorToken } from "../token-bucket-redis";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockKv = createRedisKvClient as any;

beforeEach(() => vi.clearAllMocks());

describe("acquireVendorToken", () => {
  test("degrades open (returns immediately) when Redis is absent", async () => {
    mockKv.mockReturnValue(null);
    const sleep = vi.fn(async () => {});
    await acquireVendorToken("dataforseo", { sleep, nowMs: () => 0 });
    expect(sleep).not.toHaveBeenCalled();
  });

  test("paces against an empty bucket, then proceeds once it refills", async () => {
    const store = new Map<string, unknown>();
    mockKv.mockReturnValue({
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: unknown) => {
        store.set(k, v);
      },
    });
    store.set("tb:dataforseo", { tokens: 0, lastRefillMs: 0 });

    let t = 0;
    const sleep = vi.fn(async (ms: number) => {
      t += ms;
    });
    await acquireVendorToken("dataforseo", {
      maxWaitMs: 1_000,
      nowMs: () => t,
      sleep,
    });

    // It denied at t=0 (slept at least once) then proceeded after the refill —
    // crucially it terminated rather than hanging.
    expect(sleep).toHaveBeenCalled();
  });
});
