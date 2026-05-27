// services/dataforseo/ranked-keywords.ts · all keywords a domain ranks for.
//
// Endpoint: /v3/dataforseo_labs/google/ranked_keywords/live
// Use case: per-business search-visibility discovery (S.1 plan v2).
//
// Pass a domain · get back every keyword it ranks for (top-100 by default)
// with rank + search_volume + cpc + ranking URL + is_new/up/down/lost
// movement flags. Replaces per-keyword SERP organic scans entirely · one
// call captures the full keyword portfolio.
//
// Cost: VARIABLE. Verified 2026-05-27 on theinjectionist.ca · returned
// 742 keywords for $0.013 (limit 1000). Adapter reads rawCostUsd from
// the response envelope; constant is the FALLBACK.
//
// Cache: 24h on the full (target, location_code, limit, filters) tuple.
// Discovery + admin re-trigger inside the same day dedupe automatically.

import { z } from "zod";
import { kvCache } from "@/lib/cache";
import { withCostCounter } from "@/lib/cost/cost-counter";
import { dataforSeoPost } from "./client";
import { DATAFORSEO_UNIT_COST_USD } from "./pricing";

// ---- Query schema ----------------------------------------------------------

export const RankedKeywordsQuerySchema = z.object({
  /** Target domain, subdomain, or URL. No protocol prefix for domains
   *  (e.g. "theinjectionist.ca", not "https://theinjectionist.ca"). */
  target: z.string().min(1).max(255),
  /** DataForSEO numeric location code. US=2840, CA=2124. */
  location_code: z.number().int().positive().default(2840),
  language_code: z.string().min(2).default("en"),
  /** Max rows to return. Default 100; we use 1000 (the max) for the
   *  one-shot discovery use case so we capture the full long-tail. */
  limit: z.number().int().min(1).max(1000).default(1000),
  /** Skip rows · used for paginating beyond 1000 (rare for SMBs). */
  offset: z.number().int().min(0).optional(),
  /**
   * Server-side filters · up to 8. Most common usage: cap by rank so we
   * don't pay for deep long-tail noise.
   *
   *   filters: [["ranked_serp_element.serp_item.rank_group", "<=", 50]]
   *
   * Schema kept loose because DfS accepts heterogeneous arrays and
   * mixed nested operators. Caller is responsible for correct shape.
   */
  filters: z.array(z.array(z.unknown())).max(8).optional(),
  /** Whether to ignore synonyms — default true for tighter matching. */
  ignore_synonyms: z.boolean().default(true),
  /** Order rows · "ranked_serp_element.serp_item.rank_group,asc" puts
   *  best-ranked keywords first which is what we want for the table. */
  order_by: z.array(z.string()).optional(),
});
export type RankedKeywordsQuery = z.input<typeof RankedKeywordsQuerySchema>;

// ---- Per-item shape (subset · we only persist what we use) ----------------

const KeywordInfoSchema = z.object({
  language_code: z.string().nullable().optional(),
  location_code: z.number().nullable().optional(),
  search_volume: z.number().nullable().optional(),
  cpc: z.number().nullable().optional(),
  competition: z.number().nullable().optional(),
  competition_level: z.string().nullable().optional(),
  monthly_searches: z
    .array(
      z.object({
        year: z.number().optional(),
        month: z.number().optional(),
        search_volume: z.number().nullable().optional(),
      }),
    )
    .nullable()
    .optional(),
});

const KeywordDataSchema = z.object({
  keyword: z.string(),
  keyword_info: KeywordInfoSchema.nullable().optional(),
  // DfS may also surface keyword_properties + serp_info · we keep these
  // loose since we don't use them today.
});

const RankedSerpItemSchema = z.object({
  type: z.string().nullable().optional(),
  rank_group: z.number().nullable().optional(),
  rank_absolute: z.number().nullable().optional(),
  domain: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  // Day-over-day movement flags · DfS computes these against the
  // previous weekly snapshot of the same domain × keyword.
  is_new: z.boolean().nullable().optional(),
  is_up: z.boolean().nullable().optional(),
  is_down: z.boolean().nullable().optional(),
  // Estimated traffic value from this single ranking position
  etv: z.number().nullable().optional(),
  estimated_paid_traffic_cost: z.number().nullable().optional(),
});

const RankedSerpElementSchema = z.object({
  serp_item: RankedSerpItemSchema.nullable().optional(),
  /** Some rows include a "last_updated_time" etc · keep loose. */
});

