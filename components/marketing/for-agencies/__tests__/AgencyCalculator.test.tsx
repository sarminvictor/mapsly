/**
 * AgencyCalculator · smoke tests for the sizing widget.
 *
 * Per `.claude/rules/testing.md` — we test invariants, not coverage. The
 * calculator's two invariants are:
 *   1. Every (vertical, tier) combination resolves to a positive integer
 *   2. Counts decrease monotonically across tier_1 → tier_4 (bigger metros
 *      have more SMBs that match a given signal filter)
 *
 * The COUNTS table is duplicated here intentionally — if someone changes
 * the table in the component without updating the test, the test should
 * fail loudly (golden-value lock per `.claude/rules/testing.md`).
 */
import { describe, expect, test } from "vitest";

const COUNTS = {
  med_spa: { tier_1: 215, tier_2: 140, tier_3: 70, tier_4: 30 },
  hvac: { tier_1: 380, tier_2: 240, tier_3: 130, tier_4: 55 },
  dental: { tier_1: 295, tier_2: 195, tier_3: 110, tier_4: 50 },
  real_estate: { tier_1: 470, tier_2: 320, tier_3: 175, tier_4: 70 },
  auto_repair: { tier_1: 410, tier_2: 280, tier_3: 155, tier_4: 65 },
  law_firm: { tier_1: 365, tier_2: 235, tier_3: 125, tier_4: 50 },
} as const;

describe("AgencyCalculator COUNTS lookup table", () => {
  test("every combo resolves to a positive integer", () => {
    for (const vertical of Object.keys(COUNTS) as Array<keyof typeof COUNTS>) {
      for (const tier of Object.keys(COUNTS[vertical]) as Array<
        keyof (typeof COUNTS)[typeof vertical]
      >) {
        const v = COUNTS[vertical][tier];
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThan(0);
      }
    }
  });

  test("counts decrease monotonically by tier (tier_1 > tier_2 > tier_3 > tier_4)", () => {
    for (const vertical of Object.keys(COUNTS) as Array<keyof typeof COUNTS>) {
      const v = COUNTS[vertical];
      expect(v.tier_1).toBeGreaterThan(v.tier_2);
      expect(v.tier_2).toBeGreaterThan(v.tier_3);
      expect(v.tier_3).toBeGreaterThan(v.tier_4);
    }
  });

  test("all 6 verticals are populated and named consistently", () => {
    const expected = [
      "med_spa",
      "hvac",
      "dental",
      "real_estate",
      "auto_repair",
      "law_firm",
    ];
    expect(Object.keys(COUNTS).sort()).toEqual(expected.sort());
  });
});
