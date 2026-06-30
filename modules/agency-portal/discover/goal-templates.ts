// goal-templates.ts · the GOAL step's data layer (the "What do you sell?" step).
//
// A GOAL TEMPLATE is a saved bundle of expert signals — picking one activates a
// signal set. Each template's signals are REAL keys from the agency signal
// registry (`modules/signals/agency-signals.ts`), so the templates never drift
// from the registry. SIG_META adds the per-signal presentation layer the
// prototype's `#view-goal` needs (outcome group, plain-English "means", a sales
// "pitch", a "recipe" of inputs, a confidence score, and whether it is an
// expert SIGNAL or a raw DATA field).
//
// Sourced from the prototype's TEMPLATES + SIG_META (docs/portal-prototype.html)
// but bound to the live registry. English-only for now (the app runs
// English-only — see i18n/routing.ts; i18n keys are a follow-up).

import { agencySignals } from "@/modules/signals/agency-signals";
import type { EnrichmentType } from "@/modules/cost/pricing";

/** Outcome buckets the Goal step groups signal cards under. */
export type OutcomeGroup =
  | "growing"
  | "weak-web"
  | "wasting"
  | "reputation"
  | "under"
  | "other";

export const OUTCOME_GROUPS: {
  key: OutcomeGroup;
  label: string;
  value: string;
}[] = [
  {
    key: "growing",
    label: "Growing & worth your time",
    value: "Real, operating businesses with momentum — worth the pitch.",
  },
  {
    key: "weak-web",
    label: "Weak online presence",
    value: "A site or search gap you can fix — concrete upside to sell.",
  },
  {
    key: "wasting",
    label: "Wasting money",
    value: "Spending blind on ads — money on the table, urgent to fix.",
  },
  {
    key: "reputation",
    label: "Reputation at risk",
    value: "Visible reputation cracks they will pay to stop.",
  },
  {
    key: "under",
    label: "Under-instrumented",
    value: "Flying blind — no analytics, no booking, no funnel.",
  },
  { key: "other", label: "Other criteria", value: "Your own added signals." },
];

/** A signal's presentation metadata for the Goal detail panel. */
export interface SigMeta {
  /** Real registry key this card maps to. */
  signalKey: string;
  /** Display title (from the prototype — short, sales-facing). */
  title: string;
  /** Which outcome bucket it groups under. */
  group: OutcomeGroup;
  /** Plain-English "what it means". */
  means: string;
  /** One-line sales pitch (what to tell the customer). */
  pitch: string;
  /** The inputs behind a composite — "how it works". */
  recipe: string[];
  /** 1–3 confidence dots. */
  conf: 1 | 2 | 3;
  /** Expert composite SIGNAL vs raw DATA field. */
  kind: "signal" | "data";
  /** Default comparator + value to seed into the filter when active. */
  comparator: string;
  value: string | number | boolean;
}

/**
 * SIG_META · the curated presentation layer. Each entry references a REAL
 * registry key. The order here is the catalog order for the signal library.
 */
