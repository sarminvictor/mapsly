// modules/cost/pricing.ts · canonical, versioned enrichment price list.
//
// Phase 0 of the agency-portal rework. This is the SINGLE source of truth for
// what every on-demand operation costs, so the pre-flight estimator
// (modules/cost/estimate.ts) and the post-hoc cost ledger agree.
//
// Two units of work:
//   - "business" enrichments bill per selected business (contacts, services,
//     tech, reviews, lighthouse, ai_research, google_ads).
//   - "cell"     enrichments bill once per (metro × category) cell, then serve
//     every business in that cell from the cached run (meta_ads, serp).
//
// `upperMultiplier` captures variable-cost endpoints (reviews bill per review
// returned; the contacts AI-email fallback only fires on a fraction of rows).
// The estimator surfaces both the expected `netUsd` and the `upperBoundUsd`;
// the wallet never charges above the upper bound.
//
// Bump PRICE_LIST_VERSION whenever any number here changes — CostEstimate rows
// store the version so a stale 15-min quote can be detected + re-quoted.

import { DATAFORSEO_UNIT_COST_USD } from "@/services/dataforseo/pricing";

// 2026-07-09.2 · REVIEW FIXES — top-up packs repriced above plan rates
//   ($50/1k→$70/1k, $200/5k→$275/5k) so a pack is never cheaper than a plan
//   credit, and APIFY_META_RUN_USD 0.05→0.12 to match real meta COGS (the doc's
//   own $0.12 claim). Bumped so any in-flight quote re-quotes at the corrected
//   meta cost. See docs/billing-repricing-review-2026-07-09.html Parts B3 + F.
// 2026-07-09.1 · REPRICING — CREDIT_PRICES reviews 1→2, lighthouse 1→2,
//   meta_ads 4→12; plan grants + rollover=0 (docs/billing-repricing-2026-07-09).
//   Bumped so any in-flight quote minted under the old schedule re-quotes.
// 2026-07-06.1 · meta_ads 3→4 credits/cell (stealth-rebuild images-on COGS).
// 2026-07-02.2 · billing now runs off CREDIT_PRICES (whole customer credits),
// decoupled from ENRICHMENT_PRICES.usdPerUnit (raw COGS). Any change to either
// table must bump this so in-flight 15-min quotes re-quote.
// (Prior: "2026-07-02.1" WP10-7 re-derived serp/google_ads + walled lighthouse.)
export const PRICE_LIST_VERSION = "2026-07-11.1";

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
 * Monthly plan credit grants. 1 credit = one DELIVERED lead with verified
 * contacts (per CREDIT_PRICES: contacts=1, tech=0). A fully-enriched lead
 * layering reviews (2) + site-speed (2) + AI (1) is 6 credits total
 * (CREDIT_MEANING.fullEnrichment), plus whole-market ad/rank fees once/market
 * (meta_ads=25, serp=4 = 29). See CREDIT_PRICES below — do NOT call a credit a
 * "fully-enriched lead". The free tier is a one-time 50-credit grant (no Stripe
 * subscription); paid tiers re-grant each billing cycle. Keys match the
 * AgencyPlan enum in prisma/schema.prisma. Source of truth:
 * docs/billing-repricing-2026-07-09.html.
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
// Repriced 2026-07-09 (docs/billing-repricing-2026-07-09.html). The enum values
// are the internal grant keys; the DISPLAY names map via PLAN_TIER_MAP:
//   SOLO       → "Starter" $19  → 250    (organic land tier, 1 seat)
//   AGENCY_PRO → "Solo"    $49  → 750    (real entry, advertise, 1 seat)
//   GROWTH     → "Growth"  $99  → 1,800  (3 seats)
//   BOUTIQUE   → "Pro"     $299 → 6,500  (10 seats)
// Grants tightened ~3× from the old numbers so a credit sells at ~$0.05–0.08 vs
// the unified ~$0.012 COGS (§B). AGENCY_PRO is reused (no Prisma enum migration).
export const PLAN_CREDITS: Record<AgencyPlanTier, number> = {
  SOLO: 250,
  GROWTH: 1_800,
  AGENCY_PRO: 750,
  BOUTIQUE: 6_500,
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
// Repriced 2026-07-09 · rollover DROPPED (decision F-3). Set to 0 so
// nextRolloverCredits carries nothing forward — plan credits reset each cycle,
// matching Apollo/ZoomInfo/Instantly (all expire monthly). The rolloverCredits
// bucket + settle draw order stay (always 0), so no schema/settle change.
//
// ⚠ GUARDRAIL before ever setting this > 0 again: the webhook grants a plan on
// BOTH checkout.session.completed (dedupe-keyed on event.id, currentPeriodEnd
// still null) AND customer.subscription.created/invoice.paid (dedupe-keyed on
// periodEnd). Those are DIFFERENT dedupe keys on a first purchase → two grant
// calls. It's harmless today ONLY because grantPlanCredits SETS planCredits
// (not increment) and rollover is 0. Re-enabling rollover without first keying
// the checkout grant on the same period anchor would double-grant the first
// cycle (750 → rolls to 1,500 spendable). See app/api/webhooks/stripe/route.ts
// grantAgencyCreditsFromEvent + modules/cost/server.ts grantPlanCredits.
export const ROLLOVER_CAP_MULTIPLE = 0;

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

/** Display-layer plan keys. `solo` ($49) added 2026-07-09 as the real entry
 *  tier; `scale` keeps its key but displays as "Pro". */
export type PlanKey = "free" | "starter" | "solo" | "growth" | "scale";

/** What one credit means — see CREDIT_PRICES for the per-family schedule. */
export const CREDIT_MEANING = {
  /** Credits for one lead WITH contacts (the delivered unit). */
  contacts: 1,
  /** Credits for one FULLY-enriched lead = contacts + reviews + speed + AI
   *  (1 + 2 + 2 + 1) under the 2026-07-09 unified pricing. */
  fullEnrichment: 6,
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
 * The five canonical plans (Free / Starter / Solo / Growth / Pro), repriced
 * 2026-07-09 (docs/billing-repricing-2026-07-09.html). Headline `withContacts`
 * = credits (1 credit = 1 delivered lead with verified contacts); "fullyEnriched"
 * = floor(credits / 6) (contacts + reviews + speed + AI); `rate` is
 * $ / lead-with-contacts (= priceUsd / monthlyCredits). False claims removed: no
 * rollover, no "deep audit included", Free stripped of never-expire + enrichment
 * framing.
 */
export const PLAN_CARDS: Record<PlanKey, PlanCard> = {
  free: {
    key: "free",
    displayName: "Free",
    priceUsd: 0,
    monthlyCredits: 50,
    oneTime: true,
    fullyEnriched: 8,
    withContacts: 50,
    rate: "up to 50 leads with contacts",
    featured: false,
    features: [
      "Up to 50 leads with verified contacts",
      "Search everywhere we've already mapped",
      "No card required",
    ],
    calc: "Up to 50 leads with verified contacts — search everywhere we've already mapped, no market research needed. Enough to win your first client.",
  },
  starter: {
    key: "starter",
    displayName: "Starter",
    priceUsd: 19,
    monthlyCredits: 250,
    oneTime: false,
    fullyEnriched: 41,
    withContacts: 250,
    rate: "$0.08 / lead with contacts",
    featured: false,
    features: [
      "250 leads with contacts / mo",
      "Open any market",
      "Full enrichment + first-touch",
      "1 seat",
    ],
    calc: "250 leads with contacts, or ~40 fully enriched · your starting point.",
  },
  solo: {
    key: "solo",
    displayName: "Solo",
    priceUsd: 49,
    monthlyCredits: 750,
    oneTime: false,
    fullyEnriched: 125,
    withContacts: 750,
    rate: "$0.07 / lead with contacts",
    featured: true,
    features: [
      "750 leads with contacts / mo",
      "Open any market · full depth",
      "Full enrichment + first-touch",
      "1 seat",
    ],
    calc: "750 leads with contacts, or ~125 fully enriched · the plan most agencies start on.",
  },
  growth: {
    key: "growth",
    displayName: "Growth",
    priceUsd: 99,
    monthlyCredits: 1_800,
    oneTime: false,
    fullyEnriched: 300,
    withContacts: 1_800,
    rate: "$0.055 / lead with contacts",
    featured: false,
    features: [
      "1,800 leads with contacts / mo",
      "Open any market · full depth",
      "Full enrichment + first-touch",
      "3 seats",
    ],
    calc: "1,800 leads with contacts, or ~300 fully enriched · 3 teammates.",
  },
  scale: {
    key: "scale",
    displayName: "Pro",
    priceUsd: 299,
    monthlyCredits: 6_500,
    oneTime: false,
    fullyEnriched: 1_083,
    withContacts: 6_500,
    rate: "$0.046 / lead with contacts",
    featured: false,
    features: [
      "6,500 leads with contacts / mo",
      "Open any market · full depth",
      "Full enrichment + first-touch",
      "10 seats",
      "Priority support",
    ],
    calc: "6,500 leads with contacts, or ~1,080 fully enriched · high-volume prospecting at the lowest rate.",
  },
};

/** Ordered display list (Free → Starter → Solo → Growth → Pro). */
export const PLAN_CARD_ORDER: PlanKey[] = [
  "free",
  "starter",
  "solo",
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
  starter: "SOLO", // $19 → 250
  solo: "AGENCY_PRO", // $49 → 750 (reuses the AGENCY_PRO enum, no migration)
  growth: "GROWTH", // $99 → 1,800
  scale: "BOUTIQUE", // $299 → 6,500
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
 * One-time top-up packs — the pressure valve for running out mid-cycle.
 * Purchased credits land in `AgencyWallet.purchasedCredits` and never expire.
 *
 * Repriced 2026-07-09 (review Part F · top-up inversion): packs now sit ABOVE
 * every plan's per-credit rate ($0.07 / $0.055 vs Pro $0.046 … Starter $0.076),
 * and `startTopUpCheckout` requires an active paid subscription — so a pack is
 * never a cheaper substitute for upgrading, and a Free agency can't stack
 * never-expiring credits without subscribing. Still far under Apollo's $0.20
 * overage (F-7 ceiling).
 */
export const TOPUP_PACKS: TopUpPack[] = [
  {
    key: "pack_1000",
    credits: 1_000,
    priceUsd: 70,
    rate: "$0.07 / credit",
    primary: false,
  },
  {
    key: "pack_5000",
    credits: 5_000,
    priceUsd: 275,
    rate: "$0.055 / credit",
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

/**
 * Apify Meta Ad Library actor run — measured stealth-rebuild cost per cell.
 * 2026-07-09 review: corrected 0.05→0.12 to match the repricing doc's claim.
 * 2026-07-10 CORRECTION: the Apify console showed the REAL per-run cost is
 * ~$0.72–1.22 (residential proxy + images on a 280s/4GB run), mean ~$0.87 — the
 * $0.12 estimate was 7× under, because every AdMarketRun had been booking the
 * $0.02 FALLBACK constant (fixed in services/apify/client.ts). Runtime billing
 * now records the actor's real usage (or an elapsed×memory estimate on a
 * timeout), so this constant only drives the pre-flight quote's netUsd/upperBound
 * + margin telemetry — set to the observed mean so those read honestly. The
 * Phase-5 target-chunking work will drop the per-run cost; revisit then.
 */
export const APIFY_META_RUN_USD = 0.85;

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
    // 90 to MATCH dispatch's buildJobPlan window (dispatch.ts hardcodes 90 for
    // ai_research). The old 30 here over-quoted 31–89-day-old units that the
    // fan-out then SKIPPED_FRESH + refunded — safe direction, but it inflated
    // pre-flight prices and could false-trip insufficient_credits.
    freshnessDays: 90,
  },
  // One Apify run per cell, attributed to all members. upperMultiplier 2
  // reflects the retry/soft-block case (~$0.24) the Meta actor is prone to.
  meta_ads: {
    label: "Meta ads",
    unit: "cell",
    usdPerUnit: APIFY_META_RUN_USD,
    upperMultiplier: 2,
    freshnessDays: 30,
  },
  // B1 · PER-BUSINESS (was per-cell). The collector now calls adsSearch with
  // `target: <business host>` so EVERY returned creative belongs to that domain
  // BY CONSTRUCTION (reliable attribution — no fuzzy name match). One ads_search
  // call per website-having business (depth 40, $0.002); the cheap DfS Live SERP
  // is the whole cost, amortized nowhere — it's a per-lead unit like contacts.
  // (Prior WP10-7 priced this per-cell as adsAdvertisers + adsSearch×1 = $0.004
  // amortized across the cell; the fuzzy per-cell attribution missed most leads.)
  google_ads: {
    label: "Google ads",
    unit: "business",
    usdPerUnit: DATAFORSEO_UNIT_COST_USD.adsSearch,
    upperMultiplier: 1.5,
    freshnessDays: 30,
  },
  // 2026-07-11 · redesigned per-cell SERP (modules/cell-intel/serp.ts): ONE DEEP
  // maps scan (depth ~300, matched by Google CID → a rank for ~every business,
  // not 17) + ONE deeper organic scan (depth 100) + rankedKeywords×3. Maps/organic
  // are priced per-100-results (~$0.002 × pages), so the deeper scans add cents.
  // Real charged cost ≈ serpLocalPack×3pages + serpOrganic×5pages +
  // rankedKeywords×3 ≈ $0.006 + $0.010 + $0.039 ≈ $0.055, amortized across the
  // whole cell. Runtime billing tracks the actual DfS `task.cost`; this only
  // drives the pre-flight quote's netUsd/margin telemetry.
  serp: {
    label: "SERP / search",
    unit: "cell",
    usdPerUnit:
      DATAFORSEO_UNIT_COST_USD.serpLocalPack * 3 +
      DATAFORSEO_UNIT_COST_USD.serpOrganic * 5 +
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
// Schedule (business = per lead, cell = per market) · repriced 2026-07-09:
//   website scan (contacts, +tech rides it)  1 / lead
//   services (AI)                             1 / lead
//   reviews                                   2 / lead
//   site speed (Lighthouse)                   2 / lead
//   AI research                               1 / lead
//   google ads intel                          1 / lead   (B1 · per-business, target-host)
//   meta ads intel                           25 / cell
//   search / SERP intel                       4 / cell
//
// tech = 0: it rides the one contacts DOM fetch, so a booking-tool goal
// (contacts+tech) is 1 credit/lead, not 2. When a signal declares only tech,
// resolveResearches pulls contacts (which carries the 1 credit).
// UNIFIED PRICING 2026-07-09 (docs/billing-repricing-2026-07-09.html §A): every
// research retied to ~$0.01 of COGS = 1 credit, so cost/credit is uniform ~$0.012
// and no family loses money at any plan rate. Three families moved:
//   reviews    1→2 (COGS $0.015 was thin at 1cr)
//   lighthouse 1→2 (blended $0.019, covers the walled ~$0.06 tail)
//   meta_ads   4→12 (real COGS $0.12, up to $0.24 with failures — was $0.03/cr)
// META RE-REPRICE 2026-07-10 (12→25/cell): Apify console showed the real
// per-run cost is ~$0.72–1.22 (residential proxy + images), NOT the $0.12
// estimate — every AdMarketRun had been booking the $0.02 FALLBACK constant, so
// our books under-counted meta ~40×. At 12cr meta was negative-margin even with
// perfect salvage. 25cr/market restores healthy margin; it's ONE charge per
// market (not per lead), so the user impact is small next to per-lead families.
// See docs/run-forensics-dental-2026-07-10.html §G1. Cost recording is fixed in
// the same release so future repricing runs off real telemetry, not the fallback.
export const CREDIT_PRICES: Record<EnrichmentType, number> = {
  contacts: 1,
  tech: 0,
  services: 1,
  reviews: 2,
  lighthouse: 2,
  ai_research: 1,
  google_ads: 1,
  meta_ads: 25,
  // 2026-07-11 · 4→25 (per-cell market fee, parity with meta_ads). The SERP
  // family was redesigned to give EVERY business in the cell a real maps rank
  // (deep CID-matched maps scan) + organic rank, not a head-term snapshot that
  // reached ~17 of 400. It's a whole-market fee like meta_ads → priced the same.
  serp: 25,
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
 * B1 · google_ads is now website-dependent too: the per-business collector keys
 * the ads_search on the business's host (`target: <host>`), so a business with
 * no website has no host to query — the job would produce nothing. The remaining
 * cell-basis families (meta_ads/serp) and reviews are NOT here — they're keyed
 * off the business's Google presence, not its website, so a phone-only listing
 * is still a valid target for them.
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
  "google_ads",
]);

/** True if ANY of the selected families needs a live website to run. The
 *  enrich scope, the workbench display, the CSV export, and the enrichable
 *  count all use THIS rule so "the visible list == the enrichable list". (A
 *  per-family gate that ran reviews for site-less leads in a mixed goal was
 *  tried + reverted 2026-07-10: it billed for leads the view layer never
 *  rendered. The reviews-for-dead-sites asymmetry is a known-minor limitation.) */
export function enrichmentNeedsWebsite(
  enrichments: readonly EnrichmentType[],
): boolean {
  return enrichments.some((e) => WEBSITE_DEPENDENT.has(e));
}
