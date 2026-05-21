/**
 * Unit tests for the one-pager data-shaping helpers (F.6).
 *
 * Per `.claude/rules/testing.md` the invariants we cover are:
 *
 *   - Formatters round-trip null / out-of-range inputs to stable
 *     placeholder strings ("—", "Reply rate —", etc.)
 *   - `derivePitchWedges` returns EXACTLY 3 wedges, deterministically,
 *     ordered web-perf → reputation → profile/local-SEO.
 *   - Wedge selection prioritizes the strongest signal we have:
 *     LCP > Lighthouse perf > schema missing > category fallback.
 *   - `deriveFixes` returns EXACTLY 3 fixes in the same priority order.
 *   - Filename slug strips non-alphanumerics and truncates to 80 chars.
 *
 * NOTE: we do NOT integration-test the React-PDF render here — that
 * would pull in `@react-pdf/renderer` (~600 KB) at test time. The
 * `OnePagerDocument` component is a pure function over the shape this
 * file proves correct.
 */

import { describe, expect, test } from "vitest";

import {
  derivePitchWedges,
  deriveFixes,
  formatCityLine,
  formatMapslyScore,
  formatMsiLine,
  formatPerformanceLine,
  formatRatingLine,
  formatReplyRateLine,
  toFilenameSlug,
  type DerivePitchWedgesInputs,
  type DeriveFixesInputs,
} from "../one-pager-data";

/* --------------------------------------------------- formatters */

describe("formatMapslyScore", () => {
  test("formats valid number to 1 decimal", () => {
    expect(formatMapslyScore(6.234)).toBe("6.2");
    expect(formatMapslyScore(9.96)).toBe("10.0");
    expect(formatMapslyScore(0)).toBe("0.0");
  });

  test("clamps to 0..10", () => {
    expect(formatMapslyScore(15)).toBe("10.0");
    expect(formatMapslyScore(-3)).toBe("0.0");
  });

  test("null / NaN / undefined → em-dash", () => {
    expect(formatMapslyScore(null)).toBe("—");
    expect(formatMapslyScore(undefined)).toBe("—");
    expect(formatMapslyScore(Number.NaN)).toBe("—");
  });
});

describe("formatRatingLine", () => {
  test("formats rating + reviewCount", () => {
    expect(formatRatingLine({ rating: 4.4, reviewCount: 342 })).toBe(
      "4.4 · 342 reviews",
    );
  });

  test("null rating → em-dash", () => {
    expect(formatRatingLine({ rating: null, reviewCount: 0 })).toBe(
      "— · 0 reviews",
    );
  });

  test("null reviewCount → 0", () => {
    expect(formatRatingLine({ rating: 5.0, reviewCount: null })).toBe(
      "5.0 · 0 reviews",
    );
  });
});

describe("formatReplyRateLine", () => {
  test("0..1 → percentage", () => {
    expect(formatReplyRateLine(0.87)).toBe("Reply rate 87%");
    expect(formatReplyRateLine(0)).toBe("Reply rate 0%");
    expect(formatReplyRateLine(1)).toBe("Reply rate 100%");
  });

  test("clamps out-of-range", () => {
    expect(formatReplyRateLine(1.5)).toBe("Reply rate 100%");
    expect(formatReplyRateLine(-0.3)).toBe("Reply rate 0%");
  });

  test("null / undefined → em-dash", () => {
    expect(formatReplyRateLine(null)).toBe("Reply rate —");
    expect(formatReplyRateLine(undefined)).toBe("Reply rate —");
  });
});

describe("formatPerformanceLine", () => {
  test("rounds to int", () => {
    expect(formatPerformanceLine(38.6)).toBe("Lighthouse 39");
    expect(formatPerformanceLine(90)).toBe("Lighthouse 90");
  });

  test("null → em-dash", () => {
    expect(formatPerformanceLine(null)).toBe("Lighthouse —");
  });
});

