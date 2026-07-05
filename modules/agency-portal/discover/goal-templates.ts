// goal-templates.ts · the GOAL step's data layer (the "What do you sell?" step).
//
// A GOAL TEMPLATE is a saved bundle of expert signals — picking one activates a
// signal set. Each template's signals are REAL keys from the agency signal
// registry (`modules/signals/agency-signals.ts`), so the templates never drift
// from the registry. SIG_META adds the per-signal presentation layer the
// prototype's `#view-goal` needs (outcome group, plain-English "means", a sales
// "pitch", a "recipe" of inputs, a confidence score, whether it is an expert
// SIGNAL or a raw DATA field, the per-card tuning `setting`, the data-backing
// `status`, and the canonical `registryKey` it evaluates against).
//
// Sourced from the prototype's TEMPLATES + SIG_META (docs/portal-prototype.html
// lines ~9290–10091, the full 47-signal library) but bound to the live
// registry. English-only for now (the app runs English-only — see
// i18n/routing.ts; i18n keys are a follow-up).
//
// PHASE A1 (signal-alignment): this file ports all 47 prototype signals + their
// tune `setting` descriptors. The new `setting`/`status`/`registryKey` fields
// are additive + optional so GoalStep.tsx / the card UI / the picker keep
// working unchanged (the card UX that renders `setting` is the next phase).

import type { EnrichmentType } from "@/modules/cost/pricing";
import { researchesForSignals, type Research } from "./researches";

/** Outcome buckets the Goal step groups signal cards under. */
export type OutcomeGroup =
  | "growing"
  | "weak-web"
  | "wasting"
  | "reputation"
  | "under"
  | "other";

/**
 * AUDIT C4 · signals that describe WHO you're targeting (a real, reachable,
 * operating business) rather than a PROBLEM to pitch. They belong in the goal's
 * "qualifiers" filters, not the Pain-points column — "Operating business" and
 * "Has a website" are not pain chips. The workbench pains fallback excludes
 * these so a matched qualifier never reads as a pitch angle.
 */
export const QUALIFIER_SIGNAL_KEYS: ReadonlySet<string> = new Set([
  "operating_business",
  "has_website",
  "has_phone",
  "has_email",
  "has_instagram",
  "is_owner_claimed_in_mapsly",
  "category_count",
]);

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

// ─────────────────────────────────────────────────────────────────────────────
// Per-signal tune SETTING · the discriminated union the card UX renders.
//
// Faithfully mirrors the prototype's `sigSetting()` shapes (docs/portal-
// prototype.html ~10101). The prototype expresses options as positional arrays
// (`["wix","Wix","desc"]`); here they're typed objects. A missing `setting`
// field = the prototype's "none" (no control). The card defaults to a plain
// strictness slider when `setting` is omitted, matching `sigSetting()`'s
// fallback.
// ─────────────────────────────────────────────────────────────────────────────

/** loose ↔ strict slider (the most common control). */
export interface StrictnessSetting {
  type: "strictness";
  label?: string;
  def?: "loose" | "balanced" | "strict";
}

/** 5-band radio, multi-select (bottom10 / below / around / above / top10). */
export interface ScaleSetting {
  type: "scale";
  label?: string;
  /** The selectable bands, in order. */
  bands: ScaleBand[];
  /** Bands selected by default. */
  def?: string[];
}

/** One band of a {@link ScaleSetting}. */
export interface ScaleBand {
  value: string;
  label: string;
  desc?: string;
}

/** N-option select with per-option descriptions (single-select). */
export interface ModeSetting {
  type: "mode";
  label?: string;
  options: ModeOption[];
  /** The default option value. */
  def: string;
}

/** One option of a {@link ModeSetting}. */
export interface ModeOption {
  value: string;
  label: string;
  desc?: string;
}

/** Multi-select platform chips (booking tools, CMS, ad formats, themes…). */
export interface PlatformSetting {
  type: "platform";
  label?: string;
  options: PlatformOption[];
  /** Offer a "None" choice (e.g. "no booking tool"). */
  allowNone?: boolean;
  /** Offer an "Any" choice (matches any platform). */
  allowAny?: boolean;
  /** Platforms selected by default. */
  def?: string[];
}

/** One option of a {@link PlatformSetting}. */
export interface PlatformOption {
  value: string;
  label: string;
  desc?: string;
}

/** has / hasn't toggle (presence of a thing). */
export interface PresenceSetting {
  type: "presence";
  label?: string;
  /** Label for the "has it" side. */
  hasLabel?: string;
  /** Label for the "doesn't have it" side. */
  hasntLabel?: string;
  def?: "has" | "hasnt";
  /** Optional one-line hint per side, shown under the toggle. */
  presenceHint?: { has?: string; hasnt?: string };
}

/** The 6 setting shapes a signal card can render. */
export type SignalSetting =
  | StrictnessSetting
  | ScaleSetting
  | ModeSetting
  | PlatformSetting
  | PresenceSetting;

/** The 5 reusable market-relative bands shared by every `scale` setting. */
const MARKET_BANDS: ScaleBand[] = [
  {
    value: "bottom10",
    label: "Bottom 10%",
    desc: "Only the weakest ~10% on this metric — smallest, highest-need pool.",
  },
  {
    value: "below",
    label: "Below avg",
    desc: "Everyone below the market median — a wide pool of under-performers (good place to start).",
  },
  {
    value: "around",
    label: "Around avg",
    desc: "Mid-market — typical performers, neither weak nor strong.",
  },
  {
    value: "above",
    label: "Above avg",
    desc: "Above the median — already doing well on this.",
  },
  {
    value: "top10",
    label: "Top 10%",
    desc: "Market leaders (~top 10%) — usually an upsell, not a rescue.",
  },
];

/**
 * Data-backing status — drives the live / computed / needs-data badge.
 *  - `ready`   · real per-business value already computed (prototype "real")
 *  - `deriv`   · inputs stored, the signal is derived/assembled on read
 *  - `roadmap` · needs data we don't collect yet (shown for planning)
 * Defaults to "ready" when omitted (matches the prototype's `sigStatus()`).
 */
export type SignalStatus = "deriv" | "roadmap" | "ready";

