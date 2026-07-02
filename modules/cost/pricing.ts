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

// 2026-07-02.2 · billing now runs off CREDIT_PRICES (whole customer credits),
// decoupled from ENRICHMENT_PRICES.usdPerUnit (raw COGS). Any change to either
// table must bump this so in-flight 15-min quotes re-quote.
// (Prior: "2026-07-02.1" WP10-7 re-derived serp/google_ads + walled lighthouse.)
export const PRICE_LIST_VERSION = "2026-07-02.2";

/** Internal credit price. Apollo charges ~$0.20/credit; we undercut 4×. */
export const CREDIT_USD = 0.05;

/**
 * Cost-gate thresholds (USD).
 *
 * WP1-11 (Viktor exception, 2026-07-01): the $5 approval gate is REMOVED — the
 * wallet balance is the only spend gate, so there is no `approvalMinUsd` and no
 * `autoMaxUsd` band anymore (`gateFor` returns "confirm" for any positive net,
 * "auto" for $0). What remains here is purely the quote-lifecycle policy: how
 * long a quote is valid and how much live drift forces a re-quote.
 */
export const COST_GATE = {
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

// ─── WP1-12 · ONE credit lattice · advertised == granted ─────────────────────
//
// RECONCILIATION DECISION (Viktor: sanity-check these numbers at review):
// The ADVERTISED card numbers (PLAN_CARDS below · the prototype's "Billing &
// credits" screen the customer actually sees) are the SOURCE OF TRUTH. The
// grant engine (grantPlanCredits reads PLAN_CREDITS) must hand out EXACTLY what
// the card promises — otherwise a $99 Growth buyer is advertised 6,000 credits
// but granted 1,600 (the pre-WP1 bug). PLAN_CREDITS is therefore reconciled to
// PLAN_CARDS via PLAN_TIER_MAP:
//
//   starter → SOLO       $19  → 900   credits  (advertised "from $0.06/lead")
//   growth  → GROWTH      $99 → 6,000 credits  (advertised "$0.05/lead")
//   scale   → BOUTIQUE   $299 → 24,000 credits (advertised "from $0.037/lead")
//
// The parity is guarded by a unit test: PLAN_CARDS[k].monthlyCredits ===
// PLAN_CREDITS[PLAN_TIER_MAP[k]!] for every paid display key.
//
// AGENCY_PRO has NO display card (there's no "Pro" tier in the prototype's four
// cards). It stays a legacy/internal tier at an intermediate grant between
// GROWTH and BOUTIQUE (12,000); the parity test doesn't cover it because no card
// maps to it. It exists only for pre-WP1 rows whose Agency.plan is AGENCY_PRO.
//
// MARGIN NOTE: at CREDIT_USD $0.05, the credit is the PRICE unit, not raw COGS
// (1 credit ≈ 1 lead-with-contacts, whose real vendor cost is ~$0.008; a fully-
// enriched lead is 3 credits ≈ $0.05–0.16 real). The advertised per-lead rates
// ($0.063 / $0.0495 / $0.037) are all ABOVE the ~$0.05 nominal fully-enriched
// COGS at the low end and well above real blended cost, so margins hold. See
// docs/pricing-strategy.md / docs/enrichment-cost-model.md.
export const PLAN_CREDITS: Record<AgencyPlanTier, number> = {
  SOLO: 900,
  GROWTH: 6_000,
  AGENCY_PRO: 12_000,
  BOUTIQUE: 24_000,
};

/**
 * WP6-8 · Credit rollover cap (paid tiers).
 *
 * Unused PLAN credits carry forward into the rollover bucket at each monthly
 * cycle reset, ACCUMULATING up to this multiple of the tier's monthly grant.
 * A Growth agency ($99 / 6,000/mo) can bank up to 3 × 6,000 = 18,000 rollover
 * credits on top of the fresh monthly grant. This removes Apollo's #1 complaint
 * ("credits expire, use-it-or-lose-it") and de-risks the low-priced hook.
 *
 * ORTHOGONAL TO SETTLE (docs/unit-economics.md): rollover only carries UNUSED
 * plan credits forward at grant time; it never changes how a run is charged.
 * `settleRun` already treats rollover as a spend bucket (plan → rollover →
 * purchased), so this constant governs ONLY the grant/reset accumulation.
 *
 * Purchased (top-up) credits never expire and are NOT capped — they're outside
 * the rollover bucket entirely.
 */
export const ROLLOVER_CAP_MULTIPLE = 3;

// ─── Canonical plan registry · the portal-prototype pricing model ───────────
//
// The agency billing UI (the prototype's "Billing & credits" screen) is the
// single source of truth for what plans are DISPLAYED, priced, and how many
// credits each grants. WP1-12 reconciled the credit AMOUNTS so PLAN_CARDS and
// PLAN_CREDITS (via PLAN_TIER_MAP) now agree — advertised == granted — instead
// of the pre-WP1 divergence (card said 6,000, grant gave 1,600). The display
// KEYS remain distinct from the Prisma enum for two reasons:
//
//   1. The enum names (SOLO/GROWTH/AGENCY_PRO/BOUTIQUE) drive the live
//      credit-grant engine (modules/cost/server.ts grantPlanCredits) and the
//      existing Stripe webhook — RENAMING the enum is a live-Stripe + schema
//      cutover that is `human-required` (payments). WP1-12 only changed the
//      NUMBERS, never the enum labels.
//   2. The display names the prototype specifies (Free / Starter / Growth /
//      Scale) don't all have an enum home (there's no "Starter"/"Scale" enum
//      value), so the display layer carries its own keys and maps to the enum
//      via PLAN_TIER_MAP where one exists.
//
// `PLAN_TIER_MAP` is the bridge: it maps each display plan key to the existing
// AgencyPlan enum value used at grant time, so the UI can highlight the
// active plan by reading `Agency.plan` and matching it back to a display card,
// AND so the grant amount (PLAN_CREDITS[PLAN_TIER_MAP[k]]) equals the card's
// advertised monthlyCredits (parity-tested).

/** Display-layer plan keys (the prototype's four tiers). */
export type PlanKey = "free" | "starter" | "growth" | "scale";

/** What one credit means — see CREDIT_PRICES for the per-family schedule. */
export const CREDIT_MEANING = {
  /** Credits for one lead WITH contacts (the website scan). */
  contacts: 1,
  /** Credits for one FULLY-enriched lead = scan + reviews + speed + AI (1+1+1+1). */
  fullEnrichment: 4,
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
    fullyEnriched: 12,
    withContacts: 50,
    rate: "Never expire · no card",
    featured: false,
    features: [
      "Discovery — unlimited, free",
      "Contacts on every lead",
      "Full enrichment + first-touch",
      "Never expire",
    ],
    // Honest math on the CREDIT_PRICES schedule: 1 credit = 1 lead with contacts;
    // a fully-enriched lead (scan + reviews + speed + AI) = 4 credits. 50 credits
    // ÷ 4 = 12 fully enriched, or 50 with contacts.
    calc: "Map any market free → fully enrich your best 12 leads, or pull contacts on 50. Enough to win your first client.",
  },
  starter: {
    key: "starter",
    displayName: "Starter",
    priceUsd: 19,
    monthlyCredits: 900,
    oneTime: false,
    fullyEnriched: 225,
    withContacts: 900,
    rate: "from $0.08 / enriched lead",
    featured: false,
    features: [
      "Discovery — unlimited, free",
      "Contacts on every lead",
      "Full enrichment + first-touch",
      "Unused credits roll over (up to 3× your monthly credits)",
    ],
    calc: "≈ 225 fully enriched, or 900 with contacts — e.g. 3 markets · ~75 each.",
  },
  growth: {
    key: "growth",
    displayName: "Growth",
    priceUsd: 99,
    monthlyCredits: 6_000,
    oneTime: false,
    fullyEnriched: 1_500,
    withContacts: 6_000,
    rate: "$0.07 / enriched lead",
    featured: true,
    features: [
      "Discovery — unlimited, free",
      "Contacts on every lead",
      "Deep audit included (speed + keywords)",
      "Unused credits roll over (up to 3× your monthly credits)",
    ],
    calc: "≈ 1,500 fully enriched, or 6,000 with contacts · dozens of markets · 3 teammates.",
  },
  scale: {
    key: "scale",
    displayName: "Scale",
    priceUsd: 299,
    monthlyCredits: 24_000,
    oneTime: false,
    fullyEnriched: 6_000,
    withContacts: 24_000,
    rate: "from $0.05 / enriched lead",
    featured: false,
    features: [
      "Discovery — unlimited, free",
      "Contacts on every lead",
      "Deep audit included (speed + keywords)",
      "Unused credits roll over (up to 3× your monthly credits)",
      "Priority support",
    ],
    calc: "≈ 6,000 fully enriched, or 24,000 with contacts · high-volume prospecting at the lowest rate.",
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
  // usdPerUnit is the OPEN-site cost (DfS Live audit, $0.00425). WP10-7 · the
  // upper bound reflects the Cloudflare-WALLED worst case honestly: a walled
  // site routes to the Apify in-browser Lighthouse actor at ~$0.06 (4 GB,
  // on-demand), so upperMultiplier = 0.06 / 0.00425 ≈ 14.12. This makes the
  // pre-flight quote's `upperBoundUsd` truthful for a cell full of walled sites
  // (the estimator surfaces it as a "bounded" quote), instead of implying every
  // audit is the cheap $0.00425 open case. NOTE: the SETTLE path bills the
  // per-job planned open cost ($0.00425) — actually charging the walled premium
  // at settle would require the LIGHTHOUSE worker to return a walled-specific
  // cost (a separate change); this bound only makes the ESTIMATE honest. The
  // walled loss is documented in docs/unit-economics.md (flag 1).
  lighthouse: {
    label: "Lighthouse",
    unit: "business",
    usdPerUnit: DATAFORSEO_UNIT_COST_USD.lighthouse,
    upperMultiplier: 14.117647, // 0.06 walled / 0.00425 open
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
  // WP10-7 · re-derived from the REAL call graph in modules/cell-intel/
  // google-ads.ts: the collector makes EXACTLY ONE adsAdvertisers call + ONE
  // adsSearch call (≤MAX_ADVERTISERS advertiser_ids in a single ads_search,
  // depth 40) — NOT 25 separate ad-search pulls. So the cell's real charged cost
  // is adsAdvertisers + adsSearch×1 ($0.002 + $0.002 = $0.004), amortized across
  // every business in the cell. (Was priced as ×25 = $0.052 → overstated
  // internal cost attribution by ~13×.)
  google_ads: {
    label: "Google ads",
    unit: "cell",
    usdPerUnit:
      DATAFORSEO_UNIT_COST_USD.adsAdvertisers +
      DATAFORSEO_UNIT_COST_USD.adsSearch * 1,
    upperMultiplier: 1.5,
    freshnessDays: 30,
  },
  // WP10-7 · re-derived from modules/cell-intel/serp.ts: ONE serpLocalPack scan
  // + ONE serpOrganic scan + rankedKeywords on MAX_RANKED_KEYWORD_BIZ = 3
  // businesses (one Live call each) — NOT 12. Real charged cost =
  // serpLocalPack + serpOrganic + rankedKeywords×3 ($0.002 + $0.002 +
  // $0.013×3 = $0.043), amortized across the cell. (Was priced as ×12 = $0.16 →
  // overstated by ~3.7×.)
  serp: {
    label: "SERP / search",
    unit: "cell",
    usdPerUnit:
      DATAFORSEO_UNIT_COST_USD.serpLocalPack +
      DATAFORSEO_UNIT_COST_USD.serpOrganic +
      DATAFORSEO_UNIT_COST_USD.rankedKeywords * 3,
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

// ─── CREDIT_PRICES · the CUSTOMER price (whole credits per unit) ─────────────
//
// This is what quote + settle BILL. It is deliberately SEPARATE from
// ENRICHMENT_PRICES.usdPerUnit (our raw vendor COGS / telemetry). Before this
// split, billing was `ceil(vendorUSD / $0.05)` — i.e. we charged customers our
// cost, rounded, which left ~0% margin on reviews/serp/google_ads/lighthouse
// and negative tails. Whole credits also make the UX honest: "1 credit = 1
// scanned lead" is now literally true, so the per-lead rate is an integer and
// the affordability slider stops using a pessimistic ceil. See
// docs/credits-economics-review-2026-07-02.html.
//
// Schedule (business = per lead, cell = per market):
//   website scan (contacts, +tech rides it)  1 / lead
//   services (AI)                             1 / lead
//   reviews                                   1 / lead
//   site speed (Lighthouse)                   1 / lead
//   AI research                               1 / lead
//   google ads intel                          1 / cell
//   meta ads intel                            3 / cell
//   search / SERP intel                       4 / cell
//
// tech = 0: it rides the one contacts DOM fetch, so a booking-tool goal
// (contacts+tech) is 1 credit/lead, not 2. When a signal declares only tech,
// resolveResearches pulls contacts (which carries the 1 credit).
export const CREDIT_PRICES: Record<EnrichmentType, number> = {
  contacts: 1,
  tech: 0,
  services: 1,
  reviews: 1,
  lighthouse: 1,
  ai_research: 1,
  google_ads: 1,
  meta_ads: 3,
  serp: 4,
};

/** Credits one unit of an enrichment bills (per business or per cell). */
export function creditsPerUnit(enrichment: EnrichmentType): number {
  return CREDIT_PRICES[enrichment];
}

export const ALL_ENRICHMENT_TYPES = Object.keys(
  ENRICHMENT_PRICES,
) as EnrichmentType[];

/**
 * Enrichment families that CANNOT run on a business with no website — they all
 * read the live site (Lighthouse audits it, contacts/tech fingerprint scrape
 * its DOM, services/ai_research read its page text). Enriching a website-less
 * business for any of these just burns a queued job that produces nothing, and
 * mis-scopes the cost (we'd charge for leads we can't actually enrich).
 *
 * The cell-basis families (meta_ads/google_ads/serp) and reviews are NOT here
 * — they're keyed off the business's Google presence, not its website, so a
 * phone-only listing is still a valid target for them.
 *
 * Used to scope an enrich run (and its quote) to website-havers whenever any
 * selected family requires a site. See modules/discovery/enrich-actions.ts.
 */
export const WEBSITE_DEPENDENT: ReadonlySet<EnrichmentType> = new Set([
  "lighthouse",
  "contacts",
  "tech",
  "services",
  "ai_research",
]);

/** True if ANY of the selected families needs a live website to run. */
export function enrichmentNeedsWebsite(
  enrichments: readonly EnrichmentType[],
): boolean {
  return enrichments.some((e) => WEBSITE_DEPENDENT.has(e));
}