describe("formatMsiLine", () => {
  test("renders rank of total", () => {
    expect(formatMsiLine({ msiRank: 18, msiTotal: 40 })).toBe("MSI #18 of 40");
  });

  test("either null → em-dash", () => {
    expect(formatMsiLine({ msiRank: null, msiTotal: 40 })).toBe("MSI —");
    expect(formatMsiLine({ msiRank: 1, msiTotal: null })).toBe("MSI —");
  });
});

describe("formatCityLine", () => {
  test("joins city + province", () => {
    expect(formatCityLine({ city: "Miami", province: "FL" })).toBe("Miami, FL");
  });

  test("missing pieces drop cleanly", () => {
    expect(formatCityLine({ city: "Miami", province: null })).toBe("Miami");
    expect(formatCityLine({ city: null, province: "FL" })).toBe("FL");
    expect(formatCityLine({ city: null, province: null })).toBe("");
  });
});

describe("toFilenameSlug", () => {
  test("kebab-cases ASCII", () => {
    expect(toFilenameSlug("Solea Brickell Spa")).toBe("solea-brickell-spa");
  });

  test("strips punctuation", () => {
    expect(toFilenameSlug("Joe's Pizza & Co.")).toBe("joe-s-pizza-co");
  });

  test("preserves unicode letters", () => {
    expect(toFilenameSlug("Café Olé")).toBe("café-olé");
  });

  test("truncates at 80 chars", () => {
    const long = "a".repeat(120);
    const out = toFilenameSlug(long);
    expect(out.length).toBeLessThanOrEqual(80);
  });
});

/* --------------------------------------------------- pitch wedges */

/** Build complete inputs with defaults; tests override the relevant fields. */
function buildPitchInputs(
  overrides: Partial<DerivePitchWedgesInputs> = {},
): DerivePitchWedgesInputs {
  return {
    rating: 4.4,
    reviewCount: 100,
    communicationScore: 0.5,
    profileCompleteness: 0.8,
    performance: 80,
    lcpMs: 2000,
    hasLocalBusinessSchema: true,
    napConsistent: true,
    msiRank: 5,
    msiTotal: 40,
    category: "medical_spa",
    city: "Miami",
    ...overrides,
  };
}

describe("derivePitchWedges", () => {
  test("always emits exactly 3 wedges, numbered 1/2/3", () => {
    const wedges = derivePitchWedges(buildPitchInputs());
    expect(wedges).toHaveLength(3);
    expect(wedges.map((w) => w.index)).toEqual([1, 2, 3]);
  });

  test("prioritizes LCP > 2.5s for wedge #1", () => {
    const wedges = derivePitchWedges(
      buildPitchInputs({ lcpMs: 4200, performance: 30 }),
    );
    expect(wedges[0]!.headline).toContain("4.2s");
    expect(wedges[0]!.evidence).toContain("LCP");
  });

  test("falls back to Lighthouse perf if LCP missing/ok", () => {
    const wedges = derivePitchWedges(
      buildPitchInputs({ lcpMs: 2100, performance: 35 }),
    );
    expect(wedges[0]!.headline).toContain("Performance 35");
  });

  test("falls back to schema missing if perf is OK", () => {
    const wedges = derivePitchWedges(
      buildPitchInputs({
        lcpMs: 1800,
        performance: 92,
        hasLocalBusinessSchema: false,
      }),
    );
    expect(wedges[0]!.headline).toContain("LocalBusiness schema");
  });

  test("last-resort wedge #1 uses city context when all healthy", () => {
    const wedges = derivePitchWedges(
      buildPitchInputs({
        lcpMs: 1500,
        performance: 95,
        hasLocalBusinessSchema: true,
        city: "Brickell",
      }),
    );
    expect(wedges[0]!.headline).toContain("Brickell");
  });

  test("wedge #2 — low reply rate beats other reputation signals", () => {
    const wedges = derivePitchWedges(
      buildPitchInputs({ communicationScore: 0.05, reviewCount: 80 }),
    );
    expect(wedges[1]!.headline).toContain("Reply rate 5%");
  });

  test("wedge #2 — sub-4.0 rating fires when reply rate is fine", () => {
    const wedges = derivePitchWedges(
      buildPitchInputs({
        communicationScore: 0.9,
        rating: 3.6,
        reviewCount: 50,
      }),
    );
    expect(wedges[1]!.headline).toContain("3.6");
  });

  test("wedge #2 — low review volume when other reputation healthy", () => {
    const wedges = derivePitchWedges(
      buildPitchInputs({
        communicationScore: 0.9,
        rating: 4.6,
        reviewCount: 8,
      }),
    );
    expect(wedges[1]!.headline).toContain("8 Google reviews");
  });

  test("wedge #3 — bottom-half MSI fires first", () => {
    const wedges = derivePitchWedges(
      buildPitchInputs({ msiRank: 30, msiTotal: 40 }),
    );
    expect(wedges[2]!.headline).toContain("#30");
    expect(wedges[2]!.headline).toContain("40");
  });

  test("wedge #3 — falls through to profile completeness", () => {
    const wedges = derivePitchWedges(
      buildPitchInputs({
        msiRank: 2,
        msiTotal: 40,
        profileCompleteness: 0.4,
      }),
    );
    expect(wedges[2]!.headline).toContain("40%");
  });

  test("wedge #3 — falls through to NAP if profile is fine", () => {
    const wedges = derivePitchWedges(
      buildPitchInputs({
        msiRank: 2,
        msiTotal: 40,
        profileCompleteness: 0.95,
        napConsistent: false,
      }),
    );
    expect(wedges[2]!.headline).toContain("NAP");
  });

  test("deterministic · two reads return identical output", () => {
    const inputs = buildPitchInputs({
      lcpMs: 3300,
      communicationScore: 0.1,
      msiRank: 25,
      msiTotal: 40,
    });
    expect(derivePitchWedges(inputs)).toEqual(derivePitchWedges(inputs));
  });
});

