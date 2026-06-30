// flow-types.ts · the shared state model for the "Get leads" 5-step journey
// (Goal ▸ Market ▸ Preview ▸ Discover ▸ Enrich). The flow is a single client
// component; this module holds the plain data shapes + the pure helpers that
// thread state between steps and produce the estimate numbers the Preview/
// Discover screens render. English-only for now.

import { cellKey as makeCellKey, type FreshnessState } from "@/lib/cell";
import {
  CREDIT_USD,
  ENRICHMENT_PRICES,
  type EnrichmentType,
} from "@/modules/cost/pricing";
import { templateByKey, type GoalTemplate } from "./goal-templates";

export type FlowStep = "goal" | "market" | "preview" | "discover" | "enriching";

/** The 5-step registry (key + label) — drives the stepper. */
export const FLOW_STEPS: { key: FlowStep; label: string }[] = [
  { key: "goal", label: "Goal" },
  { key: "market", label: "Market" },
  { key: "preview", label: "Preview" },
  { key: "discover", label: "Discover" },
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
 * preflight quote (`PreviewCell`), never from positional fabrication. Each field
 * is either a real DB-derived number (`isEstimate === false`) or an estimate for
 * a not-yet-discovered cell (`isEstimate === true`), and the row carries that
 * flag so the UI can mark estimates with a `~`.
 *
 *   - `freshness`  — REAL `cellFreshnessState` of the cell's TrackedLocation.
 *   - `bizCount`   — REAL `Business.count` for discovered cells; an estimate for
 *                    never-discovered cells (`isEstimate`).
 *   - `enrichCredits` — per-business families × `bizCount` + per-cell families
 *                    once, over the REAL count (a `~` projection when the count
 *                    itself is an estimate).
 *   - `discoverIsFree` — owned-free vs new framing: a cell within its freshness
 *                    window (`fresh`/`aging`) serves discovery from cache ($0);
 *                    a `stale`/`never` cell needs a (re)fetch (cost in the REAL
 *                    aggregate `netCredits`, not split per-cell here).
 */
export interface CellRow {
  name: string;
  freshness: FreshnessState;
  bizCount: number;
  /** False = real DB count; true = estimate for a never-discovered cell. */
  isEstimate: boolean;
  /** Per-cell enrich credits over the cell's (real or estimated) count. */
  enrichCredits: number;
  /** True when discovery serves from cache for this cell (owned → free). */
  discoverIsFree: boolean;
}

/** The minimal real per-cell quote shape the Preview matrix consumes (a subset
 *  of `PreviewCell` from modules/discovery/actions.ts — kept inline so this
 *  pure module has no dependency on the "use server" actions file). */
export interface QuoteCell {
  cellKey: string;
  freshness: FreshnessState;
  existingBizCount: number;
  isEstimate: boolean;
}

/**
 * Per-cell enrich credits for a single market: per-business families bill over
 * `bizCount`; per-cell families bill once. Derived from the canonical
 * {@link ENRICHMENT_PRICES} + {@link CREDIT_USD} — no fabricated multiplier.
 */
export function enrichCreditsForCell(
  families: EnrichmentType[],
  bizCount: number,
): number {
  return enrichCreditsFor(families, bizCount, 1);
}

/**
 * Build the per-cell rows for the Preview matrix from the REAL preflight quote.
 *
 * `cells` (the user's market selection, for display names) is zipped with the
 * quote's per-cell rows by `cellKey`. Each row's business count, freshness, and
 * enrich credits come from real DB data (or a clearly-flagged estimate for a
 * never-discovered cell); the enrich credit is computed over the REAL count via
 * the canonical price list. Returns `[]` when there is no quote yet so the
 * matrix shows a pricing state instead of fabricated numbers.
 */
export function buildCellRows(
  cells: MarketCell[],
  quoteByKey: Map<string, QuoteCell>,
  families: EnrichmentType[],
): CellRow[] {
  return cells.map((c) => {
    const key = makeCellKey(c.categorySlug, c.metroSlug, "US");
    const q = quoteByKey.get(key);
    const bizCount = q?.existingBizCount ?? 0;
    const freshness = q?.freshness ?? "never";
    return {
      name: `${c.category} · ${c.city.split(",")[0]}`,
      freshness,
      bizCount,
      isEstimate: q?.isEstimate ?? true,
      enrichCredits: enrichCreditsForCell(families, bizCount),
      // Owned-free vs new: a cell within its freshness window is served from
      // cache → discovery is free. Stale/never cells need a (re)fetch.
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
    country: "US",
  }));
}

/** The fallback goal (website template) for display when none is picked. */
export function fallbackGoal(): GoalState {
  const tpl = templateByKey("website")!;
  return loadGoalFrom(tpl);
}

/** The enrichment families' credit total for a set of businesses. */
export function enrichCreditsFor(
  families: EnrichmentType[],
  businessCount: number,
  cellCount: number,
): number {
  let usd = 0;
  for (const fam of families) {
    const price = ENRICHMENT_PRICES[fam];
    const units = price.unit === "cell" ? cellCount : businessCount;
    usd += units * price.usdPerUnit;
  }
  return Math.ceil(usd / CREDIT_USD);
}
