// modules/agency-portal/discover/signal-eval.ts · Phase D / Cluster A — the
// discover-flow SIGNAL-EVAL layer. This is the piece that makes a toggled goal
// signal actually evaluate against a real business's stored data.
//
// Today the agency discover flow does NOT evaluate signals (see
// docs/signal-gap-matrix.md): it filters by category/geo/reachability + one
// percentile, and match% = count of flagged PlaybookFindings. The Hunter
// evaluator (modules/hunter/evaluate.ts) exists but isn't wired in AND its
// MODEL_TO_SLOT can't read BusinessTech / PlaybookFinding / BusinessKeyword /
// Contact / AdMarketRun. This module is the foundation that fixes both:
//
//   1. hydrateBusinessForSignals(ids) — ONE batched, agency-agnostic load of
//      the stored data the goal signals read (no N+1, read-only, snapshots only,
//      never a live external call).
//   2. evaluateSignal(sig, biz, now) — pure/deterministic, resolves the
//      business's value for a signal's registry `column`, applies the per-card
//      tune setting, and compares via the registry comparator. Returns
//      `matched: boolean | null` where `null` = "not computable for this
//      business yet" (data absent — never counts as a match OR a fail).
//   3. resolveMatches(activeSignals, biz) — the aggregate the preview /
//      discovery / workbench will later call to filter + show match%.
//
// IMPORTANT — this slice does NOT rewire the discover flow. It only builds the
// resolver + hydration so they are ready to wire in the next slice. Nothing in
// goal-templates.ts / GoalStep.tsx / preview / workbench is touched here.
//
// See `modules/signals/registry.ts` for the `column` map, `comparators.ts` for
// the single-comparator semantics, and `goal-templates.ts` for SigMeta /
// flow-types.ts for the SignalTuneValue union (the 6 tune shapes).

import {
  evaluate as evaluateComparator,
  isValidComparator,
} from "@/modules/signals/comparators";
import { getSignal } from "@/modules/signals/registry";
import type {
  Comparator,
  FilterValue,
  SignalDefinition,
} from "@/modules/signals/types";
import { parseColumnRef } from "@/modules/hunter/evaluate";
import { percentileRank, type Breakpoints } from "@/modules/scoring";
import { parseCellReference } from "@/modules/market/cell-metrics";
import { slugify } from "@/modules/business-discovery";
import prisma from "@/lib/prisma";

import type { SignalTuneValue } from "./flow-types";
import { sigMeta } from "./goal-templates";

// ─────────────────────────────────────────────────────────────────────────────
// Hydrated business shape — the read-model the evaluator reads.
//
// One object per business carrying the latest/aggregated stored values the goal
// signals reference. Built once per discovery batch by hydrateBusinessForSignals.
// Every field is optional/nullable: a null/absent field means "we don't have
// this data for this business yet", which the evaluator maps to a `null`
// (not-computable) verdict — never a silent false.
// ─────────────────────────────────────────────────────────────────────────────

/** Compact per-channel contact counts derived from the Contact rows. */
export interface HydratedContacts {
  /** Distinct EMAIL contacts. */
  emailCount: number;
  /** Distinct PHONE + WHATSAPP contacts. */
  phoneCount: number;
  /** Distinct social channels (FACEBOOK/INSTAGRAM/LINKEDIN/TIKTOK/YOUTUBE/X/YELP). */
  socialChannelCount: number;
  /** True if any contact is tagged OWNER or PERSONAL (not a generic inbox). */
  hasOwnerContact: boolean;
  /** Total distinct usable contacts across every channel. */
  totalCount: number;
}

/** Latest-audit Lighthouse slice + derived DOM/tech booleans. */
export interface HydratedLighthouse {
  performance: number | null;
  accessibility: number | null;
  seo: number | null;
  bestPractices: number | null;
  lcp: number | null;
  cls: number | null;
  inp: number | null;
  fcp: number | null;
  perfSavingsMs: number | null;
  a11yViolationCount: number | null;
  /** null when the audit didn't capture HTTPS (so "No HTTPS" is not-computable). */
  isOnHttps: boolean | null;
  hasLocalBusinessSchema: boolean | null;
  hasFaqSchema: boolean | null;
}

/** Aggregated review facts the goal signals read (counts + recency). */
export interface HydratedReviews {
  /** Count of unanswered (ownerReplied=false) 1★ reviews. */
  unanswered1StarCount: number;
  /** Count of unanswered ≤2★ reviews (reputation-slipping recipe). */
  unansweredNegativeCount: number;
  /** Count of unanswered reviews of any star. */
  unansweredCount: number;
  /** True if any flagged negative review theme is present. */
  hasNegativeTheme: boolean;
  /** Distinct negative-review theme tags seen (lower-cased), for theme targeting. */
  negativeThemes: string[];
  /** Most recent review postedAt, or null if no reviews. */
  lastReviewAt: Date | null;
  /**
   * Count of ≤2★ reviews posted in the recent spike window (last ~30 days).
   * Drives `reputation_fire` (a burst of negatives = something just broke).
   * Counts every recent negative — answered or not — since a spike is about
   * the influx, not the reply state.
   */
  recentNegativeCount: number;
  /**
   * True once we have at least one Review row hydrated for this business, so a
   * zero negative count is a real "no spike" rather than "no data". Without any
   * reviews, spike/momentum review signals stay not-computable.
   */
  hasAnyReview: boolean;
}

/** Latest-scan SERP slice (best ranks + brand-query presence). */
export interface HydratedSerp {
  /** Best (lowest) localPackRank across scanned rows, null if none/absent. */
  bestLocalPackRank: number | null;
  /** Best (lowest) organicRank across scanned rows, null if none/absent. */
  bestOrganicRank: number | null;
  /** Best organicRank restricted to brand-query rows (branded-only recipe). */
  brandedOrganicRank: number | null;
  /** True if ANY scanned row is a brand query (so brand signals are computable). */
  hasBrandQuery: boolean;
  /** Count of distinct non-brand keywords with a top-N organic rank. */
  nonBrandRankedCount: number;
}

/** Aggregated active-ad facts from AdLibraryEntry. */
export interface HydratedAds {
  /** Count of active ad entries. */
  activeCount: number;
  /** True if any active ad uses a video creative. */
  hasVideo: boolean;
  /** Distinct active display formats seen (lower-cased: video/image/carousel/text). */
  formats: string[];
  /** Days since the newest active ad started; null if no dated active ad. */
  newestAgeDays: number | null;
  /** Distinct landing-URL hosts across active ads. */
  landingHostCount: number;
  /** True if every active ad with a landing URL points at the site root. */
  landingIsHomepageOnly: boolean | null;
}

/**
 * Tech presence flags derived from the BusinessTech rows. `null` = we have no
 * tech scan for this business yet (so tech signals are not-computable), `true` /
 * `false` once a scan exists.
 */
export interface HydratedTech {
  /** True once at least one BusinessTech row exists (drives the null guard). */
  scanned: boolean;
  /** First detected CMS/builder name (lower-cased), or null. */
  cmsName: string | null;
  /** AUDIT C1/C2 · the detected on-site BOOKING tool name (lower-cased, e.g.
   *  "vagaro", "square appointments", "fresha"), or null when none is detected.
   *  Powers the exact-service display + the honest no_booking absence verdict —
   *  the data was always in BusinessTech.name, just never surfaced. */
  bookingName: string | null;
  hasAnalytics: boolean;
  hasMetaPixel: boolean;
  hasBooking: boolean;
  hasChat: boolean;
  hasEcommerce: boolean;
  hasConsent: boolean;
}

/** Cell-prevalence facts from the latest AdMarketRun for the business's cell. */
export interface HydratedAdMarket {
  /** Advertisers observed in the business's cell, or null if no run. */
  advertiserCount: number | null;
}

/**
 * The business's CELL reference for the Cluster-C organic distributions +
 * Cluster-H competitive facts — computed entirely from data we already store
 * (CellMetric.distributions, same-cell Business rows). Every field is null when
 * the prerequisite data is absent OR the cell sample is too small to be honest
 * (< {@link CELL_DISTRIBUTION_MIN_SAMPLE}); the signals then stay not-computable.
 */
export interface HydratedCell {
  /** The cell's sampleSize (active businesses with a snapshot). null = no cell. */
  sampleSize: number | null;
  /** Cell organic-traffic breakpoints (est monthly visits per business). */
  organicTraffic: Breakpoints | null;
  /** Cell best-organic-rank breakpoints (lower = better). */
  organicRank: Breakpoints | null;
  /**
   * How many locations this business's brand runs IN THE SAME METRO — counted
   * from same-metro Business rows sharing a normalized brand/name (and/or a
   * shared domain / googleCid root). null when the metro/name isn't known (so
   * `multi_location` is not-computable). 1 = single location.
   */
  locationCount: number | null;
  /**
   * True if a SAME-CELL peer first appeared on Google within the recent window
   * ({@link NEW_ENTRANT_WINDOW_DAYS}). null when no same-cell peer has a
   * firstSeenOnGoogle date to judge from. Drives competitor_pressure's
   * "new rival nearby" mode.
   */
  hasRecentNewEntrant: boolean | null;
}

/** Keyword-portfolio facts from BusinessKeyword (organic traffic + trend). */
export interface HydratedKeywords {
  /** True once at least one BusinessKeyword row exists. */
  scanned: boolean;
  /** Sum of latestEstMonthlyVisits across the portfolio (organic traffic est). */
  estMonthlyVisits: number | null;
  /** True if any keyword row is flagged isDown (losing rankings). */
  anyDown: boolean;
  /** True if any keyword row is flagged isUp. */
  anyUp: boolean;
}

/** The flagged PlaybookFinding signal keys + their per-key value/confidence. */
export interface HydratedFindings {
  /** Set of signalKeys with a flagged finding. */
  flaggedKeys: Set<string>;
  /** Set of finding `group`s with a flagged finding (e.g. "compliance"). */
  flaggedGroups: Set<string>;
  /** signalKey → finding value (e.g. ADA tier "high"). */
  valueByKey: Record<string, string>;
  /** signalKey → finding confidence. */
  confidenceByKey: Record<string, string>;
}

/**
 * Service-gap facts: how many high-prevalence services in the business's cell
 * the business is missing. `null` counts mean the prerequisite data isn't
 * hydrated yet (no services taxonomy rows for this business OR no cell
 * prevalence for its cell) → the service_gap signal is not-computable.
 */
export interface HydratedServices {
  /** True once at least one BusinessService row exists for the business. */
  scanned: boolean;
  /**
   * Count of common services (cell prevalence ≥ COMMON_SERVICE_PREVALENCE) the
   * business does NOT offer. `null` when we can't compute it (no prevalence for
   * the cell, or no services scanned).
   */
  missingCommonCount: number | null;
}

/**
 * One business + its latest/aggregated stored values, ready for the evaluator.
 * Built by {@link hydrateBusinessForSignals}. The `business` slot is the raw
 * Business scalar row (selected fields only); the rest are derived rollups.
 */
export interface HydratedBusiness {
  id: string;
  /** Raw Business scalar fields the registry columns reference. */
  business: Record<string, unknown>;
  snapshot: Record<string, unknown> | null;
  lighthouse: HydratedLighthouse | null;
  reviews: HydratedReviews;
  serp: HydratedSerp | null;
  ads: HydratedAds;
  tech: HydratedTech;
  adMarket: HydratedAdMarket;
  keywords: HydratedKeywords;
  contacts: HydratedContacts;
  findings: HydratedFindings;
  services: HydratedServices;
  cell: HydratedCell;
}

// ─────────────────────────────────────────────────────────────────────────────
// Active signal — the goal-filter row, resolved against SigMeta.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One toggled goal signal to evaluate. Assembled from the working GoalFilter +
 * its SigMeta (the `comparator`/`value` defaults + `registryKey` binding). The
 * caller (next slice) builds these from the GoalState; this module never reads
 * the GoalState directly so it stays pure + unit-testable.
 */
