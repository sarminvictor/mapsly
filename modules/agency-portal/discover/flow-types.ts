// flow-types.ts · the shared state model for the "Get leads" 4-step journey
// (Goal ▸ Market ▸ Preview ▸ Enrich). The flow is a single client component;
// this module holds the plain data shapes + the pure helpers that thread
// state between steps and produce the estimate numbers Preview renders.
//
// There is deliberately no separate "Discover" step: Preview auto-triggers
// discovery the moment it mounts (right after Market's "Preview & credits →")
// and shows loading skeletons + a progress bar in place of real numbers while
// it maps, then the sticky bottom bar swaps itself from "Mapping…" to
// "Enrich →" once the market is real — one fewer step, a more informative
// Preview. See PreviewStep.tsx for the merged implementation. English-only.

import { cellKey as makeCellKey, type FreshnessState } from "@/lib/cell";
import {
  ALL_ENRICHMENT_TYPES,
  CREDIT_PRICES,
  ENRICHMENT_PRICES,
  enrichmentNeedsWebsite,
  type EnrichmentType,
} from "@/modules/cost/pricing";
import { templateByKey, type GoalTemplate } from "./goal-templates";

export type FlowStep = "goal" | "market" | "preview" | "enriching";

/** The 4-step registry (key + label) — drives the stepper. */
export const FLOW_STEPS: { key: FlowStep; label: string }[] = [
  { key: "goal", label: "Goal" },
  { key: "market", label: "Market" },
  { key: "preview", label: "Preview" },
  { key: "enriching", label: "Enrich" },
];

/**
 * The output of a per-signal tune control — one variant per setting type the
 * card can render (mirrors the prototype's `f.sset`, typed). Captured on the
 * working GoalFilter so the controls are live + the chosen value is held in the
 * goal model. (Persisting to the URL + using it in eval is a later phase.)
 */
export type SignalTuneValue =
  | { kind: "strictness"; level: "loose" | "balanced" | "strict" }
  | { kind: "scale"; bands: string[] }
  | { kind: "mode"; value: string }
  | { kind: "platform"; values: string[] }
  | { kind: "presence"; value: "has" | "hasnt" };

/** A single active filter inside the working GOAL state. */
export interface GoalFilter {
  /** SIG_META key. */
  key: string;
  /** Whether the signal is active. */
  on: boolean;
  /** Why it's here (shown in the card). */
  why: string;
  /**
   * The chosen value of this signal's tune control (the prototype's `f.sset`),
   * seeded lazily from the SIG_META default. Optional so nothing else breaks.
   */
  tune?: SignalTuneValue;
  /**
   * Composites only · per-condition include toggles, keyed by recipe-line
   * index ("0", "1", …). A line is on unless explicitly `false`.
   */
  conds?: Record<string, boolean>;
  /** Composites only · whether the conditions match "all" or "any". */
  match?: "all" | "any";
}

/**
 * GOAL · the single source of truth for the active signal set. Signals are
 * chosen ONCE on the Goal step; the Market/Preview steps read this read-only.
 */
export interface GoalState {
  /** The template this was cloned from (key) or "custom". */
  base: string;
  /** Editable goal name. */
  name: string;
  /** Whether the user edited the preset (enables Save-as-template later). */
  customized: boolean;
  /** Cloned, editable copy of the template's filters. */
  filters: GoalFilter[];
  /**
   * The AgencyTemplate row this goal was loaded from (WP5-12) — present ONLY
   * when the working goal came from one of the user's own saved templates.
   * When set, "Save" UPDATES that row in place instead of creating a duplicate;
   * cloning a built-in or starting fresh leaves it undefined (a new save).
   */
  templateId?: string;
}

/** Clone a template into a fresh working GOAL (the prototype's loadGoalFrom). */
export function loadGoalFrom(tpl: GoalTemplate): GoalState {
  return {
    base: tpl.key,
    name: tpl.title,
    customized: false,
    filters: tpl.filters.map((f) => ({ key: f.key, on: f.on, why: f.why })),
  };
}

