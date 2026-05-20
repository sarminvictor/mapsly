// Cache layer · KV-backed adapter cache · 24h dedup.
//
// Purpose: every external API call from services/* should be deduplicated for
// 24h. Two identical calls (same vendor, same operation, same args) in the
// same 24h window should make ONE network round-trip and ONE cost charge.
// This lib is the seam.
//
// Pattern (per .claude/rules/caching.md Layer 2):
//
//   import { kvCache } from "@/lib/cache";
//
//   export const dataforSeoMapsSearch = kvCache(
//     "dfs:maps:search",
//     { ttl: 86_400 },                 // 24h in seconds
//     async (params: SearchParams) => { return await rawCall(params); },
//   );
//
// On call:
//   1. Hash the args into a stable suffix.
//   2. Key = `mapsly:{keyPrefix}:{hash}`.
//   3. KV GET. On hit → increment CronRun.meta.cacheHits, return cached value.
//   4. On miss → call fn, KV SET ex=ttl, return fresh value.
//   5. If KV is unavailable (not configured, network error) → call fn
//      directly, never touch KV. The wrapper is fail-open.
//
// Cost discipline note: kvCache does NOT call incrementCost. The wrapped fn
// (which is the actual network call) is typically further wrapped by
// withCostCounter — that one bills per-call. A cache HIT therefore does not
// fire withCostCounter, which is exactly the desired behavior (we saved a
// network call → we save the bill). See .claude/rules/cost-discipline.md.

import { createHash } from "node:crypto";
import prisma from "@/lib/prisma";
import { getCurrentCronRun } from "@/lib/cost/cost-counter";
import { getKv, isKvAvailable, type KvClient } from "@/lib/cache/kv";

export interface KvCacheOptions {
  /** Time-to-live in SECONDS. Required. Per cost-discipline.md, default of
   *  86_400 (24h) is the recommended dedup window for external APIs. */
  ttl: number;
  /**
   * Optional secondary index "tag" applied to every key written by this
   * wrapper. invalidateCacheTag(tag) deletes all keys with the tag.
   *
   * Defaults to the keyPrefix passed to kvCache, which is usually what you
   * want — `kvCache("dfs:maps:search", ...)` is invalidated by
   * `invalidateCacheTag("dfs:maps:search")`.
   *
   * The tag list per key is stored in a Redis SET at `mapsly:tag:{tag}`.
   * Best-effort: if KV is down, invalidation silently no-ops.
   */
  tag?: string;
}

/** Single shared warning state so we don't spam logs on every KV failure. */
let kvWarnedUnavailable = false;
let kvWarnedRuntimeError = false;

/**
 * Wrap a pure async fn with a KV-backed 24h dedup cache.
 *
 * - `keyPrefix` should be `{vendor}:{operation}`, e.g. `dfs:maps:search`,
 *   `meta:adlib:scan`, `lh:audit`. Mapsly canonical prefix is added.
 * - Args are hashed via stable JSON. Functions, Symbols, BigInts in args are
 *   rejected — they have no canonical serialization.
 * - The wrapped fn is called at most once per (keyPrefix, args-hash) per ttl
 *   window. Concurrent calls during a miss race the network — that's fine,
 *   the second SET overwrites the first with identical data.
 *
 * Never throws on KV errors. The cache is purely an optimization layer.
 */
export function kvCache<Args extends readonly unknown[], R>(
  keyPrefix: string,
  options: KvCacheOptions,
  fn: (...args: Args) => Promise<R>,
): (...args: Args) => Promise<R> {
  if (!keyPrefix || typeof keyPrefix !== "string") {
    throw new Error(
      `[lib/cache] kvCache requires a non-empty string keyPrefix, got ${JSON.stringify(keyPrefix)}`,
    );
  }
  if (!Number.isFinite(options.ttl) || options.ttl <= 0) {
    throw new Error(
      `[lib/cache] kvCache("${keyPrefix}") requires a positive ttl in seconds, got ${options.ttl}`,
    );
  }
  const tag = options.tag ?? keyPrefix;

  return async (...args: Args): Promise<R> => {
    const key = buildKey(keyPrefix, args);

    // 1. KV unavailable → straight through.
    if (!isKvAvailable()) {
      if (!kvWarnedUnavailable && process.env.NODE_ENV !== "test") {
        console.warn(
          `[lib/cache] KV not configured (no KV_REST_API_URL / KV_URL) — running uncached. ` +
            `Set up Vercel KV to enable 24h dedup. This warning logs once per process.`,
        );
        kvWarnedUnavailable = true;
      }
      return fn(...args);
    }

    const kv = getKv();
    if (!kv) return fn(...args);

    // 2. Try a cache read. Any error here is non-fatal — fall through.
    try {
      const cached = await kv.get<R>(key);
      if (cached !== null && cached !== undefined) {
        // Best-effort: bump CronRun.meta.cacheHits if a CronRun is open.
        recordCacheHit().catch(() => {
          /* swallow — telemetry is not load-bearing */
        });
        return cached;
      }
    } catch (err) {
      logKvRuntimeError("get", key, err);
      return fn(...args);
    }

    // 3. Miss → run the fn.
    const result = await fn(...args);

    // 4. Write through. Any error here is non-fatal — caller already has the
    //    fresh value; the cache just stays cold for one more cycle.
    try {
      await kv.set(key, result, { ex: options.ttl });
      // Index the key under the tag set so invalidateCacheTag can find it.
      await addToTagIndex(kv, tag, key, options.ttl);
    } catch (err) {
      logKvRuntimeError("set", key, err);
    }

    return result;
  };
}

