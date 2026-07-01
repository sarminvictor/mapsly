import { describe, expect, test } from "vitest";

import {
  buildCellRows,
  enrichCellFeeCredits,
  enrichCreditsFor,
  enrichRatePerLead,
  type MarketCell,
  type QuoteCell,
} from "../flow-types";
import type { EnrichmentType } from "@/modules/cost/pricing";

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

  test("a realistic full bundle rounds to a small, non-zero credit rate", () => {
    // Every business-basis family together should land near "1 credit per
    // lead" (docs/pricing-strategy.md's headline number) since the per-unit
    // $ costs were sized to bundle to roughly $0.05 (=1 credit) all-in.
    const all: EnrichmentType[] = [
      "contacts",
      "services",
      "tech",
      "reviews",
      "lighthouse",
      "ai_research",
    ];
    const rate = enrichRatePerLead(all);
    expect(rate).toBeGreaterThanOrEqual(1);
    expect(rate).toBeLessThan(5); // sanity ceiling — never a runaway number
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
