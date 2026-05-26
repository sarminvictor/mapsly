import { describe, expect, test } from "vitest";
import { PRICING, computeUsd } from "../pricing";

// Current pricing (services/ai/pricing.ts, verified 2026-05-25):
//   gpt-5.4-nano · $0.20 in / $1.25 out / $0.10 cached per 1M tokens
//   gpt-5.4-mini · $0.75 in / $4.50 out / $0.375 cached per 1M tokens

describe("services/ai/pricing", () => {
  test("gpt-5.4-nano computes input + output cost from rates", () => {
    // 1M input + 1M output at nano rates = $0.20 + $1.25 = $1.45
    const cost = computeUsd("gpt-5.4-nano", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(1.45, 6);
  });

  test("gpt-5.4-mini computes input + output cost from rates", () => {
    // 1M input + 1M output at mini rates = $0.75 + $4.50 = $5.25
    const cost = computeUsd("gpt-5.4-mini", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(5.25, 6);
  });

  test("cached input bills at the discounted rate", () => {
    // 100K input total, 80K cached, 20K fresh, 50K output, on nano:
    //   fresh:  20_000 / 1e6 * 0.20  = 0.004
    //   cached: 80_000 / 1e6 * 0.10  = 0.008
    //   output: 50_000 / 1e6 * 1.25  = 0.0625
    //   total = 0.0745
    const cost = computeUsd("gpt-5.4-nano", {
      inputTokens: 100_000,
      cachedInputTokens: 80_000,
      outputTokens: 50_000,
    });
    expect(cost).toBeCloseTo(0.0745, 6);
  });

  test("0-token call costs 0", () => {
    expect(
      computeUsd("gpt-5.4-nano", { inputTokens: 0, outputTokens: 0 }),
    ).toBe(0);
  });

  test("unknown model throws (typo-safe billing)", () => {
    expect(() =>
      computeUsd("gpt-5.4-typo", { inputTokens: 100, outputTokens: 100 }),
    ).toThrow(/unknown model/);
  });

  test("PRICING is frozen — no accidental runtime mutation", () => {
    expect(Object.isFrozen(PRICING)).toBe(true);
  });

  test("cached > input does not double-count fresh (clamped at 0)", () => {
    const cost = computeUsd("gpt-5.4-nano", {
      inputTokens: 100,
      cachedInputTokens: 500,
      outputTokens: 0,
    });
    // 0 fresh + 500 cached @ $0.10/MTok = 0.00005
    expect(cost).toBeCloseTo(0.00005, 10);
  });

  test("both production models are present", () => {
    expect(PRICING["gpt-5.4-nano"]).toBeDefined();
    expect(PRICING["gpt-5.4-mini"]).toBeDefined();
  });
});
