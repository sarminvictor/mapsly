// services/dataforseo/serp-local-pack.ts · Google Maps + local-pack SERP.
//
// Endpoint: /v3/serp/google/maps/live/advanced
// Use case: weekly SERP rank scan (C.9). Tracks "local 3-pack" occupancy
// per (keyword, geo) — surfaces whether our business is in the top 3 Maps
// results, who's ahead of us, who's adjacent.
//
// Cache: 24h, same as organic SERP. Different `location_coordinate` yields
// a different cache key.

import { z } from "zod";
import { kvCache } from "@/lib/cache";
import { withCostCounter } from "@/lib/cost/cost-counter";
import { dataforSeoPost } from "./client";
import { DATAFORSEO_UNIT_COST_USD } from "./pricing";

// ---- Schemas ------------------------------------------------------------

const Coordinate = z
  .string()
  .regex(
    /^-?\d+(\.\d+)?,-?\d+(\.\d+)?,\d+(\.\d+)?$/,
    "location_coordinate must be 'lat,lng,radiusKm'",
  );

export const SerpLocalPackQuerySchema = z
  .object({
    keyword: z.string().min(1).max(700),
    /** Either location_code (numeric) or location_coordinate (lat,lng,r).
     *  At least one required by DataForSEO; we accept both and let the API
     *  validate combinations. */
    location_code: z.number().int().positive().optional(),
    location_coordinate: Coordinate.optional(),
    language_code: z.string().min(2).default("en"),
    device: z.enum(["desktop", "mobile"]).default("mobile"),
    /** SERP depth — number of map results to scan. Hard-cap 100. */
    depth: z.number().int().min(1).max(100).default(20),
  })
  .refine(
    (q) => q.location_code !== undefined || q.location_coordinate !== undefined,
    { message: "either location_code or location_coordinate is required" },
  );
export type SerpLocalPackQuery = z.input<typeof SerpLocalPackQuerySchema>;

export const SerpMapsItemSchema = z.object({
  type: z.string(),
  rank_group: z.number().nullable().optional(),
  rank_absolute: z.number().nullable().optional(),
  title: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  cid: z.string().nullable().optional(),
  rating: z
    .object({
      rating_type: z.string().optional(),
      value: z.number().nullable().optional(),
      votes_count: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
  rating_max: z.number().nullable().optional(),
  snippet: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
});
export type SerpMapsItem = z.infer<typeof SerpMapsItemSchema>;

const SerpMapsResultSchema = z.object({
  keyword: z.string().optional(),
  type: z.string().optional(),
  se_domain: z.string().optional(),
  location_code: z.number().nullable().optional(),
  items_count: z.number().nullable().optional(),
  items: z.array(SerpMapsItemSchema).nullable().optional(),
});

export interface SerpLocalPackResult {
  keyword: string;
  items: SerpMapsItem[];
  operation: string;
}

// ---- Adapter ------------------------------------------------------------

const OPERATION = "dataforseo.serp.local-pack";

async function serpLocalPackRaw(
  query: SerpLocalPackQuery,
): Promise<SerpLocalPackResult> {
  const parsed = SerpLocalPackQuerySchema.parse(query);
  const { result } = await dataforSeoPost<z.infer<typeof SerpMapsResultSchema>>({
    path: "/v3/serp/google/maps/live/advanced",
    operation: OPERATION,
    body: parsed,
  });
  const first = SerpMapsResultSchema.parse(result[0] ?? {});
  return {
    keyword: first.keyword ?? parsed.keyword,
    items: first.items ?? [],
    operation: OPERATION,
  };
}

export const serpLocalPackUncached = withCostCounter(
  OPERATION,
  DATAFORSEO_UNIT_COST_USD.serpLocalPack,
  serpLocalPackRaw,
);

export const serpLocalPack = kvCache(
  "dfs:serp:local-pack",
  { ttl: 24 * 60 * 60, tag: "dfs:serp" },
  serpLocalPackUncached,
);
