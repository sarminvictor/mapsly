/**
 * SMB reviews · payload type definitions.
 *
 * `SmbReviewsData` is the flat shape the `/(smb)/reviews` page renders
 * from. It bundles the active tab's review list with right-rail
 * aggregates (rating distribution, themes) so the page doesn't have to
 * make multiple queries from JSX.
 *
 * `EMPTY_SMB_REVIEWS` is the build-phase / no-biz / error short-circuit
 * shape per `.claude/rules/cache-components.md` Pattern 1. It MUST have
 * every field of the interface (including all aggregate shapes) so
 * TypeScript catches partial returns at literal-comparison time.
 *
 * Callers identify the empty-business state by
 * `data.ownedBusinessId === ""` and render the onboarding empty state
 * (same convention as `modules/smb-dashboard`).
 *
 * The active-tab filter is encoded in the URL search params (`?tab=...`)
 * and resolved server-side — no client component state. Per
 * `.claude/rules/data-fetching.md`, this keeps the route streamable and
 * sharable, matches Maria's "low-cognitive-load" voice (URL says what
 * she's looking at), and works without JS on first paint.
 */

export const REVIEW_TABS = [
  "unanswered",
  "negative",
  "all",
  "by-theme",
  "replied",
] as const;

export type ReviewTab = (typeof REVIEW_TABS)[number];

export const DEFAULT_REVIEW_TAB: ReviewTab = "unanswered";

export type ReviewSentiment = "POSITIVE" | "NEUTRAL" | "NEGATIVE";

/**
 * Flat per-review row shape rendered by `ReviewCard`. Denormalises the
 * Prisma `Review` model fields the page actually displays — no nested
 * `business` etc, since the page already knows the business identity
 * from `SmbReviewsData`. Dates serialised as ISO strings to keep server
 * → client transfer JSON-safe.
 */
export interface ReviewItem {
  id: string;
  reviewerInitials: string;
  reviewerPriorReviews: number | null;
  stars: number;
  text: string | null;
  language: string | null;
  postedAt: string; // ISO
  daysAgo: number;
  ownerReplied: boolean;
  ownerReplyText: string | null;
  ownerReplyAt: string | null; // ISO
  sentiment: ReviewSentiment | null;
  themes: string[];
  isUrgent: boolean;
  aiReplyDraftEn: string | null;
  aiReplyDraftEs: string | null;
}

/**
 * Star distribution across all reviews on the latest snapshot. Counts
 * are absolute; the renderer normalises against `total` for the bars.
 */
export interface RatingDistribution {
  total: number;
  star5: number;
  star4: number;
  star3: number;
  star2: number;
  star1: number;
}

/** A single theme bucket for the right-rail breakdown. */
export interface ThemeBucket {
  /** Lowercase theme slug used by the AI classifier (`"scheduling"`). */
  theme: string;
  /** Total mentions across all reviews. */
  count: number;
  /** Mentions inside 1–3★ reviews — used to surface negative skew. */
  negativeCount: number;
}

/**
 * Counts shown next to each tab. Pre-computed so the tab strip can
 * render without flickering once the body resolves.
 */
export interface ReviewTabCounts {
  unanswered: number;
  negative: number;
  all: number;
  replied: number;
}

export interface SmbReviewsData {
  /** Owned business id, or `""` for empty / build-phase. */
  ownedBusinessId: string;
  businessName: string;

  /** Active tab; falls back to `unanswered` when the URL is missing. */
  activeTab: ReviewTab;

  /** Reviews for the active tab — already filtered + ordered. */
  reviews: ReviewItem[];

  /** Aggregate tab counts (snapshot of total, not active-filter). */
  tabCounts: ReviewTabCounts;

  /** Star histogram + total. */
  ratingDistribution: RatingDistribution;

  /**
   * Top theme buckets, ordered by `count` desc. Capped at 8 for the
   * rail so it stays scannable.
   */
  topThemes: ThemeBucket[];

  /**
   * When the latest review snapshot was written. Null until the C.8
   * daily delta runs.
   */
  lastSnapshotAt: string | null; // ISO
}

export const EMPTY_RATING_DISTRIBUTION: RatingDistribution = {
  total: 0,
  star5: 0,
  star4: 0,
  star3: 0,
  star2: 0,
  star1: 0,
};

export const EMPTY_TAB_COUNTS: ReviewTabCounts = {
  unanswered: 0,
  negative: 0,
  all: 0,
  replied: 0,
};

export const EMPTY_SMB_REVIEWS: SmbReviewsData = {
  ownedBusinessId: "",
  businessName: "",
  activeTab: DEFAULT_REVIEW_TAB,
  reviews: [],
  tabCounts: EMPTY_TAB_COUNTS,
  ratingDistribution: EMPTY_RATING_DISTRIBUTION,
  topThemes: [],
  lastSnapshotAt: null,
};

/**
 * Normalise an incoming `tab` search-param value (which may be `undefined`,
 * an array, or any string) into a known `ReviewTab`. Anything unrecognised
 * falls back to the default. Encoded here so the page handler and any
 * server actions agree on the same parser.
 */
export function parseReviewTab(
  input: string | string[] | undefined,
): ReviewTab {
  const raw = Array.isArray(input) ? input[0] : input;
  if (typeof raw !== "string") return DEFAULT_REVIEW_TAB;
  return (REVIEW_TABS as readonly string[]).includes(raw)
    ? (raw as ReviewTab)
    : DEFAULT_REVIEW_TAB;
}
