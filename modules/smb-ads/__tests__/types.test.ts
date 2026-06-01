// Unit tests for the SMB /ads pure logic · opportunity score, competition
// label, best-opening pick, the budget simulator math (still exported even
// though the page's calculator was removed), and the per-network suggestion
// builders (Google + PERSONALIZED Meta). No IO / no Prisma.

import { describe, expect, test } from "vitest";
import {
  buildGoogleSuggestions,
  buildPersonalizedMetaSuggestions,
  competitionLabelFromIndex,
  opportunityScore,
  pickBestOpportunity,
  simulateAdBudget,
  type AdFormatStat,
  type AdKeywordCost,
  type GoogleSuggestionsInput,
  type MarketPromo,
  type MarketServiceStat,
  type PersonalMetaInput,
} from "../types";

function kw(p: Partial<AdKeywordCost>): AdKeywordCost {
  const base: AdKeywordCost = {
    keyword: "k",
    searchVolume: 1000,
    cpc: 2,
    competition: "MEDIUM",
    competitionIndex: 50,
    lowBid: 1,
    highBid: 3,
    opportunity: 0,
  };
  const merged = { ...base, ...p };
  merged.opportunity = opportunityScore(merged);
  return merged;
}

function svc(
  service: string,
  share: number,
  youOffer = false,
): MarketServiceStat {
  return { service, ads: Math.round(share * 100), share, youOffer };
}

function fmt(format: string, share: number): AdFormatStat {
  return { format, ads: Math.round(share * 100), share };
}

describe("opportunityScore", () => {
  test("is 0 when there is no search volume", () => {
    expect(
      opportunityScore({ searchVolume: 0, cpc: 2, competitionIndex: 10 }),
    ).toBe(0);
  });

  test("rewards low competition + low cpc over crowded + pricey", () => {
    const cheapOpen = opportunityScore({
      searchVolume: 10000,
      cpc: 1,
      competitionIndex: 10,
    });
    const priceyCrowded = opportunityScore({
      searchVolume: 10000,
      cpc: 8,
      competitionIndex: 90,
    });
    expect(cheapOpen).toBeGreaterThan(priceyCrowded);
  });

  test("treats missing competitionIndex as neutral (50)", () => {
    expect(
      opportunityScore({ searchVolume: 1000, cpc: 1, competitionIndex: null }),
    ).toBe(
      opportunityScore({ searchVolume: 1000, cpc: 1, competitionIndex: 50 }),
    );
  });
});

describe("competitionLabelFromIndex", () => {
  test.each([
    [null, null],
    [10, "Low"],
    [33, "Low"],
    [34, "Medium"],
    [66, "Medium"],
    [67, "High"],
    [95, "High"],
  ])("%s → %s", (idx, label) => {
    expect(competitionLabelFromIndex(idx as number | null)).toBe(label);
  });
});

describe("pickBestOpportunity", () => {
  test("prefers a winnable (non-HIGH) keyword over a higher-raw HIGH one", () => {
    const rows = [
      kw({
        keyword: "crowded",
        searchVolume: 99999,
        cpc: 1,
        competition: "HIGH",
        competitionIndex: 95,
      }),
      kw({
        keyword: "botox",
        searchVolume: 22200,
        cpc: 3.01,
        competition: "LOW",
        competitionIndex: 13,
      }),
    ];
    expect(pickBestOpportunity(rows)?.keyword).toBe("botox");
  });

  test("returns null on empty input", () => {
    expect(pickBestOpportunity([])).toBeNull();
  });

  test("falls back to top-opportunity when none are easy", () => {
    const rows = [
      kw({ keyword: "a", competition: "HIGH", searchVolume: 500, cpc: 5 }),
      kw({ keyword: "b", competition: "HIGH", searchVolume: 5000, cpc: 2 }),
    ];
    expect(pickBestOpportunity(rows)?.keyword).toBe("b");
  });
});

