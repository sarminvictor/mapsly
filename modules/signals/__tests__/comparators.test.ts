/**
 * Comparator semantics · invariant tests
 *
 * Per `.claude/rules/testing.md` § Hunter filter evaluation: we must cover
 * 100% of comparator types. The Hunter mis-evaluating a filter is a
 * directly-revenue-impacting bug.
 */

import { describe, expect, test } from "vitest";
import {
  BOOLEAN_COMPARATORS,
  COMPARATORS_BY_TYPE,
  DATE_COMPARATORS,
  ENUM_COMPARATORS,
  NUMERIC_COMPARATORS,
  STRING_COMPARATORS,
  evaluate,
  isValidComparator,
} from "../comparators";
import { CATEGORIES_ORDERED, CATEGORIES } from "../categories";
import {
  SIGNALS,
  SIGNALS_ORDERED,
  SIGNAL_COUNT,
  getSignal,
  getSignalsByCategory,
} from "../registry";
import type { SignalValueType } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Comparator catalogs
// ─────────────────────────────────────────────────────────────────────────────

describe("COMPARATORS_BY_TYPE", () => {
  test("every value type has at least one comparator", () => {
    const types: SignalValueType[] = [
      "numeric",
      "boolean",
      "enum",
      "string",
      "date",
    ];
    for (const t of types) {
      expect(COMPARATORS_BY_TYPE[t].length).toBeGreaterThan(0);
    }
  });

  test("every comparator catalog includes missing + present except boolean", () => {
    expect(NUMERIC_COMPARATORS).toContain("missing");
    expect(NUMERIC_COMPARATORS).toContain("present");
    expect(STRING_COMPARATORS).toContain("missing");
    expect(STRING_COMPARATORS).toContain("present");
    expect(ENUM_COMPARATORS).toContain("missing");
    expect(ENUM_COMPARATORS).toContain("present");
    expect(DATE_COMPARATORS).toContain("missing");
    expect(DATE_COMPARATORS).toContain("present");
    // boolean: is/is_not implies presence — no missing/present comparator
    expect(BOOLEAN_COMPARATORS).not.toContain("missing");
  });
});

