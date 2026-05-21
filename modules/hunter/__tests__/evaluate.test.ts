/**
 * Hunter evaluator · invariant tests · D.4
 *
 * Per `.claude/rules/testing.md` § "Hunter filter evaluation logic":
 * we must cover 100% of comparator types and aggregation rules. A
 * mis-evaluated filter = wrong list = lost revenue.
 *
 * Tests use real signal keys from the D.1 registry so a registry rename
 * surfaces here, not silently as a "stale filter" warning in production.
 */

import { describe, expect, test } from "vitest";

import type { FilterRow } from "@/modules/signals/types";

import {
  evaluateRow,
  evaluateRows,
  evaluateRowsWithTrace,
  evaluateSpec,
  evaluateSpecWithTrace,
  isKnownModel,
  MODEL_TO_SLOT,
  parseColumnRef,
  resolveColumnValue,
} from "../evaluate";
import type { EvaluationRow, FilterSpec } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// fixtures
// ─────────────────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<EvaluationRow> = {}): EvaluationRow {
  return {
    id: overrides.id ?? "biz_demo",
    business: {
      phone: "+1-305-555-0100",
      website: "https://example.com",
      isClaimed: true,
      photosCount: 42,
      yearsOnGoogle: 8,
      rating: 4.6,
      reviewCount: 187,
      categories: ["med-spa", "skincare", "laser-hair-removal"],
      category: "med-spa",
      ...overrides.business,
    },
    snapshot: {
      replyRate: 0.84,
      velocityLast30d: 12,
      ...overrides.snapshot,
    } as Record<string, unknown>,
    lighthouseAudit: {
      performance: 72,
      lcp: 2.8,
      ...overrides.lighthouseAudit,
    } as Record<string, unknown>,
    reviews: overrides.reviews ?? [
      { stars: 5, ownerReplied: true, postedAt: new Date("2026-04-01") },
      { stars: 4, ownerReplied: true, postedAt: new Date("2026-04-15") },
      { stars: 2, ownerReplied: false, postedAt: new Date("2026-05-01") },
    ],
    serpResults: overrides.serpResults ?? [],
    adLibraryEntries: overrides.adLibraryEntries ?? [],
  };
}

const r = (signalKey: string, comparator: string, value: unknown): FilterRow =>
  ({
    signalKey,
    comparator,
    value,
  }) as FilterRow;

// ─────────────────────────────────────────────────────────────────────────────
// parseColumnRef + resolveColumnValue + isKnownModel
// ─────────────────────────────────────────────────────────────────────────────

describe("parseColumnRef", () => {
  test("splits Model.field on the first dot", () => {
    expect(parseColumnRef("Business.phone")).toEqual({
      model: "Business",
      field: "phone",
    });
  });

  test("preserves dots inside the field path (JSON traversal)", () => {
    expect(parseColumnRef("BusinessSnapshot.raw.attribution.source")).toEqual({
      model: "BusinessSnapshot",
      field: "raw.attribution.source",
    });
  });

  test("returns null for malformed refs", () => {
    expect(parseColumnRef("")).toBeNull();
    expect(parseColumnRef("nopath")).toBeNull();
    expect(parseColumnRef(".leading-dot")).toBeNull();
    expect(parseColumnRef("trailing.")).toBeNull();
  });
});

describe("isKnownModel", () => {
  test("recognizes every model in MODEL_TO_SLOT", () => {
    for (const model of Object.keys(MODEL_TO_SLOT)) {
      expect(isKnownModel(model)).toBe(true);
    }
  });

  test("rejects unknown models like Lead", () => {
    expect(isKnownModel("Lead")).toBe(false);
    expect(isKnownModel("BusinessSnap")).toBe(false);
    expect(isKnownModel("")).toBe(false);
  });
});

