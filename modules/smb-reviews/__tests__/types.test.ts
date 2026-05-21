import { describe, expect, test } from "vitest";

import {
  DEFAULT_REVIEW_TAB,
  EMPTY_RATING_DISTRIBUTION,
  EMPTY_SMB_REVIEWS,
  EMPTY_TAB_COUNTS,
  REVIEW_TABS,
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
  });

  test("REVIEW_TABS is exhaustive and stable", () => {
    expect(REVIEW_TABS).toEqual([
      "unanswered",
      "negative",
      "all",
      "by-theme",
      "replied",
    ]);
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
  });

  test("takes the first value when given an array", () => {
    expect(parseReviewTab(["negative", "all"])).toBe("negative");
  });

  test("falls back when given an empty array", () => {
    expect(parseReviewTab([])).toBe(DEFAULT_REVIEW_TAB);
  });
});