/** A user-curated market: one city × one category. */
export interface MarketCell {
  /** Display city ("Miami, FL"). */
  city: string;
  /** Metro slug (lib/geo/us-metros.ts). */
  metroSlug: string;
  /** Display category label ("Med spa"). */
  category: string;
  /** Category id (BusinessCategory row). */
  categoryId: string;
  /** Category slug (dataforseo id) — feeds the discovery cells input. */
  categorySlug: string;
  /** ISO-2 country of the metro ("US" | "CA") — feeds the cellKey + discovery
   *  so Canadian businesses are stamped CA, not the old hardcoded US. */
  country: "US" | "CA";
}

/**
 * The CSS freshness class for the Preview matrix dot. The preflight's
 * {@link FreshnessState} (`never | fresh | aging | stale`) maps to the ported
 * `.freshdot` classes (`fresh | aging | stale | new`) — a never-discovered cell
 * renders as the faint `new` dot.
 */
export type FreshDot = "fresh" | "aging" | "stale" | "new";

/** Map the preflight freshness state → its `.freshdot` CSS class. */
export function freshDotClass(state: FreshnessState): FreshDot {
  return state === "never" ? "new" : state;
}

/**
 * A per-cell row the Preview matrix renders — built ENTIRELY from the REAL
 * preflight quote (`PreviewCell`), never from positional fabrication. A
 * never-discovered cell's business count is genuinely UNKNOWN (never a guessed
 * number) — the row carries `neverDiscovered` so the UI shows "—" for it.
 *
 *   - `freshness`  — REAL `cellFreshnessState` of the cell's TrackedLocation.
 *   - `bizCount`   — REAL `Business.count` for discovered cells; 0 (unused) for
 *                    never-discovered cells — always read `neverDiscovered` first.
 *   - `discoverIsFree` — discovery is ALWAYS free (see DISCOVERY_PRICE); this
 *                    field is kept for freshness-callout framing (fresh/aging
 *                    cells serve from cache instantly, stale/never re-fetch).
 */
export interface CellRow {
  name: string;
  freshness: FreshnessState;
  bizCount: number;
  /** Businesses in this cell WITH a website — the enrichable subset for
   *  website-dependent researches. 0 when never discovered. */
  websiteBizCount: number;
  /** True = business count is genuinely unknown (never discovered). */
  neverDiscovered: boolean;
  /** True when discovery serves from cache for this cell (owned → instant). */
  discoverIsFree: boolean;
}

// ── WP7-13 · statistical-edge market classification ─────────────────────────
// The market-relative claim ("38 reviews · cell median 58") must never lie at
// the statistical edges. Two edges get an honest UI note:
//
//   - THIN  (< 25 businesses): a cohort this small can't support an honest
//     percentile distribution, so the vs-cell bands are suppressed and the
//     workbench shows ABSOLUTE values with a "small market — showing absolute
//     benchmarks" note. (The band math itself already returns null below
//     MIN_COHORT_FOR_DISTRIBUTION = 4; this threshold is the higher bar at which
//     we TELL the user the comparison is absolute, not percentile.)
//   - OVERSIZED (>= 2000 businesses): the count is real but unwieldy; Preview
//     nudges the user to narrow by sub-cell (neighborhood / smaller radius)
//     rather than enrich an eye-watering set.

/** Below this business count a cell is "thin" — percentile bands are suppressed
 *  and the UI shows absolute benchmarks with a note. */
export const THIN_MARKET_THRESHOLD = 25;

/** At/above this business count a cell is "oversized" — Preview suggests a
 *  narrower sub-cell instead of enriching the whole set. */
export const OVERSIZED_MARKET_THRESHOLD = 2000;

export type MarketSizeClass = "thin" | "normal" | "oversized";

/** Classify a discovered cell's real business count for the edge-case UI notes.
 *  A never-discovered / unknown count (`bizCount == null`) is "normal" (no note
 *  until the real count lands). Pure. */
