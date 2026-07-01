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

/**
 * Monthly plan credit grants. 1 credit = 1 fully-enriched lead. The free tier
 * is a one-time 50-credit grant (no Stripe subscription); paid tiers re-grant
 * each billing cycle. Keys match the AgencyPlan enum in prisma/schema.prisma.
 * Source of truth: docs/pricing-strategy.md / docs/enrichment-cost-model.md.
 */
export const FREE_TIER_CREDITS = 50;

export type AgencyPlanTier = "SOLO" | "GROWTH" | "AGENCY_PRO" | "BOUTIQUE";

export const PLAN_CREDITS: Record<AgencyPlanTier, number> = {
  SOLO: 600,
  GROWTH: 1_600,
  AGENCY_PRO: 5_000,
  BOUTIQUE: 12_000,
};

// ─── Canonical plan registry · the portal-prototype pricing model ───────────
//
// The agency billing UI (the prototype's "Billing & credits" screen) is the
// single source of truth for what plans are DISPLAYED, priced, and how many
// credits each grants. This is deliberately DECOUPLED from the Prisma
// `AgencyPlan` enum (SOLO/GROWTH/AGENCY_PRO/BOUTIQUE) and from PLAN_CREDITS
// above, because:
//
//   1. The enum + PLAN_CREDITS drive the live credit-grant engine
//      (modules/cost/server.ts grantPlanCredits) and the existing Stripe
//      webhook — renaming them is a live-Stripe + schema cutover that is
//      `human-required` (payments). We don't touch them here.
//   2. The display names / prices / credit amounts the prototype specifies
//      (Free $0 / Starter $19 / Growth $99 / Scale $299) don't all have an
//      enum home (there's no "Starter"/"Scale" enum value), so the display
//      layer carries its own keys and maps to the enum where one exists.
//
// `PLAN_TIER_MAP` is the bridge: it maps each display plan key to the existing
// AgencyPlan enum value used at grant time, so the UI can highlight the
// active plan by reading `Agency.plan` and matching it back to a display card.

/** Display-layer plan keys (the prototype's four tiers). */
export type PlanKey = "free" | "starter" | "growth" | "scale";

/** What one credit means — the prototype's credit definition, verbatim. */
export const CREDIT_MEANING = {
  /** Credits for one lead WITH contacts (email · phone · socials). */
  contacts: 1,
  /** Credits for one FULLY-enriched lead (reviews, ads, SERP, AI, compliance). */
  fullEnrichment: 3,
  /** Credits for 100 first-touch messages. */
  firstTouchPer100: 10,
} as const;

export interface PlanCard {
  key: PlanKey;
  /** Display name shown on the plan card + current-plan header. */
  displayName: string;
  /** Monthly price in whole USD (0 for Free). */
  priceUsd: number;
  /** Monthly credit grant (or one-time grant for Free). */
  monthlyCredits: number;
  /** True when the grant is one-time (Free), not a recurring monthly allowance. */
  oneTime: boolean;
  /** Derived headline: how many fully-enriched leads the grant buys. */
  fullyEnriched: number;
  /** Derived headline: how many leads-with-contacts the grant buys. */
  withContacts: number;
  /** Short effective-rate string (e.g. "$0.05 / enriched lead"). */
  rate: string;
  /** Whether this is the recommended / best-value tier (renders the ribbon). */
  featured: boolean;
  /** ✓-bulleted feature list (last entry may be a "muted" note). */
  features: string[];
  /** Worked-example blurb shown in the indigo .plan-calc box. */
  calc: string;
}

/**
 * The four canonical plans, EXACTLY matching docs/portal-prototype.html
 * (lines 8052–8188). `fullyEnriched` = floor(credits / 3) and `withContacts`
 * = credits (1 credit = 1 lead-with-contacts), matching the prototype's
 * hand-written numbers.
 */
