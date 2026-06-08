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
  adsDetail: { ...EMPTY_LANDING_ADS, marketAdvertiserCount: 60, ownAdCount: 0 },
  websiteDetail: {
    ...EMPTY_LANDING_WEBSITE,
    performance: 36,
    industryMedian: 42,
  },
  reviews: { ...EMPTY_LANDING_REVIEWS, yourRank: 1, rankedTotal: 25 },
});

// Elena — #9 of 26, runs ads, strong website, weaker reviews.
const elena = core({
  rank: 9,
  total: 26,
  googleRating: 4.6,
  reviewCount: 210,
  search: searchWithGap,
  adsDetail: { ...EMPTY_LANDING_ADS, marketAdvertiserCount: 60, ownAdCount: 4 },
  websiteDetail: {
    ...EMPTY_LANDING_WEBSITE,
    performance: 78,
    industryMedian: 42,
  },
  reviews: { ...EMPTY_LANDING_REVIEWS, yourRank: 14, rankedTotal: 25 },
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
    expect(heroFor("Bakery").body).toMatch(/Bakeries/);
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

  test("pricing reflects the no-free-week / page-is-the-trial decision", () => {
    expect(m.pricing.body).toMatch(/free snapshot/i);
    expect(m.pricing.guarantee).toMatch(/money-back/i);
    expect(m.pricing.body).not.toMatch(/free (week|trial)/i);
    expect(m.pricing.guarantee).not.toMatch(/free (week|trial)/i);
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
