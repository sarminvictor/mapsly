/**
 * SMB activity feed · server query.
 *
 * Surface: `getSmbActivityData(userId)` — assembles a time-ordered
 * event stream from existing data:
 *
 *   - own Review writes (last 30d, new + replied)
 *   - own AdLibraryEntry starts (last 30d)
 *   - competitor Review aggregates (last 30d, grouped per business)
 *   - competitor AdLibraryEntry starts (last 30d, grouped per business)
 *   - newcomer Business creates (last 30d, same category+city)
 *
 * Per `.claude/rules/caching.md`: `'use cache'` + `cacheLife('minutes')`
 * — Maria checks the feed once a day; the underlying cron writes lag
 * by hours anyway. Per-user cacheTag so each Maria's feed invalidates
 * independently.
 *
 * Per `.claude/rules/cache-components.md` Pattern 1: NEXT_PHASE guard
 * returns EMPTY_SMB_ACTIVITY so Vercel's build worker prerenders
 * cleanly without a Neon WebSocket (INC-27).
 *
 * Per `.claude/rules/performance.md`: every fetch is bounded and uses
 * `groupBy` aggregation rather than per-row fetches — the feed renders
 * fast even when a competitor has 200 ads in flight.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

import {
  ACTIVITY_LOOKBACK_DAYS,
  EMPTY_SMB_ACTIVITY,
  MAX_ACTIVITY_EVENTS,
  type SmbActivityData,
  type SmbActivityEvent,
} from "./types";

const COMPETITOR_CAP = 30;

export async function getSmbActivityData(
  userId: string,
): Promise<SmbActivityData> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`smb-activity-${userId}`);

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_SMB_ACTIVITY;
  }

  if (!userId || typeof userId !== "string") {
    return EMPTY_SMB_ACTIVITY;
  }

  try {
    const own = await prisma.business.findFirst({
      where: { ownerUserId: userId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        category: true,
        city: true,
      },
    });

    if (!own) return EMPTY_SMB_ACTIVITY;

    const now = new Date();
    const cutoff = new Date(
      now.getTime() - ACTIVITY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
    );

    // 1 · competitor businesses we'll group activity from.
    const competitors =
      own.category && own.city
        ? await prisma.business.findMany({
            where: {
              category: own.category,
              city: own.city,
              isActive: true,
              id: { not: own.id },
            },
            take: COMPETITOR_CAP,
            orderBy: { reviewCount: "desc" },
            select: { id: true, name: true, createdAt: true },
          })
        : [];

    const competitorIds = competitors.map((c) => c.id);
    const idToName = new Map(competitors.map((c) => [c.id, c.name]));

    // 2 · concurrent fetches · all the inputs we'll fold into the feed.
    const [
      ownReviewsNew,
      ownAdsStarted,
      competitorReviewCounts,
      competitorAdCounts,
    ] = await Promise.all([
      prisma.review.findMany({
        where: { businessId: own.id, postedAt: { gte: cutoff } },
        orderBy: { postedAt: "desc" },
        take: 30,
        select: {
          id: true,
          postedAt: true,
          stars: true,
          ownerReplied: true,
          ownerReplyAt: true,
        },
      }),
      prisma.adLibraryEntry.findMany({
        where: {
          businessId: own.id,
          isActive: true,
          startedAt: { gte: cutoff },
        },
        orderBy: { startedAt: "desc" },
        take: 20,
        select: {
          id: true,
          startedAt: true,
          matchedKeyword: true,
        },
      }),
      competitorIds.length > 0
        ? prisma.review.groupBy({
            by: ["businessId"],
            where: {
              businessId: { in: competitorIds },
              postedAt: { gte: cutoff },
            },
            _count: { _all: true },
            _max: { postedAt: true },
          })
        : Promise.resolve(
            [] as Array<{
              businessId: string | null;
              _count: { _all: number };
              _max: { postedAt: Date | null };
            }>,
          ),
      competitorIds.length > 0
        ? prisma.adLibraryEntry.groupBy({
            by: ["businessId"],
            where: {
              businessId: { in: competitorIds },
              isActive: true,
              startedAt: { gte: cutoff },
            },
            _count: { _all: true },
            _max: { lastSeenAt: true },
          })
        : Promise.resolve(
            [] as Array<{
              businessId: string | null;
              _count: { _all: number };
              _max: { lastSeenAt: Date | null };
            }>,
          ),
    ]);

    const events: SmbActivityEvent[] = [];

    // 3 · own reviews (one per review · star context in the line)
    for (const r of ownReviewsNew) {
      events.push({
        id: `or-${r.id}`,
        at: r.postedAt,
        source: "reviews",
        scope: "you",
        body:
          r.stars >= 4
            ? `You got a ${r.stars}★ review.`
            : r.stars >= 3
              ? `You got a ${r.stars}★ review — take a look at the text.`
              : `You got a ${r.stars}★ review — worth a quick reply.`,
      });
      if (r.ownerReplied && r.ownerReplyAt && r.ownerReplyAt >= cutoff) {
        events.push({
          id: `orr-${r.id}`,
          at: r.ownerReplyAt,
          source: "reviews",
          scope: "you",
          body: `You replied to a ${r.stars}★ review.`,
        });
      }
    }

    // 4 · own ads
    for (const ad of ownAdsStarted) {
      if (!ad.startedAt) continue;
      events.push({
        id: `oa-${ad.id}`,
        at: ad.startedAt,
        source: "ads",
        scope: "you",
        body: ad.matchedKeyword
          ? `You launched a new ad for "${ad.matchedKeyword}".`
          : `You launched a new ad.`,
      });
    }

    // 5 · competitor reviews (one aggregate per competitor)
    for (const row of competitorReviewCounts) {
      const name = idToName.get(row.businessId ?? "");
      if (!name) continue;
      const count = row._count._all;
      if (count === 0) continue;
      events.push({
        id: `cr-${row.businessId}`,
        at: row._max.postedAt ?? cutoff,
        source: "reviews",
        scope: "competitor",
        body:
          count === 1
            ? `${name} got 1 new review.`
            : `${name} got ${count} new reviews.`,
      });
    }

    // 6 · competitor ads (one aggregate per competitor)
    for (const row of competitorAdCounts) {
      const name = idToName.get(row.businessId ?? "");
      if (!name) continue;
      const count = row._count._all;
      if (count === 0) continue;
      events.push({
        id: `ca-${row.businessId}`,
        at: row._max.lastSeenAt ?? cutoff,
        source: "ads",
        scope: "competitor",
        body:
          count === 1
            ? `${name} launched 1 new ad.`
            : `${name} launched ${count} new ads.`,
      });
    }

    // 7 · newcomers in the market
    for (const c of competitors) {
      if (!c.createdAt) continue;
      if (c.createdAt < cutoff) continue;
      events.push({
        id: `nc-${c.id}`,
        at: c.createdAt,
        source: "market",
        scope: "market",
        body: `${c.name} just opened nearby.`,
      });
    }

    events.sort((a, b) => b.at.getTime() - a.at.getTime());
    const capped = events.slice(0, MAX_ACTIVITY_EVENTS);

    return {
      ownedBusinessId: own.id,
      businessName: own.name,
      events: capped,
      generatedAt: now,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[smb-activity] query failed:", err);
    return EMPTY_SMB_ACTIVITY;
  }
}
