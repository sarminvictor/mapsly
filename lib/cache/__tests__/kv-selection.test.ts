/**
 * Tests for getKv() · the transport-selection logic.
 *
 * Two transports are supported:
 *   - REDIS_URL  → ioredis client (preferred · direct rediss://)
 *   - KV_REST_API_URL → @vercel/kv (HTTPS REST · Upstash legacy binding)
 *
 * The selection priority + isKvAvailable() behavior is what we lock in here.
 * We mock @vercel/kv + redis-client so no real network/connections fire.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { redisCreateMock, vercelKvMock } = vi.hoisted(() => ({
  redisCreateMock: vi.fn(),
  vercelKvMock: { get: vi.fn(), set: vi.fn(), del: vi.fn(), scan: vi.fn() },
}));

vi.mock("@vercel/kv", () => ({ kv: vercelKvMock }));

vi.mock("../redis-client", () => ({
  createRedisKvClient: redisCreateMock,
  isRedisUrlConfigured: () =>
    Boolean(process.env.REDIS_URL ?? process.env.KV_URL),
}));

// Import AFTER mocks so the SUT pulls our fakes.
import { getKv, isKvAvailable, __setKvClientForTest } from "../kv";

// Snapshot + restore env between tests · these vars steer the selection.
const ENV_KEYS = [
  "REDIS_URL",
  "KV_URL",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "KV_REST_API_READ_ONLY_TOKEN",
] as const;
let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  redisCreateMock.mockReset();
  __setKvClientForTest(null);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = saved[k];
    if (v !== undefined) process.env[k] = v;
    else delete process.env[k];
  }
  __setKvClientForTest(null);
});

describe("isKvAvailable", () => {
  test("false when no env vars set", () => {
    expect(isKvAvailable()).toBe(false);
  });

  test("true when REDIS_URL is set", () => {
    process.env.REDIS_URL = "rediss://default:pass@host:6379";
    expect(isKvAvailable()).toBe(true);
  });

  test("true when KV_REST_API_URL is set", () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io";
    expect(isKvAvailable()).toBe(true);
  });

  test("true when KV_URL is set (legacy alias)", () => {
    process.env.KV_URL = "rediss://default:pass@host:6379";
    expect(isKvAvailable()).toBe(true);
  });
});

describe("getKv · transport selection", () => {
  test("REDIS_URL wins over KV_REST_API_URL · direct rediss:// is preferred", () => {
    process.env.REDIS_URL = "rediss://default:pass@host:6379";
    process.env.KV_REST_API_URL = "https://example.upstash.io";
    const fakeRedisClient = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      scan: vi.fn(),
    };
    redisCreateMock.mockReturnValueOnce(fakeRedisClient);

    const client = getKv();
    expect(client).toBe(fakeRedisClient);
    expect(redisCreateMock).toHaveBeenCalledOnce();
  });

  test("falls back to @vercel/kv when only KV_REST_API_URL is set", () => {
    process.env.KV_REST_API_URL = "https://example.upstash.io";

    const client = getKv();
    expect(client).toBe(vercelKvMock);
    expect(redisCreateMock).not.toHaveBeenCalled();
  });

  test("returns null when no transport is configured", () => {
    expect(getKv()).toBeNull();
  });

  test("caches the client across calls · doesn't reconnect every invocation", () => {
    process.env.REDIS_URL = "rediss://default:pass@host:6379";
    const fakeRedisClient = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
      scan: vi.fn(),
    };
    redisCreateMock.mockReturnValueOnce(fakeRedisClient);

    const a = getKv();
    const b = getKv();
    expect(a).toBe(b);
    // createRedisKvClient called exactly once · second getKv() hits the cache.
    expect(redisCreateMock).toHaveBeenCalledOnce();
  });

  test("falls back from Redis to REST if createRedisKvClient returns null", () => {
    process.env.REDIS_URL = "rediss://default:pass@host:6379";
    process.env.KV_REST_API_URL = "https://example.upstash.io";
    // Simulate redis-client returning null (e.g. lazy connect failure)
    redisCreateMock.mockReturnValueOnce(null);

    const client = getKv();
    expect(client).toBe(vercelKvMock);
  });
});
