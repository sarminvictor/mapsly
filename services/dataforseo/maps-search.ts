// services/dataforseo/maps-search.ts · Google Maps category search.
//
// Endpoint: /v3/business_data/business_listings/search/live
// Use case: admin-triggered discovery runs from /admin/discovery (see
// modules/business-discovery). Also used by weekly/competitor-diff to
// scan an anchored market for entrants/exits.
//
// Cache: 24h. Repeated calls with identical (categories, coord, limit)
// return the same payload — dedup window prevents accidental rebill.
//
// Cost: $0.001 per call (Live tier). Standard queue would be $0.0001 with
// polling — tracked as future optimization.

import { z } from "zod";
import { kvCache } from "@/lib/cache";
import { assertCronContext, incrementCost } from "@/lib/cost/cost-counter";
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

/** Single business row as returned by DataForSEO Business Listings Search.
 *  We type the identity + scalar fields strictly; the rich nested payloads
 *  (attributes, work_time, popular_times, place_topics, …) come through as
 *  `unknown` so we can persist them as-is via `Json?` columns without
 *  pinning a Zod schema that might drift with DfS's payload shape. The
 *  parser hands these straight through to Prisma. The full original row
 *  is also persisted in `Business.sourceRawJson` for forensic recovery. */
export const MapsBusinessRowSchema = z
  .object({
    // Identity
    type: z.string().optional(),
    cid: z.string().optional(),
    feature_id: z.string().nullable().optional(),
    place_id: z.string().nullable().optional(),
    title: z.string().optional(),
    original_title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),

    // Location
    address: z.string().nullable().optional(),
    snippet: z.string().nullable().optional(),
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
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),

    // Contact
    phone: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    domain: z.string().nullable().optional(),
    contact_info: z.array(z.unknown()).nullable().optional(),

    // Categories
    category: z.string().nullable().optional(),
    category_ids: z.array(z.string()).nullable().optional(),
    additional_categories: z.array(z.string()).nullable().optional(),

    // Visuals
    logo: z.string().nullable().optional(),
    main_image: z.string().nullable().optional(),
    total_photos: z.number().nullable().optional(),

    // Ratings
    rating: z
      .object({
        rating_type: z.string().optional(),
        value: z.number().nullable().optional(),
        votes_count: z.number().nullable().optional(),
        rating_max: z.number().nullable().optional(),
      })
      .nullable()
      .optional(),
    rating_distribution: z.record(z.string(), z.number()).nullable().optional(),

    // Behavior signals
    is_claimed: z.boolean().nullable().optional(),
    hotel_rating: z.unknown().optional(),
    price_level: z.unknown().nullable().optional(),

    // Rich nested payloads · stored as Json
    attributes: z.unknown().nullable().optional(),
    place_topics: z.record(z.string(), z.number()).nullable().optional(),
    people_also_search: z.array(z.unknown()).nullable().optional(),
    work_time: z.unknown().nullable().optional(),
    popular_times: z.unknown().nullable().optional(),
    local_business_links: z.array(z.unknown()).nullable().optional(),

    // Provenance
    check_url: z.string().nullable().optional(),
    last_updated_time: z.string().nullable().optional(),
    first_seen: z.string().nullable().optional(),
  })
  // Preserve unknown fields · DfS adds payloads over time (price_levels,
  // booking metadata, etc.) and we want them to land in `sourceRawJson`
  // without a schema bump. Stripping by default would silently drop them.
  .passthrough();
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
  /** Actual cost reported by DfS for this call. Falls back to the flat
   *  pricing constant when the envelope didn't echo cost (shouldn't
   *  happen on Live tier but defensive). Use this for accurate
   *  per-call billing in DiscoveryRun / activity ledgers. */
  rawCostUsd: number;
}

// ---- Adapter ------------------------------------------------------------

const OPERATION = "dataforseo.maps.search";

/**
 * Inner call · enforces CronRun context, posts to DfS, charges the
 * actual cost reported by the envelope. Unlike the canonical
 * `withCostCounter` wrapper (flat unit cost), this uses DfS's
 * per-response `cost` field so our ledger matches their invoice
 * exactly. Live-tier Business Listings is row-priced and varies with
 * `limit` — flat costing was off by 10× at limit=3.
 */
async function mapsSearchRaw(
  query: MapsSearchQuery,
): Promise<MapsSearchResult> {
  assertCronContext(OPERATION);
  const parsed = MapsSearchQuerySchema.parse(query);
  const { result, rawCostUsd } = await dataforSeoPost<
    z.infer<typeof MapsResultSchema>
  >({
    path: "/v3/business_data/business_listings/search/live",
    operation: OPERATION,
    body: parsed,
  });

  const first = MapsResultSchema.parse(result[0] ?? {});
  // Bill the CronRun with the actual cost (fallback to flat constant
  // if DfS didn't echo cost · defensive · should never fire on Live).
  const billedCost = rawCostUsd ?? DATAFORSEO_UNIT_COST_USD.mapsSearch;
  if (billedCost > 0) await incrementCost(billedCost, OPERATION);

  return {
    items: first.items ?? [],
    totalCount: first.total_count ?? null,
    operation: OPERATION,
    rawCostUsd: billedCost,
  };
}

/** Uncached entrypoint. Use for explicit re-pull / debugging. */
export const mapsSearchUncached = mapsSearchRaw;

/** Cost-tracked + 24h KV-cached entrypoint. Default for cron handlers
 *  and admin discovery runs. Cache hits do NOT increment cost — they
 *  also do NOT enter `mapsSearchRaw`, so the cost ledger stays accurate. */
export const mapsSearch = kvCache(
  "dfs:maps:search",
  { ttl: 24 * 60 * 60, tag: "dfs:maps" },
  mapsSearchUncached,
);
