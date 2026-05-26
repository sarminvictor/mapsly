// modules/reviews/persist-helpers.ts
//
// Pure transforms from DataForSEO review items → Prisma insert shape.
// Extracted from app/api/cron/daily/new-reviews-delta/route.ts so the
// qualify-time pull (R.2), weekly delta cron (R.3), and the pingback
// webhook (R.1) all share one canonical normalizer.
//
// PII discipline: reviewer name is anonymized to initials per
// `.claude/rules/security.md` § PII handling. Never store the full
// profile name.

import type { ReviewItem } from "@/services/dataforseo";

export interface ReviewPersistData {
  businessId: string;
  externalId: string;
  reviewerName: string;
  stars: number;
  text: string | null;
  language: string | null;
  postedAt: Date;
  ownerReplied: boolean;
  ownerReplyText: string | null;
  ownerReplyAt: Date | null;
  reviewerProfileReviews: number | null;
}

/**
 * Map a DataForSEO review item into the Review insert shape. Returns null
 * if the row is missing fields we can't synthesize defaults for
 * (`review_id`, `rating.value`, `timestamp`).
 *
 * Reviewer name is anonymized to initials. e.g. "John Doe" → "J.D.";
 * single-token names → first letter only.
 */
export function reviewItemToPersist(
  item: ReviewItem,
  businessId: string,
): ReviewPersistData | null {
  const ratingValue =
    typeof item.rating?.value === "number" ? item.rating.value : null;
  const timestamp = item.timestamp ? new Date(item.timestamp) : null;
  if (
    !item.review_id ||
    ratingValue == null ||
    !timestamp ||
    Number.isNaN(timestamp.getTime())
  ) {
    return null;
  }

  const stars = clampStars(ratingValue);
  const reviewerName = anonymizeReviewerName(item.profile_name);

  // Strip HTML · DfS sometimes surfaces owner_answer with <br> tags
  // (e.g. "Hi Sarah!<br><br>Thanks for stopping by!"). React renders
  // those as literal text · ugly. Strip at persist so the DB has
  // clean text for downstream renderers + AI extractors.
  const rawOwnerReply =
    typeof item.owner_answer === "string" && item.owner_answer.trim().length > 0
      ? stripHtml(item.owner_answer.trim())
      : null;
  const ownerReplyText =
    rawOwnerReply && rawOwnerReply.length > 0 ? rawOwnerReply : null;
  const ownerReplyAt = item.owner_time_of_answer
    ? safeDate(item.owner_time_of_answer)
    : null;

  const reviewText = item.review_text
    ? stripHtml(item.review_text.toString())
    : null;

  return {
    businessId,
    externalId: item.review_id,
    reviewerName,
    stars,
    text: reviewText,
    language: null,
    postedAt: timestamp,
    ownerReplied: ownerReplyText != null,
    ownerReplyText,
    ownerReplyAt,
    reviewerProfileReviews:
      typeof item.reviews_count === "number" ? item.reviews_count : null,
  };
}

export function anonymizeReviewerName(raw: string | null | undefined): string {
  if (!raw) return "Anon";
  const parts = raw
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 0);
  if (parts.length === 0) return "Anon";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return parts
    .slice(0, 3)
    .map((p) => p.charAt(0).toUpperCase())
    .join(".");
}

export function clampStars(v: number): number {
  // Google rating is 1–5; DataForSEO occasionally surfaces decimals.
  // Clamp + round-to-nearest-integer per Review.stars schema (Int).
  const n = Math.round(v);
  if (n < 1) return 1;
  if (n > 5) return 5;
  return n;
}

export function safeDate(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Strip HTML tags + decode common entities. Used to clean both review
 * text and owner replies before persistence · DfS sometimes returns
 * `<br>` (and rarely `<p>`) tags from Google's verbatim response.
 *
 * Conservative: <br> → newline, paragraph breaks → double-newline,
 * everything else stripped to text. Decodes the 5 standard HTML
 * entities. Pre-line CSS rendering preserves the resulting newlines.
 *
 * Per `.claude/rules/security.md`, we NEVER use dangerouslySetInnerHTML
 * on review text · this util is the canonical sanitizer.
 */
export function stripHtml(input: string): string {
  return input
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Map ISO-2 country code → DataForSEO location_code for review queries. */
export function locationCodeForCountry(country: string | null): number {
  switch ((country ?? "").toUpperCase()) {
    case "CA":
    case "CAN":
      return 2124;
    case "UK":
    case "GB":
      return 2826;
    case "AU":
      return 2036;
    default:
      return 2840;
  }
}
