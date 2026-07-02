// Phase 9 · pure visual-helper math for the demand-portal components.

import { describe, expect, test } from "vitest";
import {
  trackPct,
  typicalBand,
  percentileFromBand,
  percentileTone,
  vsCellLabel,
  freshnessChip,
  reachabilityDonut,
  predictedTierTone,
  sparklinePoints,
  seriesTrend,
  rankNextActions,
} from "../visual-helpers";

describe("trackPct", () => {
  test("positions + clamps", () => {
    expect(trackPct(50, 0, 100)).toBe(50);
    expect(trackPct(0, 0, 100)).toBe(0);
    expect(trackPct(-10, 0, 100)).toBe(0);
    expect(trackPct(200, 0, 100)).toBe(100);
    expect(trackPct(5, 10, 10)).toBe(0); // degenerate range
  });
});

describe("typicalBand", () => {
  test("p25–p75 band on the track", () => {
    const b = typicalBand(25, 75, 0, 100);
    expect(b.startPct).toBe(25);
    expect(b.widthPct).toBe(50);
  });
});

describe("percentileFromBand (WP5-11)", () => {
  const band = { p10: 10, p25: 25, p50: 50, p75: 75, p90: 90 };

  test("interpolates linearly through the quantile stops", () => {
    expect(percentileFromBand(50, band)).toBe(50);
    expect(percentileFromBand(25, band)).toBe(25);
    expect(percentileFromBand(62.5, band)).toBe(63); // midway p50→p75
  });

  test("clamps outside the band — never a fake 0th/100th", () => {
    expect(percentileFromBand(-100, band)).toBe(5);
    expect(percentileFromBand(10_000, band)).toBe(95);
  });

  test("degenerate band (all quantiles equal) reads as typical", () => {
    expect(
      percentileFromBand(7, { p10: 3, p25: 3, p50: 3, p75: 3, p90: 3 }),
    ).toBe(50);
  });
});

describe("percentileTone", () => {
  test("red/amber/green by percentile", () => {
    expect(percentileTone(5)).toBe("red");
    expect(percentileTone(50)).toBe("amber");
    expect(percentileTone(90)).toBe("green");
  });
});

describe("vsCellLabel", () => {
  test("reads as value · typical · rank", () => {
    expect(vsCellLabel(100, 240, 22, "reviews")).toBe(
      "100 reviews · typical 240 reviews · bottom quartile",
    );
    expect(vsCellLabel(400, 240, 92)).toContain("top 10%");
  });
});

describe("freshnessChip", () => {
  test("fresh serves $0; stale is billed", () => {
    expect(freshnessChip("fresh")).toMatchObject({
      tone: "green",
      dollars: "$0 to serve",
    });
    expect(freshnessChip("stale").tone).toBe("red");
    expect(freshnessChip("never").label).toBe("New");
  });
});

describe("reachabilityDonut", () => {
  test("segments sum sensibly", () => {
    const seg = reachabilityDonut({
      total: 412,
      reachable: 300,
      phoneOnly: 78,
      unreachable: 34,
    });
    const byKey = Object.fromEntries(seg.map((s) => [s.key, s]));
    expect(byKey.reachable.pct).toBeCloseTo(72.8, 1);
    expect(byKey.unreachable.tone).toBe("red");
  });
  test("guards divide-by-zero", () => {
    const seg = reachabilityDonut({
      total: 0,
      reachable: 0,
      phoneOnly: 0,
      unreachable: 0,
    });
    expect(seg.every((s) => s.pct === 0)).toBe(true);
  });
});

describe("predictedTierTone", () => {
  test("maps tiers", () => {
    expect(predictedTierTone("high")).toBe("green");
    expect(predictedTierTone("low")).toBe("neutral");
  });
});

describe("sparklinePoints", () => {
  test("empty series → empty string", () => {
    expect(sparklinePoints([], 60, 16)).toBe("");
  });

  test("single point → centered horizontally and vertically", () => {
    // innerW = 58, center x = 1 + 29 = 30; flat → norm 0.5 → y = 1 + 0.5*14 = 8.
    expect(sparklinePoints([5], 60, 16)).toBe("30,8");
  });

  test("rising series inverts y (last point is highest = smallest y)", () => {
    const pts = sparklinePoints([0, 10], 60, 16).split(" ");
    const [, y0] = pts[0].split(",").map(Number);
    const [, y1] = pts[1].split(",").map(Number);
    expect(y1).toBeLessThan(y0);
  });

  test("flat multi-point series sits on the mid-line", () => {
    const pts = sparklinePoints([3, 3, 3], 60, 16);
    // every y equals the mid (1 + 0.5*14 = 8)
    expect(pts.split(" ").every((p) => p.split(",")[1] === "8")).toBe(true);
  });
});

describe("seriesTrend", () => {
  test("classifies up/down/flat", () => {
    expect(seriesTrend([1, 2, 3])).toBe("up");
    expect(seriesTrend([3, 2, 1])).toBe("down");
    expect(seriesTrend([2, 2])).toBe("flat");
    expect(seriesTrend([5])).toBe("flat");
  });
});

describe("rankNextActions", () => {
  test("sorts by weight desc, label tiebreak", () => {
    const ranked = rankNextActions([
      { id: "a", label: "Beta", weight: 1 },
      { id: "b", label: "Alpha", weight: 3 },
      { id: "c", label: "Gamma", weight: 1 },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });
});
