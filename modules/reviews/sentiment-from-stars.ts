// modules/reviews/sentiment-from-stars.ts
//
// Star-based sentiment mapping · zero cost, instant, deterministic.
//
// Per Viktor's call (review-system design v0.10): the AI sentiment
// classifier in services/ai/sentiment.ts is OVER-engineering. Stars
// already encode sentiment for the SMB use case — the /reviews tabs
// (Unanswered / Negative / All / Replied) only need a coarse 3-way
// bucket and stars give that for free.
//
// Mapping:
//   1-2 stars → NEGATIVE   (the "Negative" tab on /reviews)
//   3 stars   → NEUTRAL    (mixed reviews are worth surfacing too)
//   4-5 stars → POSITIVE   (the bulk of healthy businesses' reviews)
//
// The AI classifier is retired from the runtime path. The file
// services/ai/sentiment.ts stays in the repo for a possible v2
// "aspect-based sentiment" feature (e.g. "5★ but wait time was bad")
// but is NOT called from any cron handler or upsert path.

/** Mirrors the Prisma `ReviewSentiment` enum without importing from the
 *  generated client (lighter import graph for upsert hot paths). */
export type ReviewSentimentValue = "POSITIVE" | "NEUTRAL" | "NEGATIVE";

/**
 * Map a Google star rating (1–5) to a Mapsly sentiment bucket.
 *
 * Returns null only for non-integer / out-of-range inputs — callers
 * should already have clamped to [1,5] integer via clampStars(). If
 * null is returned, prefer leaving the Review.sentiment field NULL so
 * downstream filters (Negative tab, etc.) correctly skip the row.
 */
export function sentimentFromStars(stars: number): ReviewSentimentValue | null {
  if (!Number.isInteger(stars)) return null;
  if (stars < 1 || stars > 5) return null;
  if (stars <= 2) return "NEGATIVE";
  if (stars === 3) return "NEUTRAL";
  return "POSITIVE";
}
