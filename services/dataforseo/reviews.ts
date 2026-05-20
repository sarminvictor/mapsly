// services/dataforseo/reviews.ts · Google Maps reviews pull.
//
// Endpoint: /v3/business_data/google/reviews/live
// Use case: weekly reviews-full-pull (C.9) and daily new-reviews-delta
// (C.8). Returns the latest reviews for a business by CID, place_id, or
// keyword + location.
//
// Cache: 6h — shorter than other endpoints because the daily delta cron
// wants relatively fresh data and pays a small premium. Reviews change
// throughout the day for high-traffic businesses.

import { z } from "zod";
import { kvCache } from "@/lib/cache";
import { withCostCounter } from "@/lib/cost/cost-counter";
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
  const { result } = await dataforSeoPost<z.infer<typeof ReviewsResultSchema>>({
    path: "/v3/business_data/google/reviews/live",
    operation: OPERATION,
    body: parsed,
  });
  const first = ReviewsResultSchema.parse(result[0] ?? {});
  return {
    items: first.items ?? [],
    aggregateRating: first.rating?.value ?? null,
    totalReviewsCount: first.reviews_count ?? null,
    operation: OPERATION,
  };
}

export const reviewsPullUncached = withCostCounter(
  OPERATION,
  DATAFORSEO_UNIT_COST_USD.reviews,
  reviewsPullRaw,
);

export const reviewsPull = kvCache(
  "dfs:reviews:pull",
  { ttl: 6 * 60 * 60, tag: "dfs:reviews" },
  reviewsPullUncached,
);