describe("simulateAdBudget", () => {
  const rows = [
    kw({
      keyword: "botox",
      searchVolume: 22200,
      cpc: 3,
      competition: "LOW",
      competitionIndex: 13,
    }),
    kw({
      keyword: "lip filler",
      searchVolume: 9900,
      cpc: 2.8,
      competition: "MEDIUM",
      competitionIndex: 40,
    }),
  ];

  test("0 / negative budget → empty simulation", () => {
    const s = simulateAdBudget(rows, 0);
    expect(s.clicks).toBe(0);
    expect(s.spend).toBe(0);
    expect(s.allocations).toHaveLength(0);
  });

  test("spends within budget and estimates clicks + customers", () => {
    const s = simulateAdBudget(rows, 500);
    expect(s.spend).toBeGreaterThan(0);
    expect(s.spend).toBeLessThanOrEqual(500);
    expect(s.clicks).toBeGreaterThan(0);
    expect(s.leads).toBeGreaterThanOrEqual(0);
    expect(s.effectiveCpc).toBeGreaterThan(0);
    expect(s.costPerLead).toBeGreaterThan(0);
  });

  test("caps at market capacity (unspent when the budget is huge)", () => {
    const s = simulateAdBudget(rows, 1_000_000);
    expect(s.unspent).toBeGreaterThan(0);
  });

  test("ignores rows lacking cpc or volume", () => {
    const s = simulateAdBudget([kw({ cpc: null, searchVolume: null })], 500);
    expect(s.clicks).toBe(0);
    expect(s.unspent).toBe(500);
  });
});

describe("buildGoogleSuggestions", () => {
  function input(p: Partial<GoogleSuggestionsInput>): GoogleSuggestionsInput {
    return {
      ownAdCount: 0,
      advertiserCount: 0,
      bestOpportunity: null,
      topAdvertiser: null,
      ...p,
    };
  }
  const keys = (s: ReturnType<typeof buildGoogleSuggestions>) =>
    s.map((x) => x.key);

  test("blue ocean fires only with no ads + no rivals + a best opportunity", () => {
    const out = buildGoogleSuggestions(
      input({ bestOpportunity: kw({ keyword: "lip filler", cpc: 1.2 }) }),
    );
    expect(out[0].key).toBe("g_blue_ocean");
    expect(out[0].tone).toBe("opportunity");
    expect(out[0].network).toBe("google");
    expect(out[0].params).toMatchObject({ keyword: "lip filler" });
    // start_here also fires whenever there's a best opportunity.
    expect(keys(out)).toContain("g_start_here");
  });

  test("no blue ocean once a rival advertises on Google", () => {
    const out = buildGoogleSuggestions(
      input({ advertiserCount: 2, bestOpportunity: kw({}) }),
    );
    expect(keys(out)).not.toContain("g_blue_ocean");
    expect(keys(out)).toContain("g_start_here");
  });

  test("no blue ocean when she already runs Google ads", () => {
    const out = buildGoogleSuggestions(
      input({ ownAdCount: 2, bestOpportunity: kw({}) }),
    );
    expect(keys(out)).not.toContain("g_blue_ocean");
  });

  test("start_here carries keyword + cpc + competition label", () => {
    const out = buildGoogleSuggestions(
      input({
        advertiserCount: 1,
        bestOpportunity: kw({
          keyword: "botox",
          cpc: 3,
          competition: "LOW",
        }),
      }),
    );
    const sh = out.find((s) => s.key === "g_start_here");
    expect(sh?.params).toMatchObject({
      keyword: "botox",
      competition: "Low",
    });
    expect(sh?.params.cpc).toBe("$3.00");
  });

  test("gap fires only when rivals run Google ads and she doesn't", () => {
    const out = buildGoogleSuggestions(
      input({ ownAdCount: 0, advertiserCount: 3 }),
    );
    const gap = out.find((s) => s.key === "g_gap");
    expect(gap?.tone).toBe("gap");
    expect(gap?.params).toMatchObject({ count: 3 });
  });

  test("gap suppressed when she already runs Google ads", () => {
    const out = buildGoogleSuggestions(
      input({ ownAdCount: 2, advertiserCount: 3 }),
    );
    expect(keys(out)).not.toContain("g_gap");
  });

  test("watch labels the top Google advertiser", () => {
    const out = buildGoogleSuggestions(
      input({
        advertiserCount: 4,
        topAdvertiser: { name: "Leah V Skin Care", adCount: 6 },
      }),
    );
    const watch = out.find((s) => s.key === "g_watch");
    expect(watch?.tone).toBe("watch");
    expect(watch?.network).toBe("google");
    expect(watch?.params).toMatchObject({
      name: "Leah V Skin Care",
      count: 6,
    });
  });

  test("caps at 3 suggestions even when everything fires", () => {
    const out = buildGoogleSuggestions(
      input({
        ownAdCount: 0,
        advertiserCount: 5,
        bestOpportunity: kw({ keyword: "botox", competition: "LOW" }),
        topAdvertiser: { name: "Leah V", adCount: 6 },
      }),
    );
    expect(out.length).toBeLessThanOrEqual(3);
  });

  test("empty landscape yields no suggestions", () => {
    expect(buildGoogleSuggestions(input({}))).toEqual([]);
  });
});

