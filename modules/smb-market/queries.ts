/**
 * SMB market-reality · server query.
 *
 * Surface: `getSmbMarketData(userId)` — assembles Maria's market
 * position from her own latest BusinessSnapshot + the latest
 * snapshots of every business in the same category + city.
 *
 * Per `.claude/rules/caching.md` · `'use cache'` + cacheLife minutes;
 * the underlying snapshot writes happen weekly so minutes-fresh is
 * generous. Per-user cacheTag.
 *
 * Per `.claude/rules/cache-components.md` Pattern 1: NEXT_PHASE guard
 * returns EMPTY_SMB_MARKET so Vercel's build worker prerenders without
 * touching Neon.
 *
 * Performance: the slice is bounded (same-category-+-same-city). We
 * fetch up to MARKET_SLICE_CAP businesses with their latest snapshot
 * in one round-trip, compute medians + top-12 + movers in memory.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

import {
  EMPTY_SMB_MARKET,
  MARKET_MOVERS_N,
  MARKET_TOP_N,
  deriveMedians,
  type MarketMover,
  type MarketRankingRow,
  type SmbMarketData,
} from "./types";

const MARKET_SLICE_CAP = 80;

export async function getSmbMarketData(userId: string): Promise<SmbMarketData> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`smb-market-${userId}`);

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_SMB_MARKET;
  }

  if (!userId || typeof userId !== "string") {
    return EMPTY_SMB_MARKET;
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

    if (!own) return EMPTY_SMB_MARKET;

    if (!own.category || !own.city) {
      return {
        ...EMPTY_SMB_MARKET,
        ownedBusinessId: own.id,
        businessName: own.name,
        category: own.category ?? "",
        city: own.city,
      };
    }

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
            snapshotDate: true,
          },
        },
      },
    });

    interface Flat {
      id: string;
      name: string;
      mapslyScore: number | null;
      rating: number | null;
      reviewCount: number | null;
      replyRate: number | null;
      photosCount: number | null;
      velocityLast30d: number | null;
      snapshotDate: Date | null;
    }
    const flat: Flat[] = slice.map((b) => {
      const snap = b.snapshots[0] ?? null;
      return {
        id: b.id,
        name: b.name,
        mapslyScore: snap?.mapslyScore ?? null,
        rating: snap?.rating ?? null,
        reviewCount: snap?.reviewCount ?? null,
        replyRate: snap?.replyRate ?? null,
        photosCount: snap?.photosCount ?? null,
        velocityLast30d: snap?.velocityLast30d ?? null,
        snapshotDate: snap?.snapshotDate ?? null,
      };
    });

    // Rank by Mapsly Score desc (nulls last).
    const ranked = [...flat].sort((a, b) => {
      if (a.mapslyScore != null && b.mapslyScore != null) {
        return b.mapslyScore - a.mapslyScore;
      }
      if (a.mapslyScore != null) return -1;
      if (b.mapslyScore != null) return 1;
      return (b.reviewCount ?? 0) - (a.reviewCount ?? 0);
    });

    // Maria's row + rank
    const ownIndex = ranked.findIndex((r) => r.id === own.id);
    const ownRank = ownIndex >= 0 ? ownIndex + 1 : null;
    const ownRow = ownIndex >= 0 ? ranked[ownIndex] : null;
    const marketTotal = ranked.length;

    // Top N + include Maria if she's outside it.
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
    if (!includesOwn && ownRow && ownRank != null) {
      topRanked.push({
        id: ownRow.id,
        name: ownRow.name,
        isOwn: true,
        rank: ownRank,
        mapslyScore: ownRow.mapslyScore,
        rating: ownRow.rating,
        reviewCount: ownRow.reviewCount,
      });
    }

    // Movers · top 3 by velocity desc, excluding Maria.
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

    // Medians across the WHOLE slice (not just top 12).
    const medians = deriveMedians(flat);

    // Leader score for the gap headline.
    const leaderScore = ranked.find(
      (r) => r.id !== own.id && r.mapslyScore != null,
    )?.mapslyScore;
    const gapToLeader =
      ownRow?.mapslyScore != null && leaderScore != null
        ? Math.max(0, leaderScore - ownRow.mapslyScore)
        : null;

    // Most recent snapshot across the slice for the footer line.
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
      ownRank,
      marketTotal,
      ownMapslyScore: ownRow?.mapslyScore ?? null,
      gapToLeader,
      topRanked,
      medians,
      movers,
      lastSnapshotAt,
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[smb-market] query failed:", err);
    return EMPTY_SMB_MARKET;
  }
}
