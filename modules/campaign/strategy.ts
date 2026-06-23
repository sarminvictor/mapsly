// modules/campaign/strategy.ts · demand-intent → research strategy (Phase 8)
//
// The agency tells us what they SELL ("I sell websites" / "booking SaaS" /
// "reputation management"); we translate that into a concrete search strategy:
//   - recommendedCategories  — verticals worth targeting for this offer
//   - recommendedEnrichments — which enrichments the leads need (drives cost)
//   - signalWeights          — relative importance of each signal for ranking
//   - suggestedFilters       — concrete Hunter filter rows to seed the search
//   - rationale              — plain-English "why" lines for the UI
//
// RULES-FIRST + PURE. This function does NO I/O and NO AI: a deterministic
// keyword classifier maps the free-text intent to one of a handful of intent
// buckets, each with a hand-tuned strategy. (A gpt-5.4-nano refinement pass —
// e.g. inferring a niche vertical — is a documented LATER step; it may only add
// to this baseline, never replace the deterministic core. Keeping the mapper
// pure means it is fully unit-testable with no mocks.)
//
// See:
//   - modules/signals/registry.ts   — the signal keys referenced in filters
//   - modules/cost/pricing.ts        — EnrichmentType union
//   - prisma/schema.prisma           — Campaign / ResearchPlan / StrategyTemplate

import type { EnrichmentType } from "@/modules/cost/pricing";

/** A concrete Hunter filter row this strategy seeds the search with. */
export interface SuggestedFilter {
  signalKey: string;
  /** Comparator literal from modules/signals/comparators.ts. */
  comparator: "<" | "<=" | "=" | ">=" | ">" | "between" | "missing" | "present";
  value: number | boolean | string;
}

/** Free-text intent the agency provides. */
export interface CampaignStrategyInput {
  /** What the agency is selling (the primary classifier input). */
  sellingWhat: string;
  /** Who they sell to (optional refinement). */
  buyerIcp?: string;
  /** Pain points they solve (optional refinement). */
  painPoints?: string;
}

/** The resolved strategy. */
export interface CampaignStrategy {
  recommendedCategories: string[];
  recommendedEnrichments: EnrichmentType[];
  /** signalKey → weight (0–1, relative importance for lead ranking). */
  signalWeights: Record<string, number>;
  suggestedFilters: SuggestedFilter[];
  rationale: string[];
}

/**
 * The intent buckets we classify selling-intent into. `general` is the
 * fallback when nothing matches — a broad reachability-first strategy.
 */
type IntentBucket =
  | "website"
  | "booking_saas"
  | "reputation"
  | "ads_ppc"
  | "seo"
  | "general";

/** Keyword → bucket rules. First matching bucket wins (order = priority). */
const INTENT_RULES: { bucket: IntentBucket; keywords: string[] }[] = [
  {
    bucket: "booking_saas",
    keywords: [
      "booking",
      "scheduling",
      "appointment",
      "calendar",
      "reservation",
      "saas",
      "software",
      "intake",
    ],
  },
  {
    bucket: "reputation",
    keywords: [
      "review",
      "reputation",
      "reviews",
      "ratings",
      "feedback",
      "testimonial",
    ],
  },
  {
    bucket: "ads_ppc",
    keywords: [
      "ppc",
      "google ads",
      "meta ads",
      "paid",
      "ad management",
      "advertising",
      "adwords",
    ],
  },
  {
    bucket: "seo",
    keywords: [
      "seo",
      "search engine",
      "local search",
      "ranking",
      "rank",
      "3-pack",
      "organic",
    ],
  },
  {
    bucket: "website",
    keywords: [
      "website",
      "web design",
      "web site",
      "site",
      "landing page",
      "redesign",
      "marketing",
      "digital marketing",
      "web dev",
      "wordpress",
    ],
  },
];

/** Normalize free text for keyword matching. */
function norm(s: string | undefined): string {
  return (s ?? "").toLowerCase();
}

/**
 * Classify the selling-intent into a bucket. Uses sellingWhat primarily,
 * falling back to painPoints/buyerIcp for additional signal. Deterministic:
 * the first rule whose keyword appears (scanning rule order) wins.
 */
export function classifyIntent(input: CampaignStrategyInput): IntentBucket {
  const haystack = [
    norm(input.sellingWhat),
    norm(input.painPoints),
    norm(input.buyerIcp),
  ].join(" ");
  for (const rule of INTENT_RULES) {
    if (rule.keywords.some((k) => haystack.includes(k))) return rule.bucket;
  }
  return "general";
}

