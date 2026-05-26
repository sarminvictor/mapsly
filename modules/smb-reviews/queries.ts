/**
 * SMB reviews · server query.
 *
 * Surface: `getSmbReviewsData(userId, tab)` — returns the user's owned
 * business + the active-tab review list + aggregates for the right
 * rail. Returns the EMPTY shape (`ownedBusinessId === ""`) when:
 *
 *   - the user has no claimed business yet (Maria's first visit)
 *   - we're in Vercel's build phase (NEXT_PHASE guard, INC-27)
 *   - Prisma throws (degrades to "looks empty" rather than 500 crash)
 *
 * Per `.claude/rules/cache-components.md` Pattern 1, the build-phase
 * short-circuit + the catch block both return `EMPTY_SMB_REVIEWS` so the
 * shape parity is enforced at TypeScript compile time, not at Vercel
 * build time. Adding a field to `SmbReviewsData` means adding it to
 * `EMPTY_SMB_REVIEWS` in `types.ts` — TypeScript will fail the build
 * loudly if the two drift.
 *
 * Cache strategy per `.claude/rules/caching.md`:
 *
 *   - `'use cache'` + `cacheLife('minutes')`. Reviews change on the
 *     daily C.8 (`new-reviews-delta`) and weekly C.9
 *     (`reviews-full-pull`) cron passes. Minutes-fresh is plenty —
 *     Maria checks once a day. Aggressive caching wins.
 *   - `cacheTag('smb-reviews-${userId}-${tab}')`. Per-user + per-tab so
 *     the C.8/C.9 cron can invalidate at the right granularity without
 *     killing other tab variants needlessly.
 *
 * Per `.claude/rules/performance.md`, all `select`s are explicit; no
 * `findMany()` without a column list.
 *
 * Auth: the query does NOT enforce auth — the page handler MUST verify
 * the session and dispatch `unauthorized()` before calling. The
 * `where: { ownerUserId }` clause means a stolen userId would only
 * reveal that user's own data, but defence-in-depth: never trust the
 * caller.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

import {
  DEFAULT_REVIEW_TAB,
  EMPTY_REVIEW_KPIS,
  EMPTY_SMB_REVIEWS,
  derivePattern,
  type ReviewItem,
  type ReviewKpis,
  type ReviewSentiment,
  type ReviewTab,
  type ReviewTabCounts,
  type SmbReviewsData,
  type ThemeBucket,
} from "./types";

// Effective "no limit" · enough to cover all 12-month reviews even for
// high-volume businesses (restaurant pulling 500/yr). Client paginates
// from this set via PaginatedReviewList (5 initial → +10 each click).
const MAX_REVIEWS_PER_TAB = 500;
const MAX_THEMES = 8;

/**
 * Anonymise a Google-supplied reviewer name into `F.L.` initials, per
 * `.claude/rules/security.md` PII rules. Names like "Maria Santos"
 * become `M.S.`; single names ("Anonymous") become `A.`; empty / null
 * become `?`. We deliberately don't store full names; this is here to
 * defensively guard against legacy rows that still hold them.
 */
function toInitials(raw: string | null): string {
  if (!raw) return "?";
  const trimmed = raw.trim();
  if (!trimmed) return "?";

  // Already in `F.L.` shape — preserve.
  if (/^[A-Z]\.[A-Z](\.|$)/.test(trimmed)) {
    return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
  }

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const initials = parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .filter(Boolean)
    .join(".");
  return initials ? `${initials}.` : "?";
}

/**
 * Whole days between `then` and now. Used for the "6 days ago" label
 * and for the `Unanswered · 6d` aging pill. Floored so a 23-hour-old
 * review reads as `0 days ago` rather than `1`.
 */
function daysSince(then: Date | null | undefined): number {
  if (!then) return 0;
  const ms = Date.now() - then.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / 86_400_000);
}

