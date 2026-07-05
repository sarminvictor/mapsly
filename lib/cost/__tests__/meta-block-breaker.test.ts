// Tests for the R2 Meta block-breaker PURE primitives (audit §9). We test the
// deterministic state machine + budget math, NOT the Redis glue (that degrades
// open by construction). Invariants: the breaker trips on a sustained block
// storm, cools down to a single half-open probe, closes on recovery, re-opens
// on a still-blocked probe; the retry budget caps re-queues; full-jitter stays
// within its cap.

import { describe, expect, test } from "vitest";

import {
  META_BREAKER_CONFIG,
  freshBreaker,
  blockRate,
  decideRun,
  recordOutcome,
  fullJitterBackoffMs,
  decideRetryToken,
} from "../meta-block-breaker";

const CFG = META_BREAKER_CONFIG;

describe("meta breaker · block-rate accounting", () => {
  test("a fresh breaker is CLOSED with 0 block-rate and allows runs", () => {
    const s = freshBreaker(0);
    expect(s.phase).toBe("CLOSED");
    expect(blockRate(s)).toBe(0);
    expect(decideRun(s, CFG, 0).allow).toBe(true);
  });

  test("stays CLOSED below minSamples even at 100% block-rate", () => {
    let s = freshBreaker(0);
    // minSamples-1 consecutive blocks → still CLOSED (avoid an n=1..4 trip).
    for (let i = 0; i < CFG.minSamples - 1; i++) {
      s = recordOutcome(s, CFG, 1000, /* verified */ false);
    }
    expect(s.phase).toBe("CLOSED");
    expect(decideRun(s, CFG, 1000).allow).toBe(true);
  });

  test("trips to OPEN once block-rate ≥ tripRate with ≥ minSamples", () => {
    let s = freshBreaker(0);
    for (let i = 0; i < CFG.minSamples; i++) {
      s = recordOutcome(s, CFG, 1000, false);
    }
    expect(s.phase).toBe("OPEN");
    expect(blockRate(s)).toBeGreaterThanOrEqual(CFG.tripRate);
    // OPEN skips runs during the cooldown.
    expect(decideRun(s, CFG, 1000).allow).toBe(false);
    expect(decideRun(s, CFG, 1000).reason).toBe("open-cooldown");
  });

  test("a mostly-verified window does NOT trip (block-rate under threshold)", () => {
    let s = freshBreaker(0);
    // 1 block + 9 verified = 10% block-rate, well under 60%.
    s = recordOutcome(s, CFG, 100, false);
    for (let i = 0; i < 9; i++) s = recordOutcome(s, CFG, 100, true);
    expect(s.phase).toBe("CLOSED");
    expect(decideRun(s, CFG, 100).allow).toBe(true);
  });
});

describe("meta breaker · cooldown → half-open → recovery", () => {
  function tripped(atMs: number) {
    let s = freshBreaker(atMs);
    for (let i = 0; i < CFG.minSamples; i++)
      s = recordOutcome(s, CFG, atMs, false);
    return s;
  }

  test("OPEN before cooldown skips; after cooldown emits exactly ONE probe", () => {
    const openedAt = 10_000;
    const s = tripped(openedAt);
    // Just before cooldown → still skipping.
    const early = decideRun(s, CFG, openedAt + CFG.cooldownMs - 1);
    expect(early.allow).toBe(false);
    // After cooldown → one probe leaks through, state flips to HALF_OPEN.
    const probe = decideRun(s, CFG, openedAt + CFG.cooldownMs);
    expect(probe.allow).toBe(true);
    expect(probe.reason).toBe("probe");
    expect(probe.state.phase).toBe("HALF_OPEN");
    // While the probe is in flight, further runs are held back.
    const held = decideRun(probe.state, CFG, openedAt + CFG.cooldownMs + 1);
    expect(held.allow).toBe(false);
    expect(held.reason).toBe("half-open-inflight");
  });

  test("a verified probe CLOSES the breaker (recovered)", () => {
    const openedAt = 0;
    let s = tripped(openedAt);
    const probe = decideRun(s, CFG, openedAt + CFG.cooldownMs);
    s = recordOutcome(
      probe.state,
      CFG,
      openedAt + CFG.cooldownMs,
      /* verified */ true,
    );
    expect(s.phase).toBe("CLOSED");
    expect(s.blocked).toBe(0);
    expect(decideRun(s, CFG, openedAt + CFG.cooldownMs).allow).toBe(true);
  });

  test("a still-blocked probe RE-OPENS the breaker with a fresh cooldown", () => {
    const openedAt = 0;
    let s = tripped(openedAt);
    const probe = decideRun(s, CFG, openedAt + CFG.cooldownMs);
    const probeAt = openedAt + CFG.cooldownMs;
    s = recordOutcome(probe.state, CFG, probeAt, /* verified */ false);
    expect(s.phase).toBe("OPEN");
    expect(s.openedAtMs).toBe(probeAt); // cooldown restarts from the probe
    expect(decideRun(s, CFG, probeAt + 1).allow).toBe(false);
  });
});

describe("meta breaker · sampling window rollover", () => {
  test("stale CLOSED counts reset after windowMs so an old spike doesn't linger", () => {
    let s = freshBreaker(0);
    s = recordOutcome(s, CFG, 0, false); // one old block
    // A sample well past the window → counts reset before this one is added.
    s = recordOutcome(s, CFG, CFG.windowMs + 1, true);
    expect(s.blocked).toBe(0);
    expect(s.verified).toBe(1);
    expect(s.phase).toBe("CLOSED");
  });
});

describe("meta retry budget · token bucket", () => {
  test("allows a fresh bucket, then denies once drained within the hour", () => {
    const now = 0;
    let stored: { tokens: number; lastRefillMs: number } | null = null;
    let allowedCount = 0;
    // Drain the whole burst back-to-back (no time passes → no refill).
    for (let i = 0; i < 25; i++) {
      const r = decideRetryToken(stored, now);
      if (r.allowed) allowedCount++;
      stored = r.state;
    }
    // Burst is 20 → exactly 20 allowed, the rest denied.
    expect(allowedCount).toBe(20);
    expect(decideRetryToken(stored, now).allowed).toBe(false);
  });

  test("refills over time so a re-queue is allowed again later", () => {
    // Drain to empty.
    const stored: { tokens: number; lastRefillMs: number } | null = {
      tokens: 0,
      lastRefillMs: 0,
    };
    // 20/hour → one token every 180s. After 200s, ≥1 token is available.
    const r = decideRetryToken(stored, 200_000);
    expect(r.allowed).toBe(true);
  });
});

describe("meta breaker · full-jitter backoff", () => {
  test("never exceeds min(cap, base·2^attempt) and is 0 when rand()=0", () => {
    const base = 1000;
    const cap = 60_000;
    for (let attempt = 0; attempt < 12; attempt++) {
      const ceil = Math.min(cap, base * 2 ** attempt);
      // rand()=1 (nearly) → just under the exponential ceiling.
      const hi = fullJitterBackoffMs(attempt, base, cap, () => 0.999999);
      expect(hi).toBeLessThanOrEqual(ceil);
      expect(hi).toBeGreaterThanOrEqual(0);
      // rand()=0 → floor at 0.
      expect(fullJitterBackoffMs(attempt, base, cap, () => 0)).toBe(0);
    }
  });

  test("caps the exponential so a high attempt count can't overflow the delay", () => {
    const hi = fullJitterBackoffMs(40, 1000, 60_000, () => 0.999999);
    expect(hi).toBeLessThanOrEqual(60_000);
  });
});
