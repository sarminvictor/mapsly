/**
 * SMB dashboard · server queries.
 *
 * Surface: `getSmbHomeData(userId)` — returns the latest
 * `BusinessSnapshot` of the user's owned business denormalised into
 * the flat `SmbDashboardData` shape the page renders from, PLUS the
 * derived alert feed + top fixes + this-week market activity events.
 *
 * Returns the EMPTY shape (ownedBusinessId === "") when:
 *
 *   - the user has no claimed business yet (post-signup state)
 *   - we're in Vercel's build phase (NEXT_PHASE guard, INC-27)
 *   - Prisma throws (degrades to "looks empty" rather than 500 crash)
 *
 * Cache strategy per `.claude/rules/caching.md`:
 *
 *   - `'use cache'` + `cacheLife('minutes')` — Maria's daily check-in
 *     surface; minutes-fresh is plenty (snapshot refreshes weekly).
 *   - `cacheTag('smb-home-${userId}')` — per-user; cron jobs
 *     revalidate on snapshot writes.
 *
 * Per `.claude/rules/cache-components.md` Pattern 1, the EMPTY shape
 * is the full shape of the declared return type — TypeScript catches
 * partial shapes at literal-comparison time.
 *
 * Per `.claude/rules/performance.md`, `select`s are explicit and
 * counts are bounded.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

import { withDerivedFields } from "./derive";
import {
  EMPTY_SMB_DASHBOARD,
  MAX_MARKET_EVENTS,
  type SmbDashboardData,
  type SmbMarketEvent,
} from "./types";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function getSmbHomeData(
  userId: string,
): Promise<SmbDashboardData> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`smb-home-${userId}`);

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_SMB_DASHBOARD;
  }

  if (!userId || typeof userId !== "string") {
    return EMPTY_SMB_DASHBOARD;
  }

  try {
    const business = await prisma.business.findFirst({
      where: { ownerUserId: userId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        slug: true,
        name: true,
        category: true,
        city: true,
        province: true,
        rating: true,
        reviewCount: true,
        isClaimed: true,
        snapshots: {
          take: 1,
          orderBy: { snapshotDate: "desc" },
          select: {
            mapslyScore: true,
            msiRank: true,
            msiTotal: true,
            replyRate: true,
            velocityLast30d: true,
            reputationScore: true,
            communicationScore: true,
            profileCompletenessScore: true,
            trustScore: true,
            pricingTransparencyScore: true,
            brandPresenceScore: true,
            pillarScore: true,
            reputationPillar: true,
            visibilityPillar: true,
            profilePillar: true,
            websitePillar: true,
            adsPillar: true,
            adsApplicable: true,
            msiPercentile: true,
            snapshotDate: true,
          },
        },
      },
    });

    if (!business) return EMPTY_SMB_DASHBOARD;

    const snap = business.snapshots[0] ?? null;
    const now = new Date();
    const cutoff30d = new Date(now.getTime() - THIRTY_DAYS_MS);
    const cutoff7d = new Date(now.getTime() - SEVEN_DAYS_MS);

    // Counts on Review for this business — drive the unanswered KPI
    // tile and the alerts/fixes derivation. Bounded queries (count
    // only), no row fetch.
    const [unansweredReviewCount, reviewsLast30d, brandHijackHits] =
      await Promise.all([
        prisma.review.count({
          where: { businessId: business.id, ownerReplied: false },
        }),
        prisma.review.count({
          where: { businessId: business.id, postedAt: { gte: cutoff30d } },
        }),
        // Brand-hijack proxy: ads from OTHER businesses whose creative
        // matches a keyword overlapping Maria's name. Cheap heuristic
        // until C.6 lands a dedicated brand-hijack table — uses the
        // existing AdLibraryEntry.
        prisma.adLibraryEntry.count({
          where: {
            businessId: { not: business.id },
            isActive: true,
            adCreativeBody: {
              contains: business.name.split(" ")[0]!,
              mode: "insensitive",
            },
          },
        }),
      ]);

    const brandHijackStatus: SmbDashboardData["brandHijackStatus"] =
      brandHijackHits >= 3 ? "hit" : brandHijackHits >= 1 ? "watch" : "clean";

    // Market events · last 7 days · competitors in same category+city.
    const marketActivity: SmbMarketEvent[] = await collectMarketEvents({
      businessId: business.id,
      category: business.category,
      city: business.city,
      cutoff: cutoff7d,
    });

    const base: SmbDashboardData = {
      ownedBusinessId: business.id,
      slug: business.slug,
      name: business.name,
      category: business.category,
      city: business.city,
      province: business.province,
      rating: business.rating,
      reviewCount: business.reviewCount,
      isClaimed: business.isClaimed,
      mapslyScore: snap?.mapslyScore ?? null,
      msiRank: snap?.msiRank ?? null,
      msiTotal: snap?.msiTotal ?? null,
      replyRate: snap?.replyRate ?? null,
      velocityLast30d: snap?.velocityLast30d ?? null,
      reputationScore: snap?.reputationScore ?? null,
      communicationScore: snap?.communicationScore ?? null,
      profileCompletenessScore: snap?.profileCompletenessScore ?? null,
      trustScore: snap?.trustScore ?? null,
      pricingTransparencyScore: snap?.pricingTransparencyScore ?? null,
      brandPresenceScore: snap?.brandPresenceScore ?? null,
      pillarScore: snap?.pillarScore ?? null,
      reputationPillar: snap?.reputationPillar ?? null,
      visibilityPillar: snap?.visibilityPillar ?? null,
      profilePillar: snap?.profilePillar ?? null,
      websitePillar: snap?.websitePillar ?? null,
      adsPillar: snap?.adsPillar ?? null,
      adsApplicable: snap?.adsApplicable ?? null,
      msiPercentile: snap?.msiPercentile ?? null,
      lastSnapshotAt: snap?.snapshotDate ?? null,
      unansweredReviewCount,
      reviewsLast30d,
      brandHijackStatus,
      alerts: [],
      topFixes: [],
      marketActivity,
    };

    return withDerivedFields(base);
  } catch {
    return EMPTY_SMB_DASHBOARD;
  }
}

/* ================================================ market events */

