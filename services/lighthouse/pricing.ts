// services/lighthouse/pricing.ts · per-operation unit costs in USD.
//
// The DataForSEO Lighthouse audit is the only billable leg of an audit;
// the HTML fetch for custom DOM checks is free (we self-host the parsing).
// We re-export the DataForSEO unit cost rather than re-declaring it so a
// future DataForSEO price change propagates to both adapters without
// requiring two edits.
//
// The "DOM check" operation has unit cost $0 — withCostCounter still wraps
// it so the "no live API in user request path" invariant (an open CronRun
// is required) applies uniformly to every adapter under services/*.

import { DATAFORSEO_UNIT_COST_USD } from "@/services/dataforseo/pricing";

export const LIGHTHOUSE_UNIT_COST_USD = {
  /** DataForSEO Lighthouse audit · re-exported from DataForSEO pricing. */
  lighthouseAudit: DATAFORSEO_UNIT_COST_USD.lighthouse,
  /** HTML fetch + DOM scan · zero marginal cost; we do this ourselves. */
  domChecks: 0,
  /** Full audit · DataForSEO lighthouse + DOM checks. Sum of the two. */
  fullAudit: DATAFORSEO_UNIT_COST_USD.lighthouse + 0,
} as const;

export type LighthouseOperation = keyof typeof LIGHTHOUSE_UNIT_COST_USD;
