/**
 * Local-intent keyword expansion unit tests.
 *
 * Per `.claude/rules/testing.md` · invariants that would break the
 * SMB /search page if they flipped:
 *   - Industry mapping is case-insensitive
 *   - Service flags gate correctly
 *   - Dedup preserves "core" origin over "service"
 *   - Cell builder deduplicates across businesses
 */

import { describe, expect, test } from "vitest";

import {
  buildKeywordSetForBusiness,
  buildKeywordSetForCell,
} from "../build-keyword-set";
import { fillCityTemplate } from "../templates";

describe("buildKeywordSetForBusiness", () => {
  test("medspa in Calgary produces 5 core + every service template by default", () => {
    const r = buildKeywordSetForBusiness({
      category: "Medical spa",
      city: "Calgary",
    });
    expect(r.industry).toBe("medspa");
    // 5 core + 7 service (default-all when serviceFlags is null/undefined)
    expect(r.keywords).toHaveLength(12);
    expect(
      r.keywords.find((k) => k.keyword === "med spa calgary")?.origin,
    ).toBe("core");
    expect(
      r.keywords.find((k) => k.keyword === "dermal fillers calgary")?.origin,
    ).toBe("service");
  });

  test("unknown category yields industry=null and no keywords", () => {
    const r = buildKeywordSetForBusiness({
      category: "Photographer",
      city: "Calgary",
    });
    expect(r.industry).toBeNull();
    expect(r.keywords).toEqual([]);
  });

  test("missing city skips the business", () => {
    const r = buildKeywordSetForBusiness({
      category: "Medical spa",
      city: null,
    });
    expect(r.industry).toBeNull();
    expect(r.keywords).toEqual([]);
  });

  test("category match is case-insensitive + handles synonyms", () => {
    const r1 = buildKeywordSetForBusiness({
      category: "MED SPA",
      city: "Miami",
    });
    const r2 = buildKeywordSetForBusiness({
      category: "Skin care clinic",
      city: "Miami",
    });
    expect(r1.industry).toBe("medspa");
    expect(r2.industry).toBe("medspa");
  });

  test("service flags off shrink the set to core only", () => {
    const r = buildKeywordSetForBusiness({
      category: "Medical spa",
      city: "Calgary",
      serviceFlags: {
        hasFillers: false,
        hasLipFillers: false,
        hasMicroneedling: false,
        hasLaserHair: false,
        hasBodySculpting: false,
        hasBelkyra: false,
        hasCoolsculpting: false,
      },
    });
    expect(r.keywords).toHaveLength(5);
    expect(r.keywords.every((k) => k.origin === "core")).toBe(true);
  });

  test("selectively enabled service flag adds only that template", () => {
    const r = buildKeywordSetForBusiness({
      category: "Medical spa",
      city: "Calgary",
      serviceFlags: {
        hasBelkyra: true,
        hasFillers: false,
        hasLipFillers: false,
        hasMicroneedling: false,
        hasLaserHair: false,
        hasBodySculpting: false,
        hasCoolsculpting: false,
      },
    });
    expect(r.keywords).toHaveLength(6); // 5 core + 1 service
    expect(
      r.keywords.find((k) => k.keyword === "belkyra calgary")?.origin,
    ).toBe("service");
  });

  test("keywords come back lowercased + trimmed", () => {
    const r = buildKeywordSetForBusiness({
      category: "Medical spa",
      city: "  Calgary  ",
    });
    expect(r.keywords[0]?.keyword).toMatch(/^[a-z ]+$/);
  });

  test("restaurant industry stubbed empty so it doesn't pollute scans yet", () => {
    const r = buildKeywordSetForBusiness({
      category: "Restaurant",
      city: "Calgary",
    });
    expect(r.industry).toBe("restaurant");
    expect(r.keywords).toEqual([]);
  });
});

describe("buildKeywordSetForCell", () => {
  test("deduplicates across businesses", () => {
    // Two medspas in the same cell · core templates collide.
    const r = buildKeywordSetForCell([
      { category: "Medical spa", city: "Calgary" },
      { category: "Med spa", city: "Calgary" },
    ]);
    // Same 12 keywords, not 24
    expect(r).toHaveLength(12);
  });

  test("mixed industries produce the union", () => {
    const r = buildKeywordSetForCell([
      { category: "Medical spa", city: "Calgary" },
      { category: "Restaurant", city: "Calgary" }, // stub · adds zero
      { category: "Photographer", city: "Calgary" }, // unknown · adds zero
    ]);
    expect(r).toHaveLength(12);
  });

  test("empty cell returns []", () => {
    expect(buildKeywordSetForCell([])).toEqual([]);
  });
});

describe("fillCityTemplate", () => {
  test("replaces placeholder + lowercases + trims", () => {
    expect(fillCityTemplate("Botox {city}", "  Calgary  ")).toBe(
      "botox calgary",
    );
  });

  test("passes through 'near me' templates with no placeholder", () => {
    expect(fillCityTemplate("medspa near me", "Calgary")).toBe(
      "medspa near me",
    );
  });
});
