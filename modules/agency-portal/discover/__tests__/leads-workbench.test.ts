// Pure logic for the leads workbench: filter eval, vs-cell delta formatting,
// match% derivation, pain-group mapping, sort, search, pagination windowing.
// Per .claude/rules/testing.md we test the invariants, not rendered DOM.

import { describe, expect, test } from "vitest";

import {
  COLUMNS,
  DEFAULT_ACTIVE_COLUMNS,
  deriveMatchPct,
  evalFilter,
  filterLabel,
  fmtDelta,
  getPageNumbers,
  matchesSearch,
  painGroupClass,
  passesFilters,
  sortRows,
  toneForPercentile,
  type LeadFilter,
  type WorkbenchLeadRow,
} from "../leads-workbench";

function row(over: Partial<WorkbenchLeadRow> = {}): WorkbenchLeadRow {
  return {
    leadId: "l1",
    businessId: "b1",
    name: "Solea Brickell Spa",
    addr: "100 Main St · Medical spa · Miami",
    cell: "Medical spa · Miami",
    status: "NEW",
    match: 80,
    matchDerived: false,
    matchFromSignals: false,
    perSignal: {},
    pains: [],
    reachability: "RICH",
    reachable: true,
    builtOn: "Wix",
    touch: "None",
    reviews: 120,
    rating: 4.4,
    perf: 42,
    phones: ["+13055550100"],
    emails: ["maria@solea.com"],
    families: {
      identity: true,
      reviews: true,
      website: true,
      contacts: true,
      ads: false,
      search: false,
    },
    ...over,
  };
}

describe("evalFilter / passesFilters", () => {
  test("each comparator", () => {
    const r = row({ perf: 42, reviews: 120 });
    expect(evalFilter(r, { field: "perf", op: "<", value: 50 })).toBe(true);
    expect(evalFilter(r, { field: "perf", op: "≤", value: 42 })).toBe(true);
    expect(evalFilter(r, { field: "perf", op: "=", value: 42 })).toBe(true);
    expect(evalFilter(r, { field: "perf", op: ">", value: 50 })).toBe(false);
    expect(evalFilter(r, { field: "reviews", op: "≥", value: 20 })).toBe(true);
    expect(
      evalFilter(r, {
        field: "reviews",
        op: "between",
        value: 100,
        value2: 200,
      }),
    ).toBe(true);
  });

  test("null backing value never matches", () => {
    const r = row({ perf: null });
    expect(evalFilter(r, { field: "perf", op: "<", value: 50 })).toBe(false);
  });

  test("AND semantics across active filters", () => {
    const r = row({ perf: 42, reviews: 120 });
    const filters: LeadFilter[] = [
      { field: "perf", op: "<", value: 50 },
      { field: "reviews", op: "≥", value: 20 },
    ];
    expect(passesFilters(r, filters)).toBe(true);
    expect(
      passesFilters(r, [...filters, { field: "reviews", op: "≥", value: 999 }]),
    ).toBe(false);
  });

  test("filterLabel renders human chip text", () => {
    expect(filterLabel({ field: "perf", op: "<", value: 50 })).toBe(
      "Lighthouse < 50",
    );
    expect(
      filterLabel({ field: "reviews", op: "between", value: 10, value2: 20 }),
    ).toBe("Reviews 10–20");
  });
});

describe("fmtDelta", () => {
  test("above median (higher better) → green up", () => {
    const d = fmtDelta(200, 100, true);
    expect(d.dir).toBe("up");
    expect(d.text).toContain("▲");
    expect(d.text).toContain("+100");
  });

  test("below median (higher better) → red down", () => {
    const d = fmtDelta(40, 100, true);
    expect(d.dir).toBe("dn");
    expect(d.text).toContain("▼");
  });

  test("lower-is-better flips the color", () => {
    // value below median is GOOD when higherIsBetter=false
    expect(fmtDelta(40, 100, false).dir).toBe("up");
    expect(fmtDelta(200, 100, false).dir).toBe("dn");
  });

  test("within tolerance → ≈ flat", () => {
    expect(fmtDelta(101, 100, true)).toEqual({ text: "≈", dir: "flat" });
  });
});

