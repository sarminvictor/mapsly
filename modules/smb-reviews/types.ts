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
 * (same convention as `modules/smb-home`).
 *
 * The active-tab filter is encoded in the URL search params (`?tab=...`)
 * and resolved server-side — no client component state. Per
 * `.claude/rules/data-fetching.md`, this keeps the route streamable and
 * sharable, matches Maria's "low-cognitive-load" voice (URL says what
 * she's looking at), and works without JS on first paint.
 */

import { isHumanMedicalCategory } from "@/services/ai/medical-category";

import type { PhiMatchKind, PhiRiskLevel } from "./phi-check";

// Tabs trimmed to the three Maria actually uses · "all recent" was a
// duplicate of unanswered+replied combined · "by-theme" never landed
// useful UX (themes live in the right rail as cards now).
//
// `privacy` (S4) is CONDITIONAL: it only renders for human-medical
// businesses with ≥1 flagged published reply (`isPrivacyTabVisible`).
// It's in the canonical list so `parseReviewTab` accepts the URL value;
// the server falls back to the default tab when it doesn't apply
// (`resolvePrivacyTab`) so a stale `?tab=privacy` bookmark never
// renders an orphan view.
export const REVIEW_TABS = [
  "unanswered",
  "negative",
  "replied",
  "skipped",
  "privacy",
] as const;

export type ReviewTab = (typeof REVIEW_TABS)[number];

export const DEFAULT_REVIEW_TAB: ReviewTab = "unanswered";

export type ReviewSentiment = "POSITIVE" | "NEUTRAL" | "NEGATIVE";

/**
 * S2 · privacy-check flag on a PUBLISHED owner reply. Computed
 * server-side in `queries.ts` by running `detectPhiRisk` (phi-check.ts)
 * over `ownerReplyText` — for human-medical businesses only
 * (`isHumanMedicalCategory`). Null for non-medical businesses and for
 * clean replies, so non-medical behavior doesn't change at all.
 */
export interface ReviewPrivacyRisk {
  /** `high` = confirms patient relationship or names a treatment;
   *  `caution` = date / payment reference only. */
  level: PhiRiskLevel;
  /** Verbatim excerpt from the reply that triggered the flag — shown as
   *  the tooltip on the per-review hint so Maria sees exactly what to
   *  edit. Locale-neutral (quotes her own reply). */
  hint: string;
  /** S5 · EVERY flagged excerpt (capped server-side in
   *  `summarizeReplyRisks`). `ReviewCard` marks each occurrence inline
   *  inside the rendered reply text — Maria sees the exact phrases to
   *  edit, not just the first one. Locale-neutral (quotes her reply). */
  matches: { kind: PhiMatchKind; excerpt: string }[];
}

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
  /** R.4 · staff/provider names extracted from the review text. Used by
   *  ReviewCard to highlight name mentions inline. */
  mentionedPeople: string[];
  /** R.4 · canonical service names mentioned in the review text. Used
   *  by ReviewCard to highlight service mentions inline + by the
   *  ServiceMentionsCard for the "stale service" tips. */
  mentionedServices: string[];
  /** S2 · privacy flag on the published owner reply. Null when clean,
   *  when there's no published reply, or for non-medical businesses. */
  privacyRisk: ReviewPrivacyRisk | null;
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
  replied: number;
  skipped: number;
}

/**
 * Headline KPI bundle for the review-page state bar. Computed
 * server-side from the same Review rows the page already reads.
 * Plain numbers / nulls — the renderer formats them.
 */
export interface ReviewKpis {
  /** 0–1 reply rate across all reviews. Null when there are zero. */
  replyRate: number | null;
  /** Count of unanswered reviews (mirrors tabCounts.unanswered for
   * convenience — keeps the state bar a single object lookup). */
  unanswered: number;
  /** Current average rating, 0–5. Null when there are zero reviews. */
  avgRating: number | null;
  /** Reviews collected in the last 30 days. */
  velocityLast30d: number;
  /** Share of last-7-day reviews that classify as POSITIVE
   * (0–1). Null when no reviews landed in the window. */
  sentiment7d: number | null;
}

/**
 * "Pattern detected" callout for the right rail. Surfaces when an
 * operational pattern repeats across multiple negative reviews —
 * e.g. multiple low-star reviews mentioning scheduling within a
 * 30-day window. Null = nothing surfaces.
 */
export interface ReviewPattern {
  /** Stable id used as the React key. */
  id: string;
  /** Theme slug that triggered the pattern (matches ThemeBucket.theme). */
  theme: string;
  /** Count of low-star reviews citing this theme in the window. */
  count: number;
  /** Headline line ("3 of your last 5 low-star reviews mention scheduling."). */
  headline: string;
  /** Body line — Maria-voice nudge toward an operational fix. */
  body: string;
}