export const PLAN_CARDS: Record<PlanKey, PlanCard> = {
  free: {
    key: "free",
    displayName: "Free",
    priceUsd: 0,
    monthlyCredits: 50,
    oneTime: true,
    fullyEnriched: 16,
    withContacts: 50,
    rate: "Never expire · no card",
    featured: false,
    features: [
      "Discovery — unlimited, free",
      "Contacts on every lead",
      "Full enrichment + first-touch",
      "Never expire",
    ],
    calc: "Map any market free → fully enrich 50 leads, or pull contacts on 150. Enough to win your first client.",
  },
  starter: {
    key: "starter",
    displayName: "Starter",
    priceUsd: 19,
    monthlyCredits: 900,
    oneTime: false,
    fullyEnriched: 300,
    withContacts: 900,
    rate: "from $0.06 / enriched lead",
    featured: false,
    features: [
      "Discovery — unlimited, free",
      "Contacts on every lead",
      "Full enrichment + first-touch",
    ],
    calc: "≈ 300 fully enriched, or 900 with contacts — e.g. 3 markets · ~100 each.",
  },
  growth: {
    key: "growth",
    displayName: "Growth",
    priceUsd: 99,
    monthlyCredits: 6_000,
    oneTime: false,
    fullyEnriched: 2_000,
    withContacts: 6_000,
    rate: "$0.05 / enriched lead",
    featured: true,
    features: [
      "Discovery — unlimited, free",
      "Contacts on every lead",
      "Deep audit included (speed + keywords)",
    ],
    calc: "≈ 2,000 fully enriched, or 6,000 with contacts · dozens of markets · 3 teammates.",
  },
  scale: {
    key: "scale",
    displayName: "Scale",
    priceUsd: 299,
    monthlyCredits: 24_000,
    oneTime: false,
    fullyEnriched: 8_000,
    withContacts: 24_000,
    rate: "from $0.037 / enriched lead",
    featured: false,
    features: [
      "Discovery — unlimited, free",
      "Contacts on every lead",
      "Deep audit included (speed + keywords)",
      "Priority support",
    ],
    calc: "≈ 8,000 fully enriched, or 24,000 with contacts · high-volume prospecting at the lowest rate.",
  },
};

/** Ordered display list (Free → Starter → Growth → Scale). */
export const PLAN_CARD_ORDER: PlanKey[] = [
  "free",
  "starter",
  "growth",
  "scale",
];

/**
 * Bridge from the display plan key → the existing Prisma `AgencyPlan` enum
 * value used at grant time. `free` has no enum home (free agencies have a
 * `null` plan), so it maps to `null`. The paid tiers map to the closest
 * existing enum value. NOTE: this map is the seam the human will revisit when
 * the AgencyPlan enum is eventually renamed (see the human-required note in
 * the build summary) — the UI stays correct regardless of the enum's labels.
 */
export const PLAN_TIER_MAP: Record<PlanKey, AgencyPlanTier | null> = {
  free: null,
  starter: "SOLO",
  growth: "GROWTH",
  scale: "BOUTIQUE",
};

/** Reverse bridge: given an `Agency.plan` enum value, which display card? */
export function planKeyForEnum(
  enumValue: AgencyPlanTier | null | undefined,
): PlanKey {
  if (!enumValue) return "free";
  const hit = PLAN_CARD_ORDER.find((k) => PLAN_TIER_MAP[k] === enumValue);
  return hit ?? "free";
}

export interface TopUpPack {
  /** Stable key (used for the checkout action + env price-id lookup). */
  key: "pack_1000" | "pack_5000";
  /** Credits added to purchasedCredits on purchase. */
  credits: number;
  /** One-time price in whole USD. */
  priceUsd: number;
  /** Effective per-credit rate string (e.g. "$0.05 / credit"). */
  rate: string;
  /** Whether the pack renders with the primary (filled) CTA. */
  primary: boolean;
}

/**
 * One-time top-up packs — the prototype's "the only place real money is
 * spent" surface. Purchased credits land in `AgencyWallet.purchasedCredits`
 * and never expire.
 */
export const TOPUP_PACKS: TopUpPack[] = [
  {
    key: "pack_1000",
    credits: 1_000,
    priceUsd: 50,
    rate: "$0.05 / credit",
    primary: false,
  },
  {
    key: "pack_5000",
    credits: 5_000,
    priceUsd: 200,
    rate: "$0.04 / credit",
    primary: true,
  },
];

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

/**
 * Discovery (the raw market list) is FREE to the agency — always $0 / 0
 * credits, per docs/pricing-strategy.md § 3 and docs/enrichment-cost-model.md
 * ("Discovery (raw list) is free"). The `usdPerListingUsd`/`baseUsd` fields
 * are kept at 0 (not deleted) so `estimateDiscovery`'s per-cell math still
 * runs unchanged — it always nets to $0/0 credits.
 *
 * This does NOT touch what WE pay DataForSEO for the maps-search call — that
 * real external cost is tracked separately via `incrementCost` inside
 * `services/dataforseo/maps-search.ts` onto the open CronRun (see
 * lib/cost/cost-counter.ts). We absorb that small per-cell cost ourselves
 * (a few cents) rather than charge it to the agency's wallet; discovery
 * freshness (182-day) still gates whether a re-fetch happens at all.
 */
export const DISCOVERY_PRICE = {
  baseUsd: 0,
  perListingUsd: 0,
  freshnessDays: 182, // 6 months
} as const;

export const ALL_ENRICHMENT_TYPES = Object.keys(
  ENRICHMENT_PRICES,
) as EnrichmentType[];
