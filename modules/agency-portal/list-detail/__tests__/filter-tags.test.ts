/**
 * filter-tags · F.3 · parser invariants.
 *
 * Per `.claude/rules/testing.md` §"What we DO test":
 *   - "Hunter filter evaluation logic — mis-evaluating a filter = wrong
 *     list = lost revenue." Same logic applies to the *display* layer:
 *     a wrongly-parsed filter chip misleads Tom about what defines a
 *     list. Pure function · 100% comparator + shape coverage.
 *
 * The parser is intentionally defensive (returns `[]` on garbage input
 * rather than throwing) — these tests pin that contract so we never
 * regress into a crash on user-influenced JSON.
 */

import { describe, expect, test } from "vitest";

import { parseFilterTags } from "../filter-tags";

describe("parseFilterTags · shape parsing", () => {
  test("returns [] for null / undefined / non-object", () => {
    expect(parseFilterTags(null)).toEqual([]);
    expect(parseFilterTags(undefined)).toEqual([]);
    expect(parseFilterTags("not-json")).toEqual([]);
    expect(parseFilterTags(42)).toEqual([]);
    expect(parseFilterTags(true)).toEqual([]);
  });

  test("parses { rules: [...] } shape", () => {
    const out = parseFilterTags({
      rules: [
        { id: "lh_performance", op: "lt", value: 60 },
        { id: "lh_lcp_ms", op: "gt", value: 3 },
      ],
    });
    expect(out).toHaveLength(2);
    expect(out[0]!.label).toBe("Lighthouse Perf < 60");
    expect(out[1]!.label).toBe("LCP > 3");
  });

  test("parses raw array shape", () => {
    const out = parseFilterTags([
      { id: "category", op: "eq", value: "medical_spa" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.label).toBe("category = medical_spa");
  });

  test("rules with missing id are dropped, not crashed on", () => {
    const out = parseFilterTags({
      rules: [
        { op: "eq", value: "no-id" }, // bad — no id
        { id: "rating", op: "gte", value: 4.0 },
      ],
    });
    expect(out).toHaveLength(1);
    // Note: JS can't distinguish 4 from 4.0 (both === 4), so formatValue
    // renders integer-ish values without decimals. "rating ≥ 4" is fine UX.
    expect(out[0]!.label).toBe("rating ≥ 4");
  });
});

describe("parseFilterTags · comparator glyphs", () => {
  function tag(op: string, value: unknown = 1) {
    return parseFilterTags([{ id: "review_count", op, value }])[0]!.label;
  }
  test("maps every supported comparator to a glyph", () => {
    expect(tag("lt")).toBe("reviews < 1");
    expect(tag("lte")).toBe("reviews ≤ 1");
    expect(tag("le")).toBe("reviews ≤ 1");
    expect(tag("gt")).toBe("reviews > 1");
    expect(tag("gte")).toBe("reviews ≥ 1");
    expect(tag("ge")).toBe("reviews ≥ 1");
    expect(tag("eq")).toBe("reviews = 1");
    expect(tag("neq")).toBe("reviews ≠ 1");
    expect(tag("ne")).toBe("reviews ≠ 1");
  });

  test("missing / present collapse the value", () => {
    expect(
      parseFilterTags([{ id: "has_local_business_schema", op: "missing" }])[0]!
        .label,
    ).toBe("LocalBusiness schema: missing");
    expect(
      parseFilterTags([{ id: "has_faq_schema", op: "present" }])[0]!.label,
    ).toBe("FAQ schema: present");
  });

  test("unknown comparator falls through as the raw op", () => {
    const out = parseFilterTags([{ id: "rating", op: "wat", value: 4 }]);
    expect(out[0]!.label).toBe("rating wat 4");
  });
});

describe("parseFilterTags · value formatting", () => {
  test("ints render as integers", () => {
    const out = parseFilterTags([
      { id: "review_count", op: "gte", value: 100 },
    ]);
    expect(out[0]!.label).toBe("reviews ≥ 100");
  });

  test("non-integer floats render to 1 decimal", () => {
    const out = parseFilterTags([{ id: "rating", op: "lt", value: 3.789 }]);
    expect(out[0]!.label).toBe("rating < 3.8");
  });

  test("booleans render yes/no", () => {
    const out = parseFilterTags([{ id: "is_claimed", op: "eq", value: true }]);
    expect(out[0]!.label).toBe("GBP claimed = yes");
  });

  test("arrays render comma-joined", () => {
    const out = parseFilterTags([
      { id: "category", op: "in", value: ["a", "b"] },
    ]);
    expect(out[0]!.label).toContain("a, b");
  });

  test("unknown signal id falls back to the raw id", () => {
    const out = parseFilterTags([
      { id: "nonexistent_signal_x", op: "eq", value: 1 },
    ]);
    expect(out[0]!.label).toBe("nonexistent_signal_x = 1");
  });
});

describe("parseFilterTags · exclude flag", () => {
  test("marks exclude:true rules and propagates the flag", () => {
    const out = parseFilterTags([
      {
        id: "exclude_existing_clients",
        op: "eq",
        value: true,
        exclude: true,
      },
    ]);
    expect(out[0]!.exclude).toBe(true);
    expect(out[0]!.label.toLowerCase()).toContain("exclude");
  });

  test("non-exclude rules keep exclude=false", () => {
    const out = parseFilterTags([{ id: "rating", op: "gte", value: 4 }]);
    expect(out[0]!.exclude).toBe(false);
  });
});

describe("parseFilterTags · stable ids for React keys", () => {
  test("each rule emits a unique stable id even when ids repeat", () => {
    const out = parseFilterTags([
      { id: "rating", op: "gte", value: 4 },
      { id: "rating", op: "lt", value: 5 },
    ]);
    const ids = new Set(out.map((t) => t.id));
    expect(ids.size).toBe(2);
  });
});
