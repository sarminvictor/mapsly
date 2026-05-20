// services/dataforseo/keyword-volume.ts · Google Ads keyword volume + CPC.
//
// Endpoint: /v3/keywords_data/google_ads/search_volume/live
// Use case: monthly keyword-volume-refresh (C.10). Returns search volume,
// CPC, competition for up to 1000 keywords per call.
//
// Cache: 7d. Keyword volume updates monthly server-side anyway; we don't
// need fresher data than that.
//
// Cost: $0.05 per call (regardless of batch size up to 1000). Batching is
// strongly preferred — callers should accumulate keywords across a cron
// pass and submit in one call. The adapter accepts 1..1000 keywords.

import { z } from "zod";
import { kvCache } from "@/lib/cache";
import { withCostCounter } from "@/lib/cost/cost-counter";
import { dataforSeoPost } from "./client";
import { DATAFORSEO_UNIT_COST_USD } from "./pricing";

// ---- Schemas ------------------------------------------------------------

export const KeywordVolumeQuerySchema = z.object({
  /** 1..1000 keywords per call. Per-keyword amortized cost makes batching
   *  essential — never call this in a loop. */
  keywords: z.array(z.string().min(1).max(80)).min(1).max(1000),
  location_code: z.number().int().positive().default(2840),
  language_code: z.string().min(2).default("en"),
  /** When true, returns nearest-month historical data. Default off because
   *  it inflates response payload by ~10x. */
  include_serp_info: z.boolean().default(false),
  search_partners: z.boolean().default(false),
});
export type KeywordVolumeQuery = z.input<typeof KeywordVolumeQuerySchema>;

export const KeywordVolumeRowSchema = z.object({
  keyword: z.string(),
  /** Average monthly search volume (12-month). */
  search_volume: z.number().nullable().optional(),
  /** Competition bucket as returned by Google Ads. */
  competition: z
    .enum(["LOW", "MEDIUM", "HIGH", "UNKNOWN"])
    .nullable()
    .optional(),
  /** Competition index 0..100. */
  competition_index: z.number().nullable().optional(),
  /** Low end of bid range in USD. */
  low_top_of_page_bid: z.number().nullable().optional(),
  /** High end of bid range in USD. */
  high_top_of_page_bid: z.number().nullable().optional(),
  /** Cost-per-click estimate in USD. */
  cpc: z.number().nullable().optional(),
});
export type KeywordVolumeRow = z.infer<typeof KeywordVolumeRowSchema>;

export interface KeywordVolumeResult {
  rows: KeywordVolumeRow[];
  operation: string;
}

// ---- Adapter ------------------------------------------------------------

const OPERATION = "dataforseo.keyword.volume";

async function keywordVolumeRaw(
  query: KeywordVolumeQuery,
): Promise<KeywordVolumeResult> {
  const parsed = KeywordVolumeQuerySchema.parse(query);
  // The keyword_data endpoints return result as an array of rows directly
  // (not nested under items). Each row is a KeywordVolumeRow.
  const { result } = await dataforSeoPost<KeywordVolumeRow>({
    path: "/v3/keywords_data/google_ads/search_volume/live",
    operation: OPERATION,
    body: parsed,
  });
  const rows = result.map((r) => KeywordVolumeRowSchema.parse(r));
  return { rows, operation: OPERATION };
}

export const keywordVolumeUncached = withCostCounter(
  OPERATION,
  DATAFORSEO_UNIT_COST_USD.keywordVolume,
  keywordVolumeRaw,
);

export const keywordVolume = kvCache(
  "dfs:kw:volume",
  { ttl: 7 * 24 * 60 * 60, tag: "dfs:kw" },
  keywordVolumeUncached,
);