/** Per-bucket strategy. Hand-tuned; the signalKeys are real registry keys. */
const STRATEGIES: Record<IntentBucket, Omit<CampaignStrategy, "rationale">> = {
  // Selling websites / web design → target businesses with a weak or missing
  // web presence: no/slow site, missing schema, no ads (under-marketed).
  website: {
    recommendedCategories: ["med-spa", "restaurant", "auto-body", "dental"],
    recommendedEnrichments: ["lighthouse", "tech", "contacts"],
    signalWeights: {
      lighthouse_performance: 0.9,
      lcp_seconds: 0.8,
      has_website: 0.7,
      has_localbusiness_schema: 0.5,
      review_count: 0.3,
    },
    suggestedFilters: [
      { signalKey: "lighthouse_performance", comparator: "<", value: 50 },
      { signalKey: "lcp_seconds", comparator: ">=", value: 4 },
      { signalKey: "review_count", comparator: ">=", value: 20 },
    ],
  },
  // Selling booking / scheduling SaaS → target businesses with NO booking
  // widget but enough demand (reviews) + ad spend leaking to phone calls.
  booking_saas: {
    recommendedCategories: ["med-spa", "salon", "dental", "auto-body"],
    recommendedEnrichments: ["tech", "contacts", "reviews"],
    signalWeights: {
      has_booking_widget: 1,
      has_booking_cta_above_fold: 0.8,
      has_active_meta_ads: 0.6,
      review_count: 0.5,
    },
    suggestedFilters: [
      { signalKey: "has_booking_widget", comparator: "=", value: false },
      {
        signalKey: "has_booking_cta_above_fold",
        comparator: "=",
        value: false,
      },
      { signalKey: "review_count", comparator: ">=", value: 25 },
    ],
  },
  // Selling reputation / review management → target businesses with unanswered
  // negatives, low reply rate, or a dying review pace.
  reputation: {
    recommendedCategories: ["med-spa", "restaurant", "dental", "salon"],
    recommendedEnrichments: ["reviews", "contacts"],
    signalWeights: {
      unanswered_count: 0.9,
      unanswered_1star_count: 1,
      reply_rate: 0.8,
      last_review_age_days: 0.5,
    },
    suggestedFilters: [
      { signalKey: "unanswered_count", comparator: ">=", value: 3 },
      { signalKey: "reply_rate", comparator: "<", value: 25 },
      { signalKey: "last_review_age_days", comparator: ">=", value: 60 },
    ],
  },
  // Selling PPC / ad management → target businesses NOT currently advertising
  // (or advertising poorly) with enough revenue proxy to afford retainers.
  ads_ppc: {
    recommendedCategories: ["med-spa", "dental", "auto-body", "restaurant"],
    recommendedEnrichments: ["meta_ads", "google_ads", "contacts"],
    signalWeights: {
      has_active_meta_ads: 0.9,
      has_active_google_ads: 0.9,
      review_count: 0.6,
      rating: 0.4,
    },
    suggestedFilters: [
      { signalKey: "has_active_meta_ads", comparator: "=", value: false },
      { signalKey: "has_active_google_ads", comparator: "=", value: false },
      { signalKey: "review_count", comparator: ">=", value: 30 },
    ],
  },
  // Selling SEO / local search → target businesses ranking poorly in the local
  // pack with thin organic visibility.
  seo: {
    recommendedCategories: ["med-spa", "dental", "auto-body", "restaurant"],
    recommendedEnrichments: ["serp", "lighthouse", "contacts"],
    signalWeights: {
      local_pack_rank: 0.9,
      keyword_count_ranked: 0.7,
      lighthouse_seo: 0.6,
      review_count: 0.4,
    },
    suggestedFilters: [
      { signalKey: "in_local_pack", comparator: "=", value: false },
      { signalKey: "keyword_count_ranked", comparator: "<", value: 10 },
      { signalKey: "review_count", comparator: ">=", value: 20 },
    ],
  },
  // Fallback: a broad reachability-first strategy.
  general: {
    recommendedCategories: ["med-spa", "restaurant", "dental"],
    recommendedEnrichments: ["contacts", "reviews"],
    signalWeights: {
      review_count: 0.6,
      rating: 0.4,
      has_website: 0.3,
    },
    suggestedFilters: [
      { signalKey: "review_count", comparator: ">=", value: 15 },
      { signalKey: "has_email", comparator: "=", value: true },
    ],
  },
};

