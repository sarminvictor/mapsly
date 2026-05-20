import { describe, expect, test } from "vitest";
import { PRICING, computeUsd } from "../pricing";

describe("services/ai/pricing", () => {
  test("gpt-5.4-nano computes input + output cost from rates", () => {
    // 1M input + 1M output at nano rates = $0.05 + $0.40 = $0.45
    const cost = computeUsd("gpt-5.4-nano", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(0.45, 6);
  });

  test("gpt-5.4-mini computes input + output cost from rates", () => {
    // 1M input + 1M output at mini rates = $0.25 + $2.00 = $2.25
    const cost = computeUsd("gpt-5.4-mini", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    expect(cost).toBeCloseTo(2.25, 6);
  });

  test("cached input bills at the discounted rate", () => {
    // 100K input total, 80K cached, 20K fresh, 50K output, on nano
    //   fresh:  20_000 / 1e6 * 0.05  = 0.001
    //   cached: 80_000 / 1e6 * 0.025 = 0.002
    //   output: 50_000 / 1e6 * 0.40  = 0.02
    //   total = 0.023
    const cost = computeUsd("gpt-5.4-nano", {
      inputTokens: 100_000,
      cachedInputTokens: 80_000,
      outputTokens: 50_000,
    });
    expect(cost).toBeCloseTo(0.023, 6);
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
    // 0 fresh + 500 cached @ 0.025/MTok = 0.0000125
    expect(cost).toBeCloseTo(0.0000125, 10);
  });

  test("both production models are present", () => {
    expect(PRICING["gpt-5.4-nano"]).toBeDefined();
    expect(PRICING["gpt-5.4-mini"]).toBeDefined();
  });
});
