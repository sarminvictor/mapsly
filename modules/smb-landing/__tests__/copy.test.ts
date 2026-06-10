/**
 * Unit tests · landing copy ENGINE.
 *
 * Per `.claude/rules/testing.md` we test the INVARIANTS that would flip the
 * meaning of the page: the noun mapping (campaign token), the per-recipient
 * branches (rank tier, ads status, pillar strength), and the lost-bookings
 * guard. The one template must tell each recipient the TRUTH — a leader gets a
 * crown, a laggard gets opportunity; a strong site is praised, a weak one is the
 * sting. That's the whole reason the copy is conditional.
 */

import { describe, expect, test } from "vitest";

import { buildLandingCopy, estimateLostBookings, nounFor } from "../copy";
import {
  EMPTY_LANDING_ADS,
  EMPTY_LANDING_DATA,
  EMPTY_LANDING_REVIEWS,
  EMPTY_LANDING_SEARCH,
  EMPTY_LANDING_WEBSITE,
  type LandingData,
} from "../types";

type Core = Omit<LandingData, "copy">;
const { copy: _omit, ...BASE } = EMPTY_LANDING_DATA;

function core(over: Partial<Core> = {}): Core {
  return { ...BASE, category: "Medical spa", city: "Miami", ...over };
}

const searchWithGap = {
  ...EMPTY_LANDING_SEARCH,
  hasData: true,
  searchesTotal: 65000,
  searchesYouGet: 1400,
  topKeywords: [
    {
      keyword: "microneedling near me",
      service: "Microneedling",
      volume: 5400,
      organicRank: 23,
      mapsRank: null,
      estCustomers: null,
    },
    {
      keyword: "lip filler miami",
      service: "Lip Filler",
      volume: 2900,
      organicRank: 14,
      mapsRank: null,
      estCustomers: null,
    },
  ],
};

// Maria — #1 of 26, runs no ads, weak website, strong reviews.
const maria = core({
  rank: 1,
  total: 26,
  googleRating: 4.8,
  reviewCount: 489,
  search: searchWithGap,
  adsDetail: {
    ...EMPTY_LANDING_ADS,
    hasData: true,
    marketAdvertiserCount: 60,
    marketActiveAds: 119,
    ownAdCount: 0,
  },
  websiteDetail: {
    ...EMPTY_LANDING_WEBSITE,
    hasData: true,
    performance: 36,
    industryMedian: 42,
    industryBest: 52,
    totalChecks: 12,
    passCount: 7,
  },
  reviews: {
    ...EMPTY_LANDING_REVIEWS,
    hasData: true,
    rating: 4.8,
    reviewCount: 489,
    unanswered: 85,
    yourRank: 1,
    rankedTotal: 25,
  },
});

// Elena — #9 of 26, runs ads, strong website, weaker reviews.
const elena = core({
  rank: 9,
  total: 26,
  googleRating: 4.6,
  reviewCount: 210,
  search: searchWithGap,
  adsDetail: {
    ...EMPTY_LANDING_ADS,
    hasData: true,
    marketAdvertiserCount: 60,
    marketActiveAds: 119,
    ownAdCount: 4,
  },
  websiteDetail: {
    ...EMPTY_LANDING_WEBSITE,
    hasData: true,
    performance: 78,
    industryMedian: 42,
    industryBest: 52,
    totalChecks: 12,
    passCount: 11,
  },
  reviews: {
    ...EMPTY_LANDING_REVIEWS,
    hasData: true,
    rating: 4.6,
    reviewCount: 210,
    unanswered: 12,
    yourRank: 14,
    rankedTotal: 25,
  },
});

describe("nounFor — campaign token by category", () => {
  test("medical → patients, salon → clients, restaurant → guests, gym → members", () => {
    expect(nounFor("Medical spa").many).toBe("patients");
    expect(nounFor("Nail salon").many).toBe("clients");
    expect(nounFor("Hair salon").many).toBe("clients");
    expect(nounFor("Italian restaurant").many).toBe("guests");
    expect(nounFor("Café Miami").many).toBe("guests"); // accented spelling must match
    expect(nounFor("Fitness gym").many).toBe("members");
  });
  test("unknown category falls back to customers", () => {
    expect(nounFor("Plumber").many).toBe("customers");
    expect(nounFor(null).many).toBe("customers");
  });
});

