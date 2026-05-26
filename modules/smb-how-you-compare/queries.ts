/**
 * SMB "How you compare" · server query.
 *
 * Single fetch over the user's category+city slice (capped at
 * MARKET_SLICE_CAP) feeds every section of the page:
 *
 *   - Maria's own ranking + score
 *   - Top-12 ranked rows
 *   - Head-to-head vs the leader
 *   - Medians across the full slice
 *   - Threats (same-building, leader-pulling-away, new entrants, fastest-growing)
 *   - Movers (3 fastest-growing competitors)
 *
 * Per `.claude/rules/cache-components.md` Pattern 1: NEXT_PHASE guard
 * returns EMPTY_SMB_HOW_YOU_COMPARE so Vercel's build worker prerenders
 * without opening a Neon WebSocket.
 *
 * Per `.claude/rules/caching.md`: `'use cache'` + `cacheLife('hours')`.
 * The C.9 snapshot cron writes weekly, so hours-fresh is fine. The cron
 * revalidates `smb-how-you-compare-${userId}` after each write.
 *
 * Per `.claude/rules/performance.md`: explicit `select`s; one round-trip
 * for `own` + one for the slice; no N+1.
 *
 * Per `.claude/rules/security.md`: caller is responsible for auth.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

import {
  EMPTY_SMB_HOW_YOU_COMPARE,
  MARKET_MOVERS_N,
  MARKET_SLICE_CAP,
  MARKET_TOP_N,
  MAX_COMPETITORS,
  addressKey,
  deriveHeadToHead,
  deriveMedians,
  deriveThreats,
  type CompetitorRow,
  type MarketMover,
  type MarketRankingRow,
  type SmbHowYouCompareData,
} from "./types";

export async function getSmbHowYouCompareData(
  userId: string,
): Promise<SmbHowYouCompareData> {
  "use cache";
  cacheLife("hours");
  cacheTag(`smb-how-you-compare-${userId}`);

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_SMB_HOW_YOU_COMPARE;
  }

  if (!userId || typeof userId !== "string") {
    return EMPTY_SMB_HOW_YOU_COMPARE;
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
        province: true,
        address: true,
        rating: true,
        reviewCount: true,
        createdAt: true,
        snapshots: {
          take: 1,
          orderBy: { snapshotDate: "desc" },
          select: {
            mapslyScore: true,
            msiRank: true,
            msiTotal: true,
            velocityLast30d: true,
            replyRate: true,
            profileCompletenessScore: true,
            photosCount: true,
            rating: true,
            reviewCount: true,
            snapshotDate: true,
          },
        },
      },
    });

    if (!own) {
      return EMPTY_SMB_HOW_YOU_COMPARE;
    }

    const ownSnap = own.snapshots[0] ?? null;

    // No city → can't slice the market. Return what we know about Maria
    // so the page renders her hero block with an empty competitor list.
    if (!own.city || !own.category) {
      return {
        ...EMPTY_SMB_HOW_YOU_COMPARE,
        ownedBusinessId: own.id,
        businessName: own.name,
        category: own.category ?? "",
        city: own.city,
        province: own.province,
        ownMapslyScore: ownSnap?.mapslyScore ?? null,
        marketRank: ownSnap?.msiRank ?? null,
        marketTotal: ownSnap?.msiTotal ?? null,
        lastSnapshotAt: ownSnap?.snapshotDate ?? null,
      };
    }

    // Fetch the category+city slice (capped at MARKET_SLICE_CAP). One
    // round-trip with latest-snapshot per row.
    const slice = await prisma.business.findMany({
      where: {
        isActive: true,
        category: own.category,
        city: own.city,
      },
      take: MARKET_SLICE_CAP,
      select: {
        id: true,
        name: true,
        address: true,
        createdAt: true,
        snapshots: {
          take: 1,
          orderBy: { snapshotDate: "desc" },
          select: {
            mapslyScore: true,
            rating: true,
            reviewCount: true,
            replyRate: true,
            photosCount: true,
            velocityLast30d: true,
            profileCompletenessScore: true,
            snapshotDate: true,
          },
        },
      },
    });

    // Flatten + sort by Mapsly Score desc (nulls last).
    interface Flat {
      id: string;
      name: string;
      address: string | null;
      createdAt: Date;
      mapslyScore: number | null;
      rating: number | null;
      reviewCount: number | null;
      replyRate: number | null;
      photosCount: number | null;
      velocityLast30d: number | null;
      profileCompletenessScore: number | null;
      snapshotDate: Date | null;
    }

    const flat: Flat[] = slice.map((b) => {
      const snap = b.snapshots[0] ?? null;
      return {
        id: b.id,
        name: b.name,
        address: b.address,
        createdAt: b.createdAt,
        mapslyScore: snap?.mapslyScore ?? null,
        rating: snap?.rating ?? null,
        reviewCount: snap?.reviewCount ?? null,
        replyRate: snap?.replyRate ?? null,
        photosCount: snap?.photosCount ?? null,
        velocityLast30d: snap?.velocityLast30d ?? null,
        profileCompletenessScore: snap?.profileCompletenessScore ?? null,
        snapshotDate: snap?.snapshotDate ?? null,
      };
    });

    const ranked = [...flat].sort((a, b) => {
      if (a.mapslyScore != null && b.mapslyScore != null) {
        return b.mapslyScore - a.mapslyScore;
      }
      if (a.mapslyScore != null) return -1;
      if (b.mapslyScore != null) return 1;
      return (b.reviewCount ?? 0) - (a.reviewCount ?? 0);
    });

    const ownIndex = ranked.findIndex((r) => r.id === own.id);
    const ownRank = ownIndex >= 0 ? ownIndex + 1 : null;
    const ownFlat = ownIndex >= 0 ? ranked[ownIndex]! : null;
    const marketTotal = ranked.length;

    // Build top-ranked list (top N + maybe Maria appended)
    const topRows = ranked.slice(0, MARKET_TOP_N);
    const includesOwn = topRows.some((r) => r.id === own.id);
    const topRanked: MarketRankingRow[] = topRows.map((r, i) => ({
      id: r.id,
      name: r.name,
      isOwn: r.id === own.id,
      rank: i + 1,
      mapslyScore: r.mapslyScore,
      rating: r.rating,
      reviewCount: r.reviewCount,
    }));
    if (!includesOwn && ownFlat && ownRank != null) {
      topRanked.push({
        id: ownFlat.id,
        name: ownFlat.name,
        isOwn: true,
        rank: ownRank,
        mapslyScore: ownFlat.mapslyScore,
        rating: ownFlat.rating,
        reviewCount: ownFlat.reviewCount,
      });
    }

    // Build the head-to-head + threats comparison set.
    const ownAddrKey = addressKey(own.address);
    const ownRow: CompetitorRow = {
      id: own.id,
      name: own.name,
      isOwn: true,
      rating: ownSnap?.rating ?? own.rating,
      reviewCount: ownSnap?.reviewCount ?? own.reviewCount,
      mapslyScore: ownSnap?.mapslyScore ?? null,
      velocityLast30d: ownSnap?.velocityLast30d ?? null,
      replyRate: ownSnap?.replyRate ?? null,
      profileCompletenessScore: ownSnap?.profileCompletenessScore ?? null,
      photosCount: ownSnap?.photosCount ?? null,
      isSameBuilding: false,
      createdAt: own.createdAt ?? null,
    };

    const competitorRows: CompetitorRow[] = ranked
      .filter((r) => r.id !== own.id)
      .slice(0, MAX_COMPETITORS)
      .map((r) => ({
        id: r.id,
        name: r.name,
        isOwn: false,
        rating: r.rating,
        reviewCount: r.reviewCount,
        mapslyScore: r.mapslyScore,
        velocityLast30d: r.velocityLast30d,
        replyRate: r.replyRate,
        profileCompletenessScore: r.profileCompletenessScore,
        photosCount: r.photosCount,
        isSameBuilding:
          ownAddrKey !== null && addressKey(r.address) === ownAddrKey,
        createdAt: r.createdAt,
      }));

    const combined = [ownRow, ...competitorRows];

    const leader =
      competitorRows.find((c) => c.mapslyScore != null) ??
      competitorRows[0] ??
      null;

    const headToHead = deriveHeadToHead(ownRow, leader);
    const threats = deriveThreats({ own: ownRow, competitors: combined });

    // Movers · top 3 by velocity desc, excluding Maria
    const movers: MarketMover[] = flat
      .filter((r) => r.id !== own.id && (r.velocityLast30d ?? 0) > 0)
      .sort((a, b) => (b.velocityLast30d ?? 0) - (a.velocityLast30d ?? 0))
      .slice(0, MARKET_MOVERS_N)
      .map((r) => ({
        id: r.id,
        name: r.name,
        mapslyScore: r.mapslyScore,
        velocityLast30d: r.velocityLast30d ?? 0,
      }));

    const medians = deriveMedians(flat);

    const leaderScore = competitorRows.find(
      (c) => c.mapslyScore != null,
    )?.mapslyScore;
    const gapToLeader =
      ownSnap?.mapslyScore != null && leaderScore != null
        ? Math.max(0, leaderScore - ownSnap.mapslyScore)
        : null;

    const lastSnapshotAt = flat.reduce<Date | null>((latest, r) => {
      if (!r.snapshotDate) return latest;
      if (!latest || r.snapshotDate > latest) return r.snapshotDate;
      return latest;
    }, null);

    return {
      ownedBusinessId: own.id,
      businessName: own.name,
      category: own.category,
      city: own.city,
      province: own.province,
      ownMapslyScore: ownSnap?.mapslyScore ?? null,
      marketRank: ownRank ?? ownSnap?.msiRank ?? null,
      marketTotal: marketTotal || (ownSnap?.msiTotal ?? null),
      gapToLeader,
      topRanked,
      leaderName: leader?.name ?? null,
      headToHead,
      medians,
      threats,
      movers,
      lastSnapshotAt,
    };
  } catch {
    return EMPTY_SMB_HOW_YOU_COMPARE;
  }
}