export interface ActiveSignal {
  /** SIG_META key (e.g. "diy_platform"). */
  key: string;
  /**
   * The registry key to evaluate against (SigMeta.registryKey). When omitted,
   * the resolver falls back to looking the SigMeta up by `key`. Signals with no
   * registry equivalent yet evaluate to `null` (not-computable).
   */
  registryKey?: string;
  /** Default comparator from SigMeta (a wire-level comparator string). */
  comparator: string;
  /** Default value from SigMeta. */
  value: string | number | boolean;
  /** The chosen tune-control value (shifts threshold / selects targets). */
  tune?: SignalTuneValue;
  /** Composite per-condition include toggles (recipe-line index → on). */
  conds?: Record<string, boolean>;
  /** Composite combine mode ("all" = every condition; "any" = at least one). */
  match?: "all" | "any";
}

/** One signal's verdict. `matched: null` = not computable (data absent). */
export interface SignalVerdict {
  matched: boolean | null;
}

/** The aggregate verdict across an active signal set for one business. */
export interface MatchResult {
  /** Per-signal verdict, keyed by the ActiveSignal.key. */
  perSignal: Record<string, boolean | null>;
  /** Count of signals that matched. */
  matchedCount: number;
  /** Count of signals that were computable (matched OR not — nulls excluded). */
  applicableCount: number;
  /** matchedCount / applicableCount, 0 when nothing is applicable. */
  matchPct: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tune → threshold/target mapping.
//
// strictness shifts a NUMERIC threshold (looser = wider net, stricter = tighter)
// by a ±25% band around the signal's default value; the direction depends on the
// comparator (for "less-than" signals a stricter filter LOWERS the bar; for
// "greater-than" signals it RAISES it). scale/mode/platform/presence select the
// comparison target value(s) instead of shifting a threshold.
// ─────────────────────────────────────────────────────────────────────────────

/** The ±band applied per strictness step (balanced = 0). */
const STRICTNESS_BAND = 0.25;

/** Comparators where a SMALLER actual value means "more of a problem". */
const LESS_THAN_OPS = new Set<Comparator>(["<", "<="]);
/** Comparators where a LARGER actual value means "more of a problem". */
const GREATER_THAN_OPS = new Set<Comparator>([">", ">="]);

/**
 * Apply a strictness level to a numeric threshold. "stricter" tightens the net
 * (fewer businesses match), "looser" widens it. The shift direction respects
 * the comparator so both `<` and `>` signals behave intuitively:
 *
 *   - `lighthouse_performance < 50` (lower = worse): stricter → 37.5 (only the
 *     genuinely-slow), looser → 62.5 (catch more borderline sites).
 *   - `perf_savings_ms >= 2000` (higher = worse): stricter → 2500, looser → 1500.
 */
export function applyStrictnessToThreshold(
  base: number,
  level: "loose" | "balanced" | "strict",
  comparator: Comparator,
): number {
  if (level === "balanced") return base;
  const tighten = level === "strict";
  // For "less-than" signals, tighter = lower threshold; for "greater-than",
  // tighter = higher threshold. Looser is the inverse.
  let factor: number;
  if (LESS_THAN_OPS.has(comparator)) {
    factor = tighten ? 1 - STRICTNESS_BAND : 1 + STRICTNESS_BAND;
  } else if (GREATER_THAN_OPS.has(comparator)) {
    factor = tighten ? 1 + STRICTNESS_BAND : 1 - STRICTNESS_BAND;
  } else {
    // Equality / between / non-directional: leave the threshold unchanged.
    return base;
  }
  return base * factor;
}

/** Map a scale band selection to a [minPct, maxPct] inclusive percentile window. */
export function scaleBandsToPercentileRange(
  bands: string[],
): [number, number] | null {
  // Each band covers a slice of the 0–100 percentile axis.
  const RANGES: Record<string, [number, number]> = {
    bottom10: [0, 10],
    below: [0, 50],
    around: [25, 75],
    above: [50, 100],
    top10: [90, 100],
  };
  const picked = bands.map((b) => RANGES[b]).filter(Boolean) as [
    number,
    number,
  ][];
  if (picked.length === 0) return null;
  const min = Math.min(...picked.map((r) => r[0]));
  const max = Math.max(...picked.map((r) => r[1]));
  return [min, max];
}

// ─────────────────────────────────────────────────────────────────────────────
// Column value resolution against the hydrated business.
//
// Extends the Hunter's model→value idea to cover the 5 models its MODEL_TO_SLOT
// can't read (BusinessTech / PlaybookFinding / BusinessKeyword / Contact /
// AdMarketRun) plus the aggregated review/serp/ads rollups. Returns `undefined`
// when the data is genuinely absent → the caller maps that to a null verdict.
// ─────────────────────────────────────────────────────────────────────────────

/** Sentinel: "we have no data for this signal on this business" → null verdict. */
const NOT_COMPUTABLE = Symbol("not-computable");
type Resolved = unknown | typeof NOT_COMPUTABLE;

/** Sentinel: "this signal isn't special — fall through to the column dispatch". */
const PASS_THROUGH = Symbol("pass-through");

/** Finding `group`s that count as a compliance/legal exposure for the cell. */
const COMPLIANCE_FINDING_GROUPS = new Set([
  "compliance",
  "privacy",
  "accessibility",
]);

/**
 * Registry-bound signals that {@link resolveSpecialSignal} resolves to a real
 * boolean even though their registry `type` is numeric/string. {@link
 * evaluateSingle} evaluates these as booleans (never via the typed comparator).
 */
const BOOLEAN_VERDICT_KEYS = new Set([
  "ad_landing_pages_count", // ads_homepage_landing → landingIsHomepageOnly
  "compliance_gap", // compliance_risk → flagged compliance finding
]);

/**
 * Resolve the registry-bound signals whose stored value lives in a different
 * rollup than their nominal `column` points at. Returns {@link PASS_THROUGH}
 * when the signal isn't one of these (so the caller runs the normal column
 * dispatch). Keeps the registry as the source of the comparator/value while the
 * value comes from where the data actually is.
 */
function resolveSpecialSignal(
  signal: SignalDefinition,
  biz: HydratedBusiness,
): Resolved {
  switch (signal.key) {
    case "rank_drop_last_30d":
      // "Losing rankings" — the trend lives in the BusinessKeyword portfolio's
      // isDown flags, not in SerpResult rows. A business is losing ground if ANY
      // tracked keyword dropped. Return a 0/1 the `>= 1` comparator AND the
      // presence tune (via toBool) both read.
      if (!biz.keywords.scanned) return NOT_COMPUTABLE;
      return biz.keywords.anyDown ? 1 : 0;
    case "ad_landing_pages_count":
      // The `ads_homepage_landing` card binds this key but means "ads point at
      // the homepage", which the ad rollup derives as landingIsHomepageOnly.
      // Return a real boolean (null until an active ad with a landing URL
      // exists). Falls back to the host-count column for any OTHER card that
      // legitimately wants the count.
      if (biz.ads.landingIsHomepageOnly === null) return NOT_COMPUTABLE;
      return biz.ads.landingIsHomepageOnly;
    case "compliance_gap":
      // "Legal & compliance risk" fires on a flagged PlaybookFinding in a
      // compliance/privacy/accessibility group (HIPAA pixel, ADA a11y, etc.) —
      // not on the raw Business.complianceFlags array the column names. Not
      // computable until at least one finding exists for the business.
      if (biz.findings.flaggedKeys.size === 0) return NOT_COMPUTABLE;
      return hasComplianceFinding(biz);
    default:
      return PASS_THROUGH;
  }
}

/** True if any flagged finding sits in a compliance-class group. */
function hasComplianceFinding(biz: HydratedBusiness): boolean {
  for (const g of biz.findings.flaggedGroups) {
    if (COMPLIANCE_FINDING_GROUPS.has(g)) return true;
  }
  return false;
}

/**
 * Resolve a registry signal's `column` ("Model.field") to the business's value.
 * Returns NOT_COMPUTABLE when the backing data is absent (vs. a real false/0).
 */
export function resolveSignalValue(
  signal: SignalDefinition,
  biz: HydratedBusiness,
  now: Date,
): Resolved {
  // Some registry-bound signals declare a nominal `column` (so the registry has
  // a binding) but their real value lives in a DIFFERENT hydrated rollup. Route
  // those by registry key first, before the column-model dispatch.
  const special = resolveSpecialSignal(signal, biz);
  if (special !== PASS_THROUGH) return special;

  const ref = parseColumnRef(signal.column);
  if (!ref) return NOT_COMPUTABLE;
  const { model, field } = ref;

  switch (model) {
    case "Business":
      return resolveBusinessField(signal, biz, field);
    case "BusinessSnapshot":
      return resolveSnapshotField(signal, biz, field);
    case "LighthouseAudit":
      return resolveLighthouseField(biz, field);
    case "Review":
      return resolveReviewSignal(signal, biz, now);
    case "SerpResult":
      return resolveSerpSignal(signal, biz);
    case "AdLibraryEntry":
      return resolveAdSignal(signal, biz, now);
    case "BusinessTech":
      return resolveTechSignal(signal, biz);
    case "BusinessKeyword":
      return resolveKeywordSignal(signal, biz);
    case "Contact":
      return resolveContactSignal(signal, biz);
    case "AdMarketRun":
      return biz.adMarket.advertiserCount ?? NOT_COMPUTABLE;
    case "PlaybookFinding":
      return resolveFindingSignal(signal, biz);
    case "BusinessLicense":
      // No license data is hydrated yet (roadmap) — not computable.
      return NOT_COMPUTABLE;
    default:
      return NOT_COMPUTABLE;
  }
}

/** Pull a scalar field off a record; absent/null → NOT_COMPUTABLE. */
function pick(obj: Record<string, unknown>, field: string): Resolved {
  const v = obj[field];
  return v === undefined || v === null ? NOT_COMPUTABLE : v;
}

function resolveSnapshotField(
  signal: SignalDefinition,
  biz: HydratedBusiness,
  field: string,
): Resolved {
  if (!biz.snapshot) return NOT_COMPUTABLE;
  // Several percentile/composite signals declare their registry `column` as
  // `BusinessSnapshot.raw` (a catch-all JSON bag) but the real value lives in a
  // denormalized scalar column added by scoring v2. Route those to the dedicated
  // column the hydrator selects; everything else reads its declared field.
  switch (signal.key) {
    case "msi_percentile":
    case "reviews_vs_cell_pct":
      return pick(biz.snapshot, "msiPercentile");
    default:
      return pick(biz.snapshot, field);
  }
}

function resolveBusinessField(
  signal: SignalDefinition,
  biz: HydratedBusiness,
  field: string,
): Resolved {
  const b = biz.business;
  switch (signal.key) {
    // Boolean "has X" signals are computable from the listing even when the
    // value is null (null website = "doesn't have one"). Map listing presence
    // signals to real booleans rather than NOT_COMPUTABLE.
    case "has_phone":
      return nonEmpty(b.phone);
    case "has_website":
      return nonEmpty(b.website);
    case "has_email":
      return b.emailVerifiedAt != null;
    case "has_instagram":
      return nonEmpty(b.instagramHandle);
    case "is_owner_claimed_in_mapsly":
      return nonEmpty(b.ownerUserId);
    case "phone_only":
      // Has a phone but no website.
      return nonEmpty(b.phone) && !nonEmpty(b.website);
    case "category_count":
      return Array.isArray(b.categories) ? b.categories.length : NOT_COMPUTABLE;
    case "stale_no_reviews": {
      // True if lastReviewAt is older than the default window (~4 months).
      const last = biz.reviews.lastReviewAt;
      if (!last) return NOT_COMPUTABLE;
      const days = ageInDays(last, new Date());
      return days > 120;
    }
    default:
      return pick(b, field);
  }
}

function resolveLighthouseField(
  biz: HydratedBusiness,
  field: string,
): Resolved {
  if (!biz.lighthouse) return NOT_COMPUTABLE;
  const lh = biz.lighthouse as unknown as Record<string, unknown>;
  const v = lh[field];
  if (v === undefined || v === null) return NOT_COMPUTABLE;
  // `no_https` reads isOnHttps but means "NOT on https" → invert to a boolean
  // the comparator (is === true) can match.
  if (field === "isOnHttps") return v === false;
  return v;
}

function resolveReviewSignal(
  signal: SignalDefinition,
  biz: HydratedBusiness,
  now: Date,
): Resolved {
  const r = biz.reviews;
  switch (signal.key) {
    case "unanswered_1star_count":
      return r.unanswered1StarCount;
    case "unanswered_count":
      return r.unansweredCount;
    case "unanswered_aged_1star":
      return r.unanswered1StarCount; // aged handled upstream in hydration
    case "has_negative_theme":
      return r.hasNegativeTheme;
    case "last_review_age_days":
      return r.lastReviewAt ? ageInDays(r.lastReviewAt, now) : NOT_COMPUTABLE;
    default:
      return NOT_COMPUTABLE;
  }
}

function resolveSerpSignal(
  signal: SignalDefinition,
  biz: HydratedBusiness,
): Resolved {
  const s = biz.serp;
  if (!s) return NOT_COMPUTABLE;
  switch (signal.key) {
    case "local_pack_rank":
      // Not in the pack → a large rank so "> 3" matches. null = no scan.
      return (
        s.bestLocalPackRank ??
        (s.nonBrandRankedCount >= 0 ? 99 : NOT_COMPUTABLE)
      );
    case "in_local_pack":
      return s.bestLocalPackRank != null && s.bestLocalPackRank <= 3;
    case "organic_rank_best":
      return s.bestOrganicRank ?? NOT_COMPUTABLE;
    case "branded_organic_rank":
      // "Branded-only" → ranks for brand but little else. Computable only when
      // we actually scanned a brand query.
      // FLAG (needs NEW paid collection): cell-intel/serp.ts only scans CATEGORY
      // keywords, so `isBrandQuery` rows effectively never exist → this stays
      // not-computable. Lighting it up requires a NEW per-business branded-query
      // SERP scan (a fresh DataForSEO cost) — left for Viktor's cost approval.
      if (!s.hasBrandQuery) return NOT_COMPUTABLE;
      return s.nonBrandRankedCount === 0;
    case "keyword_count_ranked":
      return s.nonBrandRankedCount;
    case "rank_drop_last_30d":
      // Handled in resolveSignalValue (reads biz.keywords, not serp) so it
      // computes even when there are no SerpResult rows.
      return NOT_COMPUTABLE;
    default:
      return NOT_COMPUTABLE;
  }
}

function resolveAdSignal(
  signal: SignalDefinition,
  biz: HydratedBusiness,
  now: Date,
): Resolved {
  const a = biz.ads;
  switch (signal.key) {
    case "has_active_meta_ads":
      return a.activeCount > 0;
    case "meta_ad_count":
      return a.activeCount;
    case "meta_ad_format_video":
      return a.hasVideo;
    case "ads_age_days":
      return a.newestAgeDays ?? NOT_COMPUTABLE;
    case "ad_landing_pages_count":
      return a.landingHostCount;
    default:
      // Single-host ad-landing presence for ads_homepage_landing maps via
      // SigMeta to ad_landing_pages_count; the homepage-only flag is derived.
      void now;
      return NOT_COMPUTABLE;
  }
}

function resolveTechSignal(
  signal: SignalDefinition,
  biz: HydratedBusiness,
): Resolved {
  const t = biz.tech;
  if (!t.scanned) return NOT_COMPUTABLE;
  switch (signal.key) {
    case "cms_platform":
      return t.cmsName ?? "";
    case "has_booking_widget":
      return t.hasBooking;
    case "has_analytics":
      return t.hasAnalytics;
    case "has_meta_pixel":
      return t.hasMetaPixel;
    case "ads_without_pixel":
      // Runs ads but no pixel — needs BOTH ad + tech data.
      return biz.ads.activeCount > 0 && !t.hasMetaPixel;
    default:
      return NOT_COMPUTABLE;
  }
}

function resolveKeywordSignal(
  signal: SignalDefinition,
  biz: HydratedBusiness,
): Resolved {
  const k = biz.keywords;
  if (!k.scanned) return NOT_COMPUTABLE;
  switch (signal.key) {
    case "organic_traffic_est":
      return k.estMonthlyVisits ?? NOT_COMPUTABLE;
    default:
      return NOT_COMPUTABLE;
  }
}

function resolveContactSignal(
  signal: SignalDefinition,
  biz: HydratedBusiness,
): Resolved {
  const c = biz.contacts;
  switch (signal.key) {
    case "email_count":
      return c.emailCount;
    case "phone_count":
      return c.phoneCount;
    case "social_channel_count":
      return c.socialChannelCount;
    case "has_owner_contact":
      return c.hasOwnerContact;
    default:
      return NOT_COMPUTABLE;
  }
}

function resolveFindingSignal(
  signal: SignalDefinition,
  biz: HydratedBusiness,
): Resolved {
  const f = biz.findings;
  // The finding's own signalKey is the registry key for these expert signals.
  if (!f.flaggedKeys.has(signal.key)) {
    // No flagged finding: if we have NO findings at all this is not-computable;
    // if findings exist but not this one, treat as a real "not flagged".
    return f.flaggedKeys.size === 0 ? NOT_COMPUTABLE : false;
  }
  // For enum-valued findings (e.g. ada_risk tier), return the stored value.
  if (signal.type === "enum") return f.valueByKey[signal.key] ?? "";
  return true;
}

function nonEmpty(v: unknown): boolean {
  return typeof v === "string" ? v.trim().length > 0 : v != null;
}

function ageInDays(date: Date, now: Date): number {
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-signal evaluation.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate one active goal signal against one hydrated business.
 *
 * Returns `{ matched: null }` when the signal can't be computed for this
 * business (no backing data, or no registry binding). A null verdict NEVER
 * counts as a match or a fail — it's excluded from the applicable denominator in
 * {@link resolveMatches}. Otherwise returns `{ matched: true|false }`.
 *
 * Pure + deterministic: no DB, no external call, no `new Date()` (the caller
 * passes `now`). The only DB work in this module is in
 * {@link hydrateBusinessForSignals}.
 */
export function evaluateSignal(
  sig: ActiveSignal,
  biz: HydratedBusiness,
  now: Date,
): SignalVerdict {
  // ── Synthetic signals · no registry binding, computed straight off the
  // hydrated rollups by their SigMeta key (open_now, reviews_trending,
  // rating_slipping, reputation_fire, chat_widget, ecommerce, …). These are the
  // cards SIG_META carries with no `registryKey`. A composite with every
  // condition toggled off is not-computable, same as the registry path.
  if (!sig.registryKey && !resolveRegistryKey(sig.key)) {
    if (sig.conds) {
      const included = Object.entries(sig.conds).filter(
        ([, on]) => on !== false,
      );
      if (included.length === 0) return { matched: null };
    }
    return evaluateSynthetic(sig, biz, now);
  }

  const registryKey = sig.registryKey ?? resolveRegistryKey(sig.key);
  if (!registryKey) return { matched: null };

  const signal = getSignal(registryKey);
  if (!signal) return { matched: null };

  // ── true multi-condition composites ──
  // A handful of cards combine several REAL conditions (each from a different
  // rollup) under an all/any match. Their single registry binding can't express
  // that, so compute them explicitly, honoring the per-condition toggles.
  if (sig.key === "reputation_slipping") {
    return reputationSlippingVerdict(sig, biz);
  }

  // ── Cluster-C cell-relative organic signals (by SigMeta key) ──
  // These bind organic_traffic_est / local_pack_rank in the registry, but their
  // recipe is PERCENTILE-vs-cell (scale band), which the single numeric binding
  // can't express. Compute them off the hydrated cell distribution + the
  // business's organic values, honoring the scale-band tune. Null when the cell
  // sample is too thin to place the business honestly.
  switch (sig.key) {
    case "low_organic_traffic":
      return lowOrganicTrafficVerdict(sig, biz);
    case "search_visibility":
      return searchVisibilityVerdict(sig, biz);
    case "invisible_locally":
      return invisibleLocallyVerdict(biz);
    case "recurring_complaint_theme":
      return recurringComplaintThemeVerdict(sig, biz);
    case "competitor_pressure":
      // Cluster-H competitive pressure (mode tune). rivals-advertising +
      // new-entrant compute from stored data; outspend is null-TODO (no spend).
      return competitorPressureVerdict(sig, biz);
    case "no_booking":
      // AUDIT C1 · "No online booking tool" is an ABSENCE card: it matches a
      // business that has NO on-site booking widget. The old binding read the
      // GBP boolean and matched tool-name chips against it → 0 results. Compute
      // it honestly off the tech rollup's detected booking-tool name.
      return noBookingVerdict(sig, biz);
    default:
      break;
  }

  // Composite signals (conds/match) combine per-condition results. For this
  // foundation we treat each composite as its single registry binding evaluated
  // once, then apply the all/any combine across the included conditions that map
  // to the SAME binding (the multi-binding composite split is Phase B work).
  const verdict = evaluateSingle(sig, signal, biz, now);
  if (verdict.matched === null) return verdict;

  // Composite combine: when conds are present, a line explicitly toggled off is
  // ignored; with "any" the signal matches if its binding matches, with "all"
  // it must match. With a single binding both reduce to the binding's verdict,
  // but the combine still governs how multiple bindings would fold (Phase B).
  if (sig.conds) {
    const included = Object.entries(sig.conds).filter(([, on]) => on !== false);
    if (included.length === 0) return { matched: null };
  }

  return verdict;
}

/** Evaluate a single (non-composite) binding. */
function evaluateSingle(
  sig: ActiveSignal,
  signal: SignalDefinition,
  biz: HydratedBusiness,
  now: Date,
): SignalVerdict {
  const resolved = resolveSignalValue(signal, biz, now);
  if (resolved === NOT_COMPUTABLE) return { matched: null };

  const tune = sig.tune;

  // ── boolean-verdict special signals ──
  // A few registry-bound cards resolve to a real boolean even though their
  // registry `type` is numeric/string (the value comes from a different rollup
  // via resolveSpecialSignal). Evaluate them as booleans so we never feed `is`
  // to the numeric comparator (which would throw) or pass a boolean to a string
  // comparator (which would match both true AND false). A presence tune still
  // applies its has/hasn't direction.
  if (BOOLEAN_VERDICT_KEYS.has(signal.key) && typeof resolved === "boolean") {
    if (tune && tune.kind === "presence") {
      const wantHas = tune.value === "has";
      const expected = sig.value === false ? !wantHas : wantHas;
      return { matched: resolved === expected };
    }
    // No presence tune → the SigMeta default value says which boolean "matches"
    // (value:false means the card matches when the boolean is false, e.g.
    // "no tracking pixel"); default is "matches when true".
    const want = sig.value === false ? false : true;
    return { matched: resolved === want };
  }

  // ── "Review momentum" (reviews_vs_cell_pct) — a 4-state derived from review
  // velocity + lifecycle, NOT a comparison against the percentile its registry
  // column points at. Handle it BEFORE the comparator path (its registry type is
  // numeric but its `is`/string value would crash evaluateNumeric). Uses the
  // mode tune if present, else the SigMeta default. A scale tune (unused by this
  // card) would still fall through to the percentile path below.
  if (signal.key === "reviews_vs_cell_pct" && (!tune || tune.kind === "mode")) {
    const mode = tune && tune.kind === "mode" ? tune.value : String(sig.value);
    return reviewMomentumVerdict(mode, biz);
  }

  // ── scale tune (percentile bands) — compares a percentile-typed value. ──
  if (tune && tune.kind === "scale") {
    const range = scaleBandsToPercentileRange(tune.bands);
    if (!range) return { matched: null };
    const pct = toNum(resolved);
    if (pct === null) return { matched: null };
    return { matched: pct >= range[0] && pct <= range[1] };
  }

  // ── platform tune (multi-select target chips). ──
  if (tune && tune.kind === "platform") {
    return { matched: matchPlatform(tune.values, resolved) };
  }

  // ── mode tune (single-select target). ──
  if (tune && tune.kind === "mode") {
    return {
      matched: evaluateComparator(
        signal.type,
        "is" as Comparator,
        tune.value as FilterValue,
        resolved,
      ),
    };
  }

  // ── presence tune (has / hasn't toggle). ──
  if (tune && tune.kind === "presence") {
    const truthy = toBool(resolved);
    if (truthy === null) return { matched: null };
    // The SigMeta default value encodes which boolean the "has" side means;
    // most presence signals match when the underlying boolean is true.
    const wantHas = tune.value === "has";
    const expected = sig.value === false ? !wantHas : wantHas;
    return { matched: truthy === expected };
  }

  // ── strictness tune (shift the numeric threshold). ──
  const comparator = sig.comparator as Comparator;
  let expected: FilterValue = sig.value as FilterValue;
  if (
    tune &&
    tune.kind === "strictness" &&
    typeof sig.value === "number" &&
    signal.type === "numeric"
  ) {
    expected = applyStrictnessToThreshold(sig.value, tune.level, comparator);
  }

  // Defensive: a card whose default comparator isn't valid for its registry
  // type (e.g. a scale-card's `is_one_of` reaching here because the tune was
  // dropped) must NOT throw and crash the whole discovery batch — treat it as
  // not-computable. The mode/scale/presence tunes above own the legitimate
  // type-mismatched cases; this only catches a misconfigured fall-through.
  if (!isValidComparator(signal.type, comparator)) return { matched: null };

  return {
    matched: evaluateComparator(signal.type, comparator, expected, resolved),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic signals — SigMeta cards with NO registry binding, computed directly
// off the hydrated rollups by their SigMeta key. Each returns a real boolean
// when the backing data exists, or `null` when it genuinely doesn't (so it's
// excluded from match% — never a fake value). Keys with no case here fall
// through to null, matching the prior behavior for unbound roadmap signals.
// ─────────────────────────────────────────────────────────────────────────────

/** Review velocity thresholds for the 4-state "Review momentum" mode. */
const MOMENTUM_STALL_VELOCITY = 0; // velocityLast30d === 0 ⇒ no recent reviews
/** Recent-window negative count that constitutes a reputation "fire". */
const FIRE_NEGATIVE_BURST = 2;
/** A 90-day rating drop of at least this much counts as "slipping". */
const RATING_SLIP_DELTA = 0.1;
/** Cell-prevalence at/above which a service counts as "common" in the cell. */
export const COMMON_SERVICE_PREVALENCE = 0.4;

/**
 * Minimum cell sampleSize for a cell-relative organic signal to be honest. Below
 * this the distribution is too thin to place a business in — the signal stays
 * not-computable rather than grading against 2–3 peers. Mirrors CELL_MIN_SAMPLE.
 */
export const CELL_DISTRIBUTION_MIN_SAMPLE = 8;

/** A same-cell peer first seen within this window counts as a "new entrant". */
export const NEW_ENTRANT_WINDOW_DAYS = 90;

/** ≥ this many same-metro same-brand locations ⇒ multi-location. */
const MULTI_LOCATION_MIN = 2;

/**
 * Place a value in its cell distribution as a 0–100 percentile, honoring whether
 * lower is better. Returns null when the distribution is absent or the cell
 * sample is too small to be honest. `lowerIsBetter` flips the axis so a small
 * organic RANK (good) lands HIGH on the 0–100 axis, matching the scale bands'
 * "above = strong / below = weak" mental model used across the cards.
 */
function cellPercentile(
  value: number | null,
  bp: Breakpoints | null,
  sampleSize: number | null,
  lowerIsBetter: boolean,
): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (!bp) return null;
  if (sampleSize === null || sampleSize < CELL_DISTRIBUTION_MIN_SAMPLE)
    return null;
  // percentileRank is "higher-is-better"; for a rank (lower better) invert the
  // resulting percentile so a great rank reads as a high band position.
  const pct01 = percentileRank(value, bp);
  const pct = lowerIsBetter ? 1 - pct01 : pct01;
  return pct * 100;
}

/** True iff a 0–100 percentile falls inside a scale-tune band range. */
function inScaleBand(pct: number, tune: SignalTuneValue | undefined): boolean {
  // Default band (when the card's tune is absent): "below market" = [0,50].
  const range =
    tune && tune.kind === "scale"
      ? scaleBandsToPercentileRange(tune.bands)
      : ([0, 50] as [number, number]);
  if (!range) return false;
  return pct >= range[0] && pct <= range[1];
}

function evaluateSynthetic(
  sig: ActiveSignal,
  biz: HydratedBusiness,
  now: Date,
): SignalVerdict {
  switch (sig.key) {
    case "open_now":
      // Currently operating per the Google listing's open status.
      return openNowVerdict(biz);
    case "reviews_trending":
      // Review momentum up: lifecycle TRENDING, or velocity30 > velocityPrev30.
      return reviewsTrendingVerdict(biz);
    case "rating_slipping":
      // 90-day rating trend down (latest snapshot rating < ~90d-prior rating).
      return ratingSlippingVerdict(biz);
    case "reputation_fire":
      // Burst of ≤2★ reviews in the recent spike window.
      return reputationFireVerdict(biz);
    case "chat_widget":
      // Live-chat tool detected on the site (tech fingerprint). The registry
      // has no chat column, so this computes off the tech rollup's hasChat.
      return techPresenceVerdict(biz, biz.tech.hasChat);
    case "ecommerce":
      // Online store / payments platform detected on the site.
      return techPresenceVerdict(biz, biz.tech.hasEcommerce);
    case "flying_blind":
      // B4 · Under-instrumented: the business has NEITHER analytics NOR a Meta
      // pixel. Both halves are tech-fingerprint reads that ride the contacts DOM
      // fetch, so one tech scan computes the whole composite. Null until a scan
      // exists (never a fake "flying blind" on an un-scanned lead).
      return techPresenceVerdict(
        biz,
        !biz.tech.hasAnalytics && !biz.tech.hasMetaPixel,
      );
    case "no_analytics":
      // B1 · COMPOSITE "runs active ads AND has no analytics" (SigMeta signalKey
      // ads_without_analytics; no registryKey → routed here by its meta key). The
      // ad half is now reliable per-business (google_ads target-host attribution
      // feeds biz.ads.activeCount); the analytics half is a tech-fingerprint read.
      // Null until a tech scan exists (never a fake match on an un-scanned lead) —
      // matches the flying_blind/ads_without_pixel guard.
      if (!biz.tech.scanned) return { matched: null };
      return { matched: biz.ads.activeCount > 0 && !biz.tech.hasAnalytics };
    case "not_advertising":
      // B3 · PER-BUSINESS "runs 0 active ads" (was the inverted market key).
      return notAdvertisingVerdict(biz);
    case "service_gap":
      // Missing N common services in its cell (mode tune: miss1/miss3/miss5).
      return serviceGapVerdict(sig, biz);
    case "site_age_3y":
      // Agreed proxy: Google tenure ≥ 3y stands in for true (WHOIS) site age.
      return siteAge3yVerdict(biz);
    case "multi_location":
      // Chain clustering (Cluster H): ≥2 same-metro Business rows sharing a
      // normalized brand/name (or shared domain/CID root). Computed in hydration
      // from same-cell peers — no new external data.
      void now;
      return multiLocationVerdict(biz);
    default:
      // Any other unbound SigMeta key (genuine roadmap) stays not-computable.
      return { matched: null };
  }
}

/**
 * "Review momentum" 4-state match. The chosen `mode` is one of
 * growing/losing/seasonal/stalled; we derive the business's state from its
 * review velocity + lifecycle:
 *   - growing  · lifecycle TRENDING, or velocity30 > velocityPrev30
 *   - losing   · lifecycle DYING,    or 0 < velocity30 < velocityPrev30
 *   - stalled  · lifecycle DORMANT,  or velocity30 === 0
 *   - seasonal · needs a 12-month trend we don't produce yet → null (TODO)
 * Not computable when neither velocity nor lifecycle is available.
 */
function reviewMomentumVerdict(
  mode: string,
  biz: HydratedBusiness,
): SignalVerdict {
  if (mode === "seasonal") {
    // TODO(phaseB-data): seasonal needs the 12-month review trend (a seasonal
    // lull that trends up soon). We only have 30d-vs-prior-30d velocity here.
    return { matched: null };
  }
  const snap = biz.snapshot;
  if (!snap) return { matched: null };
  const lifecycle =
    typeof snap.reviewLifecycle === "string" ? snap.reviewLifecycle : null;
  const v30 = toNum(snap.velocityLast30d);
  const vPrev = toNum(snap.velocityPrev30d);
  const haveVelocity = v30 !== null && vPrev !== null;
  if (!haveVelocity && lifecycle === null) return { matched: null };

  switch (mode) {
    case "growing":
      if (lifecycle === "TRENDING") return { matched: true };
      if (haveVelocity) return { matched: v30! > vPrev! };
      return { matched: false };
    case "losing":
      if (lifecycle === "DYING") return { matched: true };
      if (haveVelocity)
        return { matched: v30! > MOMENTUM_STALL_VELOCITY && v30! < vPrev! };
      return { matched: false };
    case "stalled":
      if (lifecycle === "DORMANT") return { matched: true };
      if (haveVelocity) return { matched: v30! === MOMENTUM_STALL_VELOCITY };
      return { matched: false };
    default:
      return { matched: null };
  }
}

/** Owner reply rate (0–1 fraction) below which reputation counts as slipping. */
const LOW_REPLY_RATE = 0.25;

/**
 * "Reputation slipping" composite. Three real conditions, indexed to the recipe
 * lines so per-condition `conds` toggles work:
 *   0 · rating trend down over ~90 days
 *   1 · owner reply rate < 25%
 *   2 · an unanswered ≤2★ review exists
 * Combined with the card's match mode (default "any" — any crack qualifies).
 * A line toggled off is skipped; a line whose data is absent is null and
 * excluded from the combine. Not computable when no included line is computable.
 */
function reputationSlippingVerdict(
  sig: ActiveSignal,
  biz: HydratedBusiness,
): SignalVerdict {
  const conds = sig.conds;
  const on = (idx: string) => !conds || conds[idx] !== false;

  const parts: (boolean | null)[] = [];
  if (on("0")) parts.push(ratingSlippingVerdict(biz).matched);
  if (on("1")) parts.push(lowReplyRate(biz));
  if (on("2")) parts.push(unansweredNegativePresent(biz));

  return combineConditions(parts, sig.match ?? "any");
}

/** Owner reply rate < 25%. Null when no snapshot/replyRate is hydrated. */
function lowReplyRate(biz: HydratedBusiness): boolean | null {
  const rate = biz.snapshot ? toNum(biz.snapshot.replyRate) : null;
  if (rate === null) return null;
  return rate < LOW_REPLY_RATE;
}

/** An unanswered ≤2★ review exists. Null when no reviews are hydrated. */
function unansweredNegativePresent(biz: HydratedBusiness): boolean | null {
  if (!biz.reviews.hasAnyReview) return null;
  return biz.reviews.unansweredNegativeCount >= 1;
}

/**
 * Fold a set of per-condition verdicts under an all/any combine. Nulls (absent
 * data) are excluded; with nothing computable the result is null (not a fake
 * false). "any" = at least one computable condition true; "all" = every
 * computable condition true.
 */
function combineConditions(
  parts: readonly (boolean | null)[],
  match: "all" | "any",
): SignalVerdict {
  const computable = parts.filter((p): p is boolean => p !== null);
  if (computable.length === 0) return { matched: null };
  if (match === "all") return { matched: computable.every((p) => p) };
  return { matched: computable.some((p) => p) };
}

/** Open now iff the listing's open status is OPEN. Status is always present. */
function openNowVerdict(biz: HydratedBusiness): SignalVerdict {
  const status = biz.business.openStatus;
  if (status === undefined || status === null) return { matched: null };
  return { matched: String(status) === "OPEN" };
}

/**
 * Reviews trending up: prefer the denormalized lifecycle (TRENDING), else
 * compare the 30-day velocities. Not computable when we have no snapshot AND no
 * reviews — there's nothing to judge momentum from.
 */
function reviewsTrendingVerdict(biz: HydratedBusiness): SignalVerdict {
  const snap = biz.snapshot;
  if (snap) {
    const lifecycle = snap.reviewLifecycle;
    if (lifecycle === "TRENDING") return { matched: true };
    const v30 = toNum(snap.velocityLast30d);
    const vPrev = toNum(snap.velocityPrev30d);
    if (v30 !== null && vPrev !== null) return { matched: v30 > vPrev };
    if (lifecycle != null) return { matched: false }; // known non-trending
  }
  // No snapshot signal to read momentum from → not computable.
  return { matched: null };
}

/**
 * Rating slipping over ~90 days: latest snapshot rating is at least
 * RATING_SLIP_DELTA below the ~90-day-prior snapshot rating. Not computable
 * when there is no historical snapshot to compare against.
 */
function ratingSlippingVerdict(biz: HydratedBusiness): SignalVerdict {
  const snap = biz.snapshot;
  if (!snap) return { matched: null };
  const current = toNum(snap.rating);
  const prior = toNum(snap.priorRating);
  if (current === null || prior === null) return { matched: null };
  return { matched: prior - current >= RATING_SLIP_DELTA };
}

/**
 * Reputation fire: a burst of ≤2★ reviews in the recent spike window. Not
 * computable with no reviews hydrated (a zero count would be misleading).
 */
function reputationFireVerdict(biz: HydratedBusiness): SignalVerdict {
  if (!biz.reviews.hasAnyReview) return { matched: null };
  return { matched: biz.reviews.recentNegativeCount >= FIRE_NEGATIVE_BURST };
}

/**
 * A site-tech presence signal (chat / e-commerce) computed off a tech rollup
 * boolean. Not computable until a tech scan exists; then a real true/false.
 */
function techPresenceVerdict(
  biz: HydratedBusiness,
  has: boolean,
): SignalVerdict {
  if (!biz.tech.scanned) return { matched: null };
  return { matched: has };
}

/**
 * B3 · "Not advertising" (per-business). Matches a business that itself runs 0
 * active ads. Mirrors `competitorPressureVerdict`'s `advertising` mode, which
 * reads `biz.ads.activeCount`, but here the verdict is about THIS business, not
 * the cell — the fix for the old `ad_market_prevalence` binding that used a cell
 * number (same for every lead → flagged everyone in a busy ad market).
 *
 * Computable ONLY once the cell's ad scan actually ran: `adMarket.advertiserCount`
 * is populated from the latest AdMarketRun for the business's cell, so a non-null
 * value means "we looked for ads in this market". An un-run cell → null (honest
 * not-computable), never a false "not advertising" on a lead we never scanned.
 *
 * DEPENDENCY (out of scope here): per-business ad activity — `biz.ads.activeCount`
 * from AdLibraryEntry attribution — is populated by a separate ad-attribution
 * fix. Until it lands, `activeCount` may be 0 for businesses that DO advertise,
 * so a scanned cell can still over-report "not advertising". The honest null on
 * an un-run cell is the guard we ship now; the per-business precision follows.
 */
function notAdvertisingVerdict(biz: HydratedBusiness): SignalVerdict {
  if (biz.adMarket.advertiserCount === null) return { matched: null };
  return { matched: biz.ads.activeCount === 0 };
}

/**
 * "No online booking tool" (audit C1) · matches a business with NO on-site
 * booking widget. Not computable until a tech scan exists (so it never fakes a
 * "no booking" verdict on an un-scanned lead — the honest null the strict gate
 * reads). The card's platform tune (Calendly / Acuity / Vagaro / Mindbody /
 * Square / Boulevard) scopes WHICH tools count as booking; the default (all of
 * them) reduces to "has no booking widget at all". A business whose detected
 * tool is NOT among the selected set (or has none) matches — the absence the
 * card promises. Fixes the old tool-chip-vs-GBP-boolean mismatch that returned 0.
 */
function noBookingVerdict(
  sig: ActiveSignal,
  biz: HydratedBusiness,
): SignalVerdict {
  if (!biz.tech.scanned) return { matched: null };
  const name = biz.tech.bookingName; // null when no booking tool detected
  if (name == null) return { matched: true }; // no tool at all → "no booking"
  // A specific tool IS present. If the tune scopes which tools count as booking,
  // a business using a tool OUTSIDE that set still counts as "no [selected] tool".
  if (sig.tune && sig.tune.kind === "platform" && sig.tune.values.length > 0) {
    const selected = sig.tune.values
      .map((v) => v.toLowerCase())
      .filter((v) => v !== "none" && v !== "any");
    if (selected.length === 0) return { matched: false }; // any tool present
    const usesSelected = selected.some((v) => name.includes(v));
    return { matched: !usesSelected };
  }
  return { matched: false }; // has a booking tool, default scope → no match
}

/**
 * Service gap: business is missing ≥ N common services in its cell, where the
 * mode tune picks N (miss1 → 1, miss3 → 3, miss5 → 5). Not computable until we
 * have both the business's services AND its cell's prevalence.
 */
function serviceGapVerdict(
  sig: ActiveSignal,
  biz: HydratedBusiness,
): SignalVerdict {
  const missing = biz.services.missingCommonCount;
  if (missing === null) return { matched: null };
  const mode =
    sig.tune && sig.tune.kind === "mode"
      ? sig.tune.value
      : String(sig.value ?? "miss1");
  const threshold = mode === "miss5" ? 5 : mode === "miss3" ? 3 : 1;
  return { matched: missing >= threshold };
}

/** Website 3+ years old · proxy = Google tenure (yearsOnGoogle) ≥ 3. */
function siteAge3yVerdict(biz: HydratedBusiness): SignalVerdict {
  const years = toNum(biz.business.yearsOnGoogle);
  if (years === null) return { matched: null };
  return { matched: years >= 3 };
}

// ── Cluster-C · cell-relative organic signals ───────────────────────────────

/**
 * Low organic traffic: the business's estimated monthly organic visits sit in
 * the chosen scale band of its cell's organic-traffic distribution. Computed
 * percentile-vs-cell (NOT against the raw value), honoring the scale-band tune.
 * Null when the keyword portfolio isn't scanned OR the cell distribution is too
 * thin (< {@link CELL_DISTRIBUTION_MIN_SAMPLE}) to place the business honestly.
 */
function lowOrganicTrafficVerdict(
  sig: ActiveSignal,
  biz: HydratedBusiness,
): SignalVerdict {
  if (!biz.keywords.scanned) return { matched: null };
  const pct = cellPercentile(
    biz.keywords.estMonthlyVisits,
    biz.cell.organicTraffic,
    biz.cell.sampleSize,
    /* lowerIsBetter */ false, // more visits = higher percentile
  );
  if (pct === null) return { matched: null };
  return { matched: inScaleBand(pct, sig.tune) };
}

/**
 * Search visibility: a composite of organic RANK + organic TRAFFIC vs the cell.
 * We take the business's visibility percentile as the AVERAGE of its
 * traffic-percentile and rank-percentile (each placed in the cell, rank inverted
 * so better = higher), then test it against the scale band. Computable when at
 * least ONE of the two organic dimensions can be placed in the cell; null when
 * neither is (no scan, or the cell distribution is too thin).
 */
function searchVisibilityVerdict(
  sig: ActiveSignal,
  biz: HydratedBusiness,
): SignalVerdict {
  const trafficPct = biz.keywords.scanned
    ? cellPercentile(
        biz.keywords.estMonthlyVisits,
        biz.cell.organicTraffic,
        biz.cell.sampleSize,
        /* lowerIsBetter */ false,
      )
    : null;
  const rankPct = biz.serp
    ? cellPercentile(
        biz.serp.bestOrganicRank,
        biz.cell.organicRank,
        biz.cell.sampleSize,
        /* lowerIsBetter */ true, // rank 1 is best → high percentile
      )
    : null;
  const parts = [trafficPct, rankPct].filter((p): p is number => p !== null);
  if (parts.length === 0) return { matched: null };
  const visibility = parts.reduce((a, b) => a + b, 0) / parts.length;
  return { matched: inScaleBand(visibility, sig.tune) };
}

/**
 * Invisible locally: NOT in the local 3-pack AND organic traffic below the
 * cell's median. Two conditions, both from already-stored data:
 *   - not in 3-pack · `SerpResult.localPackRank > 3` (or no pack rank at all)
 *   - organic below median · the business's organic-traffic percentile < 50
 * Null when there's no SERP scan OR the cell organic-traffic distribution is too
 * thin to define a median (so "below median" can't be judged honestly).
 */
function invisibleLocallyVerdict(biz: HydratedBusiness): SignalVerdict {
  if (!biz.serp) return { matched: null };
  const trafficPct = biz.keywords.scanned
    ? cellPercentile(
        biz.keywords.estMonthlyVisits,
        biz.cell.organicTraffic,
        biz.cell.sampleSize,
        /* lowerIsBetter */ false,
      )
    : null;
  if (trafficPct === null) return { matched: null };
  const notInPack =
    biz.serp.bestLocalPackRank === null || biz.serp.bestLocalPackRank > 3;
  const belowMedian = trafficPct < 50;
  return { matched: notInPack && belowMedian };
}

// ── Cluster-F · recurring complaint theme (built off stored review themes) ───

/**
 * Recurring complaint theme: a chosen theme is present in the business's
 * negative-review themes. Computed off the ALREADY-stored `Review.themes`
 * (rolled up as `negativeThemes`) — no new AI pass. The card's platform tune
 * picks broad theme buckets (wait / billing / staff / results / booking); each
 * maps to the underlying `ALLOWED_THEMES` tags the sentiment classifier emits.
 *
 * IMPORTANT (cost-flag): `Review.themes` is only populated for businesses whose
 * reviews were classified BEFORE the AI sentiment path was retired (R.1). For
 * businesses with reviews but no stored themes this is honestly null — broad
 * coverage would require RE-ENABLING the generalized AI theme pass (a per-review
 * OpenAI cost), which is left for Viktor's cost approval. DfS `placeTopics` is a
 * deliberate non-source here: it's raw noise ("YYC 18", "april 9"), not buckets.
 */
function recurringComplaintThemeVerdict(
  sig: ActiveSignal,
  biz: HydratedBusiness,
): SignalVerdict {
  // No reviews at all → genuinely not computable.
  if (!biz.reviews.hasAnyReview) return { matched: null };
  // Reviews exist but none carry stored themes → the theme classifier never ran
  // on this business (post-R.1). Honest null + the cost-flag above, not a false.
  if (biz.reviews.negativeThemes.length === 0) return { matched: null };

  const selected =
    sig.tune && sig.tune.kind === "platform"
      ? sig.tune.values
      : [String(sig.value ?? "")];
  // Expand each broad chip into the concrete theme tags the classifier emits.
  const wanted = new Set<string>();
  for (const chip of selected) {
    for (const tag of THEME_CHIP_TO_TAGS[chip] ?? [chip]) {
      wanted.add(tag.toLowerCase());
    }
  }
  if (wanted.size === 0) return { matched: null };
  const present = new Set(
    biz.reviews.negativeThemes.map((t) => t.toLowerCase()),
  );
  for (const w of wanted) if (present.has(w)) return { matched: true };
  return { matched: false };
}

/**
 * Map the card's broad theme chips to the concrete `ALLOWED_THEMES` tags the
 * sentiment classifier emits (services/ai/sentiment.ts). A chip matches when ANY
 * of its tags appears in the business's negative themes.
 */
const THEME_CHIP_TO_TAGS: Record<string, string[]> = {
  wait: ["wait_time", "missed_appointment"],
  billing: ["billing_issue", "pricing", "value"],
  staff: ["staff", "rude", "communication"],
  results: ["results", "expertise", "cleanliness"],
  booking: ["booking", "missed_appointment"],
};

// ── Cluster-H · multi-location + competitor pressure ────────────────────────

/**
 * Multi-location: the business runs ≥ {@link MULTI_LOCATION_MIN} locations in
 * its metro, decided by the same-metro same-brand cluster computed in hydration
 * ({@link HydratedCell.locationCount}). Null when the metro/name isn't known.
 */
function multiLocationVerdict(biz: HydratedBusiness): SignalVerdict {
  const n = biz.cell.locationCount;
  if (n === null) return { matched: null };
  return { matched: n >= MULTI_LOCATION_MIN };
}

/**
 * Competitor pressure (mode tune):
 *   - advertising · rivals in the cell are running ads (AdMarketRun
 *     advertiserCount > 0) while THIS business isn't advertising.
 *   - newentrant  · a same-cell peer first appeared on Google within
 *     {@link NEW_ENTRANT_WINDOW_DAYS}.
 *   - outspend    · null-TODO — no per-business ad-spend data is stored, so
 *     "being outspent" can't be computed. (FLAG: needs spend collection.)
 * Each mode is null when its prerequisite data is absent — never a fake false.
 */
function competitorPressureVerdict(
  sig: ActiveSignal,
  biz: HydratedBusiness,
): SignalVerdict {
  const mode =
    sig.tune && sig.tune.kind === "mode"
      ? sig.tune.value
      : String(sig.value ?? "advertising");

  switch (mode) {
    case "advertising": {
      const advertisers = biz.adMarket.advertiserCount;
      if (advertisers === null) return { matched: null };
      // Rivals are advertising in the cell AND this business is NOT (so it's
      // under pressure, not part of the advertising set). The business's own
      // active-ad count is computable from the ad rollup at $0.
      const selfAdvertising = biz.ads.activeCount > 0;
      return { matched: advertisers > 0 && !selfAdvertising };
    }
    case "newentrant": {
      const recent = biz.cell.hasRecentNewEntrant;
      if (recent === null) return { matched: null };
      return { matched: recent };
    }
    case "outspend":
      // TODO(flag-cost): no per-business ad-spend is stored. "Being outspent"
      // needs spend data we don't collect → not computable until added.
      return { matched: null };
    default:
      return { matched: null };
  }
}

/** Resolve the registry key for a SigMeta key (falls back through SIG_META). */
function resolveRegistryKey(metaKey: string): string | undefined {
  const meta = sigMeta(metaKey);
  if (!meta) return undefined;
  return meta.registryKey;
}

/** True if the resolved value matches any of the selected platform chips. */
function matchPlatform(values: string[], resolved: unknown): boolean {
  if (values.length === 0) return false;
  const wanted = new Set(values.map((v) => v.toLowerCase()));
  // resolved may be a single token (cms name / format) or an array of tokens.
  if (Array.isArray(resolved)) {
    return resolved.some((r) => wanted.has(String(r).toLowerCase()));
  }
  return wanted.has(String(resolved).toLowerCase());
}

function toNum(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim().length > 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate a set of active signals against one business and roll up the match%.
 *
 * `matchPct = matchedCount / applicableCount`, where applicable EXCLUDES signals
 * that returned `null` (not computable). A business with no applicable signals
 * gets matchPct 0. This is what preview/discovery/workbench will call to filter
 * the cohort + render the per-business match%.
 */
export function resolveMatches(
  activeSignals: readonly ActiveSignal[],
  biz: HydratedBusiness,
  now: Date = new Date(),
): MatchResult {
  const perSignal: Record<string, boolean | null> = {};
  let matchedCount = 0;
  let applicableCount = 0;

  for (const sig of activeSignals) {
    const { matched } = evaluateSignal(sig, biz, now);
    perSignal[sig.key] = matched;
    if (matched === null) continue;
    applicableCount += 1;
    if (matched) matchedCount += 1;
  }

  const matchPct = applicableCount === 0 ? 0 : matchedCount / applicableCount;

  return { perSignal, matchedCount, applicableCount, matchPct };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hydration — the ONLY DB-touching part. Batched, read-only, snapshots only.
// ─────────────────────────────────────────────────────────────────────────────

/** Star ratings that count as "negative" for theme + unanswered rollups. */
const NEGATIVE_STARS = 2;

/**
 * Batch-load the stored data the goal signals read for a set of businesses.
 * One `findMany` per relation with `where: { businessId: { in: ids } }` (no
 * N+1), selecting only the fields the resolver needs. Read-only and
 * agency-agnostic — the agency scope is applied upstream (the businesses are
 * already the agency's discovery cohort).
 *
 * Reads ONLY from stored rows (snapshots, audits, reviews, serp, ads, tech,
 * keywords, contacts, findings) — never a live external API. Returns a Map
 * keyed by businessId; businesses with no related rows still get an entry with
 * empty/null rollups so the evaluator can return null verdicts cleanly.
 */
export async function hydrateBusinessForSignals(
  businessIds: string[],
): Promise<Map<string, HydratedBusiness>> {
  const ids = Array.from(new Set(businessIds)).filter((id) => id.length > 0);
  const out = new Map<string, HydratedBusiness>();
  if (ids.length === 0) return out;

  const idFilter = { businessId: { in: ids } };
  // Hoisted so the new-entrant pre-pass (inside the Promise.all) shares the same
  // clock as the rollups below. A single `now` keeps the whole hydration pass
  // deterministic for a given call.
  const now = new Date();

  const [
    businesses,
    snapshots,
    audits,
    reviews,
    serps,
    ads,
    tech,
    keywords,
    contacts,
    findings,
    businessServices,
    adMarketRuns,
    cellPrevalence,
    cellOrganicRefs,
    cellChainFacts,
  ] = await Promise.all([
    prisma.business.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        phone: true,
        website: true,
        emailVerifiedAt: true,
        instagramHandle: true,
        instagramFollowers: true,
        categories: true,
        category: true,
        city: true,
        province: true,
        country: true,
        rating: true,
        reviewCount: true,
        photosCount: true,
        isClaimed: true,
        isActive: true,
        yearsOnGoogle: true,
        ownerUserId: true,
        gbpHasBooking: true,
        openStatus: true,
        reachability: true,
        reachableChannelCount: true,
        isHidden: true,
        lastReviewAt: true,
        lastRefreshedAt: true,
        complianceFlags: true,
        metroSlug: true,
        cellKey: true,
        // Chain-clustering inputs for multi_location (Cluster H).
        name: true,
        domain: true,
        googleCid: true,
        firstSeenOnGoogle: true,
      },
    }),
    prisma.businessSnapshot.findMany({
      where: idFilter,
      orderBy: { snapshotDate: "desc" },
      select: {
        businessId: true,
        snapshotDate: true,
        rating: true,
        reviewCount: true,
        replyRate: true,
        velocityLast30d: true,
        velocityPrev30d: true,
        mapslyScore: true,
        msiRank: true,
        msiPercentile: true,
        reviewLifecycle: true,
        reputationScore: true,
      },
    }),
    prisma.lighthouseAudit.findMany({
      where: idFilter,
      orderBy: { auditedAt: "desc" },
      select: {
        businessId: true,
        performance: true,
        accessibility: true,
        seo: true,
        bestPractices: true,
        lcp: true,
        cls: true,
        inp: true,
        fcp: true,
        perfSavingsMs: true,
        a11yViolationCount: true,
        isOnHttps: true,
        hasLocalBusinessSchema: true,
        hasFaqSchema: true,
      },
    }),
    prisma.review.findMany({
      where: idFilter,
      select: {
        businessId: true,
        stars: true,
        ownerReplied: true,
        postedAt: true,
        sentiment: true,
        themes: true,
      },
    }),
    prisma.serpResult.findMany({
      where: idFilter,
      select: {
        businessId: true,
        localPackRank: true,
        organicRank: true,
        isBrandQuery: true,
      },
    }),
    prisma.adLibraryEntry.findMany({
      where: { ...idFilter, isActive: true },
      select: {
        businessId: true,
        isActive: true,
        displayFormat: true,
        startedAt: true,
        landingUrl: true,
      },
    }),
    prisma.businessTech.findMany({
      where: idFilter,
      select: {
        businessId: true,
        name: true,
        category: true,
        confidence: true,
      },
    }),
    prisma.businessKeyword.findMany({
      where: idFilter,
      select: {
        businessId: true,
        latestEstMonthlyVisits: true,
        isDown: true,
        isUp: true,
      },
    }),
    prisma.contact.findMany({
      where: idFilter,
      select: {
        businessId: true,
        channel: true,
        role: true,
      },
    }),
    prisma.playbookFinding.findMany({
      where: { ...idFilter, status: "flagged" },
      select: {
        businessId: true,
        signalKey: true,
        group: true,
        value: true,
        confidence: true,
      },
    }),
    // Per-business services taxonomy (active, canonicalized) for the service-gap
    // signal. Only the canonicalKey matters — that's what cell prevalence keys on.
    prisma.businessService.findMany({
      where: { ...idFilter, isActive: true },
      select: { businessId: true, canonicalKey: true },
    }),
    // Resolve cell prevalence per business via their cellKey (latest run).
    prisma.business
      .findMany({
        where: { id: { in: ids } },
        select: { id: true, cellKey: true },
      })
      .then(async (rows) => {
        const cellKeys = Array.from(
          new Set(rows.map((r) => r.cellKey).filter((k): k is string => !!k)),
        );
        if (cellKeys.length === 0)
          return [] as {
            businessId: string;
            advertiserCount: number;
          }[];
        // TRUTH UNIFICATION (2026-07-06) · META only. advertiserCount is the
        // Meta Ad Library market facet; the per-business GOOGLE telemetry rows
        // (advertiserCount 0/1) were newest and CLOBBERED the cell's value.
        const runs = await prisma.adMarketRun.findMany({
          where: { cellKey: { in: cellKeys }, platform: "META" },
          orderBy: { ranAt: "desc" },
          select: { cellKey: true, advertiserCount: true },
        });
        // Latest run per cellKey (rows are desc-ordered → first wins).
        const latestByCell = new Map<string, number>();
        for (const run of runs) {
          if (!latestByCell.has(run.cellKey))
            latestByCell.set(run.cellKey, run.advertiserCount);
        }
        return rows
          .filter((r) => r.cellKey && latestByCell.has(r.cellKey))
          .map((r) => ({
            businessId: r.id,
            advertiserCount: latestByCell.get(r.cellKey as string) as number,
          }));
      }),
    // Common-service canonicalKeys per cell (prevalence ≥ threshold), resolved
    // via each business's cellKey. Drives the service-gap "missing N common
    // services" count. Returns cellKey → Set<canonicalKey>.
    prisma.business
      .findMany({
        where: { id: { in: ids } },
        select: { id: true, cellKey: true },
      })
      .then(async (rows) => {
        const cellKeys = Array.from(
          new Set(rows.map((r) => r.cellKey).filter((k): k is string => !!k)),
        );
        if (cellKeys.length === 0) return new Map<string, Set<string>>();
        const prevRows = await prisma.cellServicePrevalence.findMany({
          where: {
            cellKey: { in: cellKeys },
            prevalence: { gte: COMMON_SERVICE_PREVALENCE },
          },
          select: { cellKey: true, canonicalKey: true },
        });
        const byCell = new Map<string, Set<string>>();
        for (const p of prevRows) {
          const set = byCell.get(p.cellKey) ?? new Set<string>();
          set.add(p.canonicalKey);
          byCell.set(p.cellKey, set);
        }
        return byCell;
      }),
    // Cluster-C · per-cell organic distributions (sampleSize + breakpoints) from
    // the already-computed CellMetric rows. Returns cellKey → CellOrganicRef.
    loadCellOrganicRefs(ids),
    // Cluster-H · same-metro chain clusters (multi_location) + per-cell recent
    // new-entrant flags (competitor_pressure). One bounded pre-pass over the
    // cohort's metros — already-stored Business rows, no external data.
    loadCellChainFacts(ids, now),
  ]);

  // SerpResult / AdLibraryEntry carry a nullable businessId in Prisma (they can
  // reference a not-yet-indexed competitor). We queried by `businessId in ids`,
  // so every row here has one — narrow the type so the grouping helpers accept
  // them without a cast that hides a real null.
  const serpsWithBiz = serps.filter(
    (r): r is typeof r & { businessId: string } => r.businessId != null,
  );
  const adsWithBiz = ads.filter(
    (r): r is typeof r & { businessId: string } => r.businessId != null,
  );

  // Index multi-row relations by businessId. Snapshots stay grouped (desc) so
  // the rollup can read both the latest AND a ~90-day-prior row for the rating
  // trend; everything else keeps its first/grouped shape.
  const snapshotsByBiz = groupByBiz(snapshots);
  const auditByBiz = firstByBiz(audits);
  const reviewsByBiz = groupByBiz(reviews);
  const serpsByBiz = groupByBiz(serpsWithBiz);
  const adsByBiz = groupByBiz(adsWithBiz);
  const techByBiz = groupByBiz(tech);
  const keywordsByBiz = groupByBiz(keywords);
  const contactsByBiz = groupByBiz(contacts);
  const findingsByBiz = groupByBiz(findings);
  const servicesByBiz = groupByBiz(businessServices);
  const adMarketByBiz = new Map(
    adMarketRuns.map((r) => [r.businessId, r.advertiserCount]),
  );

  for (const b of businesses) {
    const cellKey = typeof b.cellKey === "string" ? b.cellKey : null;
    out.set(b.id, {
      id: b.id,
      business: b as Record<string, unknown>,
      snapshot: rollupSnapshot(snapshotsByBiz.get(b.id) ?? [], now),
      lighthouse: rollupLighthouse(auditByBiz.get(b.id) ?? null),
      reviews: rollupReviews(reviewsByBiz.get(b.id) ?? [], now),
      serp: rollupSerp(serpsByBiz.get(b.id) ?? null),
      ads: rollupAds(adsByBiz.get(b.id) ?? [], now),
      tech: rollupTech(techByBiz.get(b.id) ?? []),
      adMarket: { advertiserCount: adMarketByBiz.get(b.id) ?? null },
      keywords: rollupKeywords(keywordsByBiz.get(b.id) ?? []),
      contacts: rollupContacts(contactsByBiz.get(b.id) ?? []),
      findings: rollupFindings(findingsByBiz.get(b.id) ?? []),
      services: rollupServices(
        servicesByBiz.get(b.id) ?? [],
        cellKey ? (cellPrevalence.get(cellKey) ?? null) : null,
      ),
      cell: rollupCell(b, cellKey, cellOrganicRefs, cellChainFacts),
    });
  }

  return out;
}

// ── Cluster-C / Cluster-H cell pre-passes (DB-touching, bounded, $0) ─────────

/** Per-cell organic distribution reference, read from CellMetric. */
interface CellOrganicRef {
  sampleSize: number;
  organicTraffic: Breakpoints | null;
  organicRank: Breakpoints | null;
}

/**
 * Load the organic distributions (organic-traffic + organic-rank breakpoints +
 * sampleSize) for every cell the cohort's businesses sit in, from the already-
 * computed `CellMetric` rows. ZERO external cost — a single read keyed on the
 * cohort's distinct cellKeys. Returns cellKey → {@link CellOrganicRef}.
 */
async function loadCellOrganicRefs(
  ids: string[],
): Promise<Map<string, CellOrganicRef>> {
  const out = new Map<string, CellOrganicRef>();
  const rows = await prisma.business.findMany({
    where: { id: { in: ids } },
    select: { cellKey: true },
  });
  const cellKeys = Array.from(
    new Set(rows.map((r) => r.cellKey).filter((k): k is string => !!k)),
  );
  if (cellKeys.length === 0) return out;

  const metrics = await prisma.cellMetric.findMany({
    where: { cellKey: { in: cellKeys } },
    select: {
      cellKey: true,
      sampleSize: true,
      confidence: true,
      adPrevalence: true,
      distributions: true,
    },
  });
  for (const m of metrics) {
    // parseCellReference reads the distributions bag (incl. the new organic keys)
    // into typed Breakpoints, so the two paths can't diverge.
    const ref = parseCellReference(m);
    out.set(m.cellKey, {
      sampleSize: m.sampleSize,
      organicTraffic: ref?.organicTraffic ?? null,
      organicRank: ref?.organicRank ?? null,
    });
  }
  return out;
}

/** Per-cell chain-clustering + new-entrant facts for the cohort's businesses. */
interface CellChainFacts {
  /** businessId → how many same-metro locations share its normalized brand. */
  locationCountByBiz: Map<string, number>;
  /** cellKey → whether a same-cell peer first appeared within the window. */
  newEntrantByCell: Map<string, boolean>;
}

/**
 * Bounded pre-pass over the cohort's METROS that computes, from already-stored
 * Business rows (no external data):
 *
 *   1. multi_location · for each cohort business, how many SAME-METRO Business
 *      rows share its normalized brand (slugified name, or a shared
 *      domain-host / googleCid). A brand with ≥2 same-metro rows is a chain.
 *   2. new-entrant · for each cohort cellKey, whether ANY same-cell Business
 *      first appeared on Google within {@link NEW_ENTRANT_WINDOW_DAYS}.
 *
 * Scoped to the cohort's metroSlugs/cellKeys (not the whole 2.1M index) and
 * capped at {@link CHAIN_PREPASS_SCAN_LIMIT} rows for safety.
 */
async function loadCellChainFacts(
  ids: string[],
  now: Date,
): Promise<CellChainFacts> {
  const locationCountByBiz = new Map<string, number>();
  const newEntrantByCell = new Map<string, boolean>();

  const cohort = await prisma.business.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      domain: true,
      googleCid: true,
      metroSlug: true,
      cellKey: true,
    },
  });

  const metroSlugs = Array.from(
    new Set(cohort.map((b) => b.metroSlug).filter((m): m is string => !!m)),
  );
  if (metroSlugs.length === 0) return { locationCountByBiz, newEntrantByCell };

  // All active businesses in the cohort's metros — the universe a same-metro
  // chain/new-entrant is found within. Bounded scan; cohort metros are small.
  const peers = await prisma.business.findMany({
    where: { metroSlug: { in: metroSlugs }, isActive: true },
    select: {
      id: true,
      name: true,
      domain: true,
      googleCid: true,
      metroSlug: true,
      cellKey: true,
      firstSeenOnGoogle: true,
    },
    take: CHAIN_PREPASS_SCAN_LIMIT,
  });

  // 1 · brand cluster counts per (metro, brandKey). A peer contributes once.
  const brandCounts = new Map<string, number>();
  for (const p of peers) {
    const brand = brandKeyOf(p.name, p.domain, p.googleCid);
    if (!brand || !p.metroSlug) continue;
    const key = `${p.metroSlug}|${brand}`;
    brandCounts.set(key, (brandCounts.get(key) ?? 0) + 1);
  }
  for (const b of cohort) {
    const brand = brandKeyOf(b.name, b.domain, b.googleCid);
    if (!brand || !b.metroSlug) continue; // unknown brand/metro → leave null
    const key = `${b.metroSlug}|${brand}`;
    locationCountByBiz.set(b.id, brandCounts.get(key) ?? 1);
  }

  // 2 · per-cell recent new entrant. A cell is "computable" once at least one
  // peer in it has a firstSeenOnGoogle date (else the flag stays absent → null).
  const windowStart = now.getTime() - NEW_ENTRANT_WINDOW_DAYS * 86_400_000;
  const cellHasDatedPeer = new Set<string>();
  for (const p of peers) {
    if (!p.cellKey || p.firstSeenOnGoogle == null) continue;
    cellHasDatedPeer.add(p.cellKey);
    if (p.firstSeenOnGoogle.getTime() >= windowStart) {
      newEntrantByCell.set(p.cellKey, true);
    }
  }
  // Cells that have a dated peer but no recent one → an explicit false (not null).
  for (const cellKey of cellHasDatedPeer) {
    if (!newEntrantByCell.has(cellKey)) newEntrantByCell.set(cellKey, false);
  }

  return { locationCountByBiz, newEntrantByCell };
}

