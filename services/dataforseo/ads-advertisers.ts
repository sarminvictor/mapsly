// services/dataforseo/ads-advertisers.ts · Google Ads Transparency — advertisers.
//
// Endpoint: /v3/serp/google/ads_advertisers/live/advanced
// Use case: discover which advertisers are running Google ads for a keyword in
// a location (the Google Ads Transparency Center). Feeds `ads-search` — pass a
// returned `advertiser_id` to pull that advertiser's creatives.
//
// IMPORTANT: this endpoint requires `location_code` (numeric). Passing
// `location_name` returns task error 40501 "Invalid Field" (verified
// 2026-05-28). 40102 "No Search Results" is a valid empty result (no
// advertisers for the keyword/geo), not an error.
//
// Cache: 24h. Cost: $0.002/call (Live). Desktop/Windows only per DfS docs.

import { z } from "zod";
import { kvCache } from "@/lib/cache";
import { withCostCounter } from "@/lib/cost/cost-counter";
import { dataforSeoPost } from "./client";
import { DATAFORSEO_UNIT_COST_USD } from "./pricing";

// ---- Schemas ------------------------------------------------------------

export const AdsAdvertisersQuerySchema = z.object({
  keyword: z.string().min(1).max(700),
  /** DataForSEO numeric location code. US=2840, CA=2124. `location_name` is
   *  NOT supported by this endpoint (returns task error 40501). */
  location_code: z.number().int().positive().default(2840),
  language_code: z.string().min(2).default("en"),
});
export type AdsAdvertisersQuery = z.input<typeof AdsAdvertisersQuerySchema>;

export const AdsAdvertiserItemSchema = z.object({
  type: z.string(),
  rank_group: z.number().nullable().optional(),
  rank_absolute: z.number().nullable().optional(),
  /** Advertiser display name. */
  title: z.string().nullable().optional(),
  /** Transparency Center advertiser id — pass to `ads-search`. */
  advertiser_id: z.string().nullable().optional(),
  /** Advertiser country code, e.g. "US". */
  location: z.string().nullable().optional(),
  verified: z.boolean().nullable().optional(),
  /** Approximate count of active ads — an activity/spend proxy. */
  approx_ads_count: z.number().nullable().optional(),
});
export type AdsAdvertiserItem = z.infer<typeof AdsAdvertiserItemSchema>;

const AdsAdvertisersResultSchema = z.object({
  keyword: z.string().optional(),
  type: z.string().optional(),
  location_code: z.number().optional(),
  language_code: z.string().optional(),
  items_count: z.number().nullable().optional(),
  items: z.array(AdsAdvertiserItemSchema).nullable().optional(),
});

export interface AdsAdvertisersResult {
  keyword: string;
  items: AdsAdvertiserItem[];
  operation: string;
}

// ---- Adapter ------------------------------------------------------------

const OPERATION = "dataforseo.serp.ads-advertisers";

async function adsAdvertisersRaw(
  query: AdsAdvertisersQuery,
): Promise<AdsAdvertisersResult> {
  const parsed = AdsAdvertisersQuerySchema.parse(query);
  const { result } = await dataforSeoPost<
    z.infer<typeof AdsAdvertisersResultSchema>
  >({
    path: "/v3/serp/google/ads_advertisers/live/advanced",
    operation: OPERATION,
    body: parsed,
    // 40102 "No Search Results" = a valid empty result (no advertisers for
    // this keyword/geo), still billed $0.002 — treat as success, items=[].
    acceptableTaskStatusCodes: [20000, 40102],
  });
  const first = AdsAdvertisersResultSchema.parse(result[0] ?? {});
  return {
    keyword: first.keyword ?? parsed.keyword,
    items: first.items ?? [],
    operation: OPERATION,
  };
}

export const adsAdvertisersUncached = withCostCounter(
  OPERATION,
  DATAFORSEO_UNIT_COST_USD.adsAdvertisers,
  adsAdvertisersRaw,
);

export const adsAdvertisers = kvCache(
  "dfs:ads:advertisers",
  { ttl: 24 * 60 * 60, tag: "dfs:ads" },
  adsAdvertisersUncached,
);
