import { describe, expect, test } from "vitest";

import {
  buildCellRows,
  classifyMarketSize,
  enrichableCountForCell,
  enrichCellFeeCredits,
  enrichCreditsFor,
  enrichRatePerLead,
  OVERSIZED_MARKET_THRESHOLD,
  THIN_MARKET_THRESHOLD,
  type CellRow,
  type MarketCell,
  type QuoteCell,
} from "../flow-types";
import {
  enrichmentNeedsWebsite,
  WEBSITE_DEPENDENT,
  type EnrichmentType,
} from "@/modules/cost/pricing";

// enrichRatePerLead / enrichCellFeeCredits back the Preview step's honest
// per-lead pricing (docs/pricing-strategy.md: "1 credit = 1 fully-enriched
// lead", "discovery is free"). Both must be computable WITHOUT a business
// count, since a never-discovered cell's count is genuinely unknown.

describe("enrichRatePerLead", () => {
  test("sums only business-basis families, never cell-basis ones", () => {
    const businessOnly = enrichRatePerLead(["contacts", "tech", "reviews"]);
    const withCellFamily = enrichRatePerLead([
      "contacts",
      "tech",
      "reviews",
      "meta_ads", // cell-basis — must NOT inflate the per-lead rate
    ]);
    expect(withCellFamily).toBe(businessOnly);
  });

  test("does not depend on business count (the whole point — knowable pre-discovery)", () => {
    // The function takes no bizCount param at all — this test locks that this
    // stays true by construction (a signature change would be a regression).
    const families: EnrichmentType[] = ["contacts", "services"];
    expect(enrichRatePerLead(families)).toBe(enrichRatePerLead(families));
  });

  test("empty family list costs 0", () => {
    expect(enrichRatePerLead([])).toBe(0);
  });

  test("a full bundle sums the per-family CREDIT_PRICES (tech rides contacts)", () => {
    // Under CREDIT_PRICES each chargeable business family = 1 credit; tech = 0
    // (it rides the contacts DOM scan). So the full business bundle
    // contacts+services+reviews+lighthouse+ai_research (+tech=0) = 5 credits.
    const all: EnrichmentType[] = [
      "contacts",
      "services",
      "tech",
      "reviews",
      "lighthouse",
      "ai_research",
    ];
    expect(enrichRatePerLead(all)).toBe(5);
  });

  test("booking-tool bundle (contacts + tech) is exactly 1 credit/lead", () => {
    expect(enrichRatePerLead(["contacts", "tech"])).toBe(1);
  });
});

describe("enrichCellFeeCredits", () => {
  test("sums only cell-basis families, scaled by cell count", () => {
    const oneCell = enrichCellFeeCredits(["meta_ads"], 1);
    const threeCells = enrichCellFeeCredits(["meta_ads"], 3);
    expect(threeCells).toBeGreaterThan(oneCell);
  });

  test("business-basis families never contribute a cell fee", () => {
    expect(enrichCellFeeCredits(["contacts", "reviews"], 5)).toBe(0);
  });

  test("zero cells costs 0", () => {
    expect(enrichCellFeeCredits(["meta_ads", "serp"], 0)).toBe(0);
  });
});

describe("enrichCreditsFor (real, known business + cell count)", () => {
  // Preview's post-mapping "Enrich N businesses — ~X credits" costbar line
  // calls this directly once the market is real (never before — see the
  // per-lead-rate functions above for the pre-mapping honest estimate).
  test("scales with business count for business-basis families", () => {
    const small = enrichCreditsFor(["contacts"], 10, 1);
    const large = enrichCreditsFor(["contacts"], 1000, 1);
    expect(large).toBeGreaterThan(small);
  });

  test("scales with cell count for cell-basis families, independent of business count", () => {
    const oneCell = enrichCreditsFor(["meta_ads"], 500, 1);
    const threeCells = enrichCreditsFor(["meta_ads"], 500, 3);
    expect(threeCells).toBeGreaterThan(oneCell);
  });

  test("zero businesses and a business-only family costs 0", () => {
    expect(enrichCreditsFor(["contacts"], 0, 1)).toBe(0);
  });
});