export const SIG_META: Record<string, SigMeta> = {
  operating_business: {
    signalKey: "open_status",
    title: "Operating business",
    group: "growing",
    means:
      "A real business that's currently operating — filters out closed or unverified listings.",
    pitch: "A live business worth your time.",
    recipe: ["open_status = OPEN", "currently operating on Google"],
    conf: 2,
    kind: "signal",
    comparator: "is",
    value: "OPEN",
  },
  has_website: {
    signalKey: "phone_only",
    title: "Has a website",
    group: "weak-web",
    means: "Has a site you can actually improve.",
    pitch: "There's something to redesign.",
    recipe: ["phone-only = no — a website exists"],
    conf: 1,
    kind: "signal",
    comparator: "is_not",
    value: true,
  },
  phone_only: {
    signalKey: "phone_only",
    title: "Phone-only (no website)",
    group: "weak-web",
    means: "Has a phone but no website — the core gap you remove.",
    pitch: "Needs a site built from scratch.",
    recipe: ["has phone", "no website on the listing"],
    conf: 1,
    kind: "signal",
    comparator: "is",
    value: true,
  },
  overdue_redesign: {
    signalKey: "perf_savings_ms",
    title: "Overdue for a redesign",
    group: "weak-web",
    means:
      "A slow, dated or DIY-built site that's costing them bookings — Lighthouse shows real speed headroom.",
    pitch: "A faster site wins back lost mobile customers.",
    recipe: [
      "Lighthouse speed-fix headroom ≥ 2s",
      "DIY platform or dated stack",
    ],
    conf: 3,
    kind: "signal",
    comparator: ">=",
    value: 2000,
  },
  diy_platform: {
    signalKey: "cms_platform",
    title: "Built on DIY platform",
    group: "weak-web",
    means: "Wix / GoDaddy / Squarespace — a tell that no pro built it.",
    pitch: "No professional ever touched this site.",
    recipe: ["CMS platform = Wix / GoDaddy / Squarespace"],
    conf: 2,
    kind: "data",
    comparator: "contains",
    value: "Wix",
  },
  thin_seo: {
    signalKey: "organic_traffic_est",
    title: "Thin on-page SEO",
    group: "weak-web",
    means:
      "Weak on-page SEO and low organic visibility — content + structure upside.",
    pitch: "They should rank for this — and don't.",
    recipe: ["estimated organic visits below the market"],
    conf: 2,
    kind: "signal",
    comparator: "<=",
    value: 50,
  },
  search_visibility: {
    signalKey: "organic_traffic_est",
    title: "Search visibility",
    group: "weak-web",
    means:
      "Below-average organic visibility vs the market — a wide upside pool.",
    pitch: "Quantified organic upside vs their peers.",
    recipe: ["estimated organic visits vs cell median"],
    conf: 2,
    kind: "signal",
    comparator: "<=",
    value: 50,
  },
  low_organic_traffic: {
    signalKey: "organic_traffic_est",
    title: "Low organic traffic",
    group: "weak-web",
    means:
      "Estimated monthly visits below the market — demand they aren't capturing.",
    pitch: "Real demand they're leaving on the table.",
    recipe: ["estimated organic visits < 50/mo"],
    conf: 2,
    kind: "signal",
    comparator: "<=",
    value: 50,
  },
  not_advertising: {
    signalKey: "ad_market_prevalence",
    title: "Not advertising",
    group: "wasting",
    means:
      "Sitting out while peers advertise — the widest opportunity pool in this market.",
    pitch: "Competitors are advertising; they aren't.",
    recipe: ["advertisers in cell ≥ 5", "this business not among them"],
    conf: 2,
    kind: "signal",
    comparator: ">=",
    value: 5,
  },
  competitors_advertising: {
    signalKey: "ad_market_prevalence",
    title: "Competitors are advertising",
    group: "wasting",
    means: "Others in this market run ads — money on the table.",
    pitch: "Their rivals are buying the clicks they're missing.",
    recipe: ["advertisers in cell ≥ 5"],
    conf: 2,
    kind: "signal",
    comparator: ">=",
    value: 5,
  },
  ads_without_pixel: {
    signalKey: "ads_without_pixel",
    title: "Runs Meta ads without a pixel",
    group: "wasting",
    means:
      "Paying for Meta ads with no pixel — can't measure or retarget. Detectable because we hold ad-library + tech data.",
    pitch: "Spending blind — no way to measure or retarget.",
    recipe: ["runs Meta ads", "no Meta Pixel on-site"],
    conf: 3,
    kind: "signal",
    comparator: "is",
    value: true,
  },
  no_analytics: {
    signalKey: "has_analytics",
    title: "Runs Google ads without analytics",
    group: "wasting",
    means: "Running ads with no analytics — flying blind on results.",
    pitch: "No analytics = no idea what's working.",
    recipe: ["no GA4/GTM/Plausible detected"],
    conf: 2,
    kind: "signal",
    comparator: "is",
    value: false,
  },
  meta_video_ads: {
    signalKey: "meta_ad_format_video",
    title: "Runs video/image ads (Meta)",
    group: "wasting",
    means: "Pick the Meta formats they run — a creative/production angle.",
    pitch: "A creative-production upsell on existing spend.",
    recipe: ["at least one active Meta video creative"],
    conf: 2,
    kind: "data",
    comparator: "is",
    value: true,
  },
  reputation_slipping: {
    signalKey: "review_lifecycle",
    title: "Reputation slipping",
    group: "reputation",
    means:
      "Reputation momentum is fading — rating down, replies low, or negatives unanswered.",
    pitch: "Their reputation is leaking, visibly.",
    recipe: ["review lifecycle = DYING / DORMANT", "vs its own history"],
    conf: 3,
    kind: "signal",
    comparator: "is_one_of",
    value: "DYING",
  },
  low_reply_rate: {
    signalKey: "review_lifecycle",
    title: "Low owner reply rate",
    group: "reputation",
    means: "Replies to under 25% of reviews — a reputation gap.",
    pitch: "Customers go ignored in public.",
    recipe: ["owner reply rate < 25%"],
    conf: 2,
    kind: "signal",
    comparator: "is",
    value: "DYING",
  },
  stale_reviews: {
    signalKey: "stale_no_reviews",
    title: "No reviews recently",
    group: "reputation",
    means: "No new review for ~4 months — a fading-reputation lead.",
    pitch: "Their reputation has gone quiet.",
    recipe: ["no new review in ~4 months"],
    conf: 2,
    kind: "signal",
    comparator: "is",
    value: true,
  },
  reviews_percentile: {
    signalKey: "reviews_vs_cell_pct",
    title: "Review momentum",
    group: "growing",
    means:
      "Where this business's review count ranks among peers in the same metro × category.",
    pitch: "Target the trajectory you want, not a snapshot.",
    recipe: ["review count percentile vs cell"],
    conf: 3,
    kind: "signal",
    comparator: "<=",
    value: 25,
  },
  no_booking: {
    signalKey: "gbp_no_booking",
    title: "No online booking tool",
    group: "under",
    means:
      "No Google booking link and no on-site booking tool — phone-only friction.",
    pitch: "Every booking goes through a phone call.",
    recipe: ["no Google booking link", "no on-site booking widget"],
    conf: 2,
    kind: "signal",
    comparator: "is",
    value: true,
  },
  flying_blind: {
    signalKey: "has_meta_pixel",
    title: "Flying blind",
    group: "under",
    means: "No analytics, no pixel — under-instrumented across the funnel.",
    pitch: "No data anywhere — a full-funnel rebuild.",
    recipe: ["no Meta Pixel", "no analytics"],
    conf: 2,
    kind: "signal",
    comparator: "is",
    value: false,
  },
  stale_social: {
    signalKey: "social_channel_count",
    title: "Stale social profile",
    group: "under",
    means: "A thin or abandoned social presence vs active peers.",
    pitch: "Their social presence is going stale.",
    recipe: ["social channels found ≤ 1"],
    conf: 1,
    kind: "data",
    comparator: "<=",
    value: 1,
  },
};