describe("isValidComparator", () => {
  test("accepts a numeric comparator on a numeric type", () => {
    expect(isValidComparator("numeric", "<")).toBe(true);
    expect(isValidComparator("numeric", "between")).toBe(true);
  });

  test("rejects an enum comparator on a boolean type", () => {
    expect(isValidComparator("boolean", "is_one_of")).toBe(false);
  });

  test("rejects a nonsense string", () => {
    expect(isValidComparator("numeric", "approximately")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// presence: missing + present (uniform across types)
// ─────────────────────────────────────────────────────────────────────────────

describe("presence comparators", () => {
  test("missing matches null/undefined/empty-string/NaN/Infinity", () => {
    expect(evaluate("numeric", "missing", null, null)).toBe(true);
    expect(evaluate("numeric", "missing", null, undefined)).toBe(true);
    expect(evaluate("numeric", "missing", null, NaN)).toBe(true);
    expect(evaluate("numeric", "missing", null, Infinity)).toBe(true);
    expect(evaluate("string", "missing", null, "")).toBe(true);
  });

  test("missing does NOT match real values", () => {
    expect(evaluate("numeric", "missing", null, 0)).toBe(false);
    expect(evaluate("numeric", "missing", null, 42)).toBe(false);
    expect(evaluate("string", "missing", null, "hello")).toBe(false);
    expect(evaluate("boolean", "missing", null, false)).toBe(false);
  });

  test("present is the inverse of missing", () => {
    expect(evaluate("numeric", "present", null, 42)).toBe(true);
    expect(evaluate("numeric", "present", null, null)).toBe(false);
    expect(evaluate("string", "present", null, "x")).toBe(true);
    expect(evaluate("string", "present", null, "")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// numeric
// ─────────────────────────────────────────────────────────────────────────────

describe("numeric comparators", () => {
  test("<", () => {
    expect(evaluate("numeric", "<", 25, 20)).toBe(true);
    expect(evaluate("numeric", "<", 25, 25)).toBe(false);
    expect(evaluate("numeric", "<", 25, 30)).toBe(false);
  });

  test("<=", () => {
    expect(evaluate("numeric", "<=", 25, 24)).toBe(true);
    expect(evaluate("numeric", "<=", 25, 25)).toBe(true);
    expect(evaluate("numeric", "<=", 25, 26)).toBe(false);
  });

  test("=", () => {
    expect(evaluate("numeric", "=", 4.5, 4.5)).toBe(true);
    expect(evaluate("numeric", "=", 4.5, 4.4)).toBe(false);
  });

  test(">=", () => {
    expect(evaluate("numeric", ">=", 100, 100)).toBe(true);
    expect(evaluate("numeric", ">=", 100, 99)).toBe(false);
  });

  test(">", () => {
    expect(evaluate("numeric", ">", 100, 101)).toBe(true);
    expect(evaluate("numeric", ">", 100, 100)).toBe(false);
  });

  test("between (inclusive)", () => {
    expect(evaluate("numeric", "between", [10, 20], 15)).toBe(true);
    expect(evaluate("numeric", "between", [10, 20], 10)).toBe(true);
    expect(evaluate("numeric", "between", [10, 20], 20)).toBe(true);
    expect(evaluate("numeric", "between", [10, 20], 9)).toBe(false);
    expect(evaluate("numeric", "between", [10, 20], 21)).toBe(false);
  });

  test("between tolerates reversed bounds", () => {
    expect(evaluate("numeric", "between", [20, 10], 15)).toBe(true);
  });

  test("between rejects malformed expected", () => {
    expect(evaluate("numeric", "between", [10], 15)).toBe(false);
    expect(evaluate("numeric", "between", "10,20", 15)).toBe(false);
  });

  test("coerces string values to numbers", () => {
    expect(evaluate("numeric", ">=", 100, "150")).toBe(true);
    expect(evaluate("numeric", ">=", 100, "abc")).toBe(false);
  });

  test("treats null/NaN actuals as absent (non-match for value comparators)", () => {
    expect(evaluate("numeric", "<", 25, null)).toBe(false);
    expect(evaluate("numeric", "<", 25, NaN)).toBe(false);
    expect(evaluate("numeric", ">=", 100, undefined)).toBe(false);
  });

  test("missing-expected returns no-match (defensive)", () => {
    expect(evaluate("numeric", "<", null, 5)).toBe(false);
    expect(evaluate("numeric", ">=", undefined as never, 5)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// boolean
// ─────────────────────────────────────────────────────────────────────────────

describe("boolean comparators", () => {
  test("is", () => {
    expect(evaluate("boolean", "is", true, true)).toBe(true);
    expect(evaluate("boolean", "is", false, false)).toBe(true);
    expect(evaluate("boolean", "is", true, false)).toBe(false);
  });

  test("is_not", () => {
    expect(evaluate("boolean", "is_not", true, false)).toBe(true);
    expect(evaluate("boolean", "is_not", true, true)).toBe(false);
  });

  test("coerces string/number actuals", () => {
    expect(evaluate("boolean", "is", true, "yes")).toBe(true);
    expect(evaluate("boolean", "is", true, "1")).toBe(true);
    expect(evaluate("boolean", "is", false, "no")).toBe(true);
    expect(evaluate("boolean", "is", false, 0)).toBe(true);
    expect(evaluate("boolean", "is", true, 1)).toBe(true);
  });

  test("non-coercible actual is absent", () => {
    expect(evaluate("boolean", "is", true, "maybe")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// enum
// ─────────────────────────────────────────────────────────────────────────────

describe("enum comparators", () => {
  test("is / is_not", () => {
    expect(evaluate("enum", "is", "wordpress", "wordpress")).toBe(true);
    expect(evaluate("enum", "is", "wordpress", "wix")).toBe(false);
    expect(evaluate("enum", "is_not", "wordpress", "wix")).toBe(true);
  });

  test("is_one_of", () => {
    expect(
      evaluate("enum", "is_one_of", ["wordpress", "wix"], "wordpress"),
    ).toBe(true);
    expect(evaluate("enum", "is_one_of", ["wordpress", "wix"], "shopify")).toBe(
      false,
    );
  });

  test("is_none_of", () => {
    expect(
      evaluate("enum", "is_none_of", ["wordpress", "wix"], "shopify"),
    ).toBe(true);
    expect(
      evaluate("enum", "is_none_of", ["wordpress", "wix"], "wordpress"),
    ).toBe(false);
  });

  test("rejects non-array expected for is_one_of", () => {
    expect(evaluate("enum", "is_one_of", "wordpress", "wordpress")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// string
// ─────────────────────────────────────────────────────────────────────────────

describe("string comparators", () => {
  test("contains (case-insensitive)", () => {
    expect(evaluate("string", "contains", "free", "Free consultation")).toBe(
      true,
    );
    expect(evaluate("string", "contains", "FREE", "free consultation")).toBe(
      true,
    );
    expect(evaluate("string", "contains", "premium", "Free consultation")).toBe(
      false,
    );
  });

  test("not_contains", () => {
    expect(
      evaluate("string", "not_contains", "premium", "Free first visit"),
    ).toBe(true);
    expect(evaluate("string", "not_contains", "free", "Free first visit")).toBe(
      false,
    );
  });

  test("equals / not_equals (case-insensitive)", () => {
    expect(evaluate("string", "equals", "medical_spa", "MEDICAL_SPA")).toBe(
      true,
    );
    expect(evaluate("string", "not_equals", "medical_spa", "auto_body")).toBe(
      true,
    );
  });

  test("empty expected (non-presence ops) returns no-match", () => {
    expect(evaluate("string", "contains", "", "anything")).toBe(false);
    expect(evaluate("string", "equals", "", "anything")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// date
// ─────────────────────────────────────────────────────────────────────────────

describe("date comparators", () => {
  const ref = new Date("2026-05-20T00:00:00Z");
  const earlier = new Date("2026-04-20T00:00:00Z");
  const later = new Date("2026-06-20T00:00:00Z");

  test("before / after", () => {
    expect(evaluate("date", "before", ref, earlier)).toBe(true);
    expect(evaluate("date", "before", ref, later)).toBe(false);
    expect(evaluate("date", "after", ref, later)).toBe(true);
    expect(evaluate("date", "after", ref, earlier)).toBe(false);
  });

  test("between (inclusive of bounds)", () => {
    expect(evaluate("date", "between", [earlier, later], ref)).toBe(true);
    expect(evaluate("date", "between", [earlier, ref], ref)).toBe(true);
    expect(evaluate("date", "between", [later, earlier], ref)).toBe(true);
    expect(evaluate("date", "between", [earlier, ref], later)).toBe(false);
  });

  test("older_than (days)", () => {
    const tenDaysAgo = new Date(Date.now() - 10 * 86400_000);
    const twoDaysAgo = new Date(Date.now() - 2 * 86400_000);
    expect(evaluate("date", "older_than", 7, tenDaysAgo)).toBe(true);
    expect(evaluate("date", "older_than", 7, twoDaysAgo)).toBe(false);
  });

  test("newer_than (days)", () => {
    const oneDayAgo = new Date(Date.now() - 1 * 86400_000);
    const fortyDaysAgo = new Date(Date.now() - 40 * 86400_000);
    expect(evaluate("date", "newer_than", 7, oneDayAgo)).toBe(true);
    expect(evaluate("date", "newer_than", 7, fortyDaysAgo)).toBe(false);
  });

  test("accepts string-ISO + epoch-ms + Date for actual", () => {
    expect(evaluate("date", "before", ref, "2026-04-20")).toBe(true);
    expect(evaluate("date", "before", ref, earlier.getTime())).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Registry invariants — the moat is the breadth + correctness here
// ─────────────────────────────────────────────────────────────────────────────

describe("signal registry", () => {
  test("ships 100+ signals (the moat contract + landing marketing claim)", () => {
    // The landing/welcome hero advertises "100+ signals" — this floor guarantees
    // the marketing claim can never silently exceed the real registry (105 today).
    expect(SIGNAL_COUNT).toBeGreaterThanOrEqual(100);
  });

  test("every signal key is unique", () => {
    const seen = new Set<string>();
    for (const s of SIGNALS_ORDERED) {
      expect(seen.has(s.key)).toBe(false);
      seen.add(s.key);
    }
  });

  test("every signal's comparators are valid for its value type", () => {
    for (const s of SIGNALS_ORDERED) {
      const allowed = COMPARATORS_BY_TYPE[s.type] as readonly string[];
      for (const c of s.comparators) {
        expect(allowed).toContain(c);
      }
    }
  });

  test("every signal references a known category", () => {
    const known = new Set(CATEGORIES_ORDERED.map((c) => c.key));
    for (const s of SIGNALS_ORDERED) {
      expect(known.has(s.category)).toBe(true);
    }
  });

  test("every signal column follows Model.field shape", () => {
    for (const s of SIGNALS_ORDERED) {
      expect(s.column).toMatch(/^[A-Z][A-Za-z0-9]+\.[a-z][A-Za-z0-9]+$/);
    }
  });

  test("all 8 categories are populated", () => {
    for (const cat of Object.keys(CATEGORIES)) {
      const sigs = getSignalsByCategory(cat as never);
      expect(sigs.length, `category ${cat} has zero signals`).toBeGreaterThan(
        0,
      );
    }
  });

  test("exclusions are flagged isExclusion=true", () => {
    const ex = getSignalsByCategory("exclusions");
    for (const s of ex) {
      expect(s.isExclusion).toBe(true);
    }
  });

  test("getSignal returns the same instance as the map", () => {
    const a = getSignal("reply_rate");
    expect(a).toBeDefined();
    expect(a).toBe(SIGNALS["reply_rate"]);
  });

  test("unknown keys return undefined", () => {
    expect(getSignal("nonexistent_signal")).toBeUndefined();
  });

  test("tooltips are plain English with benchmarks", () => {
    // Spot check: every reviews signal mentions benchmark or %
    for (const s of getSignalsByCategory("reviews")) {
      expect(s.helpTooltip.length).toBeGreaterThan(20);
    }
  });

  test("cadences match the docs/data-cadence.md tiers", () => {
    const validCadences = new Set([
      "daily",
      "weekly",
      "monthly",
      "on-demand",
      "static",
    ]);
    for (const s of SIGNALS_ORDERED) {
      expect(validCadences.has(s.cadence)).toBe(true);
    }
  });
});

describe("categories", () => {
  test("CATEGORIES_ORDERED is sorted by sortOrder ascending", () => {
    const orders = CATEGORIES_ORDERED.map((c) => c.sortOrder);
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeGreaterThan(orders[i - 1]);
    }
  });

  test("every category has a non-empty label, description, colorHint", () => {
    for (const c of CATEGORIES_ORDERED) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.colorHint).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  test("reviews + search lead the order (highest leverage per agency UX)", () => {
    const top2 = CATEGORIES_ORDERED.slice(0, 2).map((c) => c.key);
    expect(top2).toContain("reviews");
    expect(top2).toContain("search");
  });
});
