/**
 * Signal → research-family entitlement map · Phase 1 (entitlement model)
 *
 * The single source of truth for "which PAID research family does a signal
 * need to be evaluated?" — used by the billing decouple (Phase 2), the read +
 * FILTER gate (Phase 3 · G9), and FT-2's basic-only search filter.
 *
 * A signal's family is derived from its registry `source` (the canonical
 * source→family derivation documented in goal-templates.ts), with an explicit
 * OVERRIDES table for the ambiguous cases the source alone can't disambiguate:
 *   - `rating` / `review_count`: registry source is `dataforseo:reviews` but the
 *     raw values are Maps-listing numbers on `Business.*` (never Review rows),
 *     so they are DISCOVERY/basic — see signal-eval `resolveBusinessField`.
 *   - `computed-from-snapshots`: BusinessSnapshot holds BOTH discovery-derived
 *     Maps numbers (rating/review-count gaps, first-seen competitors → basic)
 *     AND reviews/serp/ads analytics (msi, reputation, share-of-voice → gated),
 *     so each such signal is pinned explicitly.
 *   - `playbook`: composites over evidence families → pinned to a gated
 *     evidence family so they lock in search mode.
 *
 * `null` = the signal is evaluable from the FREE discovery listing (Google/Maps
 * profile) or internal state — no entitlement required. `"contacts"` is a real
 * paid family but is the base a taken lead always carries, so it counts as
 * "basic" for the FT-2 search filter (see {@link isSearchBasicSignal}).
 *
 * NOTE (follow-up): unify `familiesForSignals` (card-layer, ~48 carded signals)
 * onto this map so there is one derivation for all 105 signals.
 */

import { SIGNALS } from "./registry";

/**
 * The paid research families an entitlement can be granted for. Mirrors the
 * billable `EnrichmentType` set (excludes the display-only PLAYBOOK fold).
 */
export type ResearchFamily =
  | "contacts"
  | "services"
  | "tech"
  | "reviews"
  | "meta_ads"
  | "google_ads"
  | "serp"
  | "lighthouse"
  | "ai_research";

/** Base derivation: registry `source` → the family it reads. `null` = free/discovery. */
const SOURCE_FAMILY: Readonly<Record<string, ResearchFamily | null>> = {
  "dataforseo:maps": null, // Google Business Profile fields (discovery)
  discovery: null,
  internal: null, // internal state (exclusions, isActive, freshness, metro)
  "computed-from-contacts": "contacts",
  "computed-from-reviews": "reviews",
  "dataforseo:reviews": "reviews", // rating/review_count overridden → null below
  "dataforseo:lighthouse": "lighthouse",
  "dataforseo:serp": "serp",
  "meta-ad-library": "meta_ads",
  "google-ads-transparency": "google_ads",
  "tech-fingerprint": "tech",
  "computed-from-snapshots": null, // ambiguous — every such signal is pinned in OVERRIDES
  playbook: "lighthouse", // gated; pinned per-signal in OVERRIDES
};

/**
 * Per-signal pins where `source` is ambiguous or misleading. `undefined` means
 * "defer to SOURCE_FAMILY". Present-but-null means "explicitly basic".
 */
const OVERRIDES: Readonly<Record<string, ResearchFamily | null>> = {
  // Raw Maps-listing numbers on Business.* — NOT Review rows → basic.
  rating: null,
  review_count: null,
  // computed-from-snapshots that need a PAID family (reviews/serp/ads analytics).
  mapsly_score: "reviews",
  msi_rank: "reviews",
  msi_percentile: "reviews",
  reputation_subscore: "reviews",
  review_velocity_vs_leader: "reviews",
  reviews_vs_cell_pct: "reviews",
  rank_drop_last_30d: "serp",
  share_of_voice: "serp",
  ads_without_pixel: "meta_ads", // meta_ads (+ tech) — primary paid family
  estimated_monthly_ad_spend: "meta_ads", // meta_ads (+ google_ads)
  // computed-from-snapshots that are Maps-number cell aggregations → basic.
  new_competitors_90d: null,
  same_building_competitors: null,
  rating_gap_to_leader: null,
  review_count_gap_to_leader: null,
  competitor_passed_us_in_reviews: null,
  // playbook composites → a gated evidence family (locks them in search mode).
  compliance_gap: "tech",
  ada_risk: "lighthouse",
  hipaa_pixel_risk: "tech",
};

/**
 * The paid research family a signal requires to be evaluated, or `null` if it
 * is evaluable from the free discovery listing / internal state.
 *
 * Unknown keys resolve to `null` (fail-open to "free/basic"); the coverage test
 * asserts every registry signal resolves, so an un-mapped new signal is caught.
 */
export function signalFamily(signalKey: string): ResearchFamily | null {
  if (signalKey in OVERRIDES) return OVERRIDES[signalKey];
  const def = SIGNALS[signalKey];
  if (!def) return null;
  const fromSource = SOURCE_FAMILY[def.source];
  return fromSource ?? null;
}

/** True when a signal needs a paid research family (i.e. is gated behind entitlement). */
export function isGatedSignal(signalKey: string): boolean {
  const fam = signalFamily(signalKey);
  return fam !== null && fam !== "contacts";
}

/**
 * True when a signal is filterable in FT-2 "Search everywhere": evaluable from
 * discovery (`null`) or from contacts (the family a 1-credit taken lead always
 * carries). Everything gated behind a richer paid family is locked.
 */
export function isSearchBasicSignal(signalKey: string): boolean {
  return !isGatedSignal(signalKey);
}

/**
 * Filter a list of signal keys to those an agency may evaluate/filter by given
 * the families it is entitled to. Discovery signals (`null`) are always
 * allowed; a gated signal is allowed only when its family is in
 * `entitledFamilies`.
 */
export function entitledSignalKeys(
  signalKeys: readonly string[],
  entitledFamilies: ReadonlySet<ResearchFamily>,
): string[] {
  return signalKeys.filter((k) => {
    const fam = signalFamily(k);
    return fam === null || entitledFamilies.has(fam);
  });
}

/** Static classification of every registry signal (built once at import). */
export const SIGNAL_FAMILY: Readonly<Record<string, ResearchFamily | null>> =
  Object.freeze(
    Object.fromEntries(Object.keys(SIGNALS).map((k) => [k, signalFamily(k)])),
  );