interface MarketEventInput {
  businessId: string;
  category: string | null;
  city: string | null;
  cutoff: Date;
}

/**
 * Pull up to MAX_MARKET_EVENTS events from competitors' recent
 * activity. We keep this bounded + cheap by aggregating counts from
 * the existing Review + AdLibraryEntry tables. Each event is a
 * single line Maria reads at a glance ("Lux Med Spa launched 4 new
 * ads") so we don't need per-row drill-downs at this surface.
 */
async function collectMarketEvents(
  input: MarketEventInput,
): Promise<SmbMarketEvent[]> {
  const { businessId, category, city, cutoff } = input;
  if (!category || !city) return [];

  try {
    // 1 · competitor businesses we'll look at (cap 30 for performance).
    const competitors = await prisma.business.findMany({
      where: {
        category,
        city,
        isActive: true,
        id: { not: businessId },
      },
      take: 30,
      orderBy: { reviewCount: "desc" },
      select: { id: true, name: true },
    });
    if (competitors.length === 0) return [];

    const idToName = new Map(competitors.map((c) => [c.id, c.name]));

    // 2 · group reviews + ads by competitor + summarise.
    const [recentReviewCounts, recentAdCounts] = await Promise.all([
      prisma.review.groupBy({
        by: ["businessId"],
        where: {
          businessId: { in: competitors.map((c) => c.id) },
          postedAt: { gte: cutoff },
        },
        _count: { _all: true },
        _max: { postedAt: true },
      }),
      prisma.adLibraryEntry.groupBy({
        by: ["businessId"],
        where: {
          businessId: { in: competitors.map((c) => c.id) },
          isActive: true,
          startedAt: { gte: cutoff },
        },
        _count: { _all: true },
        _max: { lastSeenAt: true },
      }),
    ]);

    const events: SmbMarketEvent[] = [];

    for (const row of recentReviewCounts) {
      const name = idToName.get(row.businessId ?? "");
      if (!name) continue;
      const count = row._count._all;
      if (count === 0) continue;
      events.push({
        id: `r-${row.businessId}`,
        body:
          count === 1
            ? `${name} got 1 new review this week.`
            : `${name} got ${count} new reviews this week.`,
        at: row._max.postedAt ?? cutoff,
        source: "reviews",
      });
    }

    for (const row of recentAdCounts) {
      const name = idToName.get(row.businessId ?? "");
      if (!name) continue;
      const count = row._count._all;
      if (count === 0) continue;
      events.push({
        id: `a-${row.businessId}`,
        body:
          count === 1
            ? `${name} launched 1 new ad.`
            : `${name} launched ${count} new ads.`,
        at: row._max.lastSeenAt ?? cutoff,
        source: "ads",
      });
    }

    // Newcomers — businesses created in the last 7 days.
    const newcomers = await prisma.business.findMany({
      where: {
        category,
        city,
        isActive: true,
        id: { not: businessId },
        createdAt: { gte: cutoff },
      },
      take: 3,
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, createdAt: true },
    });
    for (const n of newcomers) {
      events.push({
        id: `n-${n.id}`,
        body: `${n.name} just opened nearby.`,
        at: n.createdAt,
        source: "market",
      });
    }

    events.sort((a, b) => b.at.getTime() - a.at.getTime());
    return events.slice(0, MAX_MARKET_EVENTS);
  } catch {
    return [];
  }
}
