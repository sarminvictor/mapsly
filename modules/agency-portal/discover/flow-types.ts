// flow-types.ts · the shared state model for the "Get leads" 5-step journey
// (Goal ▸ Market ▸ Preview ▸ Discover ▸ Enrich). The flow is a single client
// component; this module holds the plain data shapes + the pure helpers that
// thread state between steps and produce the estimate numbers the Preview/
// Discover screens render. English-only for now.

import {
  CREDIT_USD,
  DISCOVERY_PRICE,
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

/** A single active filter inside the working GOAL state. */
export interface GoalFilter {
  /** SIG_META key. */
  key: string;
  /** Whether the signal is active. */
  on: boolean;
  /** Why it's here (shown in the card). */
  why: string;
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
 * Per-cell estimate row the Preview matrix renders. The backend preflight
 * returns only aggregate {netUsd, netCredits, freshCount, refetchCount} — it
 * does NOT return per-cell estimates — so the deterministic per-cell numbers
 * here mirror the prototype's approach (estimate-only, clearly marked ~). The
 * aggregate credit total still comes from the REAL preflight quote.
 */
export interface CellEstimate {
  name: string;
  freshness: "fresh" | "aging" | "stale" | "new";
  bizEstimate: number;
  discoverCredits: number;
  enrichCreditsEstimate: number;
}

/** Deterministic business-count estimate for a market index (120–460). */
export function estBizCount(index: number): number {
  return 120 + ((index * 137) % 341);
}

/** Deterministic freshness rotation (no Math.random — PPR-safe). */
export function estFreshness(index: number): CellEstimate["freshness"] {
  return (["aging", "fresh", "new", "stale"] as const)[index % 4];
}

const FRESH_DISCOVER_CREDITS = 0; // served from cache → free
const FETCH_DISCOVER_CREDITS = Math.max(
  1,
  Math.ceil(
    (DISCOVERY_PRICE.baseUsd + 250 * DISCOVERY_PRICE.perListingUsd) /
      CREDIT_USD,
  ),
);

/** Build the per-cell estimate rows for the Preview matrix. */
export function buildCellEstimates(cells: MarketCell[]): CellEstimate[] {
  return cells.map((c, i) => {
    const fresh = estFreshness(i);
    const biz = estBizCount(i);
    const isFresh = fresh === "fresh" || fresh === "aging";
    return {
      name: `${c.category} · ${c.city.split(",")[0]}`,
      freshness: fresh,
      bizEstimate: biz,
      discoverCredits: isFresh
        ? FRESH_DISCOVER_CREDITS
        : FETCH_DISCOVER_CREDITS,
      // Enrich credits scale with the real business count we find on Discover.
      enrichCreditsEstimate: Math.max(1, Math.round(biz * 0.18)),
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