export interface SmbReviewsData {
  /** Owned business id, or `""` for empty / build-phase. */
  ownedBusinessId: string;
  businessName: string;
  /**
   * Business category (e.g. "med spa"). Drives the "HIPAA-aware" badge
   * on the AI-draft panel for human-medical categories — the same
   * matcher (`isHumanMedicalCategory`) that flips the PHI guardrail in
   * `services/ai/reply-draft.ts`. Null when unknown.
   */
  businessCategory: string | null;
  /** Business Google reviews page URL (from googlePlaceId) · null if none. */
  googleReviewsUrl: string | null;

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

  /** Headline KPI bundle for the state bar. */
  kpis: ReviewKpis;

  /** Operational-pattern callout for the right rail. Null when nothing
   * notable shows up. */
  pattern: ReviewPattern | null;

  /**
   * S2 · count of PUBLISHED replies flagged by the privacy check across
   * the whole business (not just the active tab). Always 0 for
   * non-medical businesses. Drives the summary card on /reviews.
   */
  privacyRiskCount: number;
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
  replied: 0,
  skipped: 0,
};

export const EMPTY_REVIEW_KPIS: ReviewKpis = {
  replyRate: null,
  unanswered: 0,
  avgRating: null,
  velocityLast30d: 0,
  sentiment7d: null,
};

export const EMPTY_SMB_REVIEWS: SmbReviewsData = {
  ownedBusinessId: "",
  businessName: "",
  businessCategory: null,
  googleReviewsUrl: null,
  activeTab: DEFAULT_REVIEW_TAB,
  reviews: [],
  tabCounts: EMPTY_TAB_COUNTS,
  ratingDistribution: EMPTY_RATING_DISTRIBUTION,
  topThemes: [],
  lastSnapshotAt: null,
  kpis: EMPTY_REVIEW_KPIS,
  pattern: null,
  privacyRiskCount: 0,
};

/**
 * Pure derivation of the "Pattern detected" callout. Examines theme
 * buckets and returns the first theme that:
 *   - has ≥ 3 mentions in low-star reviews, AND
 *   - those low-star mentions are ≥ 50% of the theme's mentions
 *     (i.e. the theme correlates strongly with bad experiences).
 *
 * Returns `null` when nothing qualifies. Pure — unit-tested against
 * synthetic theme buckets in `__tests__/types.test.ts`.
 */
export function derivePattern(
  themes: readonly ThemeBucket[],
): ReviewPattern | null {
  for (const t of themes) {
    if (t.negativeCount < 3) continue;
    if (t.count === 0) continue;
    if (t.negativeCount / t.count < 0.5) continue;
    return {
      id: `pattern-${t.theme}`,
      theme: t.theme,
      count: t.negativeCount,
      headline: `${t.negativeCount} of your recent low-star reviews mention ${t.theme}.`,
      body: `When the same theme shows up in many unhappy reviews, it usually points at one fixable workflow — not a marketing problem. Worth a 10-minute look.`,
    };
  }
  return null;
}

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

/**
 * S4 · whether the Privacy tab exists at all. Same gate as the rest of
 * the privacy check: human-medical category (the matcher that flips the
 * PHI draft guardrail + HIPAA badge) AND at least one flagged published
 * reply. Pure — shared by the page (tab strip + summary card) and the
 * unit tests so the visibility rule can't drift between surfaces.
 */
export function isPrivacyTabVisible(
  businessCategory: string | null,
  privacyRiskCount: number,
): boolean {
  return isHumanMedicalCategory(businessCategory) && privacyRiskCount > 0;
}

/**
 * S4 · server-side fallback for `?tab=privacy`. The tab only exists
 * while `isPrivacyTabVisible` holds — a stale bookmark (the last
 * flagged reply got fixed, or the business was recategorised) falls
 * back to the default tab instead of rendering an orphan empty view.
 * Non-privacy tabs pass through untouched.
 */
export function resolvePrivacyTab(
  tab: ReviewTab,
  businessCategory: string | null,
  flaggedCount: number,
): ReviewTab {
  if (tab !== "privacy") return tab;
  return isPrivacyTabVisible(businessCategory, flaggedCount)
    ? "privacy"
    : DEFAULT_REVIEW_TAB;
}

/**
 * S4 · the Privacy tab's list: only reviews whose published reply got
 * flagged, `high` level first (the patterns regulators actually fine),
 * `caution` after. Order WITHIN each level preserves the caller's
 * ordering (urgent first, then newest — same as every other tab).
 * Pure — unit-tested in `__tests__/types.test.ts`.
 */
export function filterPrivacyReviews(
  reviews: readonly ReviewItem[],
): ReviewItem[] {
  const flagged = reviews.filter((r) => r.privacyRisk != null);
  return [
    ...flagged.filter((r) => r.privacyRisk?.level === "high"),
    ...flagged.filter((r) => r.privacyRisk?.level !== "high"),
  ];
}
