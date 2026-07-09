import { describe, expect, test } from "vitest";

import {
  marketsSummary,
  researchTitle,
  titleCaseSlug,
} from "@/modules/agency-portal/research/display-name";

// The workbench + /research title rule — a set name wins verbatim, else the
// first-cell scope title (single "Cat · Metro", multi "Cat · N markets").
describe("researchTitle", () => {
  test("a set name wins verbatim (the SE auto-name or a rename)", () => {
    expect(
      researchTitle({
        name: "SE · Website redesign",
        cellCount: 12,
        firstCategory: "Acupuncture clinic",
        firstMetro: "Boise",
      }),
    ).toBe("SE · Website redesign");
  });

  test("blank/whitespace name falls through to the scope title", () => {
    expect(
      researchTitle({
        name: "   ",
        cellCount: 1,
        firstCategory: "Med spa",
        firstMetro: "Miami",
      }),
    ).toBe("Med spa · Miami");
  });

  test("un-named single-cell → 'Category · Metro'", () => {
    expect(
      researchTitle({
        name: null,
        cellCount: 1,
        firstCategory: "Med spa",
        firstMetro: "Miami",
      }),
    ).toBe("Med spa · Miami");
  });

  test("un-named single-cell with no metro → just the category", () => {
    expect(
      researchTitle({ name: null, cellCount: 1, firstCategory: "Med spa" }),
    ).toBe("Med spa");
  });

  test("un-named multi-cell → 'Category · N markets'", () => {
    expect(
      researchTitle({
        name: undefined,
        cellCount: 3,
        firstCategory: "Barber shop",
        firstMetro: "Boise",
      }),
    ).toBe("Barber shop · 3 markets");
    expect(
      researchTitle({ name: null, cellCount: 2, firstCategory: "Barber shop" }),
    ).toBe("Barber shop · 2 markets");
  });

  test("no name + no category → 'Research'", () => {
    expect(researchTitle({ name: null, cellCount: 0 })).toBe("Research");
  });
});

describe("marketsSummary", () => {
  test("no cells → null", () => {
    expect(marketsSummary([])).toBeNull();
  });

  test("single cell → 'Category · Metro'", () => {
    expect(marketsSummary(["barber_shop|zzmetroa|US"])).toBe(
      "Barber Shop · Zzmetroa",
    );
  });

  test("multi-cell → distinct metros joined", () => {
    expect(
      marketsSummary(["a|zzmetroa|US", "b|zzmetrob|US", "a|zzmetroa|US"]),
    ).toBe("Zzmetroa · Zzmetrob");
  });

  test("more than 3 distinct metros → '+N more'", () => {
    const out = marketsSummary([
      "a|zzm1|US",
      "b|zzm2|US",
      "c|zzm3|US",
      "d|zzm4|US",
      "e|zzm5|US",
    ]);
    expect(out).toBe("Zzm1 · Zzm2 · Zzm3 +2 more");
  });
});

describe("titleCaseSlug", () => {
  test("underscores/dashes → Title Case (each word, matches /research)", () => {
    expect(titleCaseSlug("medical_spa")).toBe("Medical Spa");
    expect(titleCaseSlug("barber-shop")).toBe("Barber Shop");
  });
});
