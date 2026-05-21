/**
 * Helper invariants for `modules/agency-portal/list-detail/queries.ts`.
 *
 * The pure helpers are the formula surface — wrong signal logic =
 * wrong "why qualified" chip = Tom mis-prioritises the lead.
 *
 * Per `.claude/rules/testing.md` §"Snapshot tests for compute
 * formulas", we pin the boundary cases with inline expectations so
 * the next refactor that nudges the thresholds surfaces in the diff.
 */

import { describe, expect, test } from "vitest";

import {
  deriveAvatar,
  describeBusinessMeta,
  describeDwell,
  summarizeLeadSignals,
} from "../queries";

describe("deriveAvatar", () => {
  test("two-word name → first letters of first two words, uppercased", () => {
    expect(deriveAvatar("Solea Brickell Spa")).toBe("SB");
    expect(deriveAvatar("brickell brow bar")).toBe("BB");
  });

  test("single-word name → first two chars uppercased", () => {
    expect(deriveAvatar("Mapsly")).toBe("MA");
    expect(deriveAvatar("a")).toBe("A");
  });

  test("non-letter characters are stripped", () => {
    expect(deriveAvatar("  ,   Hello  ,  World  ")).toBe("HW");
    expect(deriveAvatar("123-go")).toBe("12");
  });

  test("empty / whitespace-only → fallback '??'", () => {
    expect(deriveAvatar("")).toBe("??");
    expect(deriveAvatar("    ")).toBe("??");
  });

  test("unicode names preserved (e.g. accented)", () => {
    expect(deriveAvatar("Maison Café")).toBe("MC");
  });
});

describe("describeBusinessMeta", () => {
  const NOW = new Date("2026-05-21T00:00:00Z").getTime();

  test("renders all parts when all present", () => {
    const out = describeBusinessMeta({
      yearsOnGoogle: 5,
      rating: 4.4,
      reviewCount: 342,
      addedAt: new Date(NOW - 3 * 24 * 60 * 60 * 1000),
      now: NOW,
    });
    expect(out).toBe("5 yrs · 4.4★ · 342 reviews · added 3d ago");
  });

  test("drops missing fragments silently", () => {
    const out = describeBusinessMeta({
      yearsOnGoogle: null,
      rating: null,
      reviewCount: null,
      addedAt: new Date(NOW),
      now: NOW,
    });
    expect(out).toBe("added today");
  });

  test("rating rounded to 1 decimal", () => {
    const out = describeBusinessMeta({
      yearsOnGoogle: null,
      rating: 4.3567,
      reviewCount: null,
      addedAt: new Date(NOW),
      now: NOW,
    });
    expect(out).toContain("4.4★");
  });

  test("relative time scales to weeks/months/years", () => {
    const d7 = describeBusinessMeta({
      yearsOnGoogle: null,
      rating: null,
      reviewCount: null,
      addedAt: new Date(NOW - 14 * 24 * 60 * 60 * 1000),
      now: NOW,
    });
    expect(d7).toContain("2w ago");
    const d70 = describeBusinessMeta({
      yearsOnGoogle: null,
      rating: null,
      reviewCount: null,
      addedAt: new Date(NOW - 70 * 24 * 60 * 60 * 1000),
      now: NOW,
    });
    expect(d70).toContain("2mo ago");
    const d800 = describeBusinessMeta({
      yearsOnGoogle: null,
      rating: null,
      reviewCount: null,
      addedAt: new Date(NOW - 800 * 24 * 60 * 60 * 1000),
      now: NOW,
    });
    expect(d800).toContain("2y ago");
  });
});

describe("describeDwell", () => {
  const NOW = new Date("2026-05-21T00:00:00Z").getTime();

  test("NEW status never shows dwell", () => {
    expect(
      describeDwell(new Date(NOW - 10 * 24 * 60 * 60 * 1000), "NEW", NOW),
    ).toBe(null);
  });

  test("null status timestamp → null", () => {
    expect(describeDwell(null, "CONTACTED", NOW)).toBe(null);
  });

  test("short ranges render as days", () => {
    expect(
      describeDwell(
        new Date(NOW - 3 * 24 * 60 * 60 * 1000),
        "CONTACTED",
        NOW,
      ),
    ).toBe("3d");
  });

  test("mid ranges render as weeks", () => {
    expect(
      describeDwell(
        new Date(NOW - 21 * 24 * 60 * 60 * 1000),
        "REPLIED",
        NOW,
      ),
    ).toBe("3w");
  });

  test("long ranges render as months", () => {
    expect(
      describeDwell(
        new Date(NOW - 90 * 24 * 60 * 60 * 1000),
        "WON",
        NOW,
      ),
    ).toBe("3mo");
  });

  test("sub-1-day collapses to 'today'", () => {
    expect(describeDwell(new Date(NOW - 1000), "CONTACTED", NOW)).toBe("today");
  });
});