/** Max same-metro peers scanned in the chain pre-pass (scale guard). */
const CHAIN_PREPASS_SCAN_LIMIT = 5000;

/**
 * Normalized brand key for chain clustering: prefer a shared registrable-ish
 * domain host, then the googleCid (same listing root), then the slugified name.
 * Returns null when none is usable (so the business's locationCount stays null →
 * multi_location not-computable). Pure.
 */
export function brandKeyOf(
  name: string | null | undefined,
  domain: string | null | undefined,
  googleCid: string | null | undefined,
): string | null {
  const host = normalizeHost(domain);
  if (host) return `d:${host}`;
  if (googleCid && googleCid.trim().length > 0) return `c:${googleCid.trim()}`;
  const slug = name ? slugify(name) : "";
  return slug.length > 0 ? `n:${slug}` : null;
}

/** Lower-cased host without a leading www., or null. */
function normalizeHost(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const raw = domain.trim().toLowerCase();
  if (raw.length === 0) return null;
  // domain is a pre-extracted host; strip a leading www. for chain matching.
  return raw.replace(/^www\./, "") || null;
}

/**
 * Build the `cell` hydration slot for one business. Pure. `locationCount` is
 * keyed on businessId (independent of cellKey — chain clustering is per-metro);
 * the organic refs + new-entrant flag are keyed on the business's cellKey.
 */
