// B1/B3/B6/B7 · pure helpers behind the touch-generation UI. These encode the
// invariants the founder's report is about: a pitch never bleeds across
// researches, a skip is never invisible, the copy-email payload is paste-ready.

import { describe, expect, test } from "vitest";
import {
  SELLING_GLOBAL_KEY,
  sellingKeyFor,
  resolveSellingWhat,
  SUBJECT_NAME_KEY,
  readSubjectNameToggle,
  normalizeSkips,
  addSkips,
  buildGenerateSummary,
  copyEmailText,
  EMPTY_SKIPS,
} from "../components/touch-gen-helpers";

/** A localStorage stub as a plain map-backed reader. */
function reader(store: Record<string, string>) {
  return (k: string): string | null => store[k] ?? null;
}

describe("sellingKeyFor", () => {
  test("per-research key includes the discoveryId", () => {
    expect(sellingKeyFor("disc_123")).toBe(`${SELLING_GLOBAL_KEY}:disc_123`);
  });
  test("no discoveryId → the global key (panel scope)", () => {
    expect(sellingKeyFor(undefined)).toBe(SELLING_GLOBAL_KEY);
  });
});

describe("resolveSellingWhat · B1 (no cross-research bleed)", () => {
  test("prefers THIS research's own last pitch", () => {
    const store = {
      [SELLING_GLOBAL_KEY]: "med-spa SEO",
      [`${SELLING_GLOBAL_KEY}:disc_A`]: "acupuncture ads",
    };
    expect(resolveSellingWhat("disc_A", reader(store))).toBe("acupuncture ads");
  });

  test("brand-new research falls back to the global last-used", () => {
    const store = { [SELLING_GLOBAL_KEY]: "med-spa SEO" };
    expect(resolveSellingWhat("disc_NEW", reader(store))).toBe("med-spa SEO");
  });

  test("a med-spa pitch does NOT bleed once THIS research has its own", () => {
    // disc_B was drafted with a specific pitch; the global still holds med-spa.
    const store = {
      [SELLING_GLOBAL_KEY]: "med-spa SEO",
      [`${SELLING_GLOBAL_KEY}:disc_B`]: "roofing lead-gen",
    };
    expect(resolveSellingWhat("disc_B", reader(store))).toBe(
      "roofing lead-gen",
    );
  });

  test("empty per-research value is ignored (whitespace-only counts as empty)", () => {
    const store = {
      [SELLING_GLOBAL_KEY]: "global default",
      [`${SELLING_GLOBAL_KEY}:disc_C`]: "   ",
    };
    expect(resolveSellingWhat("disc_C", reader(store))).toBe("global default");
  });

  test("nothing stored → empty string", () => {
    expect(resolveSellingWhat("disc_D", reader({}))).toBe("");
  });

  test("panel (no discoveryId) reads the global key only", () => {
    const store = { [SELLING_GLOBAL_KEY]: "panel pitch" };
    expect(resolveSellingWhat(undefined, reader(store))).toBe("panel pitch");
  });
});

describe("readSubjectNameToggle · B7 (default OFF)", () => {
  test("missing → false (expert default)", () => {
    expect(readSubjectNameToggle(reader({}))).toBe(false);
  });
  test('"1" → true', () => {
    expect(readSubjectNameToggle(reader({ [SUBJECT_NAME_KEY]: "1" }))).toBe(
      true,
    );
  });
  test('"0" → false', () => {
    expect(readSubjectNameToggle(reader({ [SUBJECT_NAME_KEY]: "0" }))).toBe(
      false,
    );
  });
});

describe("normalizeSkips · reads new nested shape OR legacy flat fields", () => {
  test("nested skips (AGENT A contract) wins", () => {
    expect(
      normalizeSkips({
        skips: { noAddress: 4, sparse: 2, error: 1, alreadyDrafted: 3 },
      }),
    ).toEqual({ noAddress: 4, sparse: 2, error: 1, alreadyDrafted: 3 });
  });

  test("flat legacy fields as fallback (pre-hand-off)", () => {
    expect(
      normalizeSkips({
        skippedNoAddress: 4,
        skippedSparse: 2,
        skippedExisting: 3,
      }),
    ).toEqual({ noAddress: 4, sparse: 2, error: 0, alreadyDrafted: 3 });
  });

  test("negative / non-finite counts clamp to 0", () => {
    expect(
      normalizeSkips({ skippedNoAddress: -1, skippedSparse: NaN }),
    ).toEqual(EMPTY_SKIPS);
  });
});

describe("addSkips", () => {
  test("sums two batch totals field-by-field", () => {
    expect(
      addSkips(
        { noAddress: 1, sparse: 2, error: 0, alreadyDrafted: 1 },
        { noAddress: 0, sparse: 3, error: 1, alreadyDrafted: 2 },
      ),
    ).toEqual({ noAddress: 1, sparse: 5, error: 1, alreadyDrafted: 3 });
  });
});

describe("buildGenerateSummary · B3 (the 6-of-8 fix)", () => {
  test("clean run: no skips → clean success line", () => {
    const s = buildGenerateSummary(8, EMPTY_SKIPS);
    expect(s.clean).toBe(true);
    expect(s.headline).toBe("Drafted 8 touches");
    expect(s.reasons).toEqual([]);
  });

  test("6-of-8 with 2 sparse itemizes the reason", () => {
    const s = buildGenerateSummary(6, {
      noAddress: 0,
      sparse: 2,
      error: 0,
      alreadyDrafted: 0,
    });
    expect(s.clean).toBe(false);
    expect(s.headline).toBe("Drafted 6 · 2 skipped");
    expect(s.reasons).toEqual([
      "2 skipped — no pain to pitch yet (enrich or pick other leads)",
    ]);
  });

  test("all four reasons appear, only when count > 0, in a stable order", () => {
    const s = buildGenerateSummary(1, {
      noAddress: 4,
      sparse: 2,
      error: 1,
      alreadyDrafted: 3,
    });
    expect(s.headline).toBe("Drafted 1 · 10 skipped");
    expect(s.reasons).toEqual([
      "2 skipped — no pain to pitch yet (enrich or pick other leads)",
      "1 skipped — couldn't read this lead's data",
      "3 already have a touch",
      "4 need a mailing address — set it in Settings → Profile",
    ]);
  });

  test("singular grammar for a single skip", () => {
    const s = buildGenerateSummary(0, {
      noAddress: 0,
      sparse: 0,
      error: 1,
      alreadyDrafted: 1,
    });
    expect(s.reasons).toContain("1 skipped — couldn't read this lead's data");
    expect(s.reasons).toContain("1 already has a touch");
  });

  test("copy is agency-voice: no emoji, no exclamation marks", () => {
    const s = buildGenerateSummary(6, {
      noAddress: 1,
      sparse: 1,
      error: 1,
      alreadyDrafted: 1,
    });
    const all = [s.headline, ...s.reasons].join(" ");
    expect(all).not.toMatch(/!/);
    // no emoji (surrogate pairs / pictographs)
    expect(all).not.toMatch(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });
});

describe("copyEmailText · B6", () => {
  test("subject + body, blank line between", () => {
    expect(copyEmailText("Your reviews", "Hi there")).toBe(
      "Subject: Your reviews\n\nHi there",
    );
  });
  test("no subject (dm/phone/social) → body only", () => {
    expect(copyEmailText(null, "Hey")).toBe("Hey");
    expect(copyEmailText("   ", "Hey")).toBe("Hey");
    expect(copyEmailText(undefined, "Hey")).toBe("Hey");
  });
});
