// modules/discovery/enrich-lines.ts · pure estimator-line construction for the
// Raw List "Enrich" flow (Phase 9).
//
// Split out of enrich-actions.ts so the line-input math is unit-testable
// without the "use server" boundary or a DB. Two scope units (per pricing.ts):
//   - "business" enrichments bill per selected business (× businessCount).
//   - "cell"     enrichments bill once per (metro × category) cell (× cellCount).
//
// Fresh counts are 0 for now (every selected unit is treated as billable). When
// per-unit freshness lands, callers pass the computed fresh counts through and
// the estimator dedups them to $0 ("served from cache").

import { ENRICHMENT_PRICES, type EnrichmentType } from "@/modules/cost/pricing";
import type { EstimateLineInput } from "@/modules/cost/estimate";

export interface BuildEnrichLinesInput {
  /** The enrichment families selected to run. */
  enrichments: EnrichmentType[];
  /** How many businesses are selected (drives per-business lines). */
  businessCount: number;
  /** How many cells the run spans (drives per-cell lines). */
  cellCount: number;
  /**
   * Optional already-fresh counts per enrichment (served from DB for $0). Keys
   * not present default to 0 fresh. Clamped to the line total by the estimator.
   */
  freshByEnrichment?: Partial<Record<EnrichmentType, number>>;
}

/**
 * Build the estimator line inputs for an enrichment run. A per-business
 * enrichment gets `total = businessCount`; a per-cell enrichment gets
 * `total = cellCount`. Pure — no DB, no clock. Throws on an unknown enrichment
 * key (mirrors estimateRun's contract).
 */
export function buildEnrichLines(
  input: BuildEnrichLinesInput,
): EstimateLineInput[] {
  const { enrichments, businessCount, cellCount } = input;
  const fresh = input.freshByEnrichment ?? {};

  return enrichments.map((enrichment) => {
    const price = ENRICHMENT_PRICES[enrichment];
    if (!price) {
      throw new Error(`[enrich-lines] unknown enrichment "${enrichment}"`);
    }
    const total = price.unit === "cell" ? cellCount : businessCount;
    return {
      enrichment,
      total,
      fresh: Math.max(0, fresh[enrichment] ?? 0),
    };
  });
}
