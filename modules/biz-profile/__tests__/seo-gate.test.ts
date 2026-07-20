/**
 * Truth table for the /biz SEO index gate (INC-2026-07-20-66).
 *
 * The three named fixtures mirror REAL production pages verified live on
 * 2026-07-20 — if the predicate ever inverts, these catch it before ~6,300
 * thin pages get indexed or the 327 rich pages get noindexed:
 *   - spectrum-aesthetics  → rich (score 6.0, 3,494 reviews)  → index
 *   - jeremy-b-green-md    → medium (score 4.7, 19 reviews)   → index
 *   - naomis-beauty        → sparse (no site/reviews/score)   → noindex
 */

import { describe, expect, test } from "vitest";

import { BIZ_INDEX_MIN_REVIEWS, passesBizIndexGate } from "../seo-gate";

const base = {
  website: "https://example.com",
  reviewCount: 100,
  mapslyScore: 6.0,
  pillarScore: null,
  isHidden: false,
  permanentlyClosed: false,
  suppressedAt: null,
};

describe("passesBizIndexGate · live-page fixtures", () => {
  test("rich page (spectrum-aesthetics shape) → index", () => {
    expect(
      passesBizIndexGate({
        ...base,
        website: "https://spectrumaesthetics.com",
        reviewCount: 3494,
        mapslyScore: 6.0,
      }),
    ).toBe(true);
  });

  test("medium page (jeremy-b-green-md shape, 19 reviews) → index", () => {
    expect(
      passesBizIndexGate({
        ...base,
        website: "https://drjeremygreen.com",
        reviewCount: 19,
        mapslyScore: 4.7,
      }),
    ).toBe(true);
  });

  test("sparse page (naomis-beauty shape) → noindex", () => {
    expect(
      passesBizIndexGate({
        ...base,
        website: null,
        reviewCount: 0,
        mapslyScore: null,
      }),
    ).toBe(false);
  });
});

describe("passesBizIndexGate · visibility flags override richness", () => {
  test("suppressed (do-not-sell opt-out) fails even when data-rich", () => {
    expect(
      passesBizIndexGate({
        ...base,
        suppressedAt: new Date("2026-06-01T00:00:00Z"),
      }),
    ).toBe(false);
  });

  test("hidden fails even when data-rich", () => {
    expect(passesBizIndexGate({ ...base, isHidden: true })).toBe(false);
  });

  test("permanently closed fails even when data-rich", () => {
    expect(passesBizIndexGate({ ...base, permanentlyClosed: true })).toBe(
      false,
    );
  });
});

describe("passesBizIndexGate · component conditions", () => {
  test("missing website fails even with score + reviews", () => {
    expect(passesBizIndexGate({ ...base, website: null })).toBe(false);
  });

  test("empty or whitespace-only website fails (scraped blanks)", () => {
    expect(passesBizIndexGate({ ...base, website: "" })).toBe(false);
    expect(passesBizIndexGate({ ...base, website: "   " })).toBe(false);
  });

  test("no score on latest snapshot fails even with website + reviews", () => {
    expect(
      passesBizIndexGate({ ...base, mapslyScore: null, pillarScore: null }),
    ).toBe(false);
  });

  test("pillarScore alone satisfies the score requirement (v2 pillars)", () => {
    expect(
      passesBizIndexGate({ ...base, mapslyScore: null, pillarScore: 7.2 }),
    ).toBe(true);
  });

  test("review-count boundary: min passes, min-1 fails, null fails", () => {
    expect(
      passesBizIndexGate({ ...base, reviewCount: BIZ_INDEX_MIN_REVIEWS }),
    ).toBe(true);
    expect(
      passesBizIndexGate({ ...base, reviewCount: BIZ_INDEX_MIN_REVIEWS - 1 }),
    ).toBe(false);
    expect(passesBizIndexGate({ ...base, reviewCount: null })).toBe(false);
  });

  test("a zero score is still a score (0 is a valid Mapsly Score)", () => {
    expect(passesBizIndexGate({ ...base, mapslyScore: 0 })).toBe(true);
  });
});