describe("summarizeLeadSignals", () => {
  test("Perf 38 → alert chip", () => {
    const out = summarizeLeadSignals({
      performance: 38,
      lcpSeconds: null,
      seo: null,
      hasLocalBusinessSchema: null,
      napConsistent: null,
      rating: null,
      reviewCount: null,
    });
    expect(out[0]!.label).toBe("Perf 38");
    expect(out[0]!.tone).toBe("alert");
  });

  test("Perf 62 → warn chip", () => {
    const out = summarizeLeadSignals({
      performance: 62,
      lcpSeconds: null,
      seo: null,
      hasLocalBusinessSchema: null,
      napConsistent: null,
      rating: null,
      reviewCount: null,
    });
    expect(out[0]!.label).toBe("Perf 62");
    expect(out[0]!.tone).toBe("warn");
  });

  test("Perf 90 → no chip", () => {
    const out = summarizeLeadSignals({
      performance: 90,
      lcpSeconds: null,
      seo: null,
      hasLocalBusinessSchema: null,
      napConsistent: null,
      rating: null,
      reviewCount: null,
    });
    expect(out).toEqual([]);
  });

  test("LCP > 4s → alert with seconds format", () => {
    const out = summarizeLeadSignals({
      performance: null,
      lcpSeconds: 5.1,
      seo: null,
      hasLocalBusinessSchema: null,
      napConsistent: null,
      rating: null,
      reviewCount: null,
    });
    expect(out[0]!.label).toBe("LCP 5.1s");
    expect(out[0]!.tone).toBe("alert");
  });

  test("LCP between 2.5 and 4 → warn", () => {
    const out = summarizeLeadSignals({
      performance: null,
      lcpSeconds: 3.4,
      seo: null,
      hasLocalBusinessSchema: null,
      napConsistent: null,
      rating: null,
      reviewCount: null,
    });
    expect(out[0]!.label).toBe("LCP 3.4s");
    expect(out[0]!.tone).toBe("warn");
  });

  test("LCP at 2.5 (boundary) → no chip", () => {
    const out = summarizeLeadSignals({
      performance: null,
      lcpSeconds: 2.5,
      seo: null,
      hasLocalBusinessSchema: null,
      napConsistent: null,
      rating: null,
      reviewCount: null,
    });
    expect(out).toEqual([]);
  });

  test("missing schema flag → teal chip", () => {
    const out = summarizeLeadSignals({
      performance: null,
      lcpSeconds: null,
      seo: null,
      hasLocalBusinessSchema: false,
      napConsistent: null,
      rating: null,
      reviewCount: null,
    });
    expect(out[0]!.label).toBe("no schema");
    expect(out[0]!.tone).toBe("teal");
  });

  test("NAP inconsistent → warn chip", () => {
    const out = summarizeLeadSignals({
      performance: null,
      lcpSeconds: null,
      seo: null,
      hasLocalBusinessSchema: null,
      napConsistent: false,
      rating: null,
      reviewCount: null,
    });
    expect(out[0]!.label).toBe("NAP off");
    expect(out[0]!.tone).toBe("warn");
  });

  test("multiple signals respect tone-ordering (alerts first)", () => {
    const out = summarizeLeadSignals({
      performance: 40,
      lcpSeconds: 5.0,
      seo: 65,
      hasLocalBusinessSchema: false,
      napConsistent: false,
      rating: null,
      reviewCount: null,
    });
    // alert, alert, warn, teal — capped at 4
    expect(out).toHaveLength(4);
    expect(out[0]!.tone).toBe("alert"); // Perf
    expect(out[1]!.tone).toBe("alert"); // LCP
  });

  test("capped at 4 chips", () => {
    const out = summarizeLeadSignals({
      performance: 40,
      lcpSeconds: 5.0,
      seo: 50,
      hasLocalBusinessSchema: false,
      napConsistent: false,
      rating: 3.0,
      reviewCount: 0,
    });
    expect(out).toHaveLength(4);
  });

  test("zero reviews fallback when no other signals", () => {
    const out = summarizeLeadSignals({
      performance: null,
      lcpSeconds: null,
      seo: null,
      hasLocalBusinessSchema: null,
      napConsistent: null,
      rating: null,
      reviewCount: 0,
    });
    expect(out[0]!.label).toBe("no reviews");
  });

  test("low rating fallback when no other signals", () => {
    const out = summarizeLeadSignals({
      performance: null,
      lcpSeconds: null,
      seo: null,
      hasLocalBusinessSchema: null,
      napConsistent: null,
      rating: 3.5,
      reviewCount: 100,
    });
    expect(out.some((c) => c.label === "3.5★")).toBe(true);
  });

  test("no signals + healthy business → empty array", () => {
    const out = summarizeLeadSignals({
      performance: 95,
      lcpSeconds: 1.5,
      seo: 100,
      hasLocalBusinessSchema: true,
      napConsistent: true,
      rating: 4.8,
      reviewCount: 250,
    });
    expect(out).toEqual([]);
  });
});
