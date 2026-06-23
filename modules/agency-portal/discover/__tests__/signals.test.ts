// Phase 9 · pure signal-row mapping for the Discovery "Signals" view.
// buildSignalRows turns the loaded cohort + flagged findings into rows with a
// reviews-vs-cell comparative signal + evidence chips. The distribution band is
// computed from the cohort itself and omitted when the cohort is too small.

import { describe, expect, test } from "vitest";
import {
  buildSignalRows,
  cellBand,
  percentileOf,
  quantile,
  confidencePillClass,
  MIN_COHORT_FOR_DISTRIBUTION,
  type SignalBusinessInput,
  type SignalFindingInput,
} from "../signals";

describe("percentileOf", () => {
  test("empty sample → 0", () => {
    expect(percentileOf([], 5)).toBe(0);
  });
  test("mid-rank handles ties, clamps 0–100", () => {
    const s = [0, 10, 20, 30, 40];
    expect(percentileOf(s, 40)).toBe(90); // 4 below + 0.5 of 1 equal = 4.5/5
    expect(percentileOf(s, 0)).toBe(10);
    expect(percentileOf(s, 100)).toBe(100);
    expect(percentileOf(s, -5)).toBe(0);
  });
});

describe("quantile", () => {
  test("nearest-rank quantiles", () => {
    const s = [10, 20, 30, 40, 50];
    expect(quantile(s, 0.5)).toBe(30);
    expect(quantile(s, 0)).toBe(10);
    expect(quantile(s, 1)).toBe(50);
  });
  test("single-element + empty", () => {
    expect(quantile([7], 0.5)).toBe(7);
    expect(quantile([], 0.5)).toBe(0);
  });
});

describe("cellBand", () => {
  test("null below the minimum cohort size", () => {
    const tooSmall = Array.from(
      { length: MIN_COHORT_FOR_DISTRIBUTION - 1 },
      (_, i) => i,
    );
    expect(cellBand(tooSmall)).toBeNull();
  });
  test("computes a band with enough samples", () => {
    const band = cellBand([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
    expect(band).not.toBeNull();
    expect(band!.p50).toBe(50);
    expect(band!.p10).toBeLessThan(band!.p50);
    expect(band!.p90).toBeGreaterThan(band!.p50);
  });
});

describe("buildSignalRows", () => {
  const businesses: SignalBusinessInput[] = [
    {
      id: "b1",
      name: "Alpha",
      category: "Spa",
      city: "Miami",
      reviewCount: 5,
      rating: 4.2,
    },
    {
      id: "b2",
      name: "Beta",
      category: "Spa",
      city: "Miami",
      reviewCount: 50,
      rating: 4.5,
    },
    {
      id: "b3",
      name: "Gamma",
      category: "Spa",
      city: "Miami",
      reviewCount: 100,
      rating: 4.8,
    },
    {
      id: "b4",
      name: "Delta",
      category: "Spa",
      city: "Miami",
      reviewCount: 200,
      rating: 4.9,
    },
  ];

  test("emits a reviews signal with a band + correct percentile per row", () => {
    const rows = buildSignalRows(businesses, []);
    expect(rows).toHaveLength(4);
    const alpha = rows.find((r) => r.id === "b1")!;
    const delta = rows.find((r) => r.id === "b4")!;
    expect(alpha.signals[0].key).toBe("reviews");
    expect(alpha.signals[0].band).not.toBeNull();
    // lowest reviewCount → low percentile; highest → high percentile.
    expect(alpha.signals[0].percentile).toBeLessThan(
      delta.signals[0].percentile,
    );
  });

  test("omits the bar (band null) when cohort is too small", () => {
    const rows = buildSignalRows(businesses.slice(0, 2), []);
    expect(rows[0].signals[0].band).toBeNull();
    // value still present so the UI can show the raw number.
    expect(rows[0].signals[0].value).toBe(5);
  });

  test("drops the reviews signal entirely when reviewCount is null", () => {
    const rows = buildSignalRows(
      [
        {
          id: "x",
          name: "X",
          category: null,
          city: null,
          reviewCount: null,
          rating: null,
        },
      ],
      [],
    );
    expect(rows[0].signals).toHaveLength(0);
  });

  test("attaches flagged findings as evidence chips per business", () => {
    const findings: SignalFindingInput[] = [
      {
        businessId: "b1",
        signalKey: "hipaa-pixel-on-phi-page",
        confidence: "high",
        explanation: "Tracking pixel on a PHI page",
        group: "compliance",
      },
      {
        businessId: "b1",
        signalKey: "slow-lcp",
        confidence: "medium",
        explanation: "LCP 5.2s",
        group: "website",
      },
    ];
    const rows = buildSignalRows(businesses, findings);
    const alpha = rows.find((r) => r.id === "b1")!;
    expect(alpha.findings).toHaveLength(2);
    expect(alpha.findings[0].signalKey).toBe("hipaa-pixel-on-phi-page");
    // businesses without findings get an empty array.
    expect(rows.find((r) => r.id === "b2")!.findings).toHaveLength(0);
  });
});

describe("confidencePillClass", () => {
  test("maps confidence → tone class (case-insensitive)", () => {
    expect(confidencePillClass("HIGH")).toContain("emerald");
    expect(confidencePillClass("medium")).toContain("amber");
    expect(confidencePillClass("low")).toContain("slate");
    expect(confidencePillClass("unknown")).toContain("slate");
  });
});