describe("buildCellRows — honesty contract", () => {
  const cell: MarketCell = {
    city: "Miami, FL",
    metroSlug: "miami",
    category: "Med spa",
    categoryId: "cat1",
    categorySlug: "medical_spa",
    country: "US",
  };

  test("a never-discovered cell reports neverDiscovered=true, never a guessed bizCount", () => {
    const rows = buildCellRows([cell], new Map());
    expect(rows[0]!.neverDiscovered).toBe(true);
    expect(rows[0]!.bizCount).toBe(0); // 0 = "unused", not "the real count"
  });

  test("an already-discovered cell reports the REAL count, neverDiscovered=false", () => {
    const key = "medical_spa|miami|US";
    const quoteByKey = new Map<string, QuoteCell>([
      [
        key,
        {
          cellKey: key,
          freshness: "fresh",
          existingBizCount: 342,
          websiteBizCount: 300,
          neverDiscovered: false,
        },
      ],
    ]);
    const rows = buildCellRows([cell], quoteByKey);
    expect(rows[0]!.neverDiscovered).toBe(false);
    expect(rows[0]!.bizCount).toBe(342);
  });

  test("a Canadian cell matches its quote by the REAL country (regression: this used to hardcode US)", () => {
    const torontoCell: MarketCell = {
      city: "Toronto, ON",
      metroSlug: "toronto",
      category: "Dental clinic",
      categoryId: "cat2",
      categorySlug: "dental_clinic",
      country: "CA",
    };
    const key = "dental_clinic|toronto|CA";
    const quoteByKey = new Map<string, QuoteCell>([
      [
        key,
        {
          cellKey: key,
          freshness: "fresh",
          existingBizCount: 250,
          websiteBizCount: 210,
          neverDiscovered: false,
        },
      ],
    ]);
    const rows = buildCellRows([torontoCell], quoteByKey);
    // Previously this looked up the key with a hardcoded "US" suffix, so a
    // Canadian cell's real quote NEVER matched — every Toronto market row
    // silently rendered as "never discovered" even after a real Discover run.
    expect(rows[0]!.neverDiscovered).toBe(false);
    expect(rows[0]!.bizCount).toBe(250);
  });
});

describe("enrichmentNeedsWebsite / WEBSITE_DEPENDENT", () => {
  test("site-reading families need a website", () => {
    // B1 · google_ads is website-dependent now — its collector keys the
    // ads_search on the business's host, so a site-less lead has nothing to query.
    for (const f of [
      "lighthouse",
      "contacts",
      "tech",
      "services",
      "ai_research",
      "google_ads",
    ] as EnrichmentType[]) {
      expect(WEBSITE_DEPENDENT.has(f)).toBe(true);
      expect(enrichmentNeedsWebsite([f])).toBe(true);
    }
  });

  test("Google-presence families do NOT need a website", () => {
    // reviews/meta_ads/serp key off the Google listing, not the site, so a
    // phone-only listing is still a valid target. (google_ads moved to the
    // site-reading set above — B1.)
    for (const f of ["reviews", "meta_ads", "serp"] as EnrichmentType[]) {
      expect(WEBSITE_DEPENDENT.has(f)).toBe(false);
      expect(enrichmentNeedsWebsite([f])).toBe(false);
    }
  });

  test("a mixed set needs a website if ANY member does", () => {
    expect(enrichmentNeedsWebsite(["reviews", "lighthouse"])).toBe(true);
    expect(enrichmentNeedsWebsite(["reviews", "serp"])).toBe(false);
    // B1 · a google_ads-only pick now needs a website.
    expect(enrichmentNeedsWebsite(["reviews", "google_ads"])).toBe(true);
    expect(enrichmentNeedsWebsite([])).toBe(false);
  });
});

describe("enrichableCountForCell", () => {
  const row: CellRow = {
    name: "Dentist · Calgary",
    freshness: "fresh",
    bizCount: 731,
    websiteBizCount: 613,
    neverDiscovered: false,
    discoverIsFree: true,
  };

  test("website-dependent research → only website-havers are enrichable", () => {
    expect(enrichableCountForCell(row, ["lighthouse"])).toBe(613);
    expect(enrichableCountForCell(row, ["contacts", "reviews"])).toBe(613);
  });

  test("no website-dependent research → the whole cell is enrichable", () => {
    expect(enrichableCountForCell(row, ["reviews"])).toBe(731);
    expect(enrichableCountForCell(row, ["meta_ads", "serp"])).toBe(731);
  });
});

// WP7-13 · statistical-edge market classification. The market-relative claim
// must never lie at the edges: a thin cell suppresses percentiles → absolute
// benchmarks; an oversized cell nudges toward a narrower sub-cell.
describe("classifyMarketSize", () => {
  test("null / unknown count → normal (no note until real count lands)", () => {
    expect(classifyMarketSize(null)).toBe("normal");
  });

  test("below the thin threshold → thin", () => {
    expect(classifyMarketSize(0)).toBe("thin");
    expect(classifyMarketSize(THIN_MARKET_THRESHOLD - 1)).toBe("thin");
  });

  test("exactly the thin threshold → normal (boundary is inclusive-normal)", () => {
    expect(classifyMarketSize(THIN_MARKET_THRESHOLD)).toBe("normal");
  });

  test("mid-range → normal", () => {
    expect(classifyMarketSize(500)).toBe("normal");
    expect(classifyMarketSize(OVERSIZED_MARKET_THRESHOLD - 1)).toBe("normal");
  });

  test("at/above the oversized threshold → oversized", () => {
    expect(classifyMarketSize(OVERSIZED_MARKET_THRESHOLD)).toBe("oversized");
    expect(classifyMarketSize(50_000)).toBe("oversized");
  });

  test("the thresholds are the documented values (25 / 2000)", () => {
    expect(THIN_MARKET_THRESHOLD).toBe(25);
    expect(OVERSIZED_MARKET_THRESHOLD).toBe(2000);
  });
});