describe("resolveColumnValue", () => {
  const row = makeRow();

  test("resolves direct Business field", () => {
    expect(resolveColumnValue(row, "Business.phone")).toBe("+1-305-555-0100");
    expect(resolveColumnValue(row, "Business.isClaimed")).toBe(true);
  });

  test("resolves snapshot field", () => {
    expect(resolveColumnValue(row, "BusinessSnapshot.replyRate")).toBe(0.84);
  });

  test("returns undefined when single-row relation is null", () => {
    const empty = makeRow({ snapshot: null });
    expect(
      resolveColumnValue(empty, "BusinessSnapshot.replyRate"),
    ).toBeUndefined();
  });

  test("returns array of values for multi-row relations", () => {
    const stars = resolveColumnValue(row, "Review.stars");
    expect(stars).toEqual([5, 4, 2]);
  });

  test("returns empty array for absent multi-row relation", () => {
    const empty = makeRow({ reviews: [] });
    expect(resolveColumnValue(empty, "Review.stars")).toEqual([]);
  });

  test("returns undefined for unknown model", () => {
    expect(resolveColumnValue(row, "Lead.contactedAt")).toBeUndefined();
  });

  test("returns undefined for malformed refs", () => {
    expect(resolveColumnValue(row, "")).toBeUndefined();
    expect(resolveColumnValue(row, "nodot")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// evaluateRow · single-row relations · every comparator type
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateRow · numeric comparators (single-row)", () => {
  const row = makeRow();

  test("<", () => {
    expect(evaluateRow(row, r("rating", "<", 5))).toBe(true);
    expect(evaluateRow(row, r("rating", "<", 4))).toBe(false);
  });

  test("<=", () => {
    expect(evaluateRow(row, r("rating", "<=", 4.6))).toBe(true);
    expect(evaluateRow(row, r("rating", "<=", 4.5))).toBe(false);
  });

  test("=", () => {
    expect(evaluateRow(row, r("rating", "=", 4.6))).toBe(true);
    expect(evaluateRow(row, r("rating", "=", 4.5))).toBe(false);
  });

  test(">=", () => {
    expect(evaluateRow(row, r("review_count", ">=", 100))).toBe(true);
    expect(evaluateRow(row, r("review_count", ">=", 200))).toBe(false);
  });

  test(">", () => {
    expect(evaluateRow(row, r("review_count", ">", 100))).toBe(true);
    expect(evaluateRow(row, r("review_count", ">", 187))).toBe(false);
  });

  test("between (inclusive)", () => {
    expect(evaluateRow(row, r("rating", "between", [4.0, 4.7]))).toBe(true);
    expect(evaluateRow(row, r("rating", "between", [4.7, 5.0]))).toBe(false);
  });

  test("missing on present field returns false", () => {
    expect(evaluateRow(row, r("rating", "missing", null))).toBe(false);
  });

  test("present on present field returns true", () => {
    expect(evaluateRow(row, r("rating", "present", null))).toBe(true);
  });

  test("missing matches when field is null", () => {
    const empty = makeRow({ business: { rating: null } });
    expect(evaluateRow(empty, r("rating", "missing", null))).toBe(true);
    expect(evaluateRow(empty, r("rating", "present", null))).toBe(false);
  });

  test("missing matches when snapshot is null entirely", () => {
    const noSnap = makeRow({ snapshot: null });
    expect(evaluateRow(noSnap, r("reply_rate", "missing", null))).toBe(true);
    expect(evaluateRow(noSnap, r("reply_rate", "present", null))).toBe(false);
  });
});

describe("evaluateRow · boolean comparators", () => {
  const row = makeRow();

  test("is true", () => {
    expect(evaluateRow(row, r("is_claimed", "is", true))).toBe(true);
    expect(evaluateRow(row, r("is_claimed", "is", false))).toBe(false);
  });

  test("is_not true", () => {
    expect(evaluateRow(row, r("is_claimed", "is_not", true))).toBe(false);
    expect(evaluateRow(row, r("is_claimed", "is_not", false))).toBe(true);
  });

  test("treats truthy string as boolean (has_website)", () => {
    expect(evaluateRow(row, r("has_website", "is", true))).toBe(true);
    const noSite = makeRow({ business: { website: null } });
    expect(evaluateRow(noSite, r("has_website", "is", true))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// evaluateRow · multi-row relations (Review·SerpResult·AdLibraryEntry)
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateRow · multi-row aggregation (numeric signal · Review.stars)", () => {
  // `unanswered_1star_count` (Review.stars, numeric) is the canonical
  // multi-row numeric case: per-review stars value, "any matches" semantics
  // + missing/present via the relation length. Tests use real signal keys
  // so a future registry rename surfaces here, not silently.

  test("'< 3' matches when ANY child row has stars < 3", () => {
    const row = makeRow({
      reviews: [
        { stars: 5, ownerReplied: true },
        { stars: 4, ownerReplied: true },
        { stars: 2, ownerReplied: false }, // matches
      ],
    });
    expect(evaluateRow(row, r("unanswered_1star_count", "<", 3))).toBe(true);
  });

  test("'< 1' returns false when NO child row matches", () => {
    const row = makeRow({
      reviews: [
        { stars: 5, ownerReplied: true },
        { stars: 4, ownerReplied: true },
      ],
    });
    expect(evaluateRow(row, r("unanswered_1star_count", "<", 1))).toBe(false);
  });

  test("between is inclusive on multi-row aggregation", () => {
    const row = makeRow({
      reviews: [
        { stars: 5, ownerReplied: true },
        { stars: 3, ownerReplied: true }, // matches between [2,3]
      ],
    });
    expect(
      evaluateRow(row, r("unanswered_1star_count", "between", [2, 3])),
    ).toBe(true);
  });

  test("missing matches when relation array is empty", () => {
    const empty = makeRow({ reviews: [] });
    expect(
      evaluateRow(empty, r("unanswered_1star_count", "missing", null)),
    ).toBe(true);
    expect(
      evaluateRow(empty, r("unanswered_1star_count", "present", null)),
    ).toBe(false);
  });

  test("present matches when relation has at least one row", () => {
    const row = makeRow({ reviews: [{ stars: 5, ownerReplied: true }] });
    expect(evaluateRow(row, r("unanswered_1star_count", "present", null))).toBe(
      true,
    );
    expect(evaluateRow(row, r("unanswered_1star_count", "missing", null))).toBe(
      false,
    );
  });

  test("missing matches when relation is undefined", () => {
    const row = makeRow({ reviews: undefined });
    expect(evaluateRow(row, r("unanswered_1star_count", "missing", null))).toBe(
      true,
    );
  });
});

describe("evaluateRow · multi-row aggregation (boolean signal · Review.themes)", () => {
  // `has_negative_theme` (Review.themes, boolean) tests the boolean-typed
  // multi-row aggregation path. Boolean comparators are intentionally
  // limited to `is` / `is_not` (per comparators.ts) — no missing/present.

  test("'is true' matches when ANY child row's themes is truthy", () => {
    const row = makeRow({
      reviews: [
        { stars: 5, themes: false },
        { stars: 2, themes: true }, // matches
      ],
    });
    expect(evaluateRow(row, r("has_negative_theme", "is", true))).toBe(true);
  });

  test("'is true' returns false when NO child row matches", () => {
    const row = makeRow({
      reviews: [
        { stars: 5, themes: false },
        { stars: 4, themes: false },
      ],
    });
    expect(evaluateRow(row, r("has_negative_theme", "is", true))).toBe(false);
  });

  test("'is_not true' inverts the match", () => {
    const noNeg = makeRow({ reviews: [{ themes: false }, { themes: false }] });
    expect(evaluateRow(noNeg, r("has_negative_theme", "is_not", true))).toBe(
      true,
    );
    const hasNeg = makeRow({ reviews: [{ themes: true }] });
    expect(evaluateRow(hasNeg, r("has_negative_theme", "is_not", true))).toBe(
      false,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// evaluateRow · stale registry handling
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateRow · enum comparators (single-row · Business.country)", () => {
  // `country` is the canonical enum signal (US | CA). Hunter UI renders
  // it as a multi-select; the eval engine handles is / is_not /
  // is_one_of / is_none_of plus presence semantics.
  const us = makeRow({ business: { country: "US" } });
  const ca = makeRow({ business: { country: "CA" } });

  test("is matches the exact value", () => {
    expect(evaluateRow(us, r("country", "is", "US"))).toBe(true);
    expect(evaluateRow(us, r("country", "is", "CA"))).toBe(false);
  });

  test("is_not is the inverse", () => {
    expect(evaluateRow(us, r("country", "is_not", "US"))).toBe(false);
    expect(evaluateRow(us, r("country", "is_not", "CA"))).toBe(true);
  });

  test("is_one_of matches any of the listed values", () => {
    expect(evaluateRow(us, r("country", "is_one_of", ["US", "MX"]))).toBe(true);
    expect(evaluateRow(ca, r("country", "is_one_of", ["US", "MX"]))).toBe(
      false,
    );
  });

  test("is_none_of matches when not in the listed values", () => {
    expect(evaluateRow(us, r("country", "is_none_of", ["CA", "MX"]))).toBe(
      true,
    );
    expect(evaluateRow(us, r("country", "is_none_of", ["US", "MX"]))).toBe(
      false,
    );
  });

  test("missing matches when field is null", () => {
    const noCountry = makeRow({ business: { country: null } });
    expect(evaluateRow(noCountry, r("country", "missing", null))).toBe(true);
    expect(evaluateRow(noCountry, r("country", "present", null))).toBe(false);
  });

  test("present matches when field is set", () => {
    expect(evaluateRow(us, r("country", "present", null))).toBe(true);
    expect(evaluateRow(us, r("country", "missing", null))).toBe(false);
  });
});

describe("evaluateRow · string comparators (single-row · Business.city)", () => {
  // `city` is the canonical string signal — case-insensitive substring
  // matching per the comparator implementation.
  const miami = makeRow({ business: { city: "Miami" } });

  test("contains is case-insensitive substring", () => {
    expect(evaluateRow(miami, r("city", "contains", "iam"))).toBe(true);
    expect(evaluateRow(miami, r("city", "contains", "MIA"))).toBe(true);
    expect(evaluateRow(miami, r("city", "contains", "Boston"))).toBe(false);
  });

  test("not_contains inverts contains", () => {
    expect(evaluateRow(miami, r("city", "not_contains", "iam"))).toBe(false);
    expect(evaluateRow(miami, r("city", "not_contains", "Boston"))).toBe(true);
  });

  test("equals is case-insensitive full match", () => {
    expect(evaluateRow(miami, r("city", "equals", "miami"))).toBe(true);
    expect(evaluateRow(miami, r("city", "equals", "MIAMI"))).toBe(true);
    expect(evaluateRow(miami, r("city", "equals", "miam"))).toBe(false);
  });

  test("not_equals inverts equals", () => {
    expect(evaluateRow(miami, r("city", "not_equals", "miami"))).toBe(false);
    expect(evaluateRow(miami, r("city", "not_equals", "boston"))).toBe(true);
  });

  test("missing matches when field is null/empty", () => {
    const noCity = makeRow({ business: { city: null } });
    expect(evaluateRow(noCity, r("city", "missing", null))).toBe(true);
    expect(evaluateRow(noCity, r("city", "present", null))).toBe(false);
  });

  test("present matches when field is set", () => {
    expect(evaluateRow(miami, r("city", "present", null))).toBe(true);
  });
});

describe("evaluateRow · stale/invalid input", () => {
  const row = makeRow();

  test("unknown signal key returns false (stale filter)", () => {
    expect(evaluateRow(row, r("removed_in_2027", "<", 10))).toBe(false);
  });

  test("invalid comparator for value type returns false", () => {
    // 'between' isn't valid on booleans
    expect(evaluateRow(row, r("is_claimed", "between", [true, true]))).toBe(
      false,
    );
  });

  test("Lead-based exclusion (unknown model) returns false", () => {
    // exclude_already_contacted references Lead.contactedAt — handled by SQL pre-filter
    expect(
      evaluateRow(row, r("exclude_already_contacted", "present", null)),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// evaluateSpec · combine + exclusions
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateSpec · combine = and", () => {
  const row = makeRow();

  test("matches when all rows match", () => {
    const spec: FilterSpec = {
      rows: [
        r("rating", "<", 4.7),
        r("review_count", ">=", 100),
        r("is_claimed", "is", true),
      ],
    };
    expect(evaluateSpec(row, spec)).toBe(true);
  });

  test("fails when any row fails", () => {
    const spec: FilterSpec = {
      rows: [r("rating", "<", 4.7), r("review_count", ">=", 500)],
    };
    expect(evaluateSpec(row, spec)).toBe(false);
  });

  test("empty rows matches everything", () => {
    expect(evaluateSpec(row, { rows: [] })).toBe(true);
    expect(evaluateSpec(row, {})).toBe(true);
  });

  test("default combine is 'and'", () => {
    const spec: FilterSpec = {
      rows: [r("rating", ">=", 4.5), r("review_count", ">=", 100)],
    };
    expect(evaluateSpec(row, spec)).toBe(true);
    const fails: FilterSpec = {
      rows: [r("rating", ">=", 4.5), r("review_count", ">=", 500)],
    };
    expect(evaluateSpec(row, fails)).toBe(false);
  });
});

describe("evaluateSpec · combine = or", () => {
  const row = makeRow();

  test("matches when ANY row matches", () => {
    const spec: FilterSpec = {
      combine: "or",
      rows: [r("rating", "<", 3.0), r("review_count", ">=", 100)],
    };
    expect(evaluateSpec(row, spec)).toBe(true);
  });

  test("fails when ALL rows fail", () => {
    const spec: FilterSpec = {
      combine: "or",
      rows: [r("rating", "<", 3.0), r("review_count", ">=", 500)],
    };
    expect(evaluateSpec(row, spec)).toBe(false);
  });
});

describe("evaluateSpec · exclusions", () => {
  test("exclusion match removes business (AND short-circuit)", () => {
    const row = makeRow();
    const spec: FilterSpec = {
      rows: [r("rating", ">=", 4.0)],
      exclusions: [r("is_claimed", "is", true)], // synthetic — match → exclude
    };
    expect(evaluateSpec(row, spec)).toBe(false);
  });

  test("exclusion non-match keeps business eligible", () => {
    const row = makeRow();
    const spec: FilterSpec = {
      rows: [r("rating", ">=", 4.0)],
      exclusions: [r("is_claimed", "is", false)],
    };
    expect(evaluateSpec(row, spec)).toBe(true);
  });

  test("exclusion overrides 'or' combine too", () => {
    const row = makeRow();
    const spec: FilterSpec = {
      combine: "or",
      rows: [r("rating", "<", 3.0), r("review_count", ">=", 100)],
      exclusions: [r("is_claimed", "is", true)],
    };
    expect(evaluateSpec(row, spec)).toBe(false);
  });

  test("spec with only exclusions matches everything not excluded", () => {
    const row = makeRow();
    const ok: FilterSpec = { exclusions: [r("is_claimed", "is", false)] };
    expect(evaluateSpec(row, ok)).toBe(true);
    const excluded: FilterSpec = { exclusions: [r("is_claimed", "is", true)] };
    expect(evaluateSpec(row, excluded)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// evaluateRows + tracing
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateRows", () => {
  test("returns IDs of matching rows in input order", () => {
    const a = makeRow({
      id: "biz_a",
      business: { rating: 4.9, reviewCount: 200, isClaimed: true },
    });
    const b = makeRow({
      id: "biz_b",
      business: { rating: 4.0, reviewCount: 50, isClaimed: true },
    });
    const c = makeRow({
      id: "biz_c",
      business: { rating: 4.7, reviewCount: 300, isClaimed: true },
    });

    const spec: FilterSpec = {
      rows: [r("rating", ">=", 4.5), r("review_count", ">=", 100)],
    };

    expect(evaluateRows([a, b, c], spec)).toEqual(["biz_a", "biz_c"]);
  });

  test("empty input returns empty", () => {
    expect(evaluateRows([], { rows: [r("rating", ">=", 4)] })).toEqual([]);
  });

  test("stable across repeated calls (no Set iteration order)", () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      makeRow({
        id: `biz_${i}`,
        business: { rating: 4.5, reviewCount: 100 + i, isClaimed: true },
      }),
    );
    const spec: FilterSpec = { rows: [r("rating", ">=", 4.0)] };
    const a = evaluateRows(rows, spec);
    const b = evaluateRows(rows, spec);
    expect(a).toEqual(b);
    expect(a[0]).toBe("biz_0");
  });
});

describe("evaluateSpecWithTrace", () => {
  test("trace records each row's pass/fail + actual", () => {
    const row = makeRow();
    const spec: FilterSpec = {
      rows: [r("rating", ">=", 4.5), r("review_count", ">=", 500)],
    };
    const result = evaluateSpecWithTrace(row, spec);
    expect(result.matches).toBe(false);
    expect(result.trace).toHaveLength(2);
    expect(result.trace?.[0]).toMatchObject({
      signalKey: "rating",
      matched: true,
      actual: 4.6,
      isExclusion: false,
    });
    expect(result.trace?.[1]).toMatchObject({
      signalKey: "review_count",
      matched: false,
      actual: 187,
      isExclusion: false,
    });
  });

  test("trace marks exclusion rows with isExclusion=true", () => {
    const row = makeRow();
    const spec: FilterSpec = {
      rows: [r("rating", ">=", 4.0)],
      exclusions: [r("is_claimed", "is", false)],
    };
    const result = evaluateSpecWithTrace(row, spec);
    expect(result.matches).toBe(true);
    const exclusionTrace = result.trace?.find((t) => t.isExclusion);
    expect(exclusionTrace?.signalKey).toBe("is_claimed");
    expect(exclusionTrace?.matched).toBe(false);
  });

  test("trace handles unknown signals gracefully (actual = undefined)", () => {
    const row = makeRow();
    const spec: FilterSpec = { rows: [r("removed_in_2027", "<", 10)] };
    const result = evaluateSpecWithTrace(row, spec);
    expect(result.matches).toBe(false);
    expect(result.trace?.[0].actual).toBeUndefined();
  });
});

describe("evaluateRowsWithTrace", () => {
  test("returns id + verdict for each row", () => {
    const a = makeRow({
      id: "biz_a",
      business: { rating: 4.9, reviewCount: 200, isClaimed: true },
    });
    const b = makeRow({
      id: "biz_b",
      business: { rating: 3.5, reviewCount: 50, isClaimed: true },
    });
    const spec: FilterSpec = { rows: [r("rating", ">=", 4.5)] };
    const out = evaluateRowsWithTrace([a, b], spec);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      id: "biz_a",
      verdict: expect.objectContaining({ matches: true }),
    });
    expect(out[1]).toEqual({
      id: "biz_b",
      verdict: expect.objectContaining({ matches: false }),
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// integration · dev-seed-style batch
// ─────────────────────────────────────────────────────────────────────────────

describe("integration · realistic filter spec on a batch", () => {
  // Reproduces the "website rebuild" service-template default: low Lighthouse
  // + middling rating + at least some reviews.
  const websiteRebuildSpec: FilterSpec = {
    combine: "and",
    rows: [
      r("lighthouse_performance", "<", 70),
      r("rating", ">=", 4.0),
      r("review_count", ">=", 25),
      r("is_claimed", "is", true),
    ],
  };

  test("matches a qualifying business", () => {
    const qualifies = makeRow({
      id: "qual_1",
      lighthouseAudit: { performance: 55, lcp: 3.5 },
      business: { rating: 4.4, reviewCount: 87, isClaimed: true },
    });
    expect(evaluateSpec(qualifies, websiteRebuildSpec)).toBe(true);
  });

  test("rejects a high-Lighthouse business", () => {
    const tooFast = makeRow({
      id: "fast_1",
      lighthouseAudit: { performance: 92, lcp: 1.5 },
      business: { rating: 4.4, reviewCount: 87, isClaimed: true },
    });
    expect(evaluateSpec(tooFast, websiteRebuildSpec)).toBe(false);
  });

  test("rejects an unclaimed business", () => {
    const unclaimed = makeRow({
      id: "unc_1",
      lighthouseAudit: { performance: 55, lcp: 3.5 },
      business: { rating: 4.4, reviewCount: 87, isClaimed: false },
    });
    expect(evaluateSpec(unclaimed, websiteRebuildSpec)).toBe(false);
  });

  test("filters a 100-row batch deterministically", () => {
    const batch = Array.from({ length: 100 }, (_, i) =>
      makeRow({
        id: `seed_${i}`,
        lighthouseAudit: {
          performance: 30 + (i % 60),
          lcp: 2.0 + (i % 4) * 0.5,
        },
        business: {
          rating: 3.0 + ((i * 7) % 20) / 10,
          reviewCount: 10 + i * 3,
          isClaimed: i % 2 === 0,
        },
      }),
    );
    const matched = evaluateRows(batch, websiteRebuildSpec);
    // Deterministic: same input → same output
    const matched2 = evaluateRows(batch, websiteRebuildSpec);
    expect(matched).toEqual(matched2);
    // Sanity: subset, not empty, not all
    expect(matched.length).toBeGreaterThan(0);
    expect(matched.length).toBeLessThan(batch.length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// performance · 1000 ops budget
// ─────────────────────────────────────────────────────────────────────────────

describe("performance budget", () => {
  test("1000 evaluations complete in under 100ms (warm)", () => {
    const rows = Array.from({ length: 1000 }, (_, i) =>
      makeRow({
        id: `perf_${i}`,
        business: {
          rating: 3 + (i % 20) / 10,
          reviewCount: i,
          isClaimed: i % 2 === 0,
        },
        lighthouseAudit: { performance: i % 100, lcp: 2 + (i % 5) * 0.3 },
      }),
    );
    const spec: FilterSpec = {
      rows: [
        r("rating", ">=", 4.0),
        r("review_count", ">=", 50),
        r("lighthouse_performance", "<", 80),
        r("is_claimed", "is", true),
      ],
    };
    // Warm-up — CI cold start can spike the first iteration unfairly.
    evaluateRows(rows, spec);
    const start = performance.now();
    evaluateRows(rows, spec);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});