/** A signal's presentation metadata for the Goal detail panel. */
export interface SigMeta {
  /**
   * Real registry key this card maps to (legacy field; drives
   * `familiesForSignals`). Equals `registryKey` when a binding exists, else a
   * self-reference for signals with no registry equivalent yet.
   */
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
  /** The per-card tuning control (the prototype's 6 setting types). */
  setting?: SignalSetting;
  /** Data-backing status (live / derived / roadmap). */
  status?: SignalStatus;
  /**
   * The `modules/signals/registry.ts` key this binds to for evaluation, per the
   * signal-gap matrix. Omitted when no product registry equivalent exists yet
   * (the future eval layer treats those as roadmap-only).
   */
  registryKey?: string;
  /**
   * The research families this signal's evaluation DEPENDS ON — every
   * enrichment the workflow must run so this signal can be computed. REQUIRED:
   * making it non-optional forces every signal to declare its researches, so a
   * signal can never silently resolve to "no data collected" (the bug that made
   * ~48% of the old registry-lookup resolver's signals uncollectable).
   *
   * Derivation rules (see researches.ts header + the signal-gap matrix):
   *   - One family per the signal's registry `source`
   *     (computed-from-contacts→contacts, tech-fingerprint→tech,
   *     dataforseo:lighthouse→lighthouse, computed-from-reviews/dataforseo:
   *     reviews→reviews, dataforseo:serp→serp, meta-ad-library→meta_ads,
   *     google-ads-transparency→google_ads, services→services, AI reads→
   *     ai_research).
   *   - Composites list EVERY family their recipe reads
   *     (e.g. ads_without_pixel → [meta_ads, tech]).
   *   - Discovery-only signals (known from the Google/Maps listing at $0) → [].
   *   - playbook-backed signals → the EVIDENCE families the playbook reads
   *     ([tech, lighthouse, reviews]).
   *   - Roadmap/uncomputed signals STILL declare the researches their data WOULD
   *     need (so the workflow collects honestly; the eval returns null until the
   *     computation lands — never a fake value). A signal whose only honest
   *     research is something we don't collect declares [] and relies on its
   *     eval returning null.
   *
   * Dependency chains (e.g. tech rides the contacts DOM fetch) are expanded by
   * `researchesForSignals` via RESEARCH_DEPS — declare only the LEAF family the
   * signal reads; the resolver pulls in its prerequisites.
   */
  researches: Research[];
  /** When a composite, whether its conditions match "all" or "any". */
  defaultMatch?: "all" | "any";
}

/**
 * SIG_META · the curated presentation layer — the full 47-signal prototype
 * library (+ the goal-only "Phone-only" entry = 48). Each entry mirrors a
 * prototype SIG_META title and, where one exists, binds to a real registry key.
 * The order here is the catalog order for the signal library.
 */
