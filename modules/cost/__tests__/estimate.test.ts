// Golden tests for the pre-flight cost estimator (Phase 0). These lock the
// price-list math + the cost-gate boundaries so any pricing change is a
// deliberate, visible diff.

import { describe, expect, test } from "vitest";
import {
  estimateRun,
  estimateDiscovery,
  gateFor,
  usdToCredits,
} from "../estimate";
import {
  CREDIT_USD,
  CREDIT_PRICES,
  CREDIT_MEANING,
  ENRICHMENT_PRICES,
  WEBSITE_DEPENDENT,
  PLAN_CARDS,
  PLAN_CREDITS,
  PLAN_TIER_MAP,
  PLAN_CARD_ORDER,
} from "../pricing";

describe("price list (golden)", () => {
  test("unit costs are the agreed values", () => {
    expect(ENRICHMENT_PRICES.reviews.usdPerUnit).toBeCloseTo(0.015, 6);
    // Live-verified DfS invoice charge ($0.00425, not the $0.0025 public page).
    expect(ENRICHMENT_PRICES.lighthouse.usdPerUnit).toBeCloseTo(0.00425, 6);
    expect(ENRICHMENT_PRICES.contacts.usdPerUnit).toBeCloseTo(0.008, 6);
    // WP10-7 · re-derived from the real call graph (modules/cell-intel):
    //  serp = serpLocalPack + serpOrganic + rankedKeywords×3 (MAX_RANKED_KEYWORD_BIZ),
    //         = 0.002 + 0.002 + 0.013×3 = 0.043 (was ×12 = 0.16);
    //  B1 · google_ads is now PER-BUSINESS — one target-host adsSearch call
    //         ($0.002) per website-having lead (was per-cell adsAdvertisers +
    //         adsSearch = 0.004 amortized across the cell).
    expect(ENRICHMENT_PRICES.serp.usdPerUnit).toBeCloseTo(0.043, 6);
    expect(ENRICHMENT_PRICES.google_ads.usdPerUnit).toBeCloseTo(0.002, 6);
    // 2026-07-10: corrected 0.12→0.85 to match the REAL Apify console cost
    // (~$0.72–1.22/run, mean ~$0.87 · proxy-dominated); upperMultiplier 2.
    expect(ENRICHMENT_PRICES.meta_ads.usdPerUnit).toBeCloseTo(0.85, 6);
    expect(ENRICHMENT_PRICES.meta_ads.upperMultiplier).toBe(2);
    expect(CREDIT_USD).toBe(0.05);
  });

  test("scope units — B1 · google_ads is per-business, not per-cell", () => {
    // The scope unit drives the whole billing + freshness + UI scope. google_ads
    // moved cell→business (reliable target-host attribution), so it now bills per
    // lead and reads a per-business freshness cursor. meta_ads/serp stay per-cell.
    expect(ENRICHMENT_PRICES.google_ads.unit).toBe("business");
    expect(ENRICHMENT_PRICES.meta_ads.unit).toBe("cell");
    expect(ENRICHMENT_PRICES.serp.unit).toBe("cell");
    // google_ads keys off the website host → it's website-dependent now.
    expect(WEBSITE_DEPENDENT.has("google_ads")).toBe(true);
  });
});

describe("plan-credit parity (WP1-12)", () => {
  // The one lattice: what the plan card ADVERTISES must equal what the grant
  // engine GRANTS. A drift here is the pre-WP1 bug (card said 6,000, grant gave
  // 1,600). Guards advertised == granted for every PAID display key.
  test("every paid card's monthlyCredits === PLAN_CREDITS[PLAN_TIER_MAP[k]]", () => {
    for (const key of PLAN_CARD_ORDER) {
      const tier = PLAN_TIER_MAP[key];
      if (tier === null) continue; // free tier has no enum home
      expect(PLAN_CARDS[key].monthlyCredits).toBe(PLAN_CREDITS[tier]);
    }
  });

  test("the reconciled lattice values are the advertised numbers", () => {
    // Repriced 2026-07-09.
    expect(PLAN_CARDS.starter.monthlyCredits).toBe(250);
    expect(PLAN_CARDS.solo.monthlyCredits).toBe(750);
    expect(PLAN_CARDS.growth.monthlyCredits).toBe(1_800);
    expect(PLAN_CARDS.scale.monthlyCredits).toBe(6_500);
    expect(PLAN_CREDITS.SOLO).toBe(250);
    expect(PLAN_CREDITS.AGENCY_PRO).toBe(750);
    expect(PLAN_CREDITS.GROWTH).toBe(1_800);
    expect(PLAN_CREDITS.BOUTIQUE).toBe(6_500);
  });

  test("fullyEnriched headline is floor(credits / 6) for every card", () => {
    // A fully-enriched lead is 6 credits (contacts + reviews + speed + AI =
    // 1+2+2+1) under the 2026-07-09 CREDIT_PRICES — see CREDIT_MEANING.fullEnrichment.
    for (const key of PLAN_CARD_ORDER) {
      expect(PLAN_CARDS[key].fullyEnriched).toBe(
        Math.floor(PLAN_CARDS[key].monthlyCredits / 6),
      );
    }
  });
});