describe("categoryLabel — pluralization + fallback (renders in the hero)", () => {
  const heroFor = (category: string) =>
    buildLandingCopy(core({ category, rank: 9, total: 26 })).hero;
  test("regular English plurals render correctly", () => {
    expect(heroFor("Bakery").body).toMatch(/bakeries/);
    expect(heroFor("Brewery").headline).toMatch(/breweries/);
    expect(heroFor("Nail salon").headline).toMatch(/nail salons/);
    expect(heroFor("Church").headline).toMatch(/churches/);
  });
  test("blank category falls back to business / businesses, no double-space hole", () => {
    const h = buildLandingCopy(core({ category: "", rank: 9, total: 26 })).hero;
    expect(h.headline).toMatch(/businesses/);
    expect(h.headline).not.toMatch(/ {2}/);
  });
});

describe("buildLandingCopy — the leader (Maria) vs the climber (Elena)", () => {
  const m = buildLandingCopy(maria);
  const e = buildLandingCopy(elena);

  test("hero frames rank truthfully for each", () => {
    expect(m.hero.headline).toMatch(/#1 (med spa|medical spa) in Miami/i);
    expect(e.hero.headline).toMatch(/#9 of 26/);
    expect(e.hero.headline).toMatch(/ahead of 17 others/);
  });

  test("ads branch: no-ads sting vs runs-ads peer", () => {
    expect(m.ads.title).toMatch(/60 .* are buying ads/i);
    expect(m.ads.emphasis).toMatch(/running zero/i);
    expect(e.ads.title).toMatch(/you're advertising/i);
  });

  test("hero never makes the unbacked +30% claim — hedged estimate only", () => {
    expect(m.hero.body).not.toMatch(/30% more/);
    // Maria has real search gaps → the capped lost-bookings range appears.
    expect(m.hero.body).toMatch(/roughly \d+–\d+ more patients a month/);
    // No search data → no estimate, body still reads complete.
    const bare = buildLandingCopy(core({ rank: 9, total: 26 })).hero.body;
    expect(bare).toMatch(/bring them back\.$/);
  });

  test("website branch: weak = the leak, strong = a pride beat", () => {
    expect(m.website.eyebrow).toMatch(/leak/i);
    expect(m.website.emphasis).toMatch(/scores 36/i);
    expect(e.website.eyebrow).toMatch(/ahead/i);
    expect(e.website.emphasis).toMatch(/78\/100/);
  });

  test("reviews branch: strong = winning, weak = catch-up", () => {
    expect(m.reviews.emphasis).toMatch(/winning here/i);
    expect(e.reviews.emphasis).toMatch(/pulling ahead/i);
  });

  test("noun travels into every section (patients, never customers)", () => {
    const all = JSON.stringify(m);
    expect(all).toMatch(/patients/);
    expect(all).not.toMatch(/\bcustomers\b/);
  });

  test("each block has its OWN problem→solution, not one duplicated callout", () => {
    const problems = [
      m.search.gap?.problem,
      m.ads.gap?.problem,
      m.reviews.gap?.problem,
      m.website.gap?.problem,
    ];
    expect(new Set(problems).size).toBe(4); // four distinct, none null
    // each reflects ITS block's signals
    expect(m.search.gap!.problem).toMatch(/searches a month/);
    expect(m.ads.gap!.problem).toMatch(/ads/i);
    expect(m.reviews.gap!.problem).toMatch(/reviews|unanswered/i);
    expect(m.website.gap!.problem).toMatch(/site scores|booking-driver/i);
    expect(m.fixes.gap).toBeNull();
    // the climber's gaps differ from the leader's (truly per-recipient)
    expect(e.ads.gap!.problem).not.toBe(m.ads.gap!.problem);
    expect(e.website.gap!.problem).not.toBe(m.website.gap!.problem);
  });

  test("pricing reflects the no-free-week / page-is-the-trial decision", () => {
    expect(m.pricing.body).toMatch(/free snapshot/i);
    expect(m.pricing.guarantee).toMatch(/money-back/i);
    expect(m.pricing.body).not.toMatch(/free (week|trial)/i);
    expect(m.pricing.guarantee).not.toMatch(/free (week|trial)/i);
  });
});

describe("gap attitude covers the edge scenarios (first/not, ads/not, etc.)", () => {
  test("search strong (ranks top-3 everywhere) → defend, not 'climb'", () => {
    const strong = {
      ...EMPTY_LANDING_SEARCH,
      hasData: true,
      searchesYouGet: 5000,
      searchesTotal: 6000,
      topKeywords: [
        {
          keyword: "a",
          service: "A",
          volume: 3000,
          organicRank: 1,
          mapsRank: 2,
          estCustomers: null,
        },
        {
          keyword: "b",
          service: "B",
          volume: 3000,
          organicRank: 3,
          mapsRank: null,
          estCustomers: null,
        },
      ],
    };
    const g = buildLandingCopy(core({ rank: 1, total: 26, search: strong }))
      .search.gap;
    expect(g!.solution).toMatch(/Defend/);
    expect(g!.solution).not.toMatch(/Climb into the top 3/);
  });
  test("ads score 0 + strong rank → zero explained as strength, never 'don't need ads'", () => {
    const c = buildLandingCopy(
      core({
        rank: 1,
        total: 26,
        adsDetail: {
          ...EMPTY_LANDING_ADS,
          hasData: true,
          marketAdvertiserCount: 60,
          marketActiveAds: 119,
          ownAdCount: 0,
          pillar: 0,
        },
      }),
    ).ads;
    expect(c.intro).toMatch(/#1 without paid ads/);
    expect(c.intro).toMatch(/zero paid presence, not failure/);
    expect(c.intro).not.toMatch(/don't have to run ads/i);
  });
  test("ads score 0 + weak rank → zero still explained, no 'don't need ads'", () => {
    const c = buildLandingCopy(
      core({
        rank: 20,
        total: 26,
        adsDetail: {
          ...EMPTY_LANDING_ADS,
          hasData: true,
          marketAdvertiserCount: 60,
          marketActiveAds: 119,
          ownAdCount: 0,
          pillar: 0,
        },
      }),
    ).ads;
    expect(c.intro).toMatch(/zero paid presence, not failure/);
    expect(c.intro).not.toMatch(/don't have to run ads/i);
  });
  test("ads run in a quiet market → 'head start', never '0 others'", () => {
    const g = buildLandingCopy(
      core({
        adsDetail: {
          ...EMPTY_LANDING_ADS,
          hasData: true,
          ownAdCount: 3,
          marketAdvertiserCount: 0,
          marketActiveAds: 0,
        },
      }),
    ).ads.gap;
    expect(g!.problem).toMatch(/head start/);
    expect(g!.problem).not.toMatch(/\b0 other/);
  });
  test("website found but not yet scored → no gap (never falsely 'strong')", () => {
    const g = buildLandingCopy(
      core({
        websiteDetail: {
          ...EMPTY_LANDING_WEBSITE,
          hasData: true,
          performance: null,
          totalChecks: 12,
          passCount: 2,
        },
      }),
    ).website.gap;
    expect(g).toBeNull();
  });
});

describe("estimateLostBookings — defensible + guarded", () => {
  test("returns a hedged range when there are real ranking gaps", () => {
    const r = estimateLostBookings(searchWithGap);
    expect(r).not.toBeNull();
    expect(r!.low).toBeGreaterThanOrEqual(1);
    expect(r!.high).toBeGreaterThan(r!.low);
  });
  test("returns null when there's no search data", () => {
    expect(estimateLostBookings(EMPTY_LANDING_SEARCH)).toBeNull();
  });
  test("ignores keywords already in the top 3", () => {
    const winning = {
      ...EMPTY_LANDING_SEARCH,
      hasData: true,
      topKeywords: [
        {
          keyword: "x",
          service: "X",
          volume: 9000,
          organicRank: 2,
          mapsRank: 1,
          estCustomers: null,
        },
      ],
    };
    expect(estimateLostBookings(winning)).toBeNull();
  });
  test("skips keywords with no rank data — no claim without evidence", () => {
    const noRank = {
      ...EMPTY_LANDING_SEARCH,
      hasData: true,
      topKeywords: [
        {
          keyword: "x",
          service: "X",
          volume: 99999,
          organicRank: null,
          mapsRank: null,
          estCustomers: null,
        },
      ],
    };
    expect(estimateLostBookings(noRank)).toBeNull();
  });
  test("caps the estimate so a huge-volume keyword can't inflate the claim", () => {
    const huge = {
      ...EMPTY_LANDING_SEARCH,
      hasData: true,
      topKeywords: Array.from({ length: 8 }, (_, i) => ({
        keyword: `k${i}`,
        service: "K",
        volume: 500000,
        organicRank: 50,
        mapsRank: null,
        estCustomers: null,
      })),
    };
    const r = estimateLostBookings(huge);
    expect(r).not.toBeNull();
    expect(r!.high).toBeLessThanOrEqual(45); // clamped at 40 → ceil(40 × 1.05) = 42
  });
});