function rollupCell(
  b: { id: string },
  cellKey: string | null,
  organicRefs: Map<string, CellOrganicRef>,
  chain: CellChainFacts,
): HydratedCell {
  const ref = cellKey ? (organicRefs.get(cellKey) ?? null) : null;
  return {
    sampleSize: ref?.sampleSize ?? null,
    organicTraffic: ref?.organicTraffic ?? null,
    organicRank: ref?.organicRank ?? null,
    locationCount: chain.locationCountByBiz.get(b.id) ?? null,
    hasRecentNewEntrant: cellKey
      ? (chain.newEntrantByCell.get(cellKey) ?? null)
      : null,
  };
}

// ── Rollup helpers (pure, exported for unit-testing the aggregation logic). ──

type WithBiz = { businessId: string };

function groupByBiz<T extends WithBiz>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const row of rows) {
    const arr = m.get(row.businessId);
    if (arr) arr.push(row);
    else m.set(row.businessId, [row]);
  }
  return m;
}

/** Keep the FIRST row per business (callers pass desc-ordered rows). */
function firstByBiz<T extends WithBiz>(rows: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const row of rows) {
    if (!m.has(row.businessId)) m.set(row.businessId, row);
  }
  return m;
}

/** A snapshot row carrying the fields the rating-trend rollup reads. */
interface SnapshotRow {
  snapshotDate: Date;
  rating: number | null;
  [key: string]: unknown;
}

