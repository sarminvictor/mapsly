// lib/enrichment/token-bucket-redis.ts · Redis-backed vendor pacing (Phase 3).
//
// The pure token-bucket algorithm lives in ./rate-limit.ts; this is the thin
// Redis read-modify-write wrapper around it that actually paces the on-demand
// enrichment workers so concurrent dispatch ticks never blow a vendor's req/s
// cap (DataForSEO ~10/s, OpenAI ~50 rpm, Apify low concurrency).
//
// The bucket STATE is a single Redis key per vendor (`tb:{vendor}`), GET → run
// tryConsume → SET. It's approximate pacing, not a hard distributed lock — two
// overlapping reads can each consume, but the limits carry generous headroom
// under the real vendor caps, so a small over-consume stays safe.
//
// Per `.claude/rules/incident-prevention.md`: the cache is an OPTIMIZATION,
// never load-bearing. If Redis is absent or errors, we DEGRADE OPEN (allow the
// call) rather than block the worker — a throttle outage must not stall
// enrichment.

import { createRedisKvClient } from "@/lib/cache/redis-client";

import {
  RATE_LIMITS,
  fullBucket,
  tryConsume,
  msUntilAvailable,
  type TokenBucketState,
} from "./rate-limit";

const STATE_TTL_SEC = 60; // a bucket idle this long resets to full (harmless)

function bucketKey(vendor: string): string {
  return `tb:${vendor}`;
}

/**
 * Try to consume `cost` tokens for `vendor` once. Returns whether it was allowed
 * and, if not, how many ms until enough tokens refill. Degrades OPEN on any
 * Redis miss/error (allowed=true).
 */
async function consumeOnce(
  vendor: string,
  cost: number,
  nowMs: number,
): Promise<{ allowed: boolean; msUntil: number }> {
  const config = RATE_LIMITS[vendor];
  if (!config) return { allowed: true, msUntil: 0 };
  const kv = createRedisKvClient();
  if (!kv) return { allowed: true, msUntil: 0 }; // no Redis → no pacing

  try {
    const stored = await kv.get<TokenBucketState>(bucketKey(vendor));
    const state =
      stored && typeof stored.tokens === "number"
        ? stored
        : fullBucket(config, nowMs);
    const { state: next, allowed } = tryConsume(state, config, nowMs, cost);
    await kv.set(bucketKey(vendor), next, { ex: STATE_TTL_SEC });
    return {
      allowed,
      msUntil: allowed ? 0 : msUntilAvailable(next, config, nowMs, cost),
    };
  } catch {
    return { allowed: true, msUntil: 0 }; // Redis hiccup → degrade open
  }
}

export interface AcquireOptions {
  /** Tokens to consume (default 1). */
  cost?: number;
  /** Hard cap on how long to wait before proceeding anyway (default 5s). */
  maxWaitMs?: number;
  /** Injectable clock (ms) for tests. */
  nowMs?: () => number;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Block (cooperatively) until a `vendor` token is available, then return. Caps
 * the total wait at `maxWaitMs` and proceeds anyway past that (degrade rather
 * than stall a cron forever). A no-op when Redis isn't configured.
 */
export async function acquireVendorToken(
  vendor: string,
  opts: AcquireOptions = {},
): Promise<void> {
  const cost = opts.cost ?? 1;
  const maxWaitMs = opts.maxWaitMs ?? 5_000;
  const now = opts.nowMs ?? (() => Date.now());
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let waited = 0;
  // Bounded loop: at most a few dozen iterations before the maxWait escape.
  for (let i = 0; i < 64; i++) {
    const { allowed, msUntil } = await consumeOnce(vendor, cost, now());
    if (allowed) return;
    if (waited >= maxWaitMs) return; // proceed anyway (degrade)
    const wait = Math.min(Math.max(msUntil, 25), maxWaitMs - waited, 1_000);
    await sleep(wait);
    waited += wait;
  }
}
