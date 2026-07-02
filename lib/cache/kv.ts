// KV client wrapper · lazy, fail-soft.
//
// Why a wrapper, not just `import { kv } from "@vercel/kv"`:
//
//   1. @vercel/kv reads env vars at module import time. If the env is missing
//      (local dev without KV bound, Vercel build phase before env injection,
//      a test environment), naive use crashes. We need lazy access via Proxy
//      so import-time side effects never explode. Same pattern as INC-07 for
//      Prisma/Stripe clients.
//
//   2. We want a single source of truth for "is KV configured?" so the
//      kvCache() wrapper can fall through to direct fn calls when KV is
//      unavailable. Per the task description: "Falls through gracefully if
//      Redis unavailable."
//
//   3. Tests need to swap the client out without touching env vars or hitting
//      the network. The `__setKvClientForTest` helper makes that explicit.
//
//   4. Two transports are supported · we pick automatically per env:
//      a. `@vercel/kv` over HTTPS REST · when KV_REST_API_URL is set
//      b. `ioredis` over rediss:// · when REDIS_URL or KV_URL is set
//      This makes the cache work with any Redis provider (Vercel Marketplace
//      integrations like Upstash + Redis Cloud, self-hosted, etc.) without
//      forcing the REST endpoint.
//
// Required env (any ONE is enough to be considered configured):
//   - REDIS_URL                               (rediss://… · canonical for most providers)
//   - KV_REST_API_URL + KV_REST_API_TOKEN     (Vercel KV REST · Upstash HTTPS endpoint)
//   - KV_URL                                  (alias for REDIS_URL on legacy bindings)

import { kv as vercelKv } from "@vercel/kv";

import { createRedisKvClient, isRedisUrlConfigured } from "./redis-client";

/**
 * Subset of @vercel/kv methods we actually call. Keeps the surface small and
 * test mocks honest. We deliberately do NOT depend on every Redis-compatible
 * method @vercel/kv exposes — only the ones kvCache + invalidateCacheTag use.
 */
export interface KvClient {
  get<T = unknown>(key: string): Promise<T | null>;
  set(
    key: string,
    value: unknown,
    opts?: { ex?: number; px?: number },
  ): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  /**
   * SCAN-based prefix lookup. Used for tag invalidation. Returns
   * [nextCursor, keysFoundInThisPage]. Caller iterates until cursor === '0'.
   */
  scan(
    cursor: number | string,
    opts?: { match?: string; count?: number },
  ): Promise<[string | number, string[]]>;
  /**
   * Atomic INCR-BY (WP3-3 · run-progress counters). Optional because only the
   * ioredis-backed client implements it — callers must feature-detect
   * (`typeof kv.incr === "function"`) and degrade gracefully when absent
   * (@vercel/kv REST is cast to this interface and does not expose it here).
   * Returns the value AFTER incrementing.
   */
  incr?(key: string, by?: number): Promise<number>;
  /** Set a TTL (seconds) on an existing key. Optional · see `incr`. */
  expire?(key: string, seconds: number): Promise<number>;
}

let cached: KvClient | null = null;
let testOverride: KvClient | null = null;

/**
 * Returns `true` iff KV is configured in the current process env.
 *
 * In contexts where KV is not configured (Vercel build phase, local dev
 * without a KV binding, test envs), `kvCache` falls through and calls the
 * wrapped fn directly. This keeps the build green and lets developers iterate
 * without provisioning a KV instance.
 *
 * Accepts EITHER transport · REDIS_URL (ioredis) OR KV_REST_API_URL
 * (@vercel/kv REST). REDIS_URL wins when both are set (more direct, lower
 * latency · REST adds an HTTP hop).
 */
export function isKvAvailable(): boolean {
  if (testOverride) return true;
  return Boolean(
    process.env.REDIS_URL ??
    process.env.KV_REST_API_URL ??
    process.env.KV_URL ??
    process.env.KV_REST_API_READ_ONLY_TOKEN,
  );
}

/**
 * Returns the configured KV client, or `null` if KV is not configured.
 *
 * Selection logic:
 *   1. Test override always wins.
 *   2. If `REDIS_URL` (or `KV_URL`) is set · use the ioredis-backed client
 *      from redis-client.ts. This is the path Vercel Marketplace Redis
 *      integrations + Render Redis + most third-party providers expose.
 *   3. Otherwise if `KV_REST_API_URL` is set · use @vercel/kv (HTTPS REST,
 *      Upstash via the older Vercel KV integration).
 *
 * Never throws. Callers must handle the null case.
 */
export function getKv(): KvClient | null {
  if (testOverride) return testOverride;
  if (cached) return cached;

  // Prefer rediss:// connection when available · direct Redis is lower
  // latency than the REST hop for high-traffic cache use.
  if (isRedisUrlConfigured()) {
    const redisClient = createRedisKvClient();
    if (redisClient) {
      cached = redisClient;
      return cached;
    }
  }

  if (process.env.KV_REST_API_URL || process.env.KV_REST_API_READ_ONLY_TOKEN) {
    cached = vercelKv as unknown as KvClient;
    return cached;
  }

  return null;
}

/**
 * TEST ONLY · replaces the KV client with an in-memory fake. Pass `null` to
 * clear the override. Production code paths never call this.
 */
export function __setKvClientForTest(client: KvClient | null): void {
  testOverride = client;
  cached = null;
}