/** Window (days) around 90 days used to pick the "prior" snapshot. */
const RATING_TREND_DAYS = 90;
const RATING_TREND_TOLERANCE_DAYS = 45;

/**
 * Reduce a business's desc-ordered snapshots to the LATEST record, augmented
 * with `priorRating` — the rating from the snapshot closest to ~90 days before
 * the latest (within a ±45d tolerance). `priorRating` is null when there's no
 * suitable historical snapshot, which makes `rating_slipping` not-computable.
 * Returns null when the business has no snapshot at all.
 */
export function rollupSnapshot(
  rows: SnapshotRow[],
  now: Date,
): Record<string, unknown> | null {
  if (rows.length === 0) return null;
  // Rows arrive desc by snapshotDate → the first is the latest.
  const latest = rows[0];
  const latestTime = latest.snapshotDate.getTime();
  const target = latestTime - RATING_TREND_DAYS * 86_400_000;
  const tolerance = RATING_TREND_TOLERANCE_DAYS * 86_400_000;

  let prior: SnapshotRow | null = null;
  let bestDist = Infinity;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (r.rating == null) continue;
    const dist = Math.abs(r.snapshotDate.getTime() - target);
    // Only consider snapshots strictly older than the latest, near the target.
    if (r.snapshotDate.getTime() < latestTime && dist <= tolerance) {
      if (dist < bestDist) {
        bestDist = dist;
        prior = r;
      }
    }
  }

  void now;
  return { ...latest, priorRating: prior ? prior.rating : null };
}