describe("CREDIT_PRICES (customer billing schedule)", () => {
  test("the whole-credit schedule is the agreed values", () => {
    expect(CREDIT_PRICES.contacts).toBe(1);
    expect(CREDIT_PRICES.tech).toBe(0); // rides the contacts scan
    expect(CREDIT_PRICES.services).toBe(1);
    expect(CREDIT_PRICES.reviews).toBe(2); // 1→2 unified pricing (2026-07-09)
    expect(CREDIT_PRICES.lighthouse).toBe(2); // 1→2 (covers walled tail)
    expect(CREDIT_PRICES.ai_research).toBe(1);
    expect(CREDIT_PRICES.google_ads).toBe(1);
    expect(CREDIT_PRICES.meta_ads).toBe(25); // 12→25 (real ~$0.87/run · 1/market)
    expect(CREDIT_PRICES.serp).toBe(4);
  });

  test("a fully-enriched lead = 6 credits (contacts + reviews + speed + AI)", () => {
    expect(
      CREDIT_PRICES.contacts +
        CREDIT_PRICES.reviews +
        CREDIT_PRICES.lighthouse +
        CREDIT_PRICES.ai_research,
    ).toBe(CREDIT_MEANING.fullEnrichment);
  });

  test("booking-tool goal (contacts+tech) is 1 credit/lead, not 2", () => {
    const r = estimateRun({
      lines: [
        { enrichment: "contacts", total: 84 },
        { enrichment: "tech", total: 84 },
      ],
    });
    expect(r.netCredits).toBe(84); // 84 × (1 + 0)
  });
});

describe("gateFor", () => {
  // WP1-11 (Viktor exception, 2026-07-01): the $5 approval gate is REMOVED.
  // gateFor NEVER yields "approval" — $0 is "auto", any positive net is
  // "confirm" (a self-serve click-through). Wallet balance is the only gate.
  test("$0 → auto; any positive net → confirm; never approval", () => {
    expect(gateFor(0)).toBe("auto");
    expect(gateFor(0.01)).toBe("confirm");
    expect(gateFor(1.99)).toBe("confirm");
    expect(gateFor(2)).toBe("confirm");
    expect(gateFor(5)).toBe("confirm");
    expect(gateFor(5.01)).toBe("confirm");
    expect(gateFor(1000)).toBe("confirm");
  });

  test("no net-USD value ever maps to the removed 'approval' gate", () => {
    for (const net of [0, 0.01, 1, 2, 4.99, 5, 5.01, 50, 500]) {
      expect(gateFor(net)).not.toBe("approval");
    }
  });
});

describe("usdToCredits", () => {
  test("rounds up; $0 → 0 credits", () => {
    expect(usdToCredits(0)).toBe(0);
    expect(usdToCredits(0.04)).toBe(1);
    expect(usdToCredits(0.05)).toBe(1);
    expect(usdToCredits(0.06)).toBe(2);
    expect(usdToCredits(7.5)).toBe(150);
  });
});

