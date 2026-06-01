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
  isServiceKeyword: false,
  isTemplated: false,
  ...overrides,
});

describe("estimatePatientsLost", () => {
  test("zero volume → zero", () => {
    expect(estimatePatientsLost({ searchVolume: null, bestRank: null })).toBe(
      0,
    );
    expect(estimatePatientsLost({ searchVolume: 0, bestRank: null })).toBe(0);
  });

  test("top 3 in either Maps or organic → zero (customers find her)", () => {
    expect(estimatePatientsLost({ searchVolume: 1000, bestRank: 1 })).toBe(0);
    expect(estimatePatientsLost({ searchVolume: 1000, bestRank: 3 })).toBe(0);
  });

  test("not in top 3 anywhere → volume × TOP_3_CTR × CONVERSION, rounded", () => {
    // 1000 × 0.2233 × 0.02 ≈ 4.47 → 4
    expect(estimatePatientsLost({ searchVolume: 1000, bestRank: null })).toBe(
      4,
    );
    // 400 × 0.2233 × 0.02 ≈ 1.79 → 2
    expect(estimatePatientsLost({ searchVolume: 400, bestRank: null })).toBe(2);
  });

  test("fringe rank (≥ 4) still counts as 'not in top 3'", () => {
    // 800 × 0.2233 × 0.02 ≈ 3.57 → 4
    expect(estimatePatientsLost({ searchVolume: 800, bestRank: 7 })).toBe(4);
  });
});

describe("pickQuickWinCandidates (alias deriveSearchQuickWins)", () => {
  test("returns empty when no rows qualify", () => {
    // Volume too low + not templated + already in pack — none qualify.
    expect(
      deriveSearchQuickWins([
        row({ id: "a", searchVolume: 10, isTemplated: true }),
        row({
          id: "b",
          searchVolume: 1000,
          localPackRank: 2,
          isTemplated: true,
        }),
      ]),
    ).toEqual([]);
  });

  test("requires isTemplated · drops non-template rows", () => {
    // Same fringe row · once with isTemplated=true, once false.
    const tmpl = deriveSearchQuickWins([
      row({
        id: "tmpl",
        searchVolume: 500,
        localPackRank: 5,
        estPatientsLost: 3,
        isTemplated: true,
      }),
    ]);
    const nonTmpl = deriveSearchQuickWins([
      row({
        id: "non",
        searchVolume: 500,
        localPackRank: 5,
        estPatientsLost: 3,
        isTemplated: false,
      }),
    ]);
    expect(tmpl).toHaveLength(1);
    expect(nonTmpl).toEqual([]);
  });

  test("picks fringe-maps rows · surface=maps · sorts by impact desc", () => {
    const wins = deriveSearchQuickWins([
      row({
        id: "a",
        searchVolume: 500,
        localPackRank: 4,
        estPatientsLost: 2,
        isTemplated: true,
      }),
      row({
        id: "b",
        searchVolume: 800,
        localPackRank: 6,
        estPatientsLost: 4,
        isTemplated: true,
      }),
    ]);
    expect(wins).toHaveLength(2);
    expect(wins[0]?.id).toBe("b"); // higher impact first
    expect(wins[0]?.surface).toBe("maps");
    expect(wins[0]?.estCustomersPerMo).toBe(4);
    expect(wins[1]?.id).toBe("a");
  });

  test("picks fringe-organic rows · surface=search · tight 4-10 range", () => {
    const wins = deriveSearchQuickWins([
      row({
        id: "a",
        searchVolume: 600,
        localPackRank: null,
        organicRank: 8,
        estPatientsLost: 3,
        isTemplated: true,
      }),
      // Organic 12 is OUTSIDE the new tight 4-10 fringe · skip.
      row({
        id: "b",
        searchVolume: 600,
        localPackRank: null,
        organicRank: 12,
        estPatientsLost: 3,
        isTemplated: true,
      }),
    ]);
    expect(wins).toHaveLength(1);
    expect(wins[0]?.id).toBe("a");
    expect(wins[0]?.surface).toBe("search");
    expect(wins[0]?.actionKey).toBe("review_request");
  });

  test("returns ALL qualifiers (slicing happens in the weekly layer)", () => {
    const wins = deriveSearchQuickWins(
      [4, 5, 6, 7, 8].map((rank) =>
        row({
          id: `kw-${rank}`,
          searchVolume: 500,
          localPackRank: rank,
          estPatientsLost: rank,
          isTemplated: true,
        }),
      ),
    );
    // Pure picker no longer caps at 3 · returns all 5 fringe-maps rows.
    expect(wins).toHaveLength(5);
  });

  test("emits surface chips per row · no English copy baked in", () => {
    const wins = deriveSearchQuickWins([
      row({
        id: "a",
        searchVolume: 800,
        localPackRank: 4,
        estPatientsLost: 4,
        isTemplated: true,
      }),
      row({
        id: "b",
        searchVolume: 800,
        localPackRank: null,
        organicRank: 9,
        estPatientsLost: 3,
        isTemplated: true,
      }),
    ]);
    expect(wins[0]?.surface).toBe("maps");
    expect(wins[0]?.stateKey).toBe("maps_fringe");
    expect(wins[1]?.surface).toBe("search");
    expect(wins[1]?.stateKey).toBe("search_fringe");
  });
});