export const SIG_META: Record<string, SigMeta> = {
  // ───────────────────────────── growing & worth your time ──────────────────
  reviews_percentile: {
    signalKey: "reviews_vs_cell_pct",
    registryKey: "reviews_vs_cell_pct",
    // reviews_vs_cell_pct source=computed-from-snapshots; recipe reads review
    // velocity/trend → reviews. The cell percentile is auto-computed by
    // recomputeCellMetric once reviews land.
    researches: ["reviews"],
    title: "Review momentum",
    group: "growing",
    means:
      "Where the business is in its review trend — growing now, losing momentum, in a seasonal lull, or stalled.",
    pitch: "Target the trajectory you want, not a fixed snapshot.",
    recipe: [
      "review velocity last 30d",
      "velocity vs prior 90d",
      "12-month review trend",
    ],
    conf: 3,
    kind: "signal",
    comparator: "is",
    value: "growing",
    status: "deriv",
    setting: {
      type: "mode",
      label: "State",
      options: [
        {
          value: "growing",
          label: "Growing now",
          desc: "Adding reviews faster than last quarter — momentum, good timing to pitch growth.",
        },
        {
          value: "losing",
          label: "Losing momentum",
          desc: "Review pace is slowing vs before — slipping, a wake-up-call angle.",
        },
        {
          value: "seasonal",
          label: "Seasonal peak coming",
          desc: "In a seasonal lull now but trends up soon — reach them before their peak.",
        },
        {
          value: "stalled",
          label: "Stalled",
          desc: "No new reviews in a while — went quiet, ripe for a win-back.",
        },
      ],
      def: "growing",
    },
  },
  operating_business: {
    signalKey: "open_status",
    registryKey: "open_status",
    // open_status source=dataforseo:maps — known from Discovery at $0.
    researches: [],
    title: "Operating business",
    group: "growing",
    means:
      "A real, owner-claimed business that's currently operating — filters out dead or unverified listings.",
    pitch: "A live business worth your time.",
    recipe: [
      "owner-claimed listing",
      "currently operating — not temporarily or permanently closed",
    ],
    conf: 2,
    kind: "signal",
    comparator: "is",
    value: "OPEN",
    status: "ready",
    setting: { type: "strictness" },
  },
  reviews_trending: {
    signalKey: "reviews_trending",
    // recipe = review velocity_90d ↑ — needs the reviews pull (Cluster B).
    researches: ["reviews"],
    title: "Reviews trending up",
    group: "growing",
    means: "Getting more reviews lately — momentum, not decline.",
    pitch: "Growing, not dying — a healthy prospect.",
    recipe: ["velocity_90d ↑ vs prior 90d"],
    conf: 2,
    kind: "data",
    comparator: "is",
    value: true,
  },
  open_now: {
    signalKey: "open_now",
    // open_now is on the Google/Maps listing — known from Discovery at $0.
    researches: [],
    title: "Open now / active hours",
    group: "growing",
    means: "Currently operating — not dormant or seasonal.",
    pitch: "Active, not abandoned.",
    recipe: ["open_now = yes"],
    conf: 1,
    kind: "data",
    comparator: "is",
    value: true,
  },
  years_in_business: {
    signalKey: "years_on_google",
    registryKey: "years_on_google",
    // years_on_google source=dataforseo:maps — known from Discovery at $0.
    researches: [],
    title: "Years in business",
    group: "growing",
    means: "Established operator that can carry a retainer.",
    pitch: "Stable budget for an ongoing engagement.",
    recipe: ["site_age_years ≥ 3"],
    conf: 1,
    kind: "data",
    comparator: ">=",
    value: 3,
  },
  multi_location: {
    signalKey: "multi_location",
    // Roadmap — chain clustering across listings; computed over Discovery data
    // (locations ≥ 2), no enrichment to collect. Eval returns null until built.
    researches: [],
    title: "Multi-location",
    group: "growing",
    means: "Runs two or more locations — bigger budget, bigger deal.",
    pitch: "Larger account, larger contract.",
    recipe: ["locations ≥ 2"],
    conf: 2,
    kind: "data",
    comparator: ">=",
    value: 2,
    status: "roadmap",
  },
  market_position: {
    signalKey: "msi_percentile",
    registryKey: "msi_percentile",
    // msi_percentile source=computed-from-snapshots; recipe = rating + reviews
    // vs cell percentile → reviews (the cell metric auto-computes the rank).
    researches: ["reviews"],
    title: "Market position",
    group: "growing",
    means:
      "Where this business ranks in its market on rating + reviews — measured vs the cell, not raw numbers.",
    pitch: "Target the tier you want — leaders to upsell, laggards to rescue.",
    recipe: ["rating + reviews vs cell percentile"],
    conf: 3,
    kind: "signal",
    comparator: "is_one_of",
    value: "below",
    status: "deriv",
    setting: {
      type: "scale",
      label: "Position vs market",
      bands: MARKET_BANDS,
      def: ["below", "bottom10"],
    },
  },

  // ───────────────────────────── weak online presence ───────────────────────
  overdue_redesign: {
    signalKey: "perf_savings_ms",
    registryKey: "perf_savings_ms",
    // perf_savings_ms source=dataforseo:lighthouse. Recipe also reads site age
    // (unknown is allowed), so Lighthouse is the only family to collect.
    researches: ["lighthouse"],
    title: "Overdue for a redesign",
    group: "weak-web",
    means:
      "A slow, dated site hurting an otherwise healthy business — your strongest web pitch.",
    pitch: "Your strongest web pitch — they're doing well despite the site.",
    recipe: ["lighthouse_perf < 50", "site age ≥ 3y (or unknown)"],
    conf: 3,
    kind: "signal",
    comparator: ">=",
    value: 2000,
    status: "ready",
    setting: { type: "strictness" },
  },
  slow_site: {
    signalKey: "lighthouse_performance",
    registryKey: "lighthouse_performance",
    // lighthouse_performance source=dataforseo:lighthouse.
    researches: ["lighthouse"],
    title: "Slow site (Lighthouse)",
    group: "weak-web",
    means: "Mobile performance below your threshold — pages crawl on phones.",
    pitch: "Slow site = lost bookings before the page loads.",
    recipe: ["lighthouse_perf < 50 (mobile)"],
    conf: 3,
    kind: "data",
    comparator: "<",
    value: 50,
  },
  weak_seo: {
    signalKey: "seo_score",
    registryKey: "seo_score",
    // seo_score source=dataforseo:lighthouse (LighthouseAudit.seo) — LIVE via
    // resolveLighthouseField; the field is already hydrated.
    researches: ["lighthouse"],
    title: "Weak on-page SEO",
    group: "weak-web",
    means:
      "Lighthouse on-page SEO score below your threshold — missing meta tags, crawlability, or mobile-friendliness.",
    pitch: "Concrete on-page SEO fixes with a measurable before/after.",
    recipe: ["lighthouse SEO score < 70"],
    conf: 2,
    kind: "data",
    comparator: "<",
    value: 70,
    status: "ready",
    setting: { type: "strictness" },
  },
  has_website: {
    signalKey: "has_website",
    registryKey: "has_website",
    // has_website source=dataforseo:maps — known from Discovery at $0.
    researches: [],
    title: "Has a website",
    group: "weak-web",
    means: "Has a site you can actually improve.",
    pitch: "There's something to redesign.",
    recipe: ["has_website = yes"],
    conf: 1,
    kind: "data",
    comparator: "is",
    value: true,
    status: "ready",
    setting: {
      type: "presence",
      label: "Website",
      hasLabel: "Has one",
      hasntLabel: "Doesn’t have one",
      def: "has",
      presenceHint: {
        has: "‘Has one’ = a site you can improve.",
        hasnt: "‘Doesn’t have one’ = needs one built.",
      },
    },
  },
  phone_only: {
    signalKey: "phone_only",
    registryKey: "phone_only",
    // phone_only source=dataforseo:maps (has phone + no website on the listing)
    // — known from Discovery at $0.
    researches: [],
    title: "Phone-only (no website)",
    group: "weak-web",
    means: "Has a phone but no website — the core gap you remove.",
    pitch: "Needs a site built from scratch.",
    recipe: ["has phone", "no website on the listing"],
    conf: 1,
    kind: "signal",
    comparator: "is",
    value: true,
    status: "ready",
  },
  diy_platform: {
    signalKey: "cms_platform",
    registryKey: "cms_platform",
    // cms_platform source=tech-fingerprint → tech (rides the contacts scan via
    // RESEARCH_DEPS, so the resolver pulls in contacts too).
    researches: ["tech"],
    title: "Built on DIY platform",
    group: "weak-web",
    means: "Wix / GoDaddy / Squarespace — a tell that no pro built it.",
    pitch: "DIY build = no pro ever touched it.",
    recipe: ["cms_platform ∈ {Wix, GoDaddy, Squarespace}"],
    conf: 2,
    kind: "data",
    comparator: "contains",
    value: "Wix",
    status: "deriv",
    setting: {
      type: "platform",
      label: "Built on",
      options: [
        {
          value: "wix",
          label: "Wix",
          desc: "…built on Wix — a no-code/DIY builder, usually no pro involved.",
        },
        {
          value: "squarespace",
          label: "Squarespace",
          desc: "…built on Squarespace — a no-code/DIY builder, usually no pro involved.",
        },
        {
          value: "wordpress",
          label: "WordPress",
          desc: "…built on WordPress.",
        },
        { value: "shopify", label: "Shopify", desc: "…built on Shopify." },
        {
          value: "godaddy",
          label: "GoDaddy",
          desc: "…built on GoDaddy — a no-code/DIY builder, usually no pro involved.",
        },
        { value: "webflow", label: "Webflow", desc: "…built on Webflow." },
        {
          value: "other",
          label: "Other builder",
          desc: "Any other site builder we detect.",
        },
      ],
      def: [
        "wix",
        "squarespace",
        "wordpress",
        "shopify",
        "godaddy",
        "webflow",
        "other",
      ],
    },
  },
  site_age_3y: {
    signalKey: "site_age_3y",
    // Roadmap — true site age is WHOIS/Wayback (Cluster H), a data source we
    // don't collect. No enrichment family fits; eval returns null until built.
    researches: [],
    title: "Website 3+ years old",
    group: "weak-web",
    means: "Older sites are likelier overdue for a refresh.",
    pitch: "Dated build, ripe for a rebuild.",
    recipe: ["site_age_years ≥ 3"],
    conf: 1,
    kind: "data",
    comparator: ">=",
    value: 3,
    status: "roadmap",
  },
  losing_mobile: {
    signalKey: "lighthouse_performance",
    registryKey: "lighthouse_performance",
    // mobile Lighthouse perf + Core Web Vitals (LCP/CLS/INP) — all Lighthouse.
    researches: ["lighthouse"],
    title: "Losing mobile customers",
    group: "weak-web",
    means:
      "Mobile performance is critical-low and the site fails Core Web Vitals on phones.",
    pitch: "They're losing bookings on phones, today.",
    recipe: [
      "mobile Lighthouse perf < 40",
      "fails Core Web Vitals (LCP/CLS/INP)",
    ],
    conf: 3,
    kind: "signal",
    comparator: "<",
    value: 40,
    status: "ready",
    setting: { type: "strictness" },
  },
  invisible_locally: {
    signalKey: "local_pack_rank",
    registryKey: "local_pack_rank",
    // local_pack_rank source=dataforseo:serp; recipe = not in 3-pack + organic
    // traffic below cell median — both from the SERP scan.
    researches: ["serp"],
    title: "Invisible locally",
    group: "weak-web",
    means:
      "Not in the local 3-pack and below the cell's median organic traffic.",
    pitch: "They should rank and don't — local-SEO upside.",
    recipe: ["not in local 3-pack", "organic traffic below cell median"],
    conf: 3,
    kind: "signal",
    comparator: ">",
    value: 3,
    status: "ready",
    setting: { type: "strictness" },
  },
  not_in_local_pack: {
    signalKey: "in_local_pack",
    registryKey: "in_local_pack",
    // in_local_pack source=dataforseo:serp.
    researches: ["serp"],
    title: "Not in local 3-pack",
    group: "weak-web",
    means: "Invisible in Google Maps where customers actually look.",
    pitch: "Off the map — a clear ranking gap.",
    recipe: ["local_pack_rank > 3"],
    conf: 2,
    kind: "data",
    comparator: "is",
    value: false,
  },
  low_organic_traffic: {
    signalKey: "organic_traffic_est",
    registryKey: "organic_traffic_est",
    // organic_traffic_est source=dataforseo:serp (BusinessKeyword etv).
    researches: ["serp"],
    title: "Low organic traffic",
    group: "weak-web",
    means: "Estimated monthly visits below your threshold.",
    pitch: "Demand exists but they aren't capturing it.",
    recipe: ["organic_traffic_est < 400/mo"],
    conf: 2,
    kind: "data",
    comparator: "<=",
    value: 50,
    status: "ready",
    setting: {
      type: "scale",
      label: "Traffic vs market",
      bands: MARKET_BANDS,
      def: ["below", "bottom10"],
    },
  },
  thin_seo: {
    signalKey: "organic_traffic_est",
    registryKey: "organic_traffic_est",
    // AMBIGUOUS: the registry binding is organic_traffic_est (serp), but the
    // recipe is on-page SEO — title/meta missing, no schema, Lighthouse SEO < 80
    // — which is Lighthouse. We collect BOTH so whichever the eval reads has its
    // data; the honest superset never under-collects.
    researches: ["serp", "lighthouse"],
    title: "Thin on-page SEO",
    group: "weak-web",
    means:
      "Weak on-page SEO — missing titles/meta, no structured data, and/or a low Lighthouse SEO score.",
    pitch: "Fast SEO wins they'll feel.",
    recipe: [
      "title/meta missing",
      "no schema markup",
      "Lighthouse SEO score < 80",
    ],
    conf: 2,
    kind: "signal",
    comparator: "<=",
    value: 50,
    status: "ready",
    setting: { type: "strictness" },
  },
  search_visibility: {
    signalKey: "organic_traffic_est",
    registryKey: "organic_traffic_est",
    // recipe = organic rank + traffic vs cell → the SERP scan.
    researches: ["serp"],
    title: "Search visibility",
    group: "weak-web",
    means:
      "Where they sit on organic visibility — rank + estimated traffic vs the cell.",
    pitch: "Quantified upside you can sell.",
    recipe: ["organic rank + traffic vs cell"],
    conf: 3,
    kind: "signal",
    comparator: "is_one_of",
    value: "below",
    status: "deriv",
    setting: {
      type: "scale",
      label: "Visibility vs market",
      bands: MARKET_BANDS,
      def: ["below", "bottom10"],
    },
  },
  losing_rankings: {
    signalKey: "rank_drop_last_30d",
    registryKey: "rank_drop_last_30d",
    // rank_drop_last_30d source=computed-from-snapshots; recipe = rank_trend_90d
    // from our keyword rank history → the SERP scan (BusinessKeyword isDown).
    researches: ["serp"],
    title: "Losing rankings",
    group: "weak-web",
    means:
      "Ranking trend — share of tracked keywords where the position dropped over 90 days (from our keyword rank history).",
    pitch: "Urgency — they're losing ground right now.",
    recipe: ["rank_trend_90d = down"],
    conf: 2,
    kind: "data",
    comparator: ">=",
    value: 1,
    status: "ready",
    setting: {
      type: "presence",
      label: "Ranking trend",
      hasLabel: "Losing positions",
      hasntLabel: "Stable or gaining",
      def: "has",
      presenceHint: {
        has: "‘Losing positions’ = slipping in search right now — an urgency hook.",
        hasnt:
          "‘Stable or gaining’ = holding ground — less urgent, more of an upsell.",
      },
    },
  },
  branded_only_traffic: {
    signalKey: "branded_organic_rank",
    registryKey: "branded_organic_rank",
    // branded_organic_rank source=dataforseo:serp (brand-query share).
    researches: ["serp"],
    title: "Branded-only traffic",
    group: "weak-web",
    means:
      "Shows up in search almost only for its own brand name — little/no category-term ranking (from SERP brand-query share).",
    pitch: "Huge untapped non-brand demand.",
    recipe: ["ranks only for brand terms"],
    conf: 2,
    kind: "data",
    comparator: "is",
    value: true,
    // DEAD against real data → roadmap: cell-intel scans only CATEGORY keywords,
    // so hasBrandQuery is always false and this never fires (signal-eval.ts:633).
    // Marked roadmap so the library stops advertising a signal that can't fire
    // until a branded-query SERP scan is funded.
    status: "roadmap",
    setting: {
      type: "presence",
      label: "Visibility",
      hasLabel: "Branded-only",
      hasntLabel: "Ranks for category too",
      def: "has",
      presenceHint: {
        has: "‘Branded-only’ = only found by name — huge untapped non-brand demand.",
        hasnt:
          "‘Ranks for category too’ = already pulls category searches — less SEO upside.",
      },
    },
  },
  no_ssl: {
    signalKey: "no_https",
    registryKey: "no_https",
    // no_https source=dataforseo:lighthouse (LighthouseAudit.isOnHttps).
    researches: ["lighthouse"],
    title: "No SSL / insecure site",
    group: "weak-web",
    means: "Site isn't served over HTTPS.",
    pitch: "Trust + Google-penalty fix.",
    recipe: ["https = no"],
    conf: 1,
    kind: "data",
    comparator: "is",
    value: true,
    status: "roadmap",
    setting: {
      type: "presence",
      label: "HTTPS",
      hasLabel: "Insecure (no SSL)",
      hasntLabel: "Secure",
      def: "has",
      presenceHint: {
        has: "‘Insecure (no SSL)’ = no HTTPS — a trust + Google-penalty fix.",
        hasnt: "‘Secure’ = already on HTTPS — nothing to fix here.",
      },
    },
  },
  stale_social: {
    signalKey: "social_channel_count",
    registryKey: "social_channel_count",
    // social_channel_count source=computed-from-contacts (social links found by
    // the DOM/contacts scan).
    researches: ["contacts"],
    title: "Thin / no social presence",
    group: "weak-web",
    means: "Few or no social profiles linked — looks inactive online.",
    pitch: "A near-empty social footprint is an easy upgrade pitch.",
    recipe: ["social profiles linked <= 1"],
    conf: 2,
    kind: "data",
    comparator: "<=",
    value: 1,
    setting: { type: "strictness" },
  },
  has_email_contact: {
    signalKey: "email_count",
    registryKey: "email_count",
    // email_count source=computed-from-contacts (Contact EMAIL rows). LIVE —
    // resolves via resolveContactSignal → c.emailCount (signal-eval.ts:721).
    // Closes "I can't even find the email in the library": a deliverable inbox
    // is the single highest-value contact for outreach.
    researches: ["contacts"],
    title: "Has an email contact",
    group: "growing",
    means:
      "At least one email captured for the business — a way to reach the owner directly.",
    pitch: "A deliverable inbox is the fastest path to a reply.",
    recipe: ["emails found >= 1"],
    conf: 2,
    kind: "data",
    comparator: ">=",
    value: 1,
    status: "ready",
    setting: { type: "strictness" },
  },

  // ───────────────────────────── wasting money ──────────────────────────────
  ads_without_pixel: {
    signalKey: "ads_without_pixel",
    registryKey: "ads_without_pixel",
    // Composite: running Meta ads (meta_ads) + no Meta pixel on-site (tech).
    // Needs BOTH families — the unique cross-data signal the matrix calls out.
    researches: ["meta_ads", "tech"],
    title: "Runs Meta ads without a pixel",
    group: "wasting",
    means:
      "Paying for Meta ads with no Meta pixel — can't measure or retarget.",
    pitch: "Paying for ads they cannot measure or retarget.",
    recipe: ["running Meta ads", "no Meta pixel"],
    conf: 3,
    kind: "signal",
    comparator: "is",
    value: true,
    status: "roadmap",
  },
  no_analytics: {
    signalKey: "has_analytics",
    registryKey: "has_analytics",
    // AMBIGUOUS: registry binding is has_analytics (tech-fingerprint → tech),
    // but the title/recipe is "running GOOGLE ads + no analytics". The "running
    // Google ads" half needs google_ads. We collect both so the full composite
    // can be honestly evaluated (the eval today reads has_analytics; the ads
    // half lands with Cluster A). Decision: superset over under-collecting.
    researches: ["tech", "google_ads"],
    title: "Runs Google ads without analytics",
    group: "wasting",
    means: "Running Google ads with no analytics — flying blind on results.",
    pitch: "Can't tie a single dollar to a booking.",
    recipe: ["running Google ads", "no analytics installed"],
    conf: 3,
    kind: "signal",
    comparator: "is",
    value: false,
    status: "roadmap",
    setting: { type: "strictness" },
  },
  not_advertising: {
    signalKey: "ad_market_prevalence",
    registryKey: "ad_market_prevalence",
    // ad_market_prevalence source=meta-ad-library (cell ad run; ad_count=0).
    researches: ["meta_ads"],
    title: "Not advertising",
    group: "wasting",
    means: "No Meta/Google ads detected while peers run them.",
    pitch: "Money on the table their rivals are taking.",
    recipe: ["ad_count = 0"],
    conf: 2,
    kind: "data",
    comparator: ">=",
    value: 5,
  },
  competitors_advertising: {
    signalKey: "ad_market_prevalence",
    registryKey: "ad_market_prevalence",
    // ad_market_prevalence source=meta-ad-library (cell ad run; competitor_ad
    // count > 0).
    researches: ["meta_ads"],
    title: "Competitors are advertising",
    group: "wasting",
    means: "Others in this market run ads — proven demand for paid.",
    pitch: "Their competitors are buying the clicks.",
    recipe: ["competitor_ad_count > 0"],
    conf: 2,
    kind: "data",
    comparator: ">=",
    value: 5,
  },
  no_tracking_pixel: {
    signalKey: "has_meta_pixel",
    registryKey: "has_meta_pixel",
    // has_meta_pixel source=tech-fingerprint → tech.
    researches: ["tech"],
    title: "No tracking pixel",
    group: "wasting",
    means: "No pixel installed — can't measure conversions if they start.",
    pitch: "Blind to what's working.",
    recipe: ["has_meta_pixel = no"],
    conf: 2,
    kind: "data",
    comparator: "is",
    value: false,
  },
  stale_ad_creative: {
    signalKey: "ads_age_days",
    registryKey: "ads_age_days",
    // ads_age_days source=meta-ad-library (AdLibraryEntry.startedAt).
    researches: ["meta_ads"],
    title: "Stale ad creative",
    group: "wasting",
    means: "Same ads running 60+ days — fatigue, room to optimize.",
    pitch: "Tired creative leaking budget.",
    recipe: ["ad_creative_age > 60d"],
    conf: 1,
    kind: "data",
    comparator: ">",
    value: 60,
  },
  many_ad_creatives: {
    signalKey: "meta_ad_count",
    registryKey: "meta_ad_count",
    // meta_ad_count source=meta-ad-library.
    researches: ["meta_ads"],
    title: "Many active ad creatives",
    group: "wasting",
    means: "Running 5+ live ads — clearly has budget.",
    pitch: "Proven spender worth a pitch.",
    recipe: ["ad_count ≥ 5"],
    conf: 1,
    kind: "data",
    comparator: ">=",
    value: 5,
  },
  meta_video_ads: {
    signalKey: "meta_ad_format_video",
    registryKey: "meta_ad_format_video",
    // meta_ad_format_video source=meta-ad-library (AdLibraryEntry.displayFormat).
    researches: ["meta_ads"],
    title: "Runs video/image ads (Meta)",
    group: "wasting",
    means: "Which Meta ad formats they run — video, image, carousel or text.",
    pitch: "Creative/production angle for ad sellers.",
    recipe: ["ad_format in set"],
    conf: 2,
    kind: "data",
    comparator: "is",
    value: true,
    status: "ready",
    setting: {
      type: "platform",
      label: "Ad formats",
      options: [
        {
          value: "video",
          label: "Video",
          desc: "Running video ads — a creative/production angle.",
        },
        { value: "image", label: "Image", desc: "Running static image ads." },
        { value: "carousel", label: "Carousel", desc: "Running carousel ads." },
        {
          value: "text",
          label: "Text",
          desc: "Text-only ads — likely DIY creative.",
        },
      ],
      allowNone: false,
      def: ["video", "image"],
    },
  },
  ads_homepage_landing: {
    signalKey: "ad_landing_pages_count",
    registryKey: "ad_landing_pages_count",
    // ad_landing_pages_count source=meta-ad-library (the ad library landing URL).
    researches: ["meta_ads"],
    title: "Ads point at homepage",
    group: "wasting",
    means:
      "Their ads' landing URL is the homepage, not a dedicated page (from the ad library landing URL).",
    pitch: "Quick CRO win on spend they already make.",
    recipe: ["ad_landing = homepage"],
    conf: 2,
    kind: "data",
    comparator: "is",
    value: true,
    status: "ready",
    setting: {
      type: "presence",
      label: "Ad landing",
      hasLabel: "Points at homepage",
      hasntLabel: "Has a landing page",
      def: "has",
      presenceHint: {
        has: "‘Points at homepage’ = wasting ad clicks — a quick CRO win.",
        hasnt:
          "‘Has a landing page’ = already sending ads to a dedicated page.",
      },
    },
  },

  // ───────────────────────────── reputation at risk ─────────────────────────
  reputation_slipping: {
    signalKey: "review_lifecycle",
    registryKey: "review_lifecycle",
    // Composite over reviews: rating_trend_90d ↓ + owner_reply_rate < 25% +
    // aged unanswered ≤2★ — every input comes from the reviews pull.
    researches: ["reviews"],
    title: "Reputation slipping",
    group: "reputation",
    means:
      "Rating trend is down over 90 days, the owner replies to under 25% of reviews, and there's an aged unanswered ≤2-star review.",
    pitch: "Their reputation is leaking — a reputation-management pitch.",
    recipe: [
      "rating_trend_90d ↓",
      "owner_reply_rate < 25%",
      "unanswered ≤2★ aged > 14d",
    ],
    conf: 3,
    kind: "signal",
    comparator: "is_one_of",
    value: "DYING",
    status: "deriv",
    setting: { type: "strictness" },
  },
  low_reply_rate: {
    signalKey: "review_lifecycle",
    registryKey: "review_lifecycle",
    // owner_reply_rate < 25% — from the reviews pull.
    researches: ["reviews"],
    title: "Low owner reply rate",
    group: "reputation",
    means: "Replies to under 25% of reviews — a visible reputation gap.",
    pitch: "Customers see they don't respond.",
    recipe: ["owner_reply_rate < 25%"],
    conf: 2,
    kind: "data",
    comparator: "is",
    value: "DYING",
  },
  unanswered_1star: {
    signalKey: "unanswered_1star_count",
    registryKey: "unanswered_1star_count",
    // unanswered_1star_count source=computed-from-reviews.
    researches: ["reviews"],
    title: "Unanswered 1★ reviews",
    group: "reputation",
    means: "Negative reviews sitting without an owner response.",
    pitch: "Bad reviews festering in public.",
    recipe: ["unanswered_1star ≥ 1"],
    conf: 2,
    kind: "data",
    comparator: ">=",
    value: 1,
  },
  rating_slipping: {
    signalKey: "rating_slipping",
    // recipe = rating_trend_90d down — from the reviews pull / snapshots.
    researches: ["reviews"],
    title: "Rating slipping",
    group: "reputation",
    means: "Average star rating trending down over 90 days.",
    pitch: "The trend line is going the wrong way.",
    recipe: ["rating_trend_90d = down"],
    conf: 2,
    kind: "data",
    comparator: "is",
    value: true,
  },
  stale_reviews: {
    signalKey: "stale_no_reviews",
    registryKey: "stale_no_reviews",
    // stale_no_reviews source=computed-from-reviews (no new review ~4mo).
    researches: ["reviews"],
    title: "Reviews stalled",
    group: "reputation",
    means: "No new reviews in 90+ days — momentum lost.",
    pitch: "They've gone quiet — a win-back angle.",
    recipe: ["new_reviews_90d = 0"],
    conf: 2,
    kind: "data",
    comparator: "is",
    value: true,
  },
  recurring_complaint_theme: {
    signalKey: "has_negative_theme",
    registryKey: "has_negative_theme",
    // has_negative_theme source=computed-from-reviews (NLP over review text).
    researches: ["reviews"],
    title: "Recurring complaint theme",
    group: "reputation",
    means:
      "A theme that keeps coming up in negative reviews (wait times, billing, staff…).",
    pitch: "Name the exact problem in your outreach.",
    recipe: ["review theme in negatives"],
    conf: 2,
    kind: "signal",
    comparator: "is_one_of",
    value: "wait",
    // DEAD against real data → roadmap: NLP theme extraction over review text is
    // not wired (has_negative_theme never populated), so this never fires.
    // Marked roadmap so the library stops advertising it until review-NLP ships.
    status: "roadmap",
    setting: {
      type: "platform",
      label: "Theme",
      options: [
        {
          value: "wait",
          label: "Wait times",
          desc: "Customers keep flagging slow waits — a scheduling/ops angle.",
        },
        {
          value: "billing",
          label: "Billing/price",
          desc: "Complaints about billing or price — a transparency angle.",
        },
        {
          value: "staff",
          label: "Staff/rudeness",
          desc: "Complaints about staff or service — a training/culture angle.",
        },
        {
          value: "results",
          label: "Results/quality",
          desc: "Complaints about results or quality — a delivery angle.",
        },
        {
          value: "booking",
          label: "Booking/scheduling",
          desc: "Complaints about booking or scheduling — a friction-fix angle.",
        },
      ],
      allowNone: false,
      def: ["wait", "billing", "staff"],
    },
  },
  reputation_fire: {
    signalKey: "reputation_fire",
    // recipe = negative_spike (burst of 1–2★ in a short window) — from reviews.
    researches: ["reviews"],
    title: "Reputation fire",
    group: "reputation",
    means:
      "A burst of 1–2★ reviews in a short window — something just went wrong.",
    pitch: "Time-sensitive reputation rescue.",
    recipe: ["negative_spike = yes"],
    conf: 2,
    kind: "signal",
    comparator: "is",
    value: true,
    status: "deriv",
    setting: { type: "strictness" },
  },

  // ───────────────────────────── under-instrumented ─────────────────────────
  flying_blind: {
    signalKey: "has_meta_pixel",
    registryKey: "has_meta_pixel",
    // Composite: no analytics + no Meta pixel — both are tech-fingerprint reads,
    // so one tech scan covers the whole signal.
    researches: ["tech"],
    title: "Flying blind",
    group: "under",
    means:
      "No analytics and no Meta pixel — under-instrumented, can't see what's working.",
    pitch: "Under-instrumented — a full-service opportunity.",
    recipe: ["no analytics", "no Meta pixel"],
    conf: 3,
    kind: "signal",
    comparator: "is",
    value: false,
    status: "roadmap",
    defaultMatch: "any",
    setting: { type: "strictness" },
  },
  no_booking: {
    signalKey: "has_booking_widget",
    registryKey: "has_booking_widget",
    // AUDIT C1 (2026-07-04): re-bound from gbp_no_booking (the GBP "Book" boolean,
    // false for ~every SMB) to has_booking_widget (the tech fingerprint). The
    // card's chips target ON-SITE booking tools (Calendly/Acuity/Vagaro/Mindbody/
    // Square/Boulevard); the old binding matched those tool names against a
    // BOOLEAN → 0 results. The verdict is now computed by `noBookingVerdict`
    // (signal-eval.ts) off the detected booking-tool NAME (which lives in
    // BusinessTech.name and is now surfaced as HydratedTech.bookingName), so a
    // phone-only business with no widget correctly matches. Needs tech.
    researches: ["tech"],
    title: "No online booking tool",
    group: "under",
    means: "Phone-only — friction vs competitors with instant booking.",
    pitch: "Booking friction costs them customers.",
    recipe: ["booking_tool = none"],
    conf: 2,
    kind: "data",
    comparator: "is",
    value: true,
    status: "deriv",
    setting: {
      type: "platform",
      label: "Booking tool",
      options: [
        { value: "calendly", label: "Calendly", desc: "…using Calendly." },
        { value: "acuity", label: "Acuity", desc: "…using Acuity." },
        { value: "vagaro", label: "Vagaro", desc: "…using Vagaro." },
        { value: "mindbody", label: "Mindbody", desc: "…using Mindbody." },
        { value: "square", label: "Square", desc: "…using Square." },
        { value: "boulevard", label: "Boulevard", desc: "…using Boulevard." },
      ],
      allowNone: true,
      allowAny: true,
      def: ["calendly", "acuity", "vagaro", "mindbody", "square", "boulevard"],
    },
  },
  compliance_risk: {
    signalKey: "compliance_gap",
    registryKey: "compliance_gap",
    // compliance_gap source=playbook → the EVIDENCE families the playbook reads.
    // The recipe spans HIPAA tracking-pixel (tech), ADA a11y failures
    // (lighthouse), privacy/cookie gaps (tech) — and playbooks auto-run post-
    // enrichment needing tech + lighthouse + reviews evidence. Collect all three.
    researches: ["tech", "lighthouse", "reviews"],
    title: "Legal & compliance risk",
    group: "under",
    means:
      "Potential legal exposure worth checking — HIPAA tracking, ADA accessibility, privacy/cookie gaps.",
    pitch: "Exposure worth checking — a credible risk-framed opener.",
    recipe: [
      "tracking pixel on a booking/intake (PHI) page — HIPAA",
      "serious ADA accessibility failures",
      "no privacy policy",
      "no cookie consent",
    ],
    conf: 3,
    kind: "signal",
    comparator: "is_not",
    value: "",
    status: "roadmap",
    defaultMatch: "any",
    setting: { type: "strictness" },
  },
  chat_widget: {
    signalKey: "chat_widget",
    // Live-chat tool detected on the site — a tech-fingerprint DOM read.
    researches: ["tech"],
    title: "Chat widget",
    group: "under",
    means: "Live-chat tool on the site.",
    pitch: "Conversion/automation angle.",
    recipe: ["chat widget detected"],
    conf: 1,
    kind: "data",
    comparator: "is",
    value: true,
    status: "roadmap",
    setting: {
      type: "platform",
      label: "Chat tool",
      options: [
        { value: "intercom", label: "Intercom", desc: "…using Intercom." },
        { value: "drift", label: "Drift", desc: "…using Drift." },
        { value: "tawk", label: "tawk.to", desc: "…using tawk.to." },
        { value: "hubspot", label: "HubSpot", desc: "…using HubSpot." },
        {
          value: "custom",
          label: "Custom",
          desc: "…using a custom chat tool.",
        },
      ],
      allowNone: true,
      allowAny: true,
      def: ["intercom", "drift", "tawk"],
    },
  },
  ecommerce: {
    signalKey: "ecommerce",
    // Online store / payment platform detected on the site — a tech DOM read.
    researches: ["tech"],
    title: "E-commerce / payments",
    group: "under",
    means: "Online store or payment platform in use.",
    pitch: "Store-builder / payments pitch.",
    recipe: ["ecommerce platform detected"],
    conf: 1,
    kind: "data",
    comparator: "is",
    value: true,
    status: "roadmap",
    setting: {
      type: "platform",
      label: "Platform",
      options: [
        { value: "shopify", label: "Shopify", desc: "…using Shopify." },
        { value: "woo", label: "WooCommerce", desc: "…using WooCommerce." },
        { value: "stripe", label: "Stripe", desc: "…using Stripe." },
        { value: "square", label: "Square", desc: "…using Square." },
        {
          value: "custom",
          label: "Custom",
          desc: "…using a custom store/payments setup.",
        },
      ],
      allowNone: true,
      allowAny: true,
      def: ["shopify", "woo", "stripe", "square"],
    },
  },

  // ───────────────────────────── other criteria ─────────────────────────────
  service_gap: {
    signalKey: "service_gap",
    // recipe = service prevalence gap → the services taxonomy extraction (the
    // cell prevalence is auto-recomputed once services land).
    researches: ["services"],
    title: "Service gap vs market",
    group: "other",
    means: "Missing a high-value service most peers in the cell offer.",
    pitch: "Concrete expansion advice.",
    recipe: ["service prevalence gap"],
    conf: 2,
    kind: "signal",
    comparator: "is",
    value: "miss1",
    status: "deriv",
    setting: {
      type: "mode",
      label: "Service gap",
      options: [
        {
          value: "miss1",
          label: "Missing 1+ common service",
          desc: "Missing at least one service most peers offer — the widest pool.",
        },
        {
          value: "miss3",
          label: "Missing 3+",
          desc: "Missing 3+ common services — a clear expansion story.",
        },
        {
          value: "miss5",
          label: "Missing 5+",
          desc: "Missing 5+ — a major gap; fewer but stronger leads.",
        },
      ],
      def: "miss1",
    },
  },
  competitor_pressure: {
    signalKey: "new_competitors_90d",
    registryKey: "new_competitors_90d",
    // AMBIGUOUS (roadmap): 3 modes — rivals advertising / being outspent (both
    // read cell ad prevalence → meta_ads) and new-entrant-nearby (Cluster H
    // chain-clustering, a source we don't collect). Declare the collectable
    // half (meta_ads); the new-entrant mode's eval returns null until built.
    researches: ["meta_ads"],
    title: "Competitor pressure",
    group: "other",
    means:
      "Under competitive pressure — rivals advertising, a new entrant nearby, or being outspent.",
    pitch: "Strongest urgency hook.",
    recipe: ["competitor signal"],
    conf: 2,
    kind: "data",
    comparator: "is",
    value: "advertising",
    status: "roadmap",
    setting: {
      type: "mode",
      label: "Pressure type",
      options: [
        {
          value: "advertising",
          label: "Rivals advertising",
          desc: "Rivals here are running ads — proven demand and urgency.",
        },
        {
          value: "newentrant",
          label: "New rival nearby",
          desc: "A new competitor opened nearby recently — fresh pressure.",
        },
        {
          value: "outspend",
          label: "Being outspent",
          desc: "Being outspent by rivals on ads — losing share right now.",
        },
      ],
      def: "advertising",
    },
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
  // ─── WP6-5 · Compliance-risk prospecting product line ──────────────────────
  //
  // A headline outbound category nobody else sells: package the playbook's
  // HIPAA / ADA / licensure / advertising-rule detectors as goal presets. The
  // `compliance_risk` filter binds `compliance_gap`, which fires on a flagged
  // PlaybookFinding in a compliance/privacy/accessibility group — so the
  // vertical playbook (med-spa/dental/chiropractic HIPAA, roofing/HVAC license,
  // law bar-advertising, plus ADA everywhere) does the detection automatically
  // once the agency maps that vertical's market. NO new SIG_META is needed.
  //
  // TRUST-FIRST framing (front-and-center in every `out`): we surface POTENTIAL
  // EXPOSURE worth checking — confidence-capped, evidence-backed, never a
  // violation. The playbook copy-lint (assertExposurePhrasing) guarantees the
  // shipped finding text can never assert a violation. This is the pitch's
  // credibility: "we flag exposure, never assert violations."
  {
    key: "compliance",
    icon: "⚖️",
    title: "Compliance risk",
    category: "Risk",
    who: "Businesses with a checkable legal-exposure gap — HIPAA tracking, ADA accessibility, or a licensure / advertising-rule gap",
    out: "A credible risk-framed opener nobody else sells — we flag exposure worth checking, never assert a violation",
    filters: [
      {
        key: "operating_business",
        on: true,
        why: "Real, operating businesses only — the baseline for every goal.",
      },
      {
        key: "has_website",
        on: true,
        why: "The exposure lives on the live site — HIPAA pixels, ADA failures, missing license/disclaimer language.",
      },
      {
        key: "compliance_risk",
        on: true,
        why: "A flagged compliance finding (HIPAA / ADA / licensure) — shown as evidence, confidence-capped, never a violation claim.",
      },
    ],
  },
  {
    key: "compliance_hipaa",
    icon: "🩺",
    title: "HIPAA tracking exposure",
    category: "Risk",
    who: "Health businesses (med-spa, dental, chiropractic) running a tracking pixel alongside patient-intake tools",
    out: "The highest-value, low-supply health pitch — a patient-privacy exposure worth checking, framed as a review point (HHS guidance is contested)",
    filters: [
      {
        key: "operating_business",
        on: true,
        why: "Real, operating businesses only — the baseline for every goal.",
      },
      {
        key: "has_website",
        on: true,
        why: "The pixel-on-intake co-location is a live-site read — no site, nothing to check.",
      },
      {
        key: "compliance_risk",
        on: true,
        why: "A tracking pixel co-located with a patient-intake tool — evidence-backed, confidence-capped, never a HIPAA-violation claim.",
      },
    ],
  },
  {
    key: "compliance_ada",
    icon: "♿",
    title: "ADA accessibility exposure",
    category: "Risk",
    who: "Businesses whose site fails the accessibility checks that drive ADA demand letters",
    out: "A concrete web-accessibility fix backed by Lighthouse audits — the exact checks cited in accessibility demand letters, worth reviewing",
    filters: [
      {
        key: "operating_business",
        on: true,
        why: "Real, operating businesses only — the baseline for every goal.",
      },
      {
        key: "has_website",
        on: true,
        why: "Accessibility is audited on the live site — no site, nothing to check.",
      },
      {
        key: "compliance_risk",
        on: true,
        why: "Serious WCAG audit failures (contrast, alt text, labels) — the checks most cited in ADA demand letters, shown as evidence.",
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
 * Reverse index: registry `signalKey` → the SIG_META keys that carry it. Built
 * once. Several SIG_META cards share one registry signalKey (e.g. both
 * `reputation_slipping` and `low_reply_rate` bind `review_lifecycle`), so the
 * value is a list. Used only by the legacy `familiesForSignals` wrapper.
 */
const SIG_KEYS_BY_SIGNAL_KEY: Record<string, string[]> = (() => {
  const idx: Record<string, string[]> = {};
  for (const [metaKey, meta] of Object.entries(SIG_META)) {
    (idx[meta.signalKey] ??= []).push(metaKey);
  }
  return idx;
})();

/**
 * DEPRECATED — use {@link researchesForSignals} directly with the active
 * signals (their `.key` is the SIG_META key). This is a thin backward-compatible
 * wrapper kept for any caller that still has registry `signalKey` strings: it
 * maps each signalKey back to its SIG_META key(s) and delegates to the resolver
 * (no duplicate logic). Returns the SAME `EnrichmentType[]` shape as before.
 */
export function familiesForSignals(signalKeys: string[]): EnrichmentType[] {
  const activeSignals: { key: string }[] = [];
  for (const sk of signalKeys) {
    for (const metaKey of SIG_KEYS_BY_SIGNAL_KEY[sk] ?? []) {
      activeSignals.push({ key: metaKey });
    }
  }
  return researchesForSignals(activeSignals);
}