describe("estimateRun", () => {
  test("empty → all zeros, auto gate, exact", () => {
    const r = estimateRun({ lines: [] });
    expect(r.netUsd).toBe(0);
    expect(r.netCredits).toBe(0);
    expect(r.gate).toBe("auto");
    expect(r.confidence).toBe("exact");
  });

  test("contacts ×100 (variable) → bounded, auto gate", () => {
    const r = estimateRun({ lines: [{ enrichment: "contacts", total: 100 }] });
    expect(r.grossUsd).toBeCloseTo(0.8, 4);
    expect(r.freshHitUsd).toBe(0);
    expect(r.netUsd).toBeCloseTo(0.8, 4);
    expect(r.upperBoundUsd).toBeCloseTo(2.7, 4); // 100 × 0.008 × 3.375
    expect(r.netCredits).toBe(100); // CREDIT_PRICES: 100 billable × 1 credit
    expect(r.confidence).toBe("bounded");
    expect(r.gate).toBe("confirm"); // WP1-11: any positive net → confirm
  });

  test("lighthouse ×100 with 20 fresh → fresh saves $0.085; walled upper bound (WP10-7)", () => {
    const r = estimateRun({
      lines: [{ enrichment: "lighthouse", total: 100, fresh: 20 }],
    });
    const line = r.lines[0];
    expect(line.billable).toBe(80);
    expect(line.grossUsd).toBeCloseTo(0.425, 4);
    expect(line.freshHitUsd).toBeCloseTo(0.085, 4);
    expect(r.netUsd).toBeCloseTo(0.34, 4);
    // WP10-7 · lighthouse upperMultiplier is now 14.117647 (0.06 walled /
    // 0.00425 open), so the upper bound reflects a cell of Cloudflare-walled
    // sites honestly: 80 billable × 0.00425 × 14.117647 = 0.34 × 14.117647 = 4.80.
    expect(r.upperBoundUsd).toBeCloseTo(4.8, 4);
    expect(r.netCredits).toBe(160); // CREDIT_PRICES: 80 billable × 2 credits
    // freshCredits is CREDIT-basis (20 fresh × 2 credits = 40), NOT
    // usdToCredits(freshHitUsd)=usdToCredits(0.085)=2 (the old COGS-basis bug).
    expect(r.freshCredits).toBe(40);
    // Confidence is now "bounded" (lighthouse has upperMultiplier > 1 · a
    // billable walled audit can cost up to ~14× the open quote).
    expect(r.confidence).toBe("bounded");
    expect(r.gate).toBe("confirm"); // WP1-11: any positive net → confirm
  });

  test("reviews ×500 → $7.50 COGS, confirm gate (no approval), bounded", () => {
    const r = estimateRun({ lines: [{ enrichment: "reviews", total: 500 }] });
    expect(r.netUsd).toBeCloseTo(7.5, 4); // COGS telemetry unchanged
    expect(r.netCredits).toBe(1000); // CREDIT_PRICES: 500 × 2 credits
    // WP1-11: a $7.50 run no longer needs approval — wallet balance is the gate.
    expect(r.gate).toBe("confirm");
    expect(r.confidence).toBe("bounded");
  });

  test("combined run → confirm gate, deduped freshness", () => {
    const r = estimateRun({
      lines: [
        { enrichment: "lighthouse", total: 100, fresh: 20 }, // net 80×0.00425 = 0.34
        { enrichment: "serp", total: 9 }, // WP10-7 · net 9×0.043 = 0.387
        { enrichment: "reviews", total: 50, fresh: 10 }, // net 40×0.015 = 0.60
      ],
    });
    // WP10-7 · serp is now $0.043/unit (was $0.16): 0.34 + 0.387 + 0.60 = 1.327.
    expect(r.netUsd).toBeCloseTo(1.327, 4); // COGS telemetry unchanged
    expect(r.gate).toBe("confirm");
    expect(r.confidence).toBe("bounded"); // reviews + lighthouse are variable
    // CREDIT_PRICES: lighthouse 80×2 + serp 9×4 + reviews 40×2 = 160 + 36 + 80.
    expect(r.netCredits).toBe(276);
  });

  test("all fresh → net $0 but freshHit shows the saving", () => {
    const r = estimateRun({
      lines: [{ enrichment: "contacts", total: 50, fresh: 50 }],
    });
    expect(r.netUsd).toBe(0);
    expect(r.freshHitUsd).toBeCloseTo(0.4, 4);
    expect(r.netCredits).toBe(0);
    expect(r.gate).toBe("auto");
    expect(r.confidence).toBe("exact"); // nothing billable
  });

  test("fresh is clamped to total", () => {
    const r = estimateRun({
      lines: [{ enrichment: "lighthouse", total: 10, fresh: 999 }],
    });
    expect(r.lines[0].fresh).toBe(10);
    expect(r.netUsd).toBe(0);
  });

  test("rejects bad counts + unknown enrichment", () => {
    expect(() =>
      estimateRun({ lines: [{ enrichment: "reviews", total: -1 }] }),
    ).toThrow();
    expect(() =>
      estimateRun({ lines: [{ enrichment: "reviews", total: 1.5 }] }),
    ).toThrow();
    expect(() =>
      // @ts-expect-error unknown enrichment key
      estimateRun({ lines: [{ enrichment: "nope", total: 1 }] }),
    ).toThrow();
  });
});

describe("estimateDiscovery", () => {
  test("discovery is always free — fresh and fetch cells alike ($0)", () => {
    // DISCOVERY_PRICE is $0/listing (docs/pricing-strategy.md: "Discovery is
    // free"); the fresh-vs-refetch split still tracks WHICH cells need a real
    // DfS re-fetch (that decision drives run-discovery.ts), it just never
    // charges credits either way.
    const r = estimateDiscovery([
      { fresh: true, expectedListings: 138 },
      { fresh: false, expectedListings: 100 },
    ]);
    expect(r.freshCells).toBe(1);
    expect(r.fetchCells).toBe(1);
    expect(r.netUsd).toBe(0);
    expect(r.freshHitUsd).toBe(0);
    expect(r.netCredits).toBe(0);
    expect(r.gate).toBe("auto");
  });
});
