// services/dataforseo/maps-search.ts · Google Maps category search.
//
// Endpoint: /v3/business_data/business_listings/search/live
// Use case: discover businesses in a category × geo for the indexer cron
// (C.8 daily/indexer-new-businesses). Returns up to `limit` businesses
// matching the query inside a geo coordinate.
//
// Cache: 24h. Most cron callers ask the same coord+category every day; the
// dedup window prevents accidental re-runs from billing twice.
//
// Cost: $0.001 per call (Live tier). Standard queue would be $0.0001 with
// polling — tracked as future optimization.

import { z } from "zod";
import { kvCache } from "@/lib/cache";
import { withCostCounter } from "@/lib/cost/cost-counter";
import { dataforSeoPost } from "./client";
import { DATAFORSEO_UNIT_COST_USD } from "./pricing";

// ---- Schemas ------------------------------------------------------------

/** Coordinate string `"lat,lng,radiusKm"`. DataForSEO requires this format. */
const Coordinate = z
  .string()
  .regex(
    /^-?\d+(\.\d+)?,-?\d+(\.\d+)?,\d+(\.\d+)?$/,
    "location_coordinate must be 'lat,lng,radiusKm' (e.g. '25.767,-80.194,5')",
  );

export const MapsSearchQuerySchema = z.object({
  /** DataForSEO category IDs (NOT Google category strings). See
   *  https://dataforseo.com/help-center/business-data-api/categories */
  categories: z.array(z.string().min(1)).min(1).max(10),
  /** Center + radius in km. */
  location_coordinate: Coordinate,
  /** BCP-47 language code, lowercased. */
  language_code: z.string().min(2).default("en"),
  /** Max results returned. Hard-capped at 1000 by DataForSEO. */
  limit: z.number().int().min(1).max(1000).default(100),
});
export type MapsSearchQuery = z.input<typeof MapsSearchQuerySchema>;

/** Single business row as returned by DataForSEO. We schema only the fields
 *  we read; unknown fields pass through (Zod permits extras by default). */
export const MapsBusinessRowSchema = z.object({
  type: z.string().optional(),
  cid: z.string().optional(),
  feature_id: z.string().optional(),
  title: z.string().optional(),
  address: z.string().optional(),
  address_info: z
    .object({
      borough: z.string().nullable().optional(),
      address: z.string().nullable().optional(),
      city: z.string().nullable().optional(),
      zip: z.string().nullable().optional(),
      region: z.string().nullable().optional(),
      country_code: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  phone: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  additional_categories: z.array(z.string()).nullable().optional(),
  place_id: z.string().nullable().optional(),
  rating: z
    .object({
      rating_type: z.string().optional(),
      value: z.number().nullable().optional(),
      votes_count: z.number().nullable().optional(),
      rating_max: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  is_claimed: z.boolean().nullable().optional(),
});
export type MapsBusinessRow = z.infer<typeof MapsBusinessRowSchema>;

const MapsResultSchema = z.object({
  total_count: z.number().nullable().optional(),
  count: z.number().nullable().optional(),
  items: z.array(MapsBusinessRowSchema).nullable().optional(),
});

export interface MapsSearchResult {
  items: MapsBusinessRow[];
  totalCount: number | null;
  operation: string;
}

// ---- Adapter ------------------------------------------------------------

const OPERATION = "dataforseo.maps.search";

async function mapsSearchRaw(
  query: MapsSearchQuery,
): Promise<MapsSearchResult> {
  const parsed = MapsSearchQuerySchema.parse(query);
  const { result } = await dataforSeoPost<z.infer<typeof MapsResultSchema>>({
    path: "/v3/business_data/business_listings/search/live",
    operation: OPERATION,
    body: parsed,
  });

  const first = MapsResultSchema.parse(result[0] ?? {});
  return {
    items: first.items ?? [],
    totalCount: first.total_count ?? null,
    operation: OPERATION,
  };
}

/** Cost-tracked, uncached entrypoint. Use for explicit re-pull / debugging. */
export const mapsSearchUncached = withCostCounter(
  OPERATION,
  DATAFORSEO_UNIT_COST_USD.mapsSearch,
  mapsSearchRaw,
);

/** Cost-tracked + 24h KV-cached entrypoint. Default for cron handlers. */
export const mapsSearch = kvCache(
  "dfs:maps:search",
  { ttl: 24 * 60 * 60, tag: "dfs:maps" },
  mapsSearchUncached,
);