interface LighthouseRow {
  performance: number | null;
  accessibility: number | null;
  seo: number | null;
  bestPractices: number | null;
  lcp: number | null;
  cls: number | null;
  inp: number | null;
  fcp: number | null;
  perfSavingsMs: number | null;
  a11yViolationCount: number | null;
  isOnHttps: boolean | null;
  hasLocalBusinessSchema: boolean | null;
  hasFaqSchema: boolean | null;
}

export function rollupLighthouse(
  row: LighthouseRow | null,
): HydratedLighthouse | null {
  if (!row) return null;
  return {
    performance: row.performance,
    accessibility: row.accessibility,
    seo: row.seo,
    bestPractices: row.bestPractices,
    lcp: row.lcp,
    cls: row.cls,
    inp: row.inp,
    fcp: row.fcp,
    perfSavingsMs: row.perfSavingsMs,
    a11yViolationCount: row.a11yViolationCount,
    isOnHttps: row.isOnHttps,
    hasLocalBusinessSchema: row.hasLocalBusinessSchema,
    hasFaqSchema: row.hasFaqSchema,
  };
}

interface ReviewRow {
  stars: number;
  ownerReplied: boolean;
  postedAt: Date;
  sentiment: string | null;
  themes: string[];
}

/** Recent-spike window (days) for the reputation-fire ≤2★ burst count. */
const REPUTATION_FIRE_WINDOW_DAYS = 30;

