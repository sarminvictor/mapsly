// ioredis-backed KvClient · used when `REDIS_URL` is set instead of
// (or in addition to) `KV_REST_API_URL`.
//
// Why this file exists:
//   The Mapsly cache layer (lib/cache/index.ts · kvCache wrapper) was
//   originally built against `@vercel/kv` which speaks HTTPS REST to
//   Upstash. That requires KV_REST_API_URL + KV_REST_API_TOKEN. The
//   Vercel-Marketplace Redis integration provides `REDIS_URL` (a
//   rediss:// connection string) instead — incompatible with @vercel/kv.
//
//   This adapter wraps ioredis behind the same `KvClient` interface so
//   the rest of the cache module is provider-agnostic.
//
// Lazy connect · per `.claude/rules/security.md` § module-load env access,
// we don't open a Redis socket at import time. ioredis's `lazyConnect`
// option defers the TCP handshake until the first command, and our
// Proxy in kv.ts means even the construction is on-demand.
//
// Per `.claude/rules/incident-prevention.md`, we wrap every Redis call
// in try/catch · the cache is an OPTIMIZATION, never a load-bearing
// dependency. If Redis dies, `lib/cache/index.ts` falls through to
// calling the wrapped fn directly.

import Redis from "ioredis";

import type { KvClient } from "./kv";

/**
 * Resolve the connection string. Order of precedence:
 *   1. `REDIS_URL`             · canonical (Vercel Marketplace + Render + most providers)
 *   2. `KV_URL`                · alias used by older Vercel KV bindings (rediss://)
 * Returns null if neither is set.
 */
function readRedisUrl(): string | null {
  return process.env.REDIS_URL ?? process.env.KV_URL ?? null;
}

let _client: Redis | null = null;

/**
 * Lazy ioredis instance. Created on first call · reused across requests
 * (Fluid Compute instance reuse) so we don't pay the connect cost every
 * invocation.
 *
 * `lazyConnect: true` defers TCP setup to the first command; that means
 * a Redis outage doesn't crash module-load — it surfaces as a per-call
 * error which our kvCache wrapper catches.
 *
 * `maxRetriesPerRequest: 1` keeps tail latency low · we'd rather fall
 * through to the upstream call than wait on Redis retries.
 */
function getOrCreateRedis(): Redis | null {
  if (_client) return _client;
  const url = readRedisUrl();
  if (!url) return null;
  _client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    // Connection-level retry: 3 attempts at 100/200/400ms · then give up.
    retryStrategy: (times) =>
      times > 3 ? null : Math.min(100 * 2 ** times, 1000),
    // Stay quiet on dropped connections · the cache layer handles errors.
    enableOfflineQueue: false,
  });
  // Swallow connection errors at the EventEmitter level so they don't
  // unhandled-reject the function. Per-call try/catch handles propagation.
  _client.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.warn(
      `[lib/cache/redis] connection error · ${err instanceof Error ? err.message : String(err)}`,
    );
  });
  return _client;
}

/**
 * Build the KvClient surface from an ioredis instance.
 *
 * Serialization · we store values as JSON strings (same as @vercel/kv
 * does internally) so `get<T>()` round-trips typed data.
 */
export function createRedisKvClient(): KvClient | null {
  const redis = getOrCreateRedis();
  if (!redis) return null;

  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      const raw = await redis.get(key);
      if (raw === null || raw === undefined) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        // Stored as a non-JSON literal (rare · only if a non-kvCache
        // caller wrote here). Return the raw string cast to T.
        return raw as unknown as T;
      }
    },

    async set(
      key: string,
      value: unknown,
      opts?: { ex?: number; px?: number },
    ): Promise<unknown> {
      const serialized = JSON.stringify(value);
      if (opts?.ex != null) {
        return redis.set(key, serialized, "EX", opts.ex);
      }
      if (opts?.px != null) {
        return redis.set(key, serialized, "PX", opts.px);
      }
      return redis.set(key, serialized);
    },

    async del(...keys: string[]): Promise<number> {
      if (keys.length === 0) return 0;
      return redis.del(...keys);
    },

    /**
     * Mimics @vercel/kv's scan() shape · returns [nextCursor, keysFound].
     * Caller iterates until cursor === '0'.
     *
     * ioredis variadic syntax: `scan(cursor, "MATCH", pattern, "COUNT", n)`.
     */
    async scan(
      cursor: number | string,
      opts?: { match?: string; count?: number },
    ): Promise<[string | number, string[]]> {
      const match = opts?.match ?? "*";
      const count = opts?.count ?? 100;
      const result = await redis.scan(
        String(cursor),
        "MATCH",
        match,
        "COUNT",
        String(count),
      );
      // ioredis returns [nextCursor, keys]
      return [result[0], result[1]];
    },
  };
}

/**
 * TEST ONLY · forcibly drops the cached ioredis instance so tests can
 * re-init with different env vars. Never called in production.
 */
export function __resetRedisClientForTest(): void {
  if (_client) {
    try {
      _client.disconnect();
    } catch {
      /* swallow */
    }
  }
  _client = null;
}

/** Returns true iff REDIS_URL or KV_URL is set in the env. */
export function isRedisUrlConfigured(): boolean {
  return readRedisUrl() !== null;
}
