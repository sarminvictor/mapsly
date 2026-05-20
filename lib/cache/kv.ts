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
// Required env (any ONE of these pairs is enough to be considered configured):
//   - KV_REST_API_URL + KV_REST_API_TOKEN     (Vercel KV REST · canonical)
//   - KV_URL                                  (TLS rediss:// for some bindings)

import { kv as vercelKv } from "@vercel/kv";

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
 */
export function isKvAvailable(): boolean {
  if (testOverride) return true;
  return Boolean(
    process.env.KV_REST_API_URL ??
    process.env.KV_URL ??
    process.env.KV_REST_API_READ_ONLY_TOKEN,
  );
}

/**
 * Returns the configured KV client, or `null` if KV is not configured.
 *
 * Never throws. Callers must handle the null case and either skip the cache
 * (`kvCache` does this) or surface the unconfigured state.
 */
export function getKv(): KvClient | null {
  if (testOverride) return testOverride;
  if (!isKvAvailable()) return null;
  if (cached) return cached;
  cached = vercelKv as unknown as KvClient;
  return cached;
}

/**
 * TEST ONLY · replaces the KV client with an in-memory fake. Pass `null` to
 * clear the override. Production code paths never call this.
 */
export function __setKvClientForTest(client: KvClient | null): void {
  testOverride = client;
  cached = null;
}
