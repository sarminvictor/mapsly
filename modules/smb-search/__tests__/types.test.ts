/**
 * Unit tests for the SMB search-visibility pure helpers.
 *
 * Per `.claude/rules/testing.md` we cover invariants Maria would feel
 * if they flipped — patients-lost math, quick-win selection rules, and
 * the voice promise (no banned jargon in quick-win copy).
 */

import { describe, expect, test } from "vitest";

import {
  type KeywordRow,
  deriveSearchQuickWins,
  estimatePatientsLost,
} from "../types";

const row = (overrides: Partial<KeywordRow>): KeywordRow => ({
  id: overrides.id ?? "kw-1",
  keyword: overrides.keyword ?? "med spa miami",
  searchVolume: 500,
  localPackRank: null,
  organicRank: null,
  prevLocalPackRank: null,
  prevOrganicRank: null,
  scannedAt: new Date("2026-05-21T00:00:00Z"),
  packSlots: [
    { rank: 1, name: "—", kind: "empty" },
    { rank: 2, name: "—", kind: "empty" },
    { rank: 3, name: "—", kind: "empty" },
  ],
  estPatientsLost: 0,
  estVisits: 0,
  ...overrides,
});

describe("estimatePatientsLost", () => {
  test("zero volume → zero", () => {
    expect(
      estimatePatientsLost({ searchVolume: null, localPackRank: null }),
    ).toBe(0);
    expect(estimatePatientsLost({ searchVolume: 0, localPackRank: null })).toBe(
      0,
    );
  });

  test("in the local pack → zero (no opportunity cost)", () => {
    expect(estimatePatientsLost({ searchVolume: 1000, localPackRank: 1 })).toBe(
      0,
    );
    expect(estimatePatientsLost({ searchVolume: 1000, localPackRank: 3 })).toBe(
      0,
    );
  });

  test("not in the pack → volume × 0.25 × 0.02, rounded", () => {
    // 1000 × 0.25 × 0.02 = 5
    expect(
      estimatePatientsLost({ searchVolume: 1000, localPackRank: null }),
    ).toBe(5);
    // 400 × 0.25 × 0.02 = 2
    expect(
      estimatePatientsLost({ searchVolume: 400, localPackRank: null }),
    ).toBe(2);
  });

  test("fringe rank (≥ 4) still counts as 'not in pack'", () => {
    expect(estimatePatientsLost({ searchVolume: 800, localPackRank: 7 })).toBe(
      4,
    );
  });
});

describe("deriveSearchQuickWins", () => {
  test("returns empty when no rows qualify", () => {
    // Volume too low + already in pack — neither qualifies.
    expect(
      deriveSearchQuickWins([
        row({ id: "a", searchVolume: 10 }),
        row({ id: "b", searchVolume: 1000, localPackRank: 2 }),
      ]),
    ).toEqual([]);
  });

  test("picks fringe-local rows with volume ≥ 50", () => {
    const wins = deriveSearchQuickWins([
      row({ id: "a", searchVolume: 500, localPackRank: 4, estPatientsLost: 2 }),
      row({ id: "b", searchVolume: 800, localPackRank: 6, estPatientsLost: 4 }),
    ]);
    expect(wins).toHaveLength(2);
    expect(wins[0]?.id).toBe("b"); // higher impact first
    expect(wins[0]?.impact).toMatch(/\+4 patients\/mo/);
    expect(wins[1]?.id).toBe("a");
  });

  test("picks fringe-organic rows when not in local pack", () => {
    const wins = deriveSearchQuickWins([
      row({
        id: "a",
        searchVolume: 600,
        localPackRank: null,
        organicRank: 8,
        estPatientsLost: 3,
      }),
    ]);
    expect(wins).toHaveLength(1);
    expect(wins[0]?.action.toLowerCase()).toMatch(/review/);
  });

  test("caps at 3", () => {
    const wins = deriveSearchQuickWins(
      [4, 5, 6, 7, 8].map((rank) =>
        row({
          id: `kw-${rank}`,
          searchVolume: 500,
          localPackRank: rank,
          estPatientsLost: rank,
        }),
      ),
    );
    expect(wins).toHaveLength(3);
  });

  test("copy stays in Maria voice — no banned jargon", () => {
    const wins = deriveSearchQuickWins([
      row({
        id: "a",
        searchVolume: 800,
        localPackRank: 4,
        estPatientsLost: 4,
      }),
      row({
        id: "b",
        searchVolume: 800,
        localPackRank: null,
        organicRank: 9,
        estPatientsLost: 3,
      }),
    ]);
    const haystack = wins.map((w) => `${w.currentState} ${w.action}`).join(" ");
    expect(haystack).not.toMatch(
      /\b(LCP|INP|CLS|CTR|MSI|3-pack|local 3-pack|schema|NAP|GBP|SERP|organic rank)\b/i,
    );
  });
});
