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
  EMPTY_SMB_REVIEWS,
  type ReviewItem,
  type ReviewSentiment,
  type ReviewTab,
  type ReviewTabCounts,
  type SmbReviewsData,
  type ThemeBucket,
} from "./types";

const MAX_REVIEWS_PER_TAB = 25;
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
      all: {},
      "by-theme": {},
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
    }));

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
  const [unanswered, negative, all, replied] = await Promise.all([
    prisma.review.count({ where: { businessId, ownerReplied: false } }),
    prisma.review.count({
      where: {
        businessId,
        OR: [{ stars: { lte: 3 } }, { sentiment: "NEGATIVE" }],
      },
    }),
    prisma.review.count({ where: { businessId } }),
    prisma.review.count({ where: { businessId, ownerReplied: true } }),
  ]);
  return { unanswered, negative, all, replied };
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
  // Themes are stored as `String[]` on Review. Prisma doesn't have a
  // first-class group-by over array elements, but Postgres `unnest`
  // does the job and the index on `businessId` keeps it cheap.
  //
  // Casting `theme::text` per INC-08 — the system `name` type from
  // pg_catalog would otherwise crash the Neon driver. Our `themes` is
  // plain `text[]`, but the cast is harmless and documents intent.
  const rows = await prisma.$queryRaw<
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
  return rows.map((r) => ({
    theme: r.theme,
    // bigint → number is safe here; we cap at MAX_THEMES rows and
    // counts fit comfortably inside Number.MAX_SAFE_INTEGER.
    count: Number(r.count ?? 0n),
    negativeCount: Number(r.negativeCount ?? 0n),
  }));
}