export async function getSmbReviewsData(
  userId: string,
  tab: ReviewTab = DEFAULT_REVIEW_TAB,
): Promise<SmbReviewsData> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`smb-reviews-${userId}-${tab}`);

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_SMB_REVIEWS;
  }

  if (!userId || typeof userId !== "string") {
    return EMPTY_SMB_REVIEWS;
  }

  try {
    const business = await prisma.business.findFirst({
      where: { ownerUserId: userId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    });

    if (!business) {
      return EMPTY_SMB_REVIEWS;
    }

    // Build the active-tab WHERE clause from the user's choice. The
    // tabs intentionally narrow the result set rather than re-sort it;
    // sorting is consistent across tabs (urgent first, then newest).
    const baseWhere = { businessId: business.id } as const;
    const tabWhere: Record<ReviewTab, Record<string, unknown>> = {
      unanswered: { ownerReplied: false },
      negative: {
        OR: [{ stars: { lte: 3 } }, { sentiment: "NEGATIVE" }],
      },
      replied: { ownerReplied: true },
    };

    // Run the active-tab fetch alongside the aggregate queries
    // concurrently. Each runs against indexed columns
    // (`businessId+postedAt`, `businessId+ownerReplied`) — see
    // `.claude/rules/scalability.md` indexes section.
    const [rows, tabCounts, distribution, themeRows, lastSnapshot] =
      await Promise.all([
        prisma.review.findMany({
          where: { ...baseWhere, ...tabWhere[tab] },
          orderBy: [{ isUrgent: "desc" }, { postedAt: "desc" }],
          take: MAX_REVIEWS_PER_TAB,
          select: {
            id: true,
            reviewerName: true,
            reviewerProfileReviews: true,
            stars: true,
            text: true,
            language: true,
            postedAt: true,
            ownerReplied: true,
            ownerReplyText: true,
            ownerReplyAt: true,
            sentiment: true,
            themes: true,
            isUrgent: true,
            aiReplyDraftEn: true,
            aiReplyDraftEs: true,
            mentionedPeople: true,
            mentionedServices: true,
          },
        }),
        loadTabCounts(business.id),
        loadRatingDistribution(business.id),
        loadThemeBuckets(business.id),
        prisma.review.findFirst({
          where: baseWhere,
          orderBy: { collectedAt: "desc" },
          select: { collectedAt: true },
        }),
      ]);

    const reviews: ReviewItem[] = rows.map((r) => ({
      id: r.id,
      reviewerInitials: toInitials(r.reviewerName),
      reviewerPriorReviews: r.reviewerProfileReviews,
      stars: r.stars,
      text: r.text,
      language: r.language,
      postedAt: r.postedAt.toISOString(),
      daysAgo: daysSince(r.postedAt),
      ownerReplied: r.ownerReplied,
      ownerReplyText: r.ownerReplyText,
      ownerReplyAt: r.ownerReplyAt ? r.ownerReplyAt.toISOString() : null,
      sentiment: (r.sentiment ?? null) as ReviewSentiment | null,
      themes: r.themes ?? [],
      isUrgent: r.isUrgent,
      aiReplyDraftEn: r.aiReplyDraftEn,
      aiReplyDraftEs: r.aiReplyDraftEs,
      mentionedPeople: r.mentionedPeople ?? [],
      mentionedServices: r.mentionedServices ?? [],
    }));

    // KPI strip · cheap aggregate counts driven by the same Review
    // table. Bounded with `_avg` + a couple of count queries; no row
    // fetch beyond what we already pulled.
    const kpis = await loadReviewKpis(business.id, tabCounts);
    const pattern = derivePattern(themeRows);

    return {
      ownedBusinessId: business.id,
      businessName: business.name,
      activeTab: tab,
      reviews,
      tabCounts,
      ratingDistribution: distribution,
      topThemes: themeRows,
      lastSnapshotAt: lastSnapshot?.collectedAt
        ? lastSnapshot.collectedAt.toISOString()
        : null,
      kpis,
      pattern,
    };
  } catch (err) {
    // Log so the failure surfaces in Vercel / Sentry rather than only
    // a silent EMPTY result — INC-23 lesson: silent catches mask
    // schema drift. The page renders the empty state either way.
    console.error("[smb-reviews] getSmbReviewsData failed:", err);
    return EMPTY_SMB_REVIEWS;
  }
}

async function loadTabCounts(businessId: string): Promise<ReviewTabCounts> {
  const [unanswered, negative, replied] = await Promise.all([
    prisma.review.count({ where: { businessId, ownerReplied: false } }),
    prisma.review.count({
      where: {
        businessId,
        OR: [{ stars: { lte: 3 } }, { sentiment: "NEGATIVE" }],
      },
    }),
    prisma.review.count({ where: { businessId, ownerReplied: true } }),
  ]);
  return { unanswered, negative, replied };
}