/** Resolve a signal-meta entry by its prototype key (the SIG_META key). */
export function sigMeta(metaKey: string): SigMeta | undefined {
  return SIG_META[metaKey];
}

/** A filter row inside a template (refers to a SIG_META entry by key). */
export interface TemplateFilter {
  /** SIG_META key. */
  key: string;
  /** Whether this filter is on by default when the template is picked. */
  on: boolean;
  /** Why it's in the bundle — shown in the card. */
  why: string;
}

export interface GoalTemplate {
  /** Stable key. */
  key: string;
  icon: string;
  /** Short sales title ("Website redesign"). */
  title: string;
  /** Category tag chip ("Web" / "Search" / "Ads" …). */
  category: string;
  /** Who it finds. */
  who: string;
  /** The outcome framing. */
  out: string;
  /** The signal bundle (SIG_META keys + on/why). */
  filters: TemplateFilter[];
}

/**
 * GOAL_TEMPLATES · the 11 bundles. Each filter's `key` indexes SIG_META, which
 * binds to a real registry signal. Picking a template clones these into the
 * working GOAL state (the single source of truth for the active signal set).
 */
export const GOAL_TEMPLATES: GoalTemplate[] = [
  {
    key: "website",
    icon: "🌐",
    title: "Website redesign",
    category: "Web",
    who: "Active local businesses on a slow, dated or DIY-built site",
    out: "Doing well, but a slow site is costing them bookings",
    filters: [
      {
        key: "operating_business",
        on: true,
        why: "Real, operating businesses only — the baseline for every goal.",
      },
      {
        key: "has_website",
        on: true,
        why: "You redesign sites — they need one to improve.",
      },
      {
        key: "overdue_redesign",
        on: true,
        why: "A slow, dated or DIY site — widen now, narrow later.",
      },
      {
        key: "thin_seo",
        on: false,
        why: "On-page SEO is weak — extra technical wins to quote.",
      },
      {
        key: "diy_platform",
        on: false,
        why: "Wix / GoDaddy / Squarespace — a tell that no pro built it.",
      },
    ],
  },
  {
    key: "seo",
    icon: "🔍",
    title: "Local SEO",
    category: "Search",
    who: "Businesses invisible in the local 3-pack while peers rank",
    out: "Should rank, doesn't — clear upside you can sell",
    filters: [
      {
        key: "operating_business",
        on: true,
        why: "Real, operating businesses only — the baseline for every goal.",
      },
      { key: "has_website", on: true, why: "They need a site to rank." },
      {
        key: "search_visibility",
        on: true,
        why: "Below-average organic visibility vs the market — wide upside.",
      },
      {
        key: "thin_seo",
        on: false,
        why: "On-page SEO is weak — concrete technical fixes to quote.",
      },
    ],
  },
  {
    key: "ads",
    icon: "📣",
    title: "Paid ads",
    category: "Ads",
    who: "Businesses wasting ad spend or sitting out while rivals run ads",
    out: "Money on the table — easy to frame, urgent to fix",
    filters: [
      {
        key: "operating_business",
        on: true,
        why: "Real, operating businesses only — the baseline for every goal.",
      },
      {
        key: "not_advertising",
        on: true,
        why: "Sitting out while peers advertise — the widest pool.",
      },
      {
        key: "competitors_advertising",
        on: false,
        why: "Others in this market run ads — money on the table.",
      },
      {
        key: "ads_without_pixel",
        on: false,
        why: "Paying for Meta ads with no pixel — can't measure or retarget.",
      },
      {
        key: "no_analytics",
        on: false,
        why: "Running ads with no analytics — flying blind on results.",
      },
      {
        key: "meta_video_ads",
        on: false,
        why: "Pick the Meta formats they run — a creative angle.",
      },
    ],
  },
  {
    key: "reviews",
    icon: "⭐",
    title: "Reputation",
    category: "Reviews",
    who: "Businesses whose reputation is leaking — slipping, unanswered",
    out: "Visible reputation problems they'll pay to stop",
    filters: [
      {
        key: "operating_business",
        on: true,
        why: "Real, operating businesses only — the baseline for every goal.",
      },
      {
        key: "reputation_slipping",
        on: true,
        why: "Any reputation crack — rating down, low replies, or unanswered negatives.",
      },
      {
        key: "low_reply_rate",
        on: false,
        why: "Replies to under 25% of reviews — a reputation gap.",
      },
      {
        key: "stale_reviews",
        on: false,
        why: "No new reviews recently — a fading reputation.",
      },
    ],
  },
  {
    key: "booking",
    icon: "📅",
    title: "Booking tool",
    category: "SaaS",
    who: "Phone-only businesses with no online booking",
    out: "Obvious friction to remove — a clean SaaS pitch",
    filters: [
      {
        key: "operating_business",
        on: true,
        why: "Real, operating businesses only — the baseline for every goal.",
      },
      {
        key: "no_booking",
        on: true,
        why: "Phone-only — the core gap you remove.",
      },
      {
        key: "has_website",
        on: true,
        why: "Needs a site to embed booking.",
      },
    ],
  },
  {
    key: "social",
    icon: "📸",
    title: "Social media",
    category: "Social",
    who: "Active businesses with a stale or abandoned social presence",
    out: "A clean retainer pitch around consistent posting",
    filters: [
      {
        key: "operating_business",
        on: true,
        why: "Real, operating businesses only — the baseline for every goal.",
      },
      {
        key: "stale_social",
        on: true,
        why: "A thin or abandoned social presence vs active peers.",
      },
    ],
  },
  {
    key: "content",
    icon: "✏️",
    title: "Content / blog",
    category: "Search",
    who: "Sites with thin or no content while traffic stays flat",
    out: "An SEO-content retainer angle with room to grow",
    filters: [
      {
        key: "operating_business",
        on: true,
        why: "Real, operating businesses only — the baseline for every goal.",
      },
      {
        key: "thin_seo",
        on: true,
        why: "Weak on-page SEO — content + structure upside.",
      },
      {
        key: "low_organic_traffic",
        on: false,
        why: "Estimated monthly visits below the market — demand they aren't capturing.",
      },
      {
        key: "search_visibility",
        on: false,
        why: "Organic visibility vs the cell — the quantified upside.",
      },
    ],
  },
  {
    key: "fullservice",
    icon: "🧰",
    title: "Full-service",
    category: "Bundle",
    who: "Active businesses weak on several fronts at once",
    out: "Bundle the pitch — site + ads + SEO in one deal",
    filters: [
      {
        key: "operating_business",
        on: true,
        why: "Real, operating businesses only — the baseline for every goal.",
      },
      { key: "has_website", on: true, why: "A site to work across." },
      {
        key: "overdue_redesign",
        on: true,
        why: "Any web weakness — bundle the fix.",
      },
      {
        key: "reputation_slipping",
        on: false,
        why: "Any reputation crack — add it to the bundle.",
      },
      {
        key: "search_visibility",
        on: false,
        why: "Organic visibility vs the cell — SEO upside for the deal.",
      },
      {
        key: "not_advertising",
        on: false,
        why: "Sitting out on paid — add an ads line to the bundle.",
      },
    ],
  },
  {
    key: "reactivation",
    icon: "♻️",
    title: "Reactivation",
    category: "Bundle",
    who: "Businesses that went quiet — stalled reviews, dated site",
    out: "A win-back / refresh pitch with clear momentum loss",
    filters: [
      {
        key: "operating_business",
        on: true,
        why: "Real, operating businesses only — the baseline for every goal.",
      },
      {
        key: "reviews_percentile",
        on: true,
        why: "Stalled review growth — momentum lost, ripe for a win-back.",
      },
    ],
  },
  {
    key: "email",
    icon: "📧",
    title: "Email & CRM",
    category: "Bundle",
    who: "Busy businesses flying blind — no analytics, no booking, DIY site",
    out: "Under-instrumented — a full-funnel CRM pitch",
    filters: [
      {
        key: "operating_business",
        on: true,
        why: "Real, operating businesses only — the baseline for every goal.",
      },
      {
        key: "flying_blind",
        on: true,
        why: "No analytics, no pixel — under-instrumented.",
      },
      {
        key: "no_booking",
        on: true,
        why: "Leads slip through — instrument the funnel.",
      },
    ],
  },
  {
    key: "custom",
    icon: "⚙️",
    title: "Custom",
    category: "Custom",
    who: "Start blank — pick exactly the signals you want",
    out: "Fully your own criteria",
    filters: [
      {
        key: "operating_business",
        on: true,
        why: "Real, operating businesses only — the baseline for every goal.",
      },
      {
        key: "has_website",
        on: false,
        why: "Add the signals that matter to you.",
      },
    ],
  },
];

