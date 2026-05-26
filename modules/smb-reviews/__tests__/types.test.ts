import { describe, expect, test } from "vitest";

import {
  DEFAULT_REVIEW_TAB,
  EMPTY_RATING_DISTRIBUTION,
  EMPTY_REVIEW_KPIS,
  EMPTY_SMB_REVIEWS,
  EMPTY_TAB_COUNTS,
  REVIEW_TABS,
  derivePattern,
  parseReviewTab,
} from "../types";

/**
 * EMPTY_SMB_REVIEWS shape parity is enforced by TypeScript at compile
 * time (per `.claude/rules/cache-components.md` Pattern 1) — these
 * runtime tests just verify the defaults are sane and the tab parser
 * is robust against URL-borne inputs.
 */
describe("smb-reviews/types", () => {
  test("EMPTY_SMB_REVIEWS marks the empty-business state correctly", () => {
    expect(EMPTY_SMB_REVIEWS.ownedBusinessId).toBe("");
    expect(EMPTY_SMB_REVIEWS.businessName).toBe("");
    expect(EMPTY_SMB_REVIEWS.reviews).toEqual([]);
    expect(EMPTY_SMB_REVIEWS.activeTab).toBe(DEFAULT_REVIEW_TAB);
    expect(EMPTY_SMB_REVIEWS.tabCounts).toEqual(EMPTY_TAB_COUNTS);
    expect(EMPTY_SMB_REVIEWS.ratingDistribution).toEqual(
      EMPTY_RATING_DISTRIBUTION,
    );
    expect(EMPTY_SMB_REVIEWS.topThemes).toEqual([]);
    expect(EMPTY_SMB_REVIEWS.lastSnapshotAt).toBeNull();
    expect(EMPTY_SMB_REVIEWS.kpis).toEqual(EMPTY_REVIEW_KPIS);
    expect(EMPTY_SMB_REVIEWS.pattern).toBeNull();
  });

  test("REVIEW_TABS is exhaustive and stable", () => {
    // Dropped `all` + `by-theme` in PR #94 · Maria uses Unanswered /
    // Negative / Replied only; "All" was a redundant superset, "By theme"
    // was research noise.
    expect(REVIEW_TABS).toEqual(["unanswered", "negative", "replied"]);
  });
});

describe("parseReviewTab", () => {
  test.each(REVIEW_TABS)("accepts canonical tab %s", (tab) => {
    expect(parseReviewTab(tab)).toBe(tab);
  });

  test("falls back to default for undefined", () => {
    expect(parseReviewTab(undefined)).toBe(DEFAULT_REVIEW_TAB);
  });

  test("falls back to default for unknown string (no XSS / route confusion)", () => {
    expect(parseReviewTab("../admin")).toBe(DEFAULT_REVIEW_TAB);
    expect(parseReviewTab("UNANSWERED")).toBe(DEFAULT_REVIEW_TAB); // case-sensitive
    expect(parseReviewTab("")).toBe(DEFAULT_REVIEW_TAB);
    // Retired tabs fall back to default · prevents stale bookmarks from
    // 404-ing.
    expect(parseReviewTab("all")).toBe(DEFAULT_REVIEW_TAB);
    expect(parseReviewTab("by-theme")).toBe(DEFAULT_REVIEW_TAB);
  });

  test("takes the first value when given an array", () => {
    expect(parseReviewTab(["negative", "replied"])).toBe("negative");
  });

  test("falls back when given an empty array", () => {
    expect(parseReviewTab([])).toBe(DEFAULT_REVIEW_TAB);
  });
});

describe("derivePattern", () => {
  test("returns null when no theme qualifies", () => {
    expect(derivePattern([])).toBeNull();
    expect(
      derivePattern([
        { theme: "scheduling", count: 10, negativeCount: 0 },
        { theme: "staff", count: 8, negativeCount: 2 }, // < 3 negative
      ]),
    ).toBeNull();
  });

  test("returns the first theme with ≥3 negatives AND ≥50% negative share", () => {
    const pattern = derivePattern([
      { theme: "scheduling", count: 5, negativeCount: 4 },
      { theme: "staff", count: 6, negativeCount: 1 },
    ]);
    expect(pattern).not.toBeNull();
    expect(pattern!.theme).toBe("scheduling");
    expect(pattern!.count).toBe(4);
    expect(pattern!.headline).toMatch(/scheduling/);
  });

  test("ignores themes with <50% negative share even with high count", () => {
    // 10 mentions, 3 negatives → only 30% — doesn't surface.
    expect(
      derivePattern([{ theme: "staff", count: 10, negativeCount: 3 }]),
    ).toBeNull();
  });

  test("body copy uses Maria voice — no banned jargon", () => {
    const pattern = derivePattern([
      { theme: "scheduling", count: 6, negativeCount: 5 },
    ]);
    expect(pattern).not.toBeNull();
    expect(pattern!.body).not.toMatch(
      /\b(LCP|INP|CLS|CTR|MSI|3-pack|schema|NAP|GBP)\b/i,
    );
  });
});
