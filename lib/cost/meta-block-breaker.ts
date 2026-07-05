// lib/cost/meta-block-breaker.ts · R2 · circuit breaker + retry budget for the
// Meta Ad Library actor (audit §9).
//
// PROBLEM: when Meta hard-blocks (a bad IP window, a doc_id rotation, a
// datacenter-wide soft-block), every cell run comes back `blocked` and we keep
// paying Apify residential proxy $ to hit the same wall — and a naive re-queue
// amplifies it (retry storm). R0 already stops caching a blocked "0"; R2 stops
// PAYING to discover it, and caps retry amplification.
//
// Two pure primitives here (deterministic, unit-tested, no Redis):
//   1. a block-rate CIRCUIT BREAKER — CLOSED (run normally) → OPEN (skip runs
//      for a cooldown when the recent block-rate is too high) → HALF_OPEN (let
//      ONE probe through to test recovery) → CLOSED (probe verified) / OPEN
//      (probe still blocked).
//   2. a token-bucket RETRY BUDGET — cap Meta re-queues per hour so a hard block
//      can't cause retry amplification.
// Plus a FULL-JITTER backoff for any runtime re-queue path.
//
// The Redis wrappers below are thin GET→decide→SET around these primitives and
// DEGRADE OPEN (allow the run) on any Redis miss/error — per
// `.claude/rules/incident-prevention.md`, the breaker is a cost OPTIMIZATION,
// never a load-bearing dependency. A breaker outage must never stall the cron.
//
// Redis-only, server-side only (never a cacheComponents render path) — same
// posture as lib/enrichment/token-bucket-redis.ts.

import { createRedisKvClient } from "@/lib/cache/redis-client";

// TODO(follow-up · R3): paid third-party API fallback (ScrapeCreators / SerpApi)
// for cells the breaker keeps re-OPENing on — a last-resort path for stubborn
// `blocked` cells the browser-only scraper can't clear. DEFERRED: needs a new
// vendor + Viktor's $ approval (a new metered API call in the cost path), so it
// is NOT implemented here. When approved, wire it as the `HALF_OPEN`-probe
// alternative: if the direct actor probe still blocks, fall to the paid API
// before re-OPENing, and cap it under `product-spec.json#budgets`.
//
// TODO(follow-up · R3): EU/UK `ads_archive` cross-check to CALIBRATE the block
// detector (a cell that the official DSA archive shows as active but our scraper
// returns 0 for is a probable block, not an empty). DEFERRED: low value for the
// US/CA market (the archive only covers EU/UK-delivered ads), so it's a
// calibration aid, not a data source — revisit only if block-rate SLOs regress.

// ── Pure circuit breaker ───────────────────────────────────────────────────

export type BreakerPhase = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface BreakerState {
  phase: BreakerPhase;
  /** Rolling outcome counts within the current sampling window. */
  blocked: number;
  verified: number;
  /** Epoch ms the current window opened (CLOSED sampling) — resets on rollover. */
  windowStartMs: number;
  /** Epoch ms the breaker OPENed — cooldown is measured from here. */
  openedAtMs: number;
}

export interface BreakerConfig {
  /** Min samples before the block-rate can trip the breaker (avoid n=1 trips). */
  minSamples: number;
  /** Block-rate (0–1) at/above which the breaker OPENs. */
  tripRate: number;
  /** Cooldown (ms) OPEN → HALF_OPEN — how long we stop paying to hit the wall. */
  cooldownMs: number;
  /** Sampling window (ms) — CLOSED counts roll over after this so a long-ago
   *  block-spike doesn't keep the breaker paranoid forever. */
  windowMs: number;
}

/** Meta Ad Library defaults — tuned for a low-volume cron (a few cells/tick). */
export const META_BREAKER_CONFIG: BreakerConfig = {
  minSamples: 5,
  tripRate: 0.6, // ≥60% of recent runs blocked → stop burning proxy $
  cooldownMs: 30 * 60 * 1000, // 30 min before a half-open probe
  windowMs: 60 * 60 * 1000, // 1h rolling sample window
};

export function freshBreaker(nowMs: number): BreakerState {
  return {
    phase: "CLOSED",
    blocked: 0,
    verified: 0,
    windowStartMs: nowMs,
    openedAtMs: 0,
  };
}

/** Recent block-rate in [0,1]; 0 when no samples. Pure. */
export function blockRate(state: BreakerState): number {
  const total = state.blocked + state.verified;
  return total === 0 ? 0 : state.blocked / total;
}