export function rollupReviews(rows: ReviewRow[], now: Date): HydratedReviews {
  let unanswered1Star = 0;
  let unansweredNegative = 0;
  let unanswered = 0;
  let recentNegative = 0;
  const negativeThemes = new Set<string>();
  let lastReviewAt: Date | null = null;

  const spikeCutoff = now.getTime() - REPUTATION_FIRE_WINDOW_DAYS * 86_400_000;

  for (const r of rows) {
    if (!r.ownerReplied) {
      unanswered += 1;
      if (r.stars === 1) unanswered1Star += 1;
      if (r.stars <= NEGATIVE_STARS) unansweredNegative += 1;
    }
    if (r.stars <= NEGATIVE_STARS || r.sentiment === "NEGATIVE") {
      for (const t of r.themes ?? []) negativeThemes.add(t.toLowerCase());
    }
    // Reputation-fire counts ≤2★ posted inside the recent window — answered or
    // not — since a spike is about the influx of negatives.
    if (r.stars <= NEGATIVE_STARS && r.postedAt.getTime() >= spikeCutoff) {
      recentNegative += 1;
    }
    if (!lastReviewAt || r.postedAt.getTime() > lastReviewAt.getTime()) {
      lastReviewAt = r.postedAt;
    }
  }

  return {
    unanswered1StarCount: unanswered1Star,
    unansweredNegativeCount: unansweredNegative,
    unansweredCount: unanswered,
    hasNegativeTheme: negativeThemes.size > 0,
    negativeThemes: Array.from(negativeThemes),
    lastReviewAt,
    recentNegativeCount: recentNegative,
    hasAnyReview: rows.length > 0,
  };
}

