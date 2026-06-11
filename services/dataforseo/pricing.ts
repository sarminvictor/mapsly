// services/dataforseo/pricing.ts · per-operation unit costs (USD).
//
// Source: https://dataforseo.com/pricing (Live tier · pay-as-you-go).
// Numbers reflect 2026 pricing for the endpoints we use. They are
// approximate (DataForSEO rounds to fractional cents on the invoice) and
// conservative — slightly over-attributing cost is safer than under since
// the CronRun ledger is consulted to enforce tier ceilings.
//
// IMPORTANT: Variable-cost endpoints (reviews, reviewsTask) bill by what
// the API actually returns, not per-call. For those, the adapter reads
// `task.cost` (rawCostUsd from `dataforSeoPost`) and calls `incrementCost`
// directly. The constants below are FALLBACKS used only when DfS doesn't
// surface task.cost (rare — happens for some error envelopes).
//
// Standard queue (task_post + task_get) is ~50% cheaper than Live for
// reviews ($0.00075 vs $0.0015 per 10 reviews) with a 45-min SLA. We use
// Standard for: initial historical pull (R.2), weekly delta (R.3).
//
// The dashboard's cost-audit reads these constants to model expected vs
// actual spend per cron run; keep them in sync with DataForSEO's public
// pricing page.

export const DATAFORSEO_UNIT_COST_USD = {
  /** /v3/business_data/business_listings/search/live — VARIABLE COST.
   *  Observed billing: ~$0.01 base per call + ~$0.0003 per returned
   *  listing (limit=25 → $0.0175, limit=50 → $0.025 · verified against
   *  DiscoveryRun history 2026-05-26). The adapter bills `task.cost`
   *  from the response; this constant is the per-call base FALLBACK
   *  used only when the envelope omits cost. */
  mapsSearch: 0.01,

  /** /v3/serp/google/organic/live/advanced — $0.002 per query (Live tier;
   *  Standard would be $0.0002). */
  serpOrganic: 0.002,

  /** /v3/serp/google/maps/live/advanced — $0.002 per query (Live tier).
   *  Returns local-pack + Maps results for the query. */
  serpLocalPack: 0.002,

  /** /v3/business_data/google/reviews/live — VARIABLE COST.
   *  Live tier · $0.0015 per 10 reviews returned. For depth=50 a single
   *  call bills $0.0075. The adapter uses `rawCostUsd` from the DfS
   *  response; this constant is the FALLBACK used only when the response
   *  envelope omits task.cost (rare). */
  reviews: 0.0075,

  /** /v3/business_data/google/reviews/task_post (Standard queue) —
   *  VARIABLE COST.
   *  Standard tier · $0.00075 per 10 reviews returned. Bills on task_get
   *  retrieval, not task_post submission. Adapter reads rawCostUsd from
   *  the task_get response. This constant is the per-10-reviews unit and
   *  the FALLBACK for a depth=10 pull. */
  reviewsTask: 0.00075,

  /** /v3/keywords_data/google_ads/search_volume/live — $0.05 per call,
   *  batches up to 1000 keywords. Per-keyword amortized cost = $0.00005,
   *  but billing is at the call level so we charge $0.05 to the open run. */
  keywordVolume: 0.05,

  /** /v3/on_page/lighthouse/live/json — $0.0025 per audit. */
  lighthouse: 0.0025,

  /** /v3/dataforseo_labs/google/ranked_keywords/live — VARIABLE COST.
   *  Live tier · ~$0.013 per call for limit=100 (verified 2026-05-27 on
   *  theinjectionist.ca · returned 742 keywords for $0.013). Per-row cost
   *  is roughly $0.0001 so larger limit calls scale proportionally.
   *  Adapter reads rawCostUsd from response; constant is the FALLBACK. */
  rankedKeywords: 0.013,

  /** /v3/serp/google/ads_advertisers/live/advanced — $0.002 per call (Live;
   *  Standard $0.0006). Returns advertisers running Google ads for a keyword
   *  in a location (Google Ads Transparency Center). Billed even on the
   *  40102 "No Search Results" empty case. Verified live 2026-05-28. */
  adsAdvertisers: 0.002,

  /** /v3/serp/google/ads_search/live/advanced — $0.002 per SERP of ≤40
   *  creatives (Live; Standard $0.0006). Returns an advertiser's actual ad
   *  creatives + first/last-shown dates, by advertiser_ids or target domain
   *  (Google Ads Transparency Center). Verified live 2026-05-28. */
  adsSearch: 0.002,
} as const;

export type DataForSeoOperation = keyof typeof DATAFORSEO_UNIT_COST_USD;
