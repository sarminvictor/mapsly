// modules/discovery/enrich-fresh.ts · per-enrichment freshness dedup (Phase 9).
//
// The Enrich pre-flight charges $0 for any unit (business or cell) already
// enriched within that enrichment's `freshnessDays` window (per pricing.ts).
// This module owns the FRESH-COUNT math:
//
//   - `isFresh(lastAt, freshnessDays, now)`      — pure single-unit predicate.
//   - `countFresh(input)`                        — pure per-enrichment counts.
//   - `loadFreshTimestamps(...)` + `countFreshForRun(...)` — the DB-backed
//     glue (in enrich-actions / dispatch) reads the per-business `*LastAt`
//     columns + per-cell `AdMarketRun.ranAt` and hands `countFresh` plain
//     timestamps so the math stays unit-testable without a DB.
//
// Freshness sources by family:
//   per-business:
//     contacts    → Business.contactsExtractedAt
//     tech        → Business.techScanLastAt
//     reviews     → Business.reviewsLastDeltaAt
//     lighthouse  → latest LighthouseAudit.auditedAt
//     services    → Business.servicesLastAt      (A4 · 90-day window)
//     ai_research → Business.aiResearchLastAt    (A4 · 90-day window)
//     google_ads  → Business.googleAdsLastAt     (B1 · 30-day window)
//   per-cell:
//     meta_ads    → latest AdMarketRun(platform=META).ranAt
//     serp        → latest AdMarketRun(platform=SERP).ranAt

import {
  ENRICHMENT_PRICES,
  type EnrichmentType,
  type ScopeUnit,
} from "@/modules/cost/pricing";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A unit is fresh when its last successful enrichment is within the window.
 * `null` (never enriched) → not fresh. Pure.
 */
export function isFresh(
  lastAt: Date | null | undefined,
  freshnessDays: number,
  now: Date,
): boolean {
  if (!lastAt) return false;
  const ageMs = now.getTime() - lastAt.getTime();
  if (ageMs < 0) return true; // clock skew → treat as fresh, never negative
  return ageMs <= freshnessDays * MS_PER_DAY;
}

/**
 * Per-unit last-enriched timestamps, keyed by the unit's id (businessId for
 * per-business families, cellKey for per-cell families). A unit absent from a
 * map is treated as "never enriched" (not fresh).
 */
export interface FreshTimestamps {
  /** businessId → { family → lastAt }. */
  perBusiness: Map<string, Partial<Record<EnrichmentType, Date | null>>>;
  /** cellKey → { family → lastAt }. */
  perCell: Map<string, Partial<Record<EnrichmentType, Date | null>>>;
}

export interface CountFreshInput {
  /** Families selected for the run. */
  enrichments: readonly EnrichmentType[];
  /** Selected businesses (scope for per-business families). */
  businessIds: readonly string[];
  /** Cells the run spans (scope for per-cell families). */
  cellKeys: readonly string[];
  /** Last-enriched timestamps for every (unit × family). */
  timestamps: FreshTimestamps;
  now: Date;
}

/** What `countFresh` returns: a fresh count per selected enrichment. */
export type FreshByEnrichment = Partial<Record<EnrichmentType, number>>;

function unitFor(enrichment: EnrichmentType): ScopeUnit {
  return ENRICHMENT_PRICES[enrichment].unit;
}

/**
 * Count fresh units per selected enrichment. Pure over the supplied
 * timestamps — no DB, no implicit clock. A per-business family counts a
 * business fresh when its `*LastAt` for that family is within the window; a
 * per-cell family counts a cell fresh when its latest run is within the window.
 *
 * Families whose unit map carries no timestamp (never enriched) never count
 * fresh, so every such unit is billable.
 */
export function countFresh(input: CountFreshInput): FreshByEnrichment {
  const { enrichments, businessIds, cellKeys, timestamps, now } = input;
  const out: FreshByEnrichment = {};

  for (const enrichment of enrichments) {
    const price = ENRICHMENT_PRICES[enrichment];
    if (!price) continue;
    const window = price.freshnessDays;
    let fresh = 0;

    if (unitFor(enrichment) === "business") {
      for (const id of businessIds) {
        const lastAt = timestamps.perBusiness.get(id)?.[enrichment] ?? null;
        if (isFresh(lastAt, window, now)) fresh += 1;
      }
    } else {
      for (const key of cellKeys) {
        const lastAt = timestamps.perCell.get(key)?.[enrichment] ?? null;
        if (isFresh(lastAt, window, now)) fresh += 1;
      }
    }

    out[enrichment] = fresh;
  }

  return out;
}
