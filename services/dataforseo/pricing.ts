// services/dataforseo/pricing.ts · per-operation unit costs (USD).
//
// Source: https://dataforseo.com/pricing (Live tier · pay-as-you-go).
// Numbers reflect 2025-Q2 Live-tier pricing for the endpoints we use. They
// are approximate (DataForSEO rounds to fractional cents on the invoice)
// and conservative — slightly over-attributing cost is safer than under
// since the CronRun ledger is consulted to enforce tier ceilings.
//
// DataForSEO Standard queue (task_post + task_get) is ~10× cheaper but
// requires a polling architecture we haven't built yet. Per
// `.claude/rules/cost-discipline.md`, swap to Standard once volume
// justifies the complexity. Tracked in PLAN.md as a follow-up task.
//
// The dashboard's cost-audit reads these constants to model expected vs
// actual spend per cron run; keep them in sync with DataForSEO's public
// pricing page.

export const DATAFORSEO_UNIT_COST_USD = {
  /** /v3/business_data/business_listings/search/live — $0.001 per call,
   *  up to 1000 listings returned. */
  mapsSearch: 0.001,

  /** /v3/serp/google/organic/live/advanced — $0.002 per query (Live tier;
   *  Standard would be $0.0002). */
  serpOrganic: 0.002,

  /** /v3/serp/google/maps/live/advanced — $0.002 per query (Live tier).
   *  Returns local-pack + Maps results for the query. */
  serpLocalPack: 0.002,

  /** /v3/business_data/google/reviews/live — $0.0008 per page of reviews. */
  reviews: 0.0008,

  /** /v3/keywords_data/google_ads/search_volume/live — $0.05 per call,
   *  batches up to 1000 keywords. Per-keyword amortized cost = $0.00005,
   *  but billing is at the call level so we charge $0.05 to the open run. */
  keywordVolume: 0.05,

  /** /v3/on_page/lighthouse/live/json — $0.0025 per audit. */
  lighthouse: 0.0025,
} as const;

export type DataForSeoOperation = keyof typeof DATAFORSEO_UNIT_COST_USD;