export function classifyMarketSize(bizCount: number | null): MarketSizeClass {
  if (bizCount == null) return "normal";
  if (bizCount < THIN_MARKET_THRESHOLD) return "thin";
  if (bizCount >= OVERSIZED_MARKET_THRESHOLD) return "oversized";
  return "normal";
}

/** The minimal real per-cell quote shape the Preview matrix consumes (a subset
 *  of `PreviewCell` from modules/discovery/actions.ts — kept inline so this
 *  pure module has no dependency on the "use server" actions file). */
export interface QuoteCell {
  cellKey: string;
  freshness: FreshnessState;
  existingBizCount: number;
  websiteBizCount: number;
  neverDiscovered: boolean;
}

/**
 * Per-lead enrich RATE (credits per business you choose to enrich) — the
 * business-basis families' unit costs, summed and converted ONCE. This does
 * NOT depend on how many businesses are in the market, so it's honestly
 * knowable even before Discover reveals the real count (unlike a projected
 * total, which would require guessing the lead count).
 */
export function enrichRatePerLead(families: EnrichmentType[]): number {
  // Whole-credit per-lead rate = sum of the business-basis families' CREDIT_PRICES.
  // Now EXACT (an integer), not the old pessimistic ceil of blended vendor USD —
  // so the affordability slider (affordableN) computes the true max leads.
  let credits = 0;
  for (const fam of families) {
    if (ENRICHMENT_PRICES[fam].unit === "business")
      credits += CREDIT_PRICES[fam];
  }
  return credits;
}

/**
 * One-time fee for cell-basis families (meta_ads / google_ads / serp) — a flat
 * cost that covers the WHOLE market once, shared across however many leads end
 * up enriched from it. Independent of business count for the same reason as
 * {@link enrichRatePerLead}.
 */
export function enrichCellFeeCredits(
  families: EnrichmentType[],
  cellCount: number,
): number {
  let credits = 0;
  for (const fam of families) {
    if (ENRICHMENT_PRICES[fam].unit === "cell")
      credits += CREDIT_PRICES[fam] * cellCount;
  }
  return credits;
}

/**
 * B3 · the ONE definition of "how many businesses are actually enrichable for
 * this set of researches": website-havers only when any research reads a live
 * site (Lighthouse/contacts/tech/services/AI), else the whole count. Both the
 * Preview matrix ({@link enrichableCountForCell}) and the workbench page's
 * counts strip route through THIS helper so the rule can never diverge between
 * the two surfaces. Pure.
 */
export function enrichableCount(
  families: EnrichmentType[],
  websiteHavingCount: number,
  totalCount: number,
): number {
  return enrichmentNeedsWebsite(families) ? websiteHavingCount : totalCount;
}

/**
 * The number of businesses in a cell that will ACTUALLY be enriched for the
 * selected researches: website-havers only when any research needs a live site
 * (Lighthouse/contacts/tech/services/AI), else every business. This is the
 * count the enrich cost + the matrix Enrich column must use — enriching a
 * website-less business for a site-reading research produces nothing, so it's
 * neither charged nor queued (mirrors the server preflight scope). Delegates to
 * the shared {@link enrichableCount} rule (B3).
 */
export function enrichableCountForCell(
  row: CellRow,
  families: EnrichmentType[],
): number {
  return enrichableCount(families, row.websiteBizCount, row.bizCount);
}

/**
 * Build the per-cell rows for the Preview matrix from the REAL preflight quote.
 *
 * `cells` (the user's market selection, for display names) is zipped with the
 * quote's per-cell rows by `cellKey`. Each row's business count and freshness
 * come from real DB data; a never-discovered cell's count is left unknown
 * (never a guessed number). Returns `[]` when there is no quote yet so the
 * matrix shows a pricing state instead of fabricated numbers.
 */