/** Human-readable rationale per bucket. */
const RATIONALE: Record<IntentBucket, string[]> = {
  website: [
    "You sell websites, so we target businesses whose current site is slow, thin, or missing key markup.",
    "We require some review volume so the prospect is an active operation worth pitching.",
    "Lighthouse + tech enrichment surfaces the concrete 'we can make your site faster' angle.",
  ],
  booking_saas: [
    "You sell booking software, so we target businesses with no online booking widget today.",
    "We weight ad spend high — paying for ads with no booking is measurable waste you can fix.",
    "Tech enrichment confirms the booking gap; reviews confirm there's demand to capture.",
  ],
  reputation: [
    "You sell reputation management, so we target businesses with unanswered negatives and a low reply rate.",
    "A stale review pace (no recent reviews) is a second strong trigger for this offer.",
    "Reviews enrichment is required to read reply rate + unanswered counts.",
  ],
  ads_ppc: [
    "You manage paid ads, so we target businesses that are NOT advertising yet but could afford to.",
    "Review count is a revenue proxy — enough volume means they can sustain a retainer.",
    "Meta + Google ads enrichment confirms the absence of current campaigns.",
  ],
  seo: [
    "You sell SEO, so we target businesses ranking poorly in the local pack with thin keyword coverage.",
    "SERP enrichment confirms current ranking; Lighthouse SEO surfaces on-page gaps.",
    "Review count keeps the list to active, pitchable operations.",
  ],
  general: [
    "We couldn't pin a specific service, so this is a broad, reachability-first strategy.",
    "We require an email and some review volume so every lead is contactable and active.",
    "Refine the campaign's 'selling what' field for a sharper, signal-driven strategy.",
  ],
};

/**
 * Map a campaign's free-text intent to a concrete, costed research strategy.
 * PURE + deterministic — no I/O, no AI. The classifier (classifyIntent) covers
 * ≥5 selling-intents (website, booking SaaS, reputation, PPC, SEO) plus a
 * general fallback.
 */
export function mapCampaignToStrategy(
  input: CampaignStrategyInput,
): CampaignStrategy {
  const bucket = classifyIntent(input);
  const base = STRATEGIES[bucket];
  return {
    recommendedCategories: [...base.recommendedCategories],
    recommendedEnrichments: [...base.recommendedEnrichments],
    signalWeights: { ...base.signalWeights },
    suggestedFilters: base.suggestedFilters.map((f) => ({ ...f })),
    rationale: [...RATIONALE[bucket]],
  };
}

/**
 * A reusable intent → strategy template. Seeds the StrategyTemplate table so
 * the agency UI can offer one-click starting points ("Sell websites",
 * "Sell booking software"). The shapes here mirror StrategyTemplate columns.
 */
export interface StrategyTemplateSeed {
  slug: string;
  name: string;
  sellingWhat: string;
  recommendedCategories: string[];
  recommendedEnrichments: EnrichmentType[];
  signalWeights: Record<string, number>;
}

/**
 * The seed set of StrategyTemplate shapes. Derived from the same deterministic
 * strategies so templates and live mapping never drift.
 */
export const STRATEGY_TEMPLATE_SEEDS: StrategyTemplateSeed[] = [
  (() => {
    const s = mapCampaignToStrategy({ sellingWhat: "website redesign" });
    return {
      slug: "sell-websites",
      name: "Sell websites",
      sellingWhat: "website redesign",
      recommendedCategories: s.recommendedCategories,
      recommendedEnrichments: s.recommendedEnrichments,
      signalWeights: s.signalWeights,
    };
  })(),
  (() => {
    const s = mapCampaignToStrategy({ sellingWhat: "booking scheduling SaaS" });
    return {
      slug: "sell-booking-saas",
      name: "Sell booking software",
      sellingWhat: "booking scheduling SaaS",
      recommendedCategories: s.recommendedCategories,
      recommendedEnrichments: s.recommendedEnrichments,
      signalWeights: s.signalWeights,
    };
  })(),
  (() => {
    const s = mapCampaignToStrategy({ sellingWhat: "reputation management" });
    return {
      slug: "sell-reputation",
      name: "Sell reputation management",
      sellingWhat: "reputation management",
      recommendedCategories: s.recommendedCategories,
      recommendedEnrichments: s.recommendedEnrichments,
      signalWeights: s.signalWeights,
    };
  })(),
];
