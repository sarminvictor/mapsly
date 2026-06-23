// Phase 3 · token-bucket rate limiter (the pure algorithm behind the Redis
// bucket the enrichment workers share).

import { describe, expect, test } from "vitest";
import {
  fullBucket,
  refill,
  tryConsume,
  msUntilAvailable,
  RATE_LIMITS,
} from "../rate-limit";

const cfg = { ratePerSec: 10, burst: 10 };
const t0 = 1_000_000;

describe("token bucket", () => {
  test("starts full at burst", () => {
    expect(fullBucket(cfg, t0).tokens).toBe(10);
  });

  test("consume drains tokens", () => {
    const s = fullBucket(cfg, t0);
    const r = tryConsume(s, cfg, t0);
    expect(r.allowed).toBe(true);
    expect(r.state.tokens).toBe(9);
  });

  test("denies when empty, then refills over time", () => {
    let s = fullBucket(cfg, t0);
    // drain all 10
    for (let i = 0; i < 10; i++) s = tryConsume(s, cfg, t0).state;
    const denied = tryConsume(s, cfg, t0);
    expect(denied.allowed).toBe(false);
    // 0.5s later → +5 tokens at 10/s
    const later = tryConsume(s, cfg, t0 + 500);
    expect(later.allowed).toBe(true);
    expect(refill(s, cfg, t0 + 500).tokens).toBeCloseTo(5, 5);
  });

  test("refill caps at burst", () => {
    const s = { tokens: 0, lastRefillMs: t0 };
    expect(refill(s, cfg, t0 + 10_000).tokens).toBe(10); // would be 100, capped
  });

  test("msUntilAvailable", () => {
    let s = fullBucket(cfg, t0);
    for (let i = 0; i < 10; i++) s = tryConsume(s, cfg, t0).state;
    expect(msUntilAvailable(s, cfg, t0)).toBe(100); // 1 token at 10/s = 100ms
    expect(msUntilAvailable(fullBucket(cfg, t0), cfg, t0)).toBe(0);
  });

  test("vendor limits are defined", () => {
    expect(RATE_LIMITS.dataforseo.ratePerSec).toBe(10);
    expect(RATE_LIMITS.ai.burst).toBe(10);
    expect(RATE_LIMITS.apify).toBeDefined();
  });
});
