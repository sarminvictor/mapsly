// lib/enrichment/rate-limit.ts · pure token-bucket algorithm (Phase 3).
//
// The on-demand enrichment workers must respect vendor rate limits (DataForSEO
// ~10 req/s, Anthropic/OpenAI ~50 rpm, Apify low concurrency). The bucket STATE
// lives in Redis (shared across serverless invocations); this module is the
// pure algorithm over that state so it's deterministic + unit-testable. The
// Redis wrapper just GET/SETs `TokenBucketState` around `tryConsume`.

export interface TokenBucketConfig {
  /** Sustained refill rate (tokens per second). */
  ratePerSec: number;
  /** Max tokens (burst capacity). */
  burst: number;
}

export interface TokenBucketState {
  tokens: number;
  lastRefillMs: number;
}

/** Vendor limits with headroom under the published caps. */
export const RATE_LIMITS: Record<string, TokenBucketConfig> = {
  // DataForSEO 30 simultaneous / 2000 rpm → 10 req/s is comfortably under.
  dataforseo: { ratePerSec: 10, burst: 10 },
  // OpenAI/Anthropic ~50 rpm.
  ai: { ratePerSec: 50 / 60, burst: 10 },
  // Apify actor runs — keep concurrency low.
  apify: { ratePerSec: 1, burst: 2 },
};

/** A fresh, full bucket. */
export function fullBucket(
  config: TokenBucketConfig,
  nowMs: number,
): TokenBucketState {
  return { tokens: config.burst, lastRefillMs: nowMs };
}

/** Refill tokens for the elapsed time, capped at burst. Pure. */
export function refill(
  state: TokenBucketState,
  config: TokenBucketConfig,
  nowMs: number,
): TokenBucketState {
  const elapsedSec = Math.max(0, (nowMs - state.lastRefillMs) / 1000);
  const tokens = Math.min(
    config.burst,
    state.tokens + elapsedSec * config.ratePerSec,
  );
  return { tokens, lastRefillMs: nowMs };
}

export interface ConsumeResult {
  state: TokenBucketState;
  allowed: boolean;
}

/**
 * Try to consume `cost` tokens. Refills first, then consumes if available.
 * Returns the new state + whether the request is allowed. Pure.
 */
export function tryConsume(
  state: TokenBucketState,
  config: TokenBucketConfig,
  nowMs: number,
  cost = 1,
): ConsumeResult {
  const refilled = refill(state, config, nowMs);
  if (refilled.tokens >= cost) {
    return {
      state: { tokens: refilled.tokens - cost, lastRefillMs: nowMs },
      allowed: true,
    };
  }
  return { state: refilled, allowed: false };
}

/** Milliseconds until `cost` tokens will be available (0 if already). Pure. */
export function msUntilAvailable(
  state: TokenBucketState,
  config: TokenBucketConfig,
  nowMs: number,
  cost = 1,
): number {
  const refilled = refill(state, config, nowMs);
  if (refilled.tokens >= cost) return 0;
  const deficit = cost - refilled.tokens;
  return Math.ceil((deficit / config.ratePerSec) * 1000);
}