interface SerpRow {
  localPackRank: number | null;
  organicRank: number | null;
  isBrandQuery: boolean;
}

export function rollupSerp(rows: SerpRow[] | null): HydratedSerp | null {
  if (!rows || rows.length === 0) return null;
  let bestLocalPackRank: number | null = null;
  let bestOrganicRank: number | null = null;
  let brandedOrganicRank: number | null = null;
  let hasBrandQuery = false;
  let nonBrandRankedCount = 0;

  for (const s of rows) {
    if (s.localPackRank != null) {
      bestLocalPackRank =
        bestLocalPackRank == null
          ? s.localPackRank
          : Math.min(bestLocalPackRank, s.localPackRank);
    }
    if (s.organicRank != null) {
      bestOrganicRank =
        bestOrganicRank == null
          ? s.organicRank
          : Math.min(bestOrganicRank, s.organicRank);
    }
    if (s.isBrandQuery) {
      hasBrandQuery = true;
      if (s.organicRank != null) {
        brandedOrganicRank =
          brandedOrganicRank == null
            ? s.organicRank
            : Math.min(brandedOrganicRank, s.organicRank);
      }
    } else if (s.organicRank != null && s.organicRank <= 10) {
      nonBrandRankedCount += 1;
    }
  }

  return {
    bestLocalPackRank,
    bestOrganicRank,
    brandedOrganicRank,
    hasBrandQuery,
    nonBrandRankedCount,
  };
}

interface AdRow {
  isActive: boolean;
  displayFormat: string | null;
  startedAt: Date | null;
  landingUrl: string | null;
}

export function rollupAds(rows: AdRow[], now: Date): HydratedAds {
  const active = rows.filter((r) => r.isActive);
  const formats = new Set<string>();
  let newestStart: Date | null = null;
  const hosts = new Set<string>();
  let anyLanding = false;
  let allHomepage = true;

  for (const a of active) {
    if (a.displayFormat) formats.add(a.displayFormat.toLowerCase());
    if (a.startedAt) {
      newestStart =
        newestStart == null || a.startedAt.getTime() > newestStart.getTime()
          ? a.startedAt
          : newestStart;
    }
    if (a.landingUrl) {
      anyLanding = true;
      const { host, isRoot } = parseUrl(a.landingUrl);
      if (host) hosts.add(host);
      if (!isRoot) allHomepage = false;
    }
  }

  return {
    activeCount: active.length,
    hasVideo: formats.has("video"),
    formats: Array.from(formats),
    newestAgeDays: newestStart ? ageInDays(newestStart, now) : null,
    landingHostCount: hosts.size,
    landingIsHomepageOnly: anyLanding ? allHomepage : null,
  };
}

interface TechRow {
  name: string;
  category: string;
  confidence: number;
}

export function rollupTech(rows: TechRow[]): HydratedTech {
  if (rows.length === 0) {
    return {
      scanned: false,
      cmsName: null,
      bookingName: null,
      hasAnalytics: false,
      hasMetaPixel: false,
      hasBooking: false,
      hasChat: false,
      hasEcommerce: false,
      hasConsent: false,
    };
  }
  const cats = new Set(rows.map((r) => r.category));
  // Highest-confidence CMS name.
  const cms = rows
    .filter((r) => r.category === "CMS")
    .sort((a, b) => b.confidence - a.confidence)[0];
  // Highest-confidence BOOKING tool name (audit C1/C2) — the exact service.
  const booking = rows
    .filter((r) => r.category === "BOOKING")
    .sort((a, b) => b.confidence - a.confidence)[0];
  // Meta pixel is a PIXEL-category tech whose name names Meta/Facebook.
  const hasMetaPixel = rows.some(
    (r) => r.category === "PIXEL" && /meta|facebook|fb/i.test(r.name),
  );

  return {
    scanned: true,
    cmsName: cms ? cms.name.toLowerCase() : null,
    bookingName: booking ? booking.name.toLowerCase() : null,
    hasAnalytics: cats.has("ANALYTICS"),
    hasMetaPixel,
    hasBooking: cats.has("BOOKING"),
    hasChat: cats.has("CHAT"),
    hasEcommerce: cats.has("ECOMMERCE"),
    hasConsent: cats.has("CONSENT"),
  };
}

interface KeywordRow {
  latestEstMonthlyVisits: number | null;
  isDown: boolean;
  isUp: boolean;
}

export function rollupKeywords(rows: KeywordRow[]): HydratedKeywords {
  if (rows.length === 0) {
    return {
      scanned: false,
      estMonthlyVisits: null,
      anyDown: false,
      anyUp: false,
    };
  }
  let sum = 0;
  let anyVisits = false;
  let anyDown = false;
  let anyUp = false;
  for (const k of rows) {
    if (k.latestEstMonthlyVisits != null) {
      sum += k.latestEstMonthlyVisits;
      anyVisits = true;
    }
    if (k.isDown) anyDown = true;
    if (k.isUp) anyUp = true;
  }
  return {
    scanned: true,
    estMonthlyVisits: anyVisits ? sum : null,
    anyDown,
    anyUp,
  };
}

interface ContactRow {
  channel: string;
  role: string;
}

const SOCIAL_CHANNELS = new Set([
  "FACEBOOK",
  "INSTAGRAM",
  "LINKEDIN",
  "TIKTOK",
  "YOUTUBE",
  "X",
  "YELP",
]);

export function rollupContacts(rows: ContactRow[]): HydratedContacts {
  let emailCount = 0;
  let phoneCount = 0;
  const socials = new Set<string>();
  let hasOwnerContact = false;

  for (const c of rows) {
    if (c.channel === "EMAIL") emailCount += 1;
    else if (c.channel === "PHONE" || c.channel === "WHATSAPP") phoneCount += 1;
    else if (SOCIAL_CHANNELS.has(c.channel)) socials.add(c.channel);
    if (c.role === "OWNER" || c.role === "PERSONAL") hasOwnerContact = true;
  }

  return {
    emailCount,
    phoneCount,
    socialChannelCount: socials.size,
    hasOwnerContact,
    totalCount: rows.length,
  };
}

interface FindingRow {
  signalKey: string;
  group?: string | null;
  value: string;
  confidence: string;
}

export function rollupFindings(rows: FindingRow[]): HydratedFindings {
  const flaggedKeys = new Set<string>();
  const flaggedGroups = new Set<string>();
  const valueByKey: Record<string, string> = {};
  const confidenceByKey: Record<string, string> = {};
  for (const f of rows) {
    flaggedKeys.add(f.signalKey);
    if (f.group) flaggedGroups.add(f.group);
    valueByKey[f.signalKey] = f.value;
    confidenceByKey[f.signalKey] = f.confidence;
  }
  return { flaggedKeys, flaggedGroups, valueByKey, confidenceByKey };
}

interface BusinessServiceRow {
  canonicalKey: string | null;
}

/**
 * Service-gap rollup: count how many of the cell's common services the business
 * is MISSING. `commonKeys` is the set of canonicalKeys with cell prevalence ≥
 * threshold (null when no prevalence is computed for the cell). Returns a null
 * count — making the signal not-computable — when either the business has no
 * services scanned OR the cell has no prevalence data.
 */
export function rollupServices(
  rows: BusinessServiceRow[],
  commonKeys: Set<string> | null,
): HydratedServices {
  const scanned = rows.length > 0;
  if (!scanned || !commonKeys || commonKeys.size === 0) {
    return { scanned, missingCommonCount: null };
  }
  const offered = new Set<string>();
  for (const r of rows) {
    if (r.canonicalKey) offered.add(r.canonicalKey);
  }
  let missing = 0;
  for (const key of commonKeys) {
    if (!offered.has(key)) missing += 1;
  }
  return { scanned, missingCommonCount: missing };
}

// ── URL helper (no external dep; handles missing scheme gracefully). ──
function parseUrl(raw: string): { host: string | null; isRoot: boolean } {
  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    try {
      url = new URL(`https://${raw}`);
    } catch {
      return { host: null, isRoot: false };
    }
  }
  const path = url.pathname.replace(/\/+$/, "");
  return { host: url.host.toLowerCase(), isRoot: path === "" };
}
