// services/dataforseo/serp-organic.ts · Google organic top-10 SERP.
//
// Endpoint: /v3/serp/google/organic/live/advanced
// Use case: weekly SERP rank scan (C.9). For each tracked keyword, returns
// the top organic results with rank, URL, title, description.
//
// Cache: 24h. Multiple cron invocations the same day for the same keyword
// dedupe. Different `location_code` produces a different cache key.

import { z } from "zod";
import { kvCache } from "@/lib/cache";
import { withCostCounter } from "@/lib/cost/cost-counter";
import { dataforSeoPost } from "./client";
import { DATAFORSEO_UNIT_COST_USD } from "./pricing";

// ---- Schemas ------------------------------------------------------------

export const SerpOrganicQuerySchema = z.object({
  keyword: z.string().min(1).max(700),
  /** DataForSEO numeric location code. US=2840, CA=2124. See
   *  https://docs.dataforseo.com/v3/serp/google/locations */
  location_code: z.number().int().positive().default(2840),
  language_code: z.string().min(2).default("en"),
  /** Mobile or desktop ranking. */
  device: z.enum(["desktop", "mobile"]).default("desktop"),
  /** SERP depth — number of organic positions to scan. Hard-cap 100. */
  depth: z.number().int().min(1).max(100).default(20),
});
export type SerpOrganicQuery = z.input<typeof SerpOrganicQuerySchema>;

/** Single item inside `items[]`. DataForSEO returns many item.type values
 *  (organic, paid, knowledge_graph, …); we keep type loose. */
export const SerpOrganicItemSchema = z.object({
  type: z.string(),
  rank_group: z.number().nullable().optional(),
  rank_absolute: z.number().nullable().optional(),
  domain: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  is_image: z.boolean().nullable().optional(),
  is_video: z.boolean().nullable().optional(),
});
export type SerpOrganicItem = z.infer<typeof SerpOrganicItemSchema>;

const SerpOrganicResultSchema = z.object({
  keyword: z.string().optional(),
  type: z.string().optional(),
  se_domain: z.string().optional(),
  location_code: z.number().optional(),
  language_code: z.string().optional(),
  items_count: z.number().nullable().optional(),
  items: z.array(SerpOrganicItemSchema).nullable().optional(),
});

export interface SerpOrganicResult {
  keyword: string;
  items: SerpOrganicItem[];
  operation: string;
}

// ---- Adapter ------------------------------------------------------------

const OPERATION = "dataforseo.serp.organic";

async function serpOrganicRaw(query: SerpOrganicQuery): Promise<SerpOrganicResult> {
  const parsed = SerpOrganicQuerySchema.parse(query);
  const { result } = await dataforSeoPost<z.infer<typeof SerpOrganicResultSchema>>({
    path: "/v3/serp/google/organic/live/advanced",
    operation: OPERATION,
    body: parsed,
  });
  const first = SerpOrganicResultSchema.parse(result[0] ?? {});
  return {
    keyword: first.keyword ?? parsed.keyword,
    items: first.items ?? [],
    operation: OPERATION,
  };
}

export const serpOrganicUncached = withCostCounter(
  OPERATION,
  DATAFORSEO_UNIT_COST_USD.serpOrganic,
  serpOrganicRaw,
);

export const serpOrganic = kvCache(
  "dfs:serp:organic",
  { ttl: 24 * 60 * 60, tag: "dfs:serp" },
  serpOrganicUncached,
);
