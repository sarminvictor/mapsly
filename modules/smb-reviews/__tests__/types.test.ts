import { describe, expect, test } from "vitest";

import {
  DEFAULT_REVIEW_TAB,
  EMPTY_RATING_DISTRIBUTION,
  EMPTY_REVIEW_KPIS,
  EMPTY_SMB_REVIEWS,
  EMPTY_TAB_COUNTS,
  REVIEW_TABS,
  derivePattern,
  filterPrivacyReviews,
  isPrivacyTabVisible,
  parseReviewTab,
  resolvePrivacyTab,
  type ReviewItem,
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
    // S2 · privacy check is a no-op in the empty/build-phase shape.
    expect(EMPTY_SMB_REVIEWS.privacyRiskCount).toBe(0);
  });

  test("REVIEW_TABS is exhaustive and stable", () => {
    // Dropped `all` + `by-theme` in PR #94 · Maria uses Unanswered /
    // Negative / Replied only; "All" was a redundant superset, "By theme"
    // was research noise. Added `skipped` when Skip moved a review out of
    // the active queue (a later owner reply promotes it to Replied).
    // Added `privacy` (S4) · conditional tab for human-medical
    // businesses with ≥1 flagged published reply.
    expect(REVIEW_TABS).toEqual([
      "unanswered",
      "negative",
      "replied",
      "skipped",
      "privacy",
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

/** Minimal ReviewItem fixture for the S4 privacy-tab helpers. */
function makeReview(
  overrides: Partial<ReviewItem> & { id: string },
): ReviewItem {
  return {
    reviewerInitials: "A.B.",
    reviewerPriorReviews: null,
    stars: 5,
    text: "Great place",
    language: "en",
    postedAt: "2026-06-01T00:00:00.000Z",
    daysAgo: 9,
    ownerReplied: true,
    ownerReplyText: "Thank you!",
    ownerReplyAt: "2026-06-02T00:00:00.000Z",
    sentiment: "POSITIVE",
    themes: [],
    isUrgent: false,
    aiReplyDraftEn: null,
    aiReplyDraftEs: null,
    mentionedPeople: [],
    mentionedServices: [],
    privacyRisk: null,
    ...overrides,
  };
}

describe("isPrivacyTabVisible", () => {
  test("visible only for human-medical category AND count > 0", () => {
    expect(isPrivacyTabVisible("med spa", 3)).toBe(true);
    expect(isPrivacyTabVisible("Dental clinic", 1)).toBe(true);
  });

  test("hidden when count is 0 — even for medical businesses", () => {
    expect(isPrivacyTabVisible("med spa", 0)).toBe(false);
  });

  test("hidden for non-medical categories regardless of count", () => {
    expect(isPrivacyTabVisible("restaurant", 5)).toBe(false);
    expect(isPrivacyTabVisible(null, 5)).toBe(false);
    // Veterinary is explicitly excluded from the medical matcher —
    // HIPAA doesn't cover animal patients.
    expect(isPrivacyTabVisible("veterinary clinic", 5)).toBe(false);
  });
});

describe("resolvePrivacyTab", () => {
  test("keeps privacy active for medical businesses with flagged replies", () => {
    expect(resolvePrivacyTab("privacy", "med spa", 2)).toBe("privacy");
  });

  test("falls back to the default tab when the last flagged reply got fixed", () => {
    // Stale `?tab=privacy` bookmark · zero flagged → no orphan view.
    expect(resolvePrivacyTab("privacy", "med spa", 0)).toBe(DEFAULT_REVIEW_TAB);
  });

  test("falls back to the default tab for non-medical businesses", () => {
    expect(resolvePrivacyTab("privacy", "restaurant", 3)).toBe(
      DEFAULT_REVIEW_TAB,
    );
    expect(resolvePrivacyTab("privacy", null, 3)).toBe(DEFAULT_REVIEW_TAB);
  });

  test("passes every non-privacy tab through untouched", () => {
    for (const tab of REVIEW_TABS) {
      if (tab === "privacy") continue;
      expect(resolvePrivacyTab(tab, null, 0)).toBe(tab);
      expect(resolvePrivacyTab(tab, "med spa", 4)).toBe(tab);
    }
  });
});

describe("filterPrivacyReviews", () => {
  test("keeps only flagged reviews", () => {
    const out = filterPrivacyReviews([
      makeReview({ id: "clean" }),
      makeReview({
        id: "flagged",
        privacyRisk: {
          level: "caution",
          hint: "…on March 12…",
          matches: [
            {
              kind: "visit-or-date",
              phrase: "on March 12",
              excerpt: "…on March 12…",
            },
          ],
        },
      }),
    ]);
    expect(out.map((r) => r.id)).toEqual(["flagged"]);
  });

  test("orders high level before caution, preserving order within each level", () => {
    const out = filterPrivacyReviews([
      makeReview({
        id: "caution-1",
        privacyRisk: {
          level: "caution",
          hint: "…$50…",
          matches: [{ kind: "payment", phrase: "$50", excerpt: "…$50…" }],
        },
      }),
      makeReview({
        id: "high-1",
        privacyRisk: {
          level: "high",
          hint: "…your visit…",
          matches: [
            {
              kind: "patient-status",
              phrase: "your visit",
              excerpt: "…your visit…",
            },
          ],
        },
      }),
      makeReview({ id: "clean" }),
      makeReview({
        id: "high-2",
        privacyRisk: {
          level: "high",
          hint: "…botox…",
          matches: [{ kind: "treatment", phrase: "botox", excerpt: "…botox…" }],
        },
      }),
      makeReview({
        id: "caution-2",
        privacyRisk: {
          level: "caution",
          hint: "…refund…",
          matches: [{ kind: "payment", phrase: "refund", excerpt: "…refund…" }],
        },
      }),
    ]);
    expect(out.map((r) => r.id)).toEqual([
      "high-1",
      "high-2",
      "caution-1",
      "caution-2",
    ]);
  });

  test("returns empty array when nothing is flagged (tab falls back)", () => {
    expect(filterPrivacyReviews([makeReview({ id: "a" })])).toEqual([]);
    expect(filterPrivacyReviews([])).toEqual([]);
  });

  test("F3 · ai-sentence matches flow through ReviewPrivacyRisk + the privacy tab", () => {
    // Type-level: `kind: "ai-sentence"` is part of PrivacyMatchKind, so
    // a payload mixing phrase marks + AI sentence marks compiles AND
    // filters like any other flagged review (one mark system).
    const out = filterPrivacyReviews([
      makeReview({
        id: "ai-flagged",
        privacyRisk: {
          level: "high",
          hint: "…coming in…",
          matches: [
            {
              kind: "patient-status",
              phrase: "coming in",
              excerpt: "…coming in…",
            },
            {
              kind: "ai-sentence",
              phrase:
                "After reviewing footage from that afternoon, we are perplexed why you voiced frustration.",
              excerpt:
                "After reviewing footage from that afternoon, we are perplexed why you voiced frustration.",
            },
          ],
        },
      }),
    ]);
    expect(out.map((r) => r.id)).toEqual(["ai-flagged"]);
    expect(out[0]!.privacyRisk!.matches.map((m) => m.kind)).toContain(
      "ai-sentence",
    );
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
