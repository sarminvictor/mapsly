// services/dataforseo/reviews.ts · Google Maps reviews pull (Live tier).
//
// Endpoint: /v3/business_data/google/reviews/live
// Use case: legacy daily new-reviews-delta + weekly reviews-full-pull
// (R.3 replaces both with Standard-queue + pingback flow; this Live
// adapter stays for ad-hoc / debug use and for the existing crons until
// R.3 lands).
//
// Cost: VARIABLE per-call · $0.0015 per 10 reviews returned on Live.
// Earlier versions hardcoded a single $0.0008 unit cost via
// withCostCounter, under-billing depth=50 calls by ~9×. Fixed in R.1 —
// we now bill the cost DfS itself reports (`task.cost`) and fall back
// to per-10-reviews ceil math if the envelope omits it.
//
// Cache: 6h — shorter than other endpoints because the daily delta cron
// wants relatively fresh data.

import { z } from "zod";
import { kvCache } from "@/lib/cache";
import { incrementCost } from "@/lib/cost/cost-counter";
import { dataforSeoPost } from "./client";
import { DATAFORSEO_UNIT_COST_USD } from "./pricing";

// ---- Schemas ------------------------------------------------------------

export const ReviewsQuerySchema = z
  .object({
    /** Google CID (preferred — exact business match). */
    cid: z.string().min(1).optional(),
    /** Google place_id (fallback). */
    place_id: z.string().min(1).optional(),
    /** Business keyword (last-resort when no CID/place_id available). */
    keyword: z.string().min(1).optional(),
    location_code: z.number().int().positive().default(2840),
    language_code: z.string().min(2).default("en"),
    /** Max reviews to return. Hard-capped at 700 by DataForSEO. */
    depth: z.number().int().min(10).max(700).default(50),
    /** Sort: newest | rating_low | rating_high | relevant. */
    sort_by: z
      .enum(["newest", "rating_high", "rating_low", "relevant"])
      .default("newest"),
  })
  .refine(
    (q) =>
      q.cid !== undefined ||
      q.place_id !== undefined ||
      q.keyword !== undefined,
    { message: "one of cid, place_id, keyword is required" },
  );
export type ReviewsQuery = z.input<typeof ReviewsQuerySchema>;

export const ReviewItemSchema = z.object({
  type: z.string().optional(),
  rating: z
    .object({
      rating_type: z.string().optional(),
      value: z.number().nullable().optional(),
      rating_max: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
  review_text: z.string().nullable().optional(),
  original_review_text: z.string().nullable().optional(),
  /** ISO 8601 datetime or null. */
  timestamp: z.string().nullable().optional(),
  profile_name: z.string().nullable().optional(),
  profile_url: z.string().nullable().optional(),
  profile_image_url: z.string().nullable().optional(),
  reviews_count: z.number().nullable().optional(),
  photos_count: z.number().nullable().optional(),
  owner_answer: z.string().nullable().optional(),
  owner_time_of_answer: z.string().nullable().optional(),
  /** Stable Google review id when available. */
  review_id: z.string().nullable().optional(),
});
export type ReviewItem = z.infer<typeof ReviewItemSchema>;

const ReviewsResultSchema = z.object({
  cid: z.string().nullable().optional(),
  place_id: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  /** Aggregate over all reviews on the business profile. */
  reviews_count: z.number().nullable().optional(),
  rating: z
    .object({
      value: z.number().nullable().optional(),
      votes_count: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
  items_count: z.number().nullable().optional(),
  items: z.array(ReviewItemSchema).nullable().optional(),
});

export interface ReviewsPullResult {
  items: ReviewItem[];
  aggregateRating: number | null;
  totalReviewsCount: number | null;
  operation: string;
}

// ---- Adapter ------------------------------------------------------------

const OPERATION = "dataforseo.reviews.pull";

async function reviewsPullRaw(query: ReviewsQuery): Promise<ReviewsPullResult> {
  const parsed = ReviewsQuerySchema.parse(query);
  const { result, rawCostUsd } = await dataforSeoPost<
    z.infer<typeof ReviewsResultSchema>
  >({
    path: "/v3/business_data/google/reviews/live",
    operation: OPERATION,
    body: parsed,
  });
  const first = ReviewsResultSchema.parse(result[0] ?? {});

  // Bill the variable cost. DfS reports the actual call cost in
  // `task.cost` (returned as `rawCostUsd`). Fall back to per-10-reviews
  // math when missing — never silently under-bill.
  const itemsCount = first.items_count ?? first.items?.length ?? 0;
  // DATAFORSEO_UNIT_COST_USD.reviews is the cost for a typical depth=50
  // pull ($0.0075). Scale by actual items: floor of (cost per 10) ×
  // ceil(items/10) ≈ $0.0015 × ceil(items/10).
  const perTen = DATAFORSEO_UNIT_COST_USD.reviews / 50; // per-review unit
  const fallbackCost = perTen * 10 * Math.max(1, Math.ceil(itemsCount / 10));
  const billedCost = rawCostUsd ?? fallbackCost;
  if (billedCost > 0) {
    await incrementCost(billedCost, OPERATION);
  }

  return {
    items: first.items ?? [],
    aggregateRating: first.rating?.value ?? null,
    totalReviewsCount: first.reviews_count ?? null,
    operation: OPERATION,
  };
}

/**
 * Uncached pull. Always bills the open CronRun based on actual items
 * returned. `dataforSeoPost` already enforces CronRun context via
 * `assertCronContext`, so calls outside a CronRun fast-fail there.
 */
export const reviewsPullUncached = reviewsPullRaw;

/**
 * Cached pull. KV TTL = 6h. Cache hits return without invoking the raw
 * function — no cost is billed on a hit (correct: DfS itself caches
 * per-CID for 6h, so a hit means the result was already paid for).
 */
export const reviewsPull = kvCache(
  "dfs:reviews:pull",
  { ttl: 6 * 60 * 60, tag: "dfs:reviews" },
  reviewsPullUncached,
);