export function templateByKey(key: string): GoalTemplate | undefined {
  return GOAL_TEMPLATES.find((t) => t.key === key);
}

/**
 * Signal → enrichment family. The active signal set determines which
 * enrichment families a discovery's businesses must be enriched with so the
 * filters can be applied. Used by the Preview/Discover cost estimate and the
 * Enriching step's stage rollup. Maps the registry `category` + signal source
 * to a real `EnrichmentType` (modules/cost/pricing.ts).
 */
// Fallback when a signal's source doesn't name an enrichment family directly
// (e.g. profile signals from the listing/discovery). Keyed by registry category.
const CATEGORY_TO_FAMILY: Partial<Record<string, EnrichmentType>> = {
  profile: "contacts",
  website: "tech",
  reviews: "reviews",
  search: "serp",
  ads: "meta_ads",
};

export function familiesForSignals(signalKeys: string[]): EnrichmentType[] {
  const fams = new Set<EnrichmentType>();
  for (const key of signalKeys) {
    const def = agencySignals.find((s) => s.key === key);
    if (!def) continue;
    const src = def.source;
    if (src.startsWith("computed-from-contacts")) fams.add("contacts");
    else if (src.startsWith("tech-fingerprint")) fams.add("tech");
    else if (src === "dataforseo:lighthouse") fams.add("lighthouse");
    else if (src.startsWith("computed-from-reviews")) fams.add("reviews");
    else if (src === "dataforseo:serp") fams.add("serp");
    else if (src === "meta-ad-library") fams.add("meta_ads");
    else if (src === "computed-from-snapshots") {
      // ads_without_pixel needs both meta + tech
      fams.add("meta_ads");
      fams.add("tech");
    } else {
      const cat = CATEGORY_TO_FAMILY[def.category];
      if (cat) fams.add(cat);
    }
  }
  return Array.from(fams);
}