export function buildCellRows(
  cells: MarketCell[],
  quoteByKey: Map<string, QuoteCell>,
): CellRow[] {
  return cells.map((c) => {
    const key = makeCellKey(c.categorySlug, c.metroSlug, c.country);
    const q = quoteByKey.get(key);
    const bizCount = q?.existingBizCount ?? 0;
    const freshness = q?.freshness ?? "never";
    return {
      name: `${c.category} · ${c.city.split(",")[0]}`,
      freshness,
      bizCount,
      websiteBizCount: q?.websiteBizCount ?? 0,
      neverDiscovered: q?.neverDiscovered ?? true,
      // Owned-free vs new: a cell within its freshness window is served from
      // cache → discovery is instant. Stale/never cells need a (re)fetch —
      // still free either way (DISCOVERY_PRICE is $0), just slower.
      discoverIsFree: freshness === "fresh" || freshness === "aging",
    };
  });
}

/** Format a credit count with thousands separators. */
export function fmtCredits(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/**
 * Convert MarketCells → the discovery cells input the server action expects.
 * (modules/discovery/actions.ts DiscoveryInput.cells)
 */
export function toDiscoveryCells(cells: MarketCell[]): {
  categorySlug: string;
  categoryId: string;
  metroSlug: string;
  country: string;
}[] {
  return cells.map((c) => ({
    categorySlug: c.categorySlug,
    categoryId: c.categoryId,
    metroSlug: c.metroSlug,
    country: c.country,
  }));
}

/** The fallback goal (website template) for display when none is picked. */
export function fallbackGoal(): GoalState {
  const tpl = templateByKey("website")!;
  return loadGoalFrom(tpl);
}

/**
 * Parse the `?enrich=<type,type,…>` deep-link param into valid enrichment
 * types (WP5-3). Unknown tokens are dropped (a stale/hand-edited link can't
 * inject an unpriceable family); duplicates are de-duped, order preserved.
 * Pure — unit-testable without React.
 */
export function parseEnrichTypes(raw: string | null): EnrichmentType[] {
  if (!raw) return [];
  const valid = new Set<string>(ALL_ENRICHMENT_TYPES);
  const out: EnrichmentType[] = [];
  for (const token of raw.split(",")) {
    const t = token.trim();
    if (valid.has(t) && !out.includes(t as EnrichmentType)) {
      out.push(t as EnrichmentType);
    }
  }
  return out;
}

/**
 * Free pre-enrich market filters (WP5-4) — the client-safe mirror of
 * `RawListFilters` (modules/discovery/raw-list.ts imports prisma, so client
 * components can't import it). The server actions translate 1:1.
 */
export interface MarketFilters {
  /** Only businesses with a non-null website. */
  hasWebsite?: boolean;
  /** rating >= this (inclusive). */
  minRating?: number;
  /** reviewCount >= this (inclusive). */
  minReviewCount?: number;
  /** Require one of these reachability tiers. */
  reachability?: (
    | "UNREACHABLE"
    | "EMAIL_ONLY"
    | "PHONE_ONLY"
    | "MULTI"
    | "RICH"
    | "UNKNOWN"
  )[];
}

/** Whether any pre-enrich filter is actually set (empty object = inactive). */
export function marketFiltersActive(f: MarketFilters): boolean {
  return (
    f.hasWebsite === true ||
    (typeof f.minRating === "number" && f.minRating > 0) ||
    (typeof f.minReviewCount === "number" && f.minReviewCount > 0) ||
    (Array.isArray(f.reachability) && f.reachability.length > 0)
  );
}

/** The enrichment families' whole-credit total for a set of businesses/cells.
 *  Uses CREDIT_PRICES (customer price) — matches the server quote + settle. */
export function enrichCreditsFor(
  families: EnrichmentType[],
  businessCount: number,
  cellCount: number,
): number {
  let credits = 0;
  for (const fam of families) {
    const units =
      ENRICHMENT_PRICES[fam].unit === "cell" ? cellCount : businessCount;
    credits += CREDIT_PRICES[fam] * units;
  }
  return credits;
}