export const RankedKeywordsItemSchema = z.object({
  se_type: z.string().nullable().optional(),
  keyword_data: KeywordDataSchema,
  ranked_serp_element: RankedSerpElementSchema.nullable().optional(),
});
export type RankedKeywordsItem = z.infer<typeof RankedKeywordsItemSchema>;

const MetricsBlock = z
  .object({
    pos_1: z.number().nullable().optional(),
    pos_2_3: z.number().nullable().optional(),
    pos_4_10: z.number().nullable().optional(),
    pos_11_20: z.number().nullable().optional(),
    pos_21_30: z.number().nullable().optional(),
    pos_31_40: z.number().nullable().optional(),
    pos_41_50: z.number().nullable().optional(),
    pos_51_60: z.number().nullable().optional(),
    pos_61_70: z.number().nullable().optional(),
    pos_71_80: z.number().nullable().optional(),
    pos_81_90: z.number().nullable().optional(),
    pos_91_100: z.number().nullable().optional(),
    etv: z.number().nullable().optional(),
    impressions_etv: z.number().nullable().optional(),
    count: z.number().nullable().optional(),
    estimated_paid_traffic_cost: z.number().nullable().optional(),
    is_new: z.number().nullable().optional(),
    is_up: z.number().nullable().optional(),
    is_down: z.number().nullable().optional(),
    is_lost: z.number().nullable().optional(),
  })
  .nullable()
  .optional();

const RankedKeywordsResultSchema = z.object({
  target: z.string().nullable().optional(),
  location_code: z.number().nullable().optional(),
  language_code: z.string().nullable().optional(),
  total_count: z.number().nullable().optional(),
  items_count: z.number().nullable().optional(),
  items: z.array(RankedKeywordsItemSchema).nullable().optional(),
  metrics: z
    .object({
      organic: MetricsBlock,
      paid: MetricsBlock,
    })
    .nullable()
    .optional(),
});
export type RankedKeywordsResultRaw = z.infer<
  typeof RankedKeywordsResultSchema
>;

// ---- Public return shape · slim, typed, easy to use downstream ------------

export interface RankedKeywordsResult {
  target: string;
  totalCount: number;
  itemsCount: number;
  items: RankedKeywordsItem[];
  /** Aggregate metrics across all ranked keywords for the domain. */
  organicMetrics: {
    pos1: number;
    pos2to3: number;
    pos4to10: number;
    etv: number;
    estimatedPaidTrafficCost: number;
    isNew: number;
    isUp: number;
    isDown: number;
    isLost: number;
  };
  operation: string;
}

// ---- Adapter ---------------------------------------------------------------

const OPERATION = "dataforseo.labs.ranked_keywords";

async function rankedKeywordsRaw(
  query: RankedKeywordsQuery,
): Promise<RankedKeywordsResult> {
  const parsed = RankedKeywordsQuerySchema.parse(query);
  const { result } = await dataforSeoPost<RankedKeywordsResultRaw>({
    path: "/v3/dataforseo_labs/google/ranked_keywords/live",
    operation: OPERATION,
    body: parsed as Record<string, unknown>,
  });
  const first = RankedKeywordsResultSchema.parse(result[0] ?? {});
  const orgMetrics = first.metrics?.organic ?? null;

  return {
    target: first.target ?? parsed.target,
    totalCount: first.total_count ?? 0,
    itemsCount: first.items_count ?? first.items?.length ?? 0,
    items: first.items ?? [],
    organicMetrics: {
      pos1: orgMetrics?.pos_1 ?? 0,
      pos2to3: orgMetrics?.pos_2_3 ?? 0,
      pos4to10: orgMetrics?.pos_4_10 ?? 0,
      etv: orgMetrics?.etv ?? 0,
      estimatedPaidTrafficCost: orgMetrics?.estimated_paid_traffic_cost ?? 0,
      isNew: orgMetrics?.is_new ?? 0,
      isUp: orgMetrics?.is_up ?? 0,
      isDown: orgMetrics?.is_down ?? 0,
      isLost: orgMetrics?.is_lost ?? 0,
    },
    operation: OPERATION,
  };
}

/** Non-cached variant · use only when you need force-refresh (admin
 *  "Re-scan now" inside the same 24h window). */
export const rankedKeywordsUncached = withCostCounter(
  OPERATION,
  DATAFORSEO_UNIT_COST_USD.rankedKeywords,
  rankedKeywordsRaw,
);

/** 24h-cached · default path. Cache key is the full input tuple. */
export const rankedKeywords = kvCache(
  "dfs:labs:ranked_keywords",
  { ttl: 24 * 60 * 60, tag: "dfs:labs" },
  rankedKeywordsUncached,
);