/**
 * Decide whether a Meta cell run should proceed RIGHT NOW, given the breaker's
 * current state + clock. Pure — no mutation. The caller acts on `.allow` and
 * persists `.state` (which may transition OPEN→HALF_OPEN on cooldown expiry).
 *   - CLOSED    → allow (normal operation)
 *   - OPEN      → skip until cooldown elapses, then flip to HALF_OPEN + allow ONE
 *                 probe
 *   - HALF_OPEN → the single probe is already in flight; skip further runs until
 *                 it reports back (recordOutcome closes or re-opens the breaker)
 */
export interface BreakerDecision {
  allow: boolean;
  state: BreakerState;
  /** "probe" when this allow is the half-open recovery probe (caller may log). */
  reason: "closed" | "probe" | "open-cooldown" | "half-open-inflight";
}

export function decideRun(
  state: BreakerState,
  config: BreakerConfig,
  nowMs: number,
): BreakerDecision {
  if (state.phase === "CLOSED") {
    return { allow: true, state, reason: "closed" };
  }
  if (state.phase === "OPEN") {
    const cooled = nowMs - state.openedAtMs >= config.cooldownMs;
    if (cooled) {
      // Cooldown elapsed → let ONE probe through to test recovery.
      return {
        allow: true,
        state: { ...state, phase: "HALF_OPEN" },
        reason: "probe",
      };
    }
    return { allow: false, state, reason: "open-cooldown" };
  }
  // HALF_OPEN: a probe is already in flight — hold everything else back.
  return { allow: false, state, reason: "half-open-inflight" };
}

/**
 * Fold one run outcome into the breaker + apply the state machine. Pure.
 *   - a `verified` (ok/empty_verified) probe in HALF_OPEN → CLOSE (recovered);
 *   - a `blocked` probe in HALF_OPEN → re-OPEN (still walled, restart cooldown);
 *   - in CLOSED, roll the window; trip to OPEN once block-rate ≥ tripRate with
 *     ≥ minSamples.
 * `verified` = the run reached Meta's data query (ok/empty_verified/partial);
 * `blocked`  = blocked/timeout/error (never reached data).
 */
export function recordOutcome(
  state: BreakerState,
  config: BreakerConfig,
  nowMs: number,
  verified: boolean,
): BreakerState {
  if (state.phase === "HALF_OPEN") {
    return verified
      ? freshBreaker(nowMs) // recovered → CLOSED, counts reset
      : { ...freshBreaker(nowMs), phase: "OPEN", openedAtMs: nowMs }; // still walled
  }

  // CLOSED: roll the sampling window if it's stale, then count.
  let s = state;
  if (nowMs - s.windowStartMs > config.windowMs) {
    s = freshBreaker(nowMs);
  }
  s = verified
    ? { ...s, verified: s.verified + 1 }
    : { ...s, blocked: s.blocked + 1 };

  const total = s.blocked + s.verified;
  if (total >= config.minSamples && blockRate(s) >= config.tripRate) {
    return { ...s, phase: "OPEN", openedAtMs: nowMs };
  }
  return s;
}

// ── Full-jitter backoff (runtime re-queue paths ONLY) ───────────────────────

/**
 * Full-jitter backoff delay: `random(0, min(cap, base × 2^attempt))`.
 * `attempt` is 0-based. `rand` is injectable for tests; it defaults to
 * `Math.random`. CALLERS MUST ONLY use this in runtime code (cron/consumer/
 * re-queue) — never in a cacheComponents render path (Math.random is forbidden
 * there · INC-09). The default-arg call site keeps that boundary explicit.
 */
export function fullJitterBackoffMs(
  attempt: number,
  baseMs: number,
  capMs: number,
  rand: () => number = Math.random,
): number {
  const exp = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.floor(rand() * exp);
}

// ── Redis-backed wrappers (degrade OPEN) ────────────────────────────────────

const BREAKER_KEY = "metaads:breaker";
/** State TTL — long enough to hold a cooldown, short enough to self-heal. */
const BREAKER_TTL_SEC = 2 * 60 * 60;

/** Retry-budget bucket key (token-bucket, shared shape with rate-limit.ts). */
const RETRY_BUDGET_KEY = "metaads:retrybudget";
/** Meta re-queue budget: 20 retries/hour with a small burst. Generous enough
 *  for normal churn, tight enough to cap a retry storm. */
const RETRY_REFILL_PER_SEC = 20 / 3600;
const RETRY_BURST = 20;
const RETRY_BUDGET_TTL_SEC = 2 * 60 * 60;

function readBreakerState(raw: unknown, nowMs: number): BreakerState {
  if (
    raw &&
    typeof raw === "object" &&
    typeof (raw as BreakerState).phase === "string" &&
    typeof (raw as BreakerState).blocked === "number"
  ) {
    return raw as BreakerState;
  }
  return freshBreaker(nowMs);
}

