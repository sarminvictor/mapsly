// services/dataforseo/ads-search.ts · Google Ads Transparency — ad creatives.
//
// Endpoint: /v3/serp/google/ads_search/live/advanced
// Use case: pull the actual ad creatives an advertiser is/was running — by
// `advertiser_ids` (from ads-advertisers) OR by `target` domain. Returns each
// creative's id, format, preview image, and first/last-shown dates (so we can
// derive "running since" + "currently active").
//
// 40102 "No Search Results" = the advertiser/domain has no ads — valid empty.
//
// Cache: 24h. Cost: $0.002 per SERP (≤40 creatives, Live; depth>40 multiplies).

import { z } from "zod";
import { kvCache } from "@/lib/cache";
import { withCostCounter } from "@/lib/cost/cost-counter";
import { dataforSeoPost } from "./client";
import { DATAFORSEO_UNIT_COST_USD } from "./pricing";

// ---- Schemas ------------------------------------------------------------

export const AdsSearchQuerySchema = z
  .object({
    /** Advertiser domain (e.g. "competitor.com"). Provide this OR
     *  `advertiser_ids` (at least one is required). */
    target: z.string().min(1).optional(),
    /** Up to 25 Transparency advertiser ids (from ads-advertisers). */
    advertiser_ids: z.array(z.string().min(1)).min(1).max(25).optional(),
    /** US=2840, CA=2124. */
    location_code: z.number().int().positive().default(2840),
    language_code: z.string().min(2).default("en"),
    /** Restrict to a platform. */
    platform: z
      .enum([
        "all",
        "google_search",
        "google_maps",
        "google_shopping",
        "youtube",
        "google_play",
      ])
      .default("all"),
    /** Restrict to a creative format. */
    format: z.enum(["all", "text", "image", "video"]).default("all"),
    /** Creatives to return per SERP. Default 40, max 120 (depth>40 costs more). */
    depth: z.number().int().min(1).max(120).default(40),
  })
  .refine((q) => q.target != null || (q.advertiser_ids?.length ?? 0) > 0, {
    message: "ads-search requires either target or advertiser_ids",
  });
export type AdsSearchQuery = z.input<typeof AdsSearchQuerySchema>;

export const AdsCreativeItemSchema = z.object({
  type: z.string(),
  rank_group: z.number().nullable().optional(),
  rank_absolute: z.number().nullable().optional(),
  advertiser_id: z.string().nullable().optional(),
  /** Unique creative id (stable dedupe / React key). */
  creative_id: z.string().nullable().optional(),
  /** Advertiser display name. */
  title: z.string().nullable().optional(),
  /** Link to the ad on the Transparency platform. */
  url: z.string().nullable().optional(),
  verified: z.boolean().nullable().optional(),
  /** "text" | "image" | "video". */
  format: z.string().nullable().optional(),
  preview_image: z
    .object({
      url: z.string().nullable().optional(),
      height: z.number().nullable().optional(),
      width: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
  preview_url: z.string().nullable().optional(),
  /** UTC timestamps — derive "running since" + "currently active" (last_shown
   *  within ~30d). */
  first_shown: z.string().nullable().optional(),
  last_shown: z.string().nullable().optional(),
});
export type AdsCreativeItem = z.infer<typeof AdsCreativeItemSchema>;

const AdsSearchResultSchema = z.object({
  type: z.string().optional(),
  location_code: z.number().optional(),
  language_code: z.string().optional(),
  items_count: z.number().nullable().optional(),
  items: z.array(AdsCreativeItemSchema).nullable().optional(),
});

export interface AdsSearchResult {
  items: AdsCreativeItem[];
  operation: string;
}

// ---- Adapter ------------------------------------------------------------

const OPERATION = "dataforseo.serp.ads-search";

async function adsSearchRaw(query: AdsSearchQuery): Promise<AdsSearchResult> {
  const parsed = AdsSearchQuerySchema.parse(query);
  const { result } = await dataforSeoPost<
    z.infer<typeof AdsSearchResultSchema>
  >({
    path: "/v3/serp/google/ads_search/live/advanced",
    operation: OPERATION,
    body: parsed,
    acceptableTaskStatusCodes: [20000, 40102],
  });
  const first = AdsSearchResultSchema.parse(result[0] ?? {});
  return { items: first.items ?? [], operation: OPERATION };
}

export const adsSearchUncached = withCostCounter(
  OPERATION,
  DATAFORSEO_UNIT_COST_USD.adsSearch,
  adsSearchRaw,
);

export const adsSearch = kvCache(
  "dfs:ads:search",
  { ttl: 24 * 60 * 60, tag: "dfs:ads" },
  adsSearchUncached,
);
