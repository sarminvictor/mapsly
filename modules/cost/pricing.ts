// modules/cost/pricing.ts · canonical, versioned enrichment price list.
//
// Phase 0 of the agency-portal rework. This is the SINGLE source of truth for
// what every on-demand operation costs, so the pre-flight estimator
// (modules/cost/estimate.ts) and the post-hoc cost ledger agree.
//
// Two units of work:
//   - "business" enrichments bill per selected business (contacts, services,
//     tech, reviews, lighthouse, ai_research).
//   - "cell"     enrichments bill once per (metro × category) cell, then serve
//     every business in that cell from the cached run (meta_ads, google_ads,
//     serp).
//
// `upperMultiplier` captures variable-cost endpoints (reviews bill per review
// returned; the contacts AI-email fallback only fires on a fraction of rows).
// The estimator surfaces both the expected `netUsd` and the `upperBoundUsd`;
// the wallet never charges above the upper bound.
//
// Bump PRICE_LIST_VERSION whenever any number here changes — CostEstimate rows
// store the version so a stale 15-min quote can be detected + re-quoted.

import { DATAFORSEO_UNIT_COST_USD } from "@/services/dataforseo/pricing";

export const PRICE_LIST_VERSION = "2026-06-22.1";

/** Internal credit price. Apollo charges ~$0.20/credit; we undercut 4×. */
export const CREDIT_USD = 0.05;

/** Cost gate thresholds (USD) per the plan defaults. */
export const COST_GATE = {
  /** Runs strictly below this auto-proceed with no confirm. */
  autoMaxUsd: 2,
  /** Runs above this require explicit Viktor/owner approval ($5 rule). */
  approvalMinUsd: 5,
  /** A quote is valid this long before the server must re-quote. */
  quoteTtlMinutes: 15,
  /** A live re-quote that drifts more than this fraction forces re-confirm. */
  reQuoteDriftPct: 0.1,
} as const;

export type EnrichmentType =
  | "contacts"
  | "services"
  | "tech"
  | "reviews"
  | "meta_ads"
  | "google_ads"
  | "serp"
  | "lighthouse"
  | "ai_research";

export type ScopeUnit = "business" | "cell";

export interface EnrichmentPrice {
  label: string;
  unit: ScopeUnit;
  /** Expected USD per unit when freshly fetched (fresh units cost $0). */
  usdPerUnit: number;
  /** upperBound = usdPerUnit × this. >1 for variable-cost endpoints. */
  upperMultiplier: number;
  /** Serve-from-DB freshness window in days. */
  freshnessDays: number;
}

/** Apify Meta Ad Library actor run — the source is free; small compute. */
export const APIFY_META_RUN_USD = 0.05;

/** gpt-5.4-nano blended cost per business for AI-assisted text reads. */
export const NANO_PER_BUSINESS_USD = 0.01;

/**
 * The price list. Reviews/contacts/tech are variable (upperMultiplier > 1);
 * lighthouse/meta_ads are fixed.
 */
export const ENRICHMENT_PRICES: Record<EnrichmentType, EnrichmentPrice> = {
  // Scrape is our own compute ($0). The only external cost is the rare
  // gpt-5.4-nano email-finder fallback (~$0.027) that fires when scrape + RDAP
  // both miss (~30% of rows) → blended ~$0.008, upper $0.027.
  contacts: {
    label: "Contacts",
    unit: "business",
    usdPerUnit: 0.008,
    upperMultiplier: 3.375,
    freshnessDays: 90,
  },
  // gpt-5.4-nano over already-extracted page text (batched).
  services: {
    label: "Services",
    unit: "business",
    usdPerUnit: 0.002,
    upperMultiplier: 2,
    freshnessDays: 90,
  },
  // Deterministic DOM fingerprint rides the contacts scrape ($0); rare DfS
  // domain_technologies fallback ($0.01) on JS-heavy sites.
  tech: {
    label: "Tech / DOM",
    unit: "business",
    usdPerUnit: 0.001,
    upperMultiplier: 10,
    freshnessDays: 30,
  },
  // DfS Standard reviews ≈ $0.00075 per 10. Depth ~200 (recency ladder) ≈
  // $0.015 expected; upper bound depth 4490 ≈ $0.337.
  reviews: {
    label: "Reviews",
    unit: "business",
    usdPerUnit: DATAFORSEO_UNIT_COST_USD.reviewsTask * 20,
    upperMultiplier: 22,
    freshnessDays: 90,
  },
  lighthouse: {
    label: "Lighthouse",
    unit: "business",
    usdPerUnit: DATAFORSEO_UNIT_COST_USD.lighthouse,
    upperMultiplier: 1,
    freshnessDays: 30,
  },
  // 5-stage gpt-5.4-nano pipeline, batched + cached.
  ai_research: {
    label: "AI research",
    unit: "business",
    usdPerUnit: NANO_PER_BUSINESS_USD,
    upperMultiplier: 2,
    freshnessDays: 30,
  },
  // One Apify run per cell, attributed to all members.
  meta_ads: {
    label: "Meta ads",
    unit: "cell",
    usdPerUnit: APIFY_META_RUN_USD,
    upperMultiplier: 1,
    freshnessDays: 30,
  },
  // Advertiser discovery ($0.002) + up to ~25 creative pulls ($0.002 each).
  google_ads: {
    label: "Google ads",
    unit: "cell",
    usdPerUnit:
      DATAFORSEO_UNIT_COST_USD.adsAdvertisers +
      DATAFORSEO_UNIT_COST_USD.adsSearch * 25,
    upperMultiplier: 1.5,
    freshnessDays: 30,
  },
  // 3-tier: one local-pack + one organic scan + ranked_keywords on ~12 picks.
  serp: {
    label: "SERP / search",
    unit: "cell",
    usdPerUnit:
      DATAFORSEO_UNIT_COST_USD.serpLocalPack +
      DATAFORSEO_UNIT_COST_USD.serpOrganic +
      DATAFORSEO_UNIT_COST_USD.rankedKeywords * 12,
    upperMultiplier: 1.5,
    freshnessDays: 30,
  },
};

/** Discovery (Google Maps listings) per-cell cost model. Variable: a base
 *  fee plus a per-returned-listing fee. A cell discovered within its freshness
 *  window serves from the DB for $0. */
export const DISCOVERY_PRICE = {
  baseUsd: DATAFORSEO_UNIT_COST_USD.mapsSearch, // ~$0.01 base per cell
  perListingUsd: 0.0003,
  freshnessDays: 182, // 6 months
} as const;

export const ALL_ENRICHMENT_TYPES = Object.keys(
  ENRICHMENT_PRICES,
) as EnrichmentType[];