/**
 * Gate: should a Meta cell run proceed now? Consults the Redis-persisted breaker
 * and, on OPEN cooldown, transitions to HALF_OPEN + persists that so exactly ONE
 * probe leaks through. DEGRADES OPEN (allow=true) when Redis is absent/errors —
 * a breaker outage must not stall the cron. Server-side only.
 */
export async function shouldRunMetaCell(
  opts: { nowMs?: () => number; config?: BreakerConfig } = {},
): Promise<{ allow: boolean; reason: BreakerDecision["reason"] }> {
  const now = (opts.nowMs ?? (() => Date.now()))();
  const config = opts.config ?? META_BREAKER_CONFIG;
  const kv = createRedisKvClient();
  if (!kv) return { allow: true, reason: "closed" }; // no Redis → no breaker
  try {
    const stored = await kv.get<BreakerState>(BREAKER_KEY);
    const state = readBreakerState(stored, now);
    const decision = decideRun(state, config, now);
    // Persist a phase transition (OPEN→HALF_OPEN) so only one probe leaks out.
    if (decision.state !== state) {
      await kv.set(BREAKER_KEY, decision.state, { ex: BREAKER_TTL_SEC });
    }
    return { allow: decision.allow, reason: decision.reason };
  } catch {
    return { allow: true, reason: "closed" }; // degrade open
  }
}

/**
 * Record a Meta cell run outcome into the Redis breaker. `verified` = the run
 * reached Meta's data query (ok/empty_verified/partial); false = blocked/
 * timeout/error. Best-effort — a persist failure just means the breaker learns
 * one sample slower. Server-side only.
 */
export async function recordMetaCellOutcome(
  verified: boolean,
  opts: { nowMs?: () => number; config?: BreakerConfig } = {},
): Promise<void> {
  const now = (opts.nowMs ?? (() => Date.now()))();
  const config = opts.config ?? META_BREAKER_CONFIG;
  const kv = createRedisKvClient();
  if (!kv) return;
  try {
    const stored = await kv.get<BreakerState>(BREAKER_KEY);
    const state = readBreakerState(stored, now);
    const next = recordOutcome(state, config, now, verified);
    await kv.set(BREAKER_KEY, next, { ex: BREAKER_TTL_SEC });
  } catch {
    /* best-effort — breaker is an optimization */
  }
}

// ── Retry budget (token-bucket over Redis) ──────────────────────────────────

interface RetryBucket {
  tokens: number;
  lastRefillMs: number;
}

/**
 * Consume ONE Meta re-queue token. Returns true if the re-queue is within
 * budget, false if the hourly cap is hit (caller should DEFER, not re-queue).
 * DEGRADES OPEN (returns true) when Redis is absent/errors — a budget outage
 * must not block a legitimate retry. Pure token-bucket math inline (small +
 * self-contained; the enrichment bucket in rate-limit.ts is vendor-req pacing,
 * a different concern). Server-side only.
 */
export async function consumeMetaRetryToken(
  opts: { nowMs?: () => number } = {},
): Promise<boolean> {
  const now = (opts.nowMs ?? (() => Date.now()))();
  const kv = createRedisKvClient();
  if (!kv) return true; // no Redis → no cap (degrade open)
  try {
    const stored = await kv.get<RetryBucket>(RETRY_BUDGET_KEY);
    const bucket = decideRetryToken(stored, now);
    await kv.set(RETRY_BUDGET_KEY, bucket.state, { ex: RETRY_BUDGET_TTL_SEC });
    return bucket.allowed;
  } catch {
    return true; // degrade open
  }
}

/** Pure token-bucket step for the retry budget. Refills for elapsed time, then
 *  consumes one token if available. Exported for unit tests. */
export function decideRetryToken(
  stored: RetryBucket | null | undefined,
  nowMs: number,
): { allowed: boolean; state: RetryBucket } {
  const prev: RetryBucket =
    stored && typeof stored.tokens === "number"
      ? stored
      : { tokens: RETRY_BURST, lastRefillMs: nowMs };
  const elapsedSec = Math.max(0, (nowMs - prev.lastRefillMs) / 1000);
  const tokens = Math.min(
    RETRY_BURST,
    prev.tokens + elapsedSec * RETRY_REFILL_PER_SEC,
  );
  if (tokens >= 1) {
    return {
      allowed: true,
      state: { tokens: tokens - 1, lastRefillMs: nowMs },
    };
  }
  return { allowed: false, state: { tokens, lastRefillMs: nowMs } };
}