describe("deriveMatchPct", () => {
  test("stored 0–1 fraction scales to 0–100", () => {
    expect(deriveMatchPct(0.87, 0)).toEqual({ match: 87, derived: false });
  });

  test("stored 0–100 passes through clamped", () => {
    expect(deriveMatchPct(73, 0)).toEqual({ match: 73, derived: false });
    expect(deriveMatchPct(140, 0)).toEqual({ match: 100, derived: false });
  });

  test("derives from pain count when no stored score, capped at 95", () => {
    expect(deriveMatchPct(null, 0)).toEqual({ match: 40, derived: true });
    expect(deriveMatchPct(null, 1).match).toBe(60);
    expect(deriveMatchPct(null, 2).match).toBe(75);
    expect(deriveMatchPct(null, 3).match).toBe(85);
    expect(deriveMatchPct(undefined, 9)).toEqual({ match: 92, derived: true });
  });
});

describe("painGroupClass", () => {
  test("maps known groups to .ppchip modifiers", () => {
    expect(painGroupClass("website")).toBe("weak-web");
    expect(painGroupClass("Ad spend")).toBe("wasting");
    expect(painGroupClass("reputation")).toBe("reputation");
    expect(painGroupClass("search visibility")).toBe("under");
    expect(painGroupClass("growth")).toBe("growing");
  });

  test("unknown → neutral more chip", () => {
    expect(painGroupClass("whatever")).toBe("more");
  });
});

describe("toneForPercentile", () => {
  test("buckets", () => {
    expect(toneForPercentile(90)).toBe("g");
    expect(toneForPercentile(50)).toBe("a");
    expect(toneForPercentile(10)).toBe("r");
  });
});

describe("sortRows", () => {
  test("sorts by match desc then asc; nulls sink", () => {
    const rows = [
      row({ leadId: "a", match: 40 }),
      row({ leadId: "b", match: 90 }),
    ];
    expect(sortRows(rows, "match", -1).map((r) => r.leadId)).toEqual([
      "b",
      "a",
    ]);
    expect(sortRows(rows, "match", 1).map((r) => r.leadId)).toEqual(["a", "b"]);
    const withNull = [
      row({ leadId: "x", reviews: null }),
      row({ leadId: "y", reviews: 5 }),
    ];
    expect(sortRows(withNull, "reviews", -1).map((r) => r.leadId)).toEqual([
      "y",
      "x",
    ]);
  });
});

describe("matchesSearch", () => {
  test("matches name / addr / builtOn, case-insensitive", () => {
    const r = row();
    expect(matchesSearch(r, "")).toBe(true);
    expect(matchesSearch(r, "solea")).toBe(true);
    expect(matchesSearch(r, "main st")).toBe(true);
    expect(matchesSearch(r, "wix")).toBe(true);
    expect(matchesSearch(r, "nope")).toBe(false);
  });
});

describe("getPageNumbers", () => {
  test("no ellipsis when ≤ 7 pages", () => {
    expect(getPageNumbers(1, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  test("windows with ellipsis on both sides for the middle", () => {
    expect(getPageNumbers(5, 10)).toEqual([
      1,
      "ellipsis",
      4,
      5,
      6,
      "ellipsis",
      10,
    ]);
  });

  test("first page → trailing ellipsis only", () => {
    expect(getPageNumbers(1, 10)).toEqual([1, 2, "ellipsis", 10]);
  });

  test("last page → leading ellipsis only", () => {
    expect(getPageNumbers(10, 10)).toEqual([1, "ellipsis", 9, 10]);
  });
});

describe("column registry", () => {
  test("default-on columns include the signature workflow columns", () => {
    expect(DEFAULT_ACTIVE_COLUMNS).toEqual(
      expect.arrayContaining([
        "biz",
        "match",
        "pains",
        "reachable",
        "status",
        "touch",
      ]),
    );
  });

  test("raw numeric facts are off by default (Fields-menu toggles)", () => {
    const reviews = COLUMNS.find((c) => c.key === "reviews");
    expect(reviews?.defaultOn).toBe(false);
  });
});