/**
 * Drop every cache key written under the given tag. Use after a cron job
 * writes fresh data and you want the next adapter call to hit the network
 * (not the now-stale cache).
 *
 * Fail-soft: returns 0 if KV is unavailable, errors are logged once per
 * process. Tag-set is itself cleared by `del` after listing.
 */
export async function invalidateCacheTag(tag: string): Promise<number> {
  if (!tag) {
    throw new Error("[lib/cache] invalidateCacheTag requires a non-empty tag");
  }
  const kv = getKv();
  if (!kv) return 0;

  const tagKey = `mapsly:tag:${tag}`;

  // Approach: the tag-index is a normal SET key. We SCAN over its members
  // by storing a synthetic key `mapsly:tag:{tag}:m:{cachedKey}` that we can
  // discover via SCAN with MATCH. This avoids requiring SADD/SMEMBERS, which
  // some KV providers gate behind a feature flag.
  const pattern = `${tagKey}:m:*`;
  const keysToDelete: string[] = [];
  let cursor: string | number = 0;

  try {
    do {
      const [nextCursor, page] = await kv.scan(cursor, {
        match: pattern,
        count: 200,
      });
      for (const memberKey of page) {
        // Strip the `mapsly:tag:{tag}:m:` prefix to recover the cache key.
        const cacheKey = memberKey.slice(tagKey.length + 3);
        if (cacheKey) keysToDelete.push(cacheKey);
      }
      cursor = nextCursor;
    } while (String(cursor) !== "0");
  } catch (err) {
    logKvRuntimeError("scan", pattern, err);
    return 0;
  }

  if (keysToDelete.length === 0) return 0;

  try {
    // Delete the cache keys and their tag-member markers in one shot.
    const memberKeys = keysToDelete.map((k) => `${tagKey}:m:${k}`);
    await kv.del(...keysToDelete, ...memberKeys);
    return keysToDelete.length;
  } catch (err) {
    logKvRuntimeError("del", `tag:${tag}`, err);
    return 0;
  }
}

// ---- Internals ----------------------------------------------------------

/** Mapsly-namespaced key derivation. */
function buildKey(prefix: string, args: readonly unknown[]): string {
  const hash = stableHashArgs(args);
  return `mapsly:${prefix}:${hash}`;
}

/**
 * Stable hash of a function-call arg list. We canonicalize objects by sorting
 * keys recursively so { a: 1, b: 2 } and { b: 2, a: 1 } produce the same hash.
 *
 * Throws on Function / Symbol / BigInt values — these have no portable JSON
 * encoding and any silent fallback would mask cache poisoning bugs.
 */
export function stableHashArgs(args: readonly unknown[]): string {
  const canonical = canonicalize(args);
  return createHash("sha256")
    .update(JSON.stringify(canonical))
    .digest("hex")
    .slice(0, 16);
}

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return { __t: "Date", v: value.toISOString() };
  const t = typeof value;
  if (t === "function" || t === "symbol" || t === "bigint") {
    throw new Error(
      `[lib/cache] stableHashArgs cannot serialize ${t} — wrap or remove the argument`,
    );
  }
  if (t === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = canonicalize(obj[k]);
    return out;
  }
  // string / number / boolean / undefined
  return value;
}

/**
 * Atomically increment CronRun.meta.cacheHits using Postgres jsonb_set.
 * Returns silently if there is no open CronRun (telemetry only).
 *
 * Why raw SQL: Prisma has no first-class JSON increment. Read-modify-write
 * would race under concurrent cron handlers. `jsonb_set` over jsonb is
 * single-statement atomic.
 */
async function recordCacheHit(): Promise<void> {
  const run = getCurrentCronRun();
  if (!run) return;
  await prisma.$executeRaw`
    UPDATE "CronRun"
    SET meta = jsonb_set(
      COALESCE(meta, '{}'::jsonb),
      '{cacheHits}',
      to_jsonb(COALESCE((meta->>'cacheHits')::int, 0) + 1)
    )
    WHERE id = ${run.id}
  `;
}

/**
 * Add the cache key to the tag's secondary index. We use synthetic key
 * markers (one KV entry per (tag, cacheKey)) instead of a single SET so we
 * don't depend on SADD/SMEMBERS — keeps the surface tiny and portable.
 *
 * The markers expire with the same TTL as the cache value so they self-clean
 * even if invalidateCacheTag is never called.
 */
async function addToTagIndex(
  kv: KvClient,
  tag: string,
  cacheKey: string,
  ttl: number,
): Promise<void> {
  const marker = `mapsly:tag:${tag}:m:${cacheKey}`;
  await kv.set(marker, 1, { ex: ttl });
}

function logKvRuntimeError(op: string, key: string, err: unknown): void {
  if (process.env.NODE_ENV === "test") return;
  if (kvWarnedRuntimeError) return;
  kvWarnedRuntimeError = true;
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(
    `[lib/cache] KV ${op} failed for "${key}" — falling through to direct call. ` +
      `This warning logs once per process. Error: ${msg}`,
  );
}

/** TEST ONLY · resets warn-once flags so each test can assert log behavior. */
export function __resetCacheWarningsForTest(): void {
  kvWarnedUnavailable = false;
  kvWarnedRuntimeError = false;
}