describe("buildPersonalizedMetaSuggestions", () => {
  function input(p: Partial<PersonalMetaInput>): PersonalMetaInput {
    return {
      ownAdCount: 0,
      ownPlatforms: [],
      advertiserCount: 0,
      ownServices: [],
      formatMix: [],
      serviceMix: [],
      promos: [],
      ...p,
    };
  }
  const keys = (s: ReturnType<typeof buildPersonalizedMetaSuggestions>) =>
    s.map((x) => x.key);

  test("m_start fires when she runs no Meta ads but the market does", () => {
    const out = buildPersonalizedMetaSuggestions(
      input({ ownAdCount: 0, advertiserCount: 5 }),
    );
    const start = out.find((s) => s.key === "m_start");
    expect(start?.tone).toBe("gap");
    expect(start?.network).toBe("meta");
    expect(start?.params).toMatchObject({ count: 5 });
  });

  test("m_start suppressed once she runs her own Meta ads", () => {
    const out = buildPersonalizedMetaSuggestions(
      input({ ownAdCount: 3, advertiserCount: 5 }),
    );
    expect(keys(out)).not.toContain("m_start");
  });

  test("m_service_win fires for an own service the market barely advertises", () => {
    const out = buildPersonalizedMetaSuggestions(
      input({
        ownServices: ["Hydrafacial", "Botox"],
        // Botox is well-advertised (40%); Hydrafacial is absent (→ 0% ≤ 10%).
        serviceMix: [svc("Botox", 0.4), svc("Lip filler", 0.3)],
      }),
    );
    const win = out.find((s) => s.key === "m_service_win");
    expect(win?.tone).toBe("opportunity");
    expect(win?.network).toBe("meta");
    expect(String(win?.params.services)).toContain("Hydrafacial");
    expect(String(win?.params.services)).not.toContain("Botox");
  });

  test("m_service_win also fires when an own service is advertised at ≤10%", () => {
    const out = buildPersonalizedMetaSuggestions(
      input({
        ownServices: ["Microneedling"],
        serviceMix: [svc("Microneedling", 0.08), svc("Botox", 0.5)],
      }),
    );
    expect(keys(out)).toContain("m_service_win");
  });

  test("m_service_win does not fire when every own service is well-advertised", () => {
    const out = buildPersonalizedMetaSuggestions(
      input({
        ownServices: ["Botox"],
        serviceMix: [svc("Botox", 0.5)],
      }),
    );
    expect(keys(out)).not.toContain("m_service_win");
  });

  test("m_platform_trim fires when she runs ads on a fringe surface", () => {
    const out = buildPersonalizedMetaSuggestions(
      input({
        ownAdCount: 2,
        ownPlatforms: [
          "FACEBOOK",
          "INSTAGRAM",
          "MESSENGER",
          "AUDIENCE_NETWORK",
        ],
      }),
    );
    const trim = out.find((s) => s.key === "m_platform_trim");
    expect(trim?.tone).toBe("opportunity");
    expect(String(trim?.params.platforms)).toContain("Messenger");
    expect(String(trim?.params.platforms)).toContain("Audience Network");
  });

  test("m_platform_trim also fires for WhatsApp", () => {
    const out = buildPersonalizedMetaSuggestions(
      input({ ownAdCount: 1, ownPlatforms: ["FACEBOOK", "WHATSAPP"] }),
    );
    const trim = out.find((s) => s.key === "m_platform_trim");
    expect(String(trim?.params.platforms)).toBe("WhatsApp");
  });

  test("m_platform_trim suppressed when she has no Meta ads", () => {
    const out = buildPersonalizedMetaSuggestions(
      input({ ownAdCount: 0, ownPlatforms: ["MESSENGER", "WHATSAPP"] }),
    );
    expect(keys(out)).not.toContain("m_platform_trim");
  });

  test("m_platform_trim suppressed when she only runs FB/IG", () => {
    const out = buildPersonalizedMetaSuggestions(
      input({ ownAdCount: 2, ownPlatforms: ["FACEBOOK", "INSTAGRAM"] }),
    );
    expect(keys(out)).not.toContain("m_platform_trim");
  });

  test("m_promo_benchmark fires when a market promo has a stated price", () => {
    const out = buildPersonalizedMetaSuggestions(
      input({
        promos: [
          { label: "intro", offer: "Free consult", price: null },
          { label: "botox", offer: "$9/unit Botox", price: "$9/unit" },
        ] as MarketPromo[],
      }),
    );
    const promo = out.find((s) => s.key === "m_promo_benchmark");
    expect(promo?.tone).toBe("watch");
    expect(promo?.params).toMatchObject({
      offer: "$9/unit Botox",
      price: "$9/unit",
    });
  });

  test("m_promo_benchmark suppressed when no promo carries a price", () => {
    const out = buildPersonalizedMetaSuggestions(
      input({
        promos: [{ label: "intro", offer: "Free consult", price: null }],
      }),
    );
    expect(keys(out)).not.toContain("m_promo_benchmark");
  });

  test("m_format_video fires when video share ≥ 0.4", () => {
    const out = buildPersonalizedMetaSuggestions(
      input({ formatMix: [fmt("Video", 0.6), fmt("Image", 0.4)] }),
    );
    const vid = out.find((s) => s.key === "m_format_video");
    expect(vid?.tone).toBe("opportunity");
    expect(vid?.params).toMatchObject({ pct: 60 });
  });

  test("m_format_video suppressed when video share < 0.4", () => {
    const out = buildPersonalizedMetaSuggestions(
      input({ formatMix: [fmt("Video", 0.3), fmt("Image", 0.7)] }),
    );
    expect(keys(out)).not.toContain("m_format_video");
  });

  test("caps at 4 suggestions even when everything fires", () => {
    const out = buildPersonalizedMetaSuggestions(
      input({
        ownAdCount: 2,
        ownPlatforms: ["FACEBOOK", "MESSENGER", "WHATSAPP"],
        advertiserCount: 6,
        ownServices: ["Hydrafacial"],
        serviceMix: [svc("Botox", 0.5)],
        formatMix: [fmt("Video", 0.7)],
        promos: [
          { label: "p", offer: "$9/unit Botox", price: "$9/unit" },
        ] as MarketPromo[],
      }),
    );
    expect(out.length).toBeLessThanOrEqual(4);
  });

  test("empty landscape yields no suggestions", () => {
    expect(buildPersonalizedMetaSuggestions(input({}))).toEqual([]);
  });
});