async function loadRatingDistribution(businessId: string) {
  // groupBy preserves both performance (single SQL query under the
  // hood) and explicit column selection. Faster than five separate
  // count() calls for the same grouping.
  const groups = await prisma.review.groupBy({
    by: ["stars"],
    where: { businessId },
    _count: { _all: true },
  });

  const dist = {
    total: 0,
    star5: 0,
    star4: 0,
    star3: 0,
    star2: 0,
    star1: 0,
  };
  for (const g of groups) {
    const n = g._count._all;
    dist.total += n;
    switch (g.stars) {
      case 5:
        dist.star5 = n;
        break;
      case 4:
        dist.star4 = n;
        break;
      case 3:
        dist.star3 = n;
        break;
      case 2:
        dist.star2 = n;
        break;
      case 1:
        dist.star1 = n;
        break;
      default:
        // Out-of-range stars (shouldn't happen) still count toward
        // total but not any bucket. Aggregation stays consistent.
        break;
    }
  }
  return dist;
}

async function loadThemeBuckets(businessId: string): Promise<ThemeBucket[]> {
  // Themes come from two sources, in order of preference:
  //
  // 1. Review.themes[] · populated by the AI sentiment classifier
  //    (retired from runtime path in R.1 · stars→sentiment replacement).
  //    Empty for businesses pulled after the retirement, BUT preserved
  //    for legacy data from before R.1.
  //
  // 2. Business.placeTopics · DfS-provided {keyword: count} extracted
  //    from Google reviews by DfS's own NLP. Free with the Maps
  //    Listings call (no AI cost). 8-15 keywords per business typical.
  //    This is the canonical fallback when (1) is empty.
  //
  // Both are returned as ThemeBucket[] · the ThemesCard renders them
  // identically. `negativeCount` is 0 for placeTopics (no per-review
  // star linkage at the DfS layer) — that just disables the "negative
  // skew" pill on those rows.

  const aiRows = await prisma.$queryRaw<
    Array<{ theme: string; count: bigint; negativeCount: bigint }>
  >`
    SELECT
      unnest("themes")::text AS theme,
      COUNT(*)::bigint AS count,
      SUM(CASE WHEN "stars" <= 3 THEN 1 ELSE 0 END)::bigint AS "negativeCount"
    FROM "Review"
    WHERE "businessId" = ${businessId}
    GROUP BY theme
    ORDER BY count DESC
    LIMIT ${MAX_THEMES}
  `;

  if (aiRows.length > 0) {
    return aiRows.map((r) => ({
      theme: r.theme,
      count: Number(r.count ?? 0n),
      negativeCount: Number(r.negativeCount ?? 0n),
    }));
  }

  // Fallback · Business.placeTopics from DfS.
  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: { placeTopics: true },
  });
  const topics = biz?.placeTopics as Record<string, number> | null;
  if (!topics || typeof topics !== "object") return [];

  return Object.entries(topics)
    .filter(([k, v]) => typeof k === "string" && typeof v === "number" && v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_THEMES)
    .map(([theme, count]) => ({
      theme,
      count,
      negativeCount: 0,
    }));
}

/**
 * Compute the 5-KPI state-bar bundle. Driven by the same Review
 * table the page already touches:
 *   - replyRate  · all reviews with ownerReplied / all reviews
 *   - unanswered · already in tabCounts.unanswered
 *   - avgRating  · `_avg.stars` across all reviews
 *   - velocity30 · count over the last 30 days
 *   - sentiment7d· share of last-7-day reviews flagged POSITIVE
 */
async function loadReviewKpis(
  businessId: string,
  tabCounts: ReviewTabCounts,
): Promise<ReviewKpis> {
  // Every review is either replied or unanswered · the union is "all".
  const total = tabCounts.unanswered + tabCounts.replied;
  if (total === 0) return { ...EMPTY_REVIEW_KPIS };

  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const cutoff30d = new Date(now - THIRTY_DAYS_MS);
  const cutoff7d = new Date(now - SEVEN_DAYS_MS);

  const [agg, velocity30, sentiment7d] = await Promise.all([
    prisma.review.aggregate({
      where: { businessId },
      _avg: { stars: true },
    }),
    prisma.review.count({
      where: { businessId, postedAt: { gte: cutoff30d } },
    }),
    prisma.review.findMany({
      where: { businessId, postedAt: { gte: cutoff7d } },
      select: { sentiment: true },
    }),
  ]);

  const replyRate = Math.max(0, Math.min(1, tabCounts.replied / total));

  let sentimentShare: number | null = null;
  if (sentiment7d.length > 0) {
    const positive = sentiment7d.filter(
      (s) => s.sentiment === "POSITIVE",
    ).length;
    sentimentShare = positive / sentiment7d.length;
  }

  return {
    replyRate,
    unanswered: tabCounts.unanswered,
    avgRating: agg._avg.stars,
    velocityLast30d: velocity30,
    sentiment7d: sentimentShare,
  };
}