/* --------------------------------------------------- fixes */

function buildFixesInputs(
  overrides: Partial<DeriveFixesInputs> = {},
): DeriveFixesInputs {
  return {
    performance: 80,
    lcpMs: 2000,
    hasLocalBusinessSchema: true,
    profileCompleteness: 0.8,
    communicationScore: 0.5,
    reviewCount: 100,
    ...overrides,
  };
}

describe("deriveFixes", () => {
  test("always emits exactly 3 fixes", () => {
    expect(deriveFixes(buildFixesInputs())).toHaveLength(3);
  });

  test("fix #1 prioritizes LCP > 2.5s", () => {
    const fixes = deriveFixes(buildFixesInputs({ lcpMs: 4500 }));
    expect(fixes[0]!.area).toBe("Web performance");
    expect(fixes[0]!.action).toContain("4.5s");
  });

  test("fix #1 falls back to schema when perf + LCP are fine", () => {
    const fixes = deriveFixes(
      buildFixesInputs({
        lcpMs: 1500,
        performance: 95,
        hasLocalBusinessSchema: false,
      }),
    );
    expect(fixes[0]!.area).toBe("Schema & SEO");
  });

  test("fix #2 surfaces profile completeness when low", () => {
    const fixes = deriveFixes(
      buildFixesInputs({ profileCompleteness: 0.6 }),
    );
    expect(fixes[1]!.area).toBe("Profile completeness");
    expect(fixes[1]!.action).toContain("60%");
  });

  test("fix #3 surfaces low reply rate first", () => {
    const fixes = deriveFixes(
      buildFixesInputs({ communicationScore: 0.1 }),
    );
    expect(fixes[2]!.area).toBe("Review management");
    expect(fixes[2]!.action).toContain("10%");
  });

  test("fix #3 falls through to volume when reply rate fine", () => {
    const fixes = deriveFixes(
      buildFixesInputs({ communicationScore: 0.9, reviewCount: 12 }),
    );
    expect(fixes[2]!.action).toContain("12");
  });

  test("deterministic", () => {
    const inputs = buildFixesInputs({
      lcpMs: 3300,
      communicationScore: 0.2,
      profileCompleteness: 0.5,
    });
    expect(deriveFixes(inputs)).toEqual(deriveFixes(inputs));
  });
});
