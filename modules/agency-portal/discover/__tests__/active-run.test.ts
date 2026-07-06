// SPEND-1 · money-aggregation invariant for the discovery "credits to date".
// Per .claude/rules/testing.md we test the compute (a sum over money), not the
// DB round-trip — resolveSpendCreditsForDiscovery pre-filters runs to OK/PARTIAL
// and delegates the arithmetic to the pure sumCreditsForCellOverlap below.

import { describe, expect, test } from "vitest";

import { sumCreditsForCellOverlap } from "../spend-credits";

const run = (creditsCharged: number | null, cellKeys: unknown) => ({
  creditsCharged,
  scopeRefsJson: { cellKeys },
});

describe("sumCreditsForCellOverlap", () => {
  test("sums creditsCharged only for runs whose cellKeys overlap", () => {
    const runs = [
      run(3, ["a", "b"]), // overlaps → counted
      run(4, ["b"]), // overlaps → counted
      run(9, ["z"]), // no overlap → ignored
    ];
    expect(sumCreditsForCellOverlap(runs, ["a"])).toBe(3);
    expect(sumCreditsForCellOverlap(runs, ["b"])).toBe(7);
    expect(sumCreditsForCellOverlap(runs, ["a", "b"])).toBe(7);
  });

  test("returns 0 for empty target cellKeys", () => {
    expect(sumCreditsForCellOverlap([run(5, ["a"])], [])).toBe(0);
  });

  test("returns 0 when nothing overlaps", () => {
    expect(sumCreditsForCellOverlap([run(5, ["x"])], ["a"])).toBe(0);
  });

  test("treats a null creditsCharged as 0 (never NaN)", () => {
    const total = sumCreditsForCellOverlap(
      [run(null, ["a"]), run(2, ["a"])],
      ["a"],
    );
    expect(total).toBe(2);
  });

  test("tolerates a missing / malformed scopeRefsJson.cellKeys", () => {
    const runs = [
      { creditsCharged: 5, scopeRefsJson: null },
      { creditsCharged: 5, scopeRefsJson: { cellKeys: "not-an-array" } },
      run(3, ["a"]),
    ];
    expect(sumCreditsForCellOverlap(runs, ["a"])).toBe(3);
  });
});
