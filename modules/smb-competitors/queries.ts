/**
 * SMB competitors · server query.
 *
 * Surface: `getSmbCompetitorsData(userId)` — returns the user's own
 * business + the top N competitors in the same category and city for a
 * side-by-side comparison. Returns the EMPTY shape
 * (`ownedBusinessId === ""`) when:
 *
 *   - the user has no claimed business yet (post-signup / onboarding)
 *   - we're in Vercel's build phase (NEXT_PHASE guard, INC-27)
 *   - Prisma throws (degrades to "looks empty" rather than 500 crash)
 *
 * The page handler reads `data.ownedBusinessId === ""` and renders an
 * onboarding-style empty state (Maria's first visit).
 *
 * Cache strategy per `.claude/rules/caching.md`:
 *
 *   - `'use cache'` + `cacheLife('hours')` — competitor relativity
 *     changes only when the weekly C.9 snapshot cron lands; hours-fresh
 *     is plenty. The cron explicitly `revalidateTag`s this tag so
 *     post-refresh data appears next page-load anyway.
 *   - `cacheTag('smb-competitors-${userId}')` — per-user; per-user
 *     because the competitor set is keyed off Maria's category+city,
 *     which can only change if her own profile changes.
 *
 * Per `.claude/rules/cache-components.md` Pattern 1, the EMPTY shape is
 * the full shape of the declared return type — TypeScript catches
 * partial returns at literal-comparison time. Build-phase short-circuit
 * + catch block both return EMPTY so the page prerenders cleanly.
 *
 * Per `.claude/rules/performance.md`, `select`s are explicit. The
 * neighbour query joins via a single roundtrip with `include: snapshots
 * take:1 orderBy desc` — no N+1 across competitors.
 *
 * Per `.claude/rules/security.md`, this helper does NOT enforce auth —
 * the page handler is responsible for `unauthorized()`. This function
 * just runs queries scoped to the userId it's given.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

import {
  EMPTY_SMB_COMPETITORS,
  MAX_COMPETITORS,
  deriveHeadToHead,
  deriveThreats,
  type CompetitorRow,
  type SmbCompetitorsData,
} from "./types";

export async function getSmbCompetitorsData(
  userId: string,
): Promise<SmbCompetitorsData> {
  "use cache";
  cacheLife("hours");
  cacheTag(`smb-competitors-${userId}`);

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_SMB_COMPETITORS;
  }

  if (!userId || typeof userId !== "string") {
    return EMPTY_SMB_COMPETITORS;
  }

  try {
    // 1) Fetch the user's own business + latest snapshot.
    const own = await prisma.business.findFirst({
      where: { ownerUserId: userId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        category: true,
        city: true,
        province: true,
        rating: true,
        reviewCount: true,
        address: true,
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
            snapshotDate: true,
          },
        },
      },
    });

    if (!own) {
      return EMPTY_SMB_COMPETITORS;
    }

    const ownSnap = own.snapshots[0] ?? null;

    // No city yet — we can't run a category+city neighbour query.
    // Return the user's row alone so the page renders with the
    // "we'll find competitors once we know your area" empty state.
    if (!own.city) {
      return {
        ownedBusinessId: own.id,
        name: own.name,
        category: own.category,
        city: own.city,
        province: own.province,
        ownMapslyScore: ownSnap?.mapslyScore ?? null,
        marketRank: ownSnap?.msiRank ?? null,
        marketTotal: ownSnap?.msiTotal ?? null,
        competitors: [],
        lastSnapshotAt: ownSnap?.snapshotDate ?? null,
        headToHead: [],
        leaderName: null,
        threats: [],
      };
    }

    // 2) Fetch up to MAX_COMPETITORS neighbours in the same category+city,
    //    excluding the user's own business. Order by latest-snapshot
    //    mapslyScore desc when present; businesses without a snapshot fall
    //    to the end of the list (Prisma's nulls-last on relation orderBy
    //    isn't expressive enough, so we sort in memory below).
    const neighbours = await prisma.business.findMany({
      where: {
        isActive: true,
        category: own.category,
        city: own.city,
        id: { not: own.id },
      },
      take: MAX_COMPETITORS * 2, // overfetch slightly so the in-memory
      // sort still picks the top N when several have null scores.
      select: {
        id: true,
        name: true,
        rating: true,
        reviewCount: true,
        address: true,
        createdAt: true,
        snapshots: {
          take: 1,
          orderBy: { snapshotDate: "desc" },
          select: {
            mapslyScore: true,
            velocityLast30d: true,
            replyRate: true,
            profileCompletenessScore: true,
            photosCount: true,
          },
        },
      },
    });

    // Build a combined list: user's row + neighbours, ranked by
    // mapslyScore desc (nulls last), then by reviewCount desc as a
    // tie-breaker (a 100-review biz with no score is still more
    // established than a 2-review biz with no score).
    const ownRow: CompetitorRow = {
      id: own.id,
      name: own.name,
      isOwn: true,
      rating: own.rating,
      reviewCount: own.reviewCount,
      mapslyScore: ownSnap?.mapslyScore ?? null,
      velocityLast30d: ownSnap?.velocityLast30d ?? null,
      replyRate: ownSnap?.replyRate ?? null,
      profileCompletenessScore: ownSnap?.profileCompletenessScore ?? null,
      photosCount: ownSnap?.photosCount ?? null,
      isSameBuilding: false,
      createdAt: own.createdAt ?? null,
    };

    const ownAddrKey = addressKey(own.address);

    const neighbourRows: CompetitorRow[] = neighbours.map((n) => {
      const snap = n.snapshots[0] ?? null;
      return {
        id: n.id,
        name: n.name,
        isOwn: false,
        rating: n.rating,
        reviewCount: n.reviewCount,
        mapslyScore: snap?.mapslyScore ?? null,
        velocityLast30d: snap?.velocityLast30d ?? null,
        replyRate: snap?.replyRate ?? null,
        profileCompletenessScore: snap?.profileCompletenessScore ?? null,
        photosCount: snap?.photosCount ?? null,
        isSameBuilding:
          ownAddrKey !== null && addressKey(n.address) === ownAddrKey,
        createdAt: n.createdAt ?? null,
      };
    });

    const combined = [ownRow, ...neighbourRows].sort(rankRows).slice(
      0,
      MAX_COMPETITORS + 1, // user's row + N competitors
    );

    // Identify the leader (highest-scoring non-own row) for the
    // head-to-head panel.
    const leader =
      combined.find((c) => !c.isOwn && c.mapslyScore != null) ??
      combined.find((c) => !c.isOwn) ??
      null;

    const headToHead = deriveHeadToHead(ownRow, leader);
    const threats = deriveThreats({
      own: ownRow,
      competitors: combined,
    });

    return {
      ownedBusinessId: own.id,
      name: own.name,
      category: own.category,
      city: own.city,
      province: own.province,
      ownMapslyScore: ownSnap?.mapslyScore ?? null,
      marketRank: ownSnap?.msiRank ?? null,
      marketTotal: ownSnap?.msiTotal ?? null,
      competitors: combined,
      lastSnapshotAt: ownSnap?.snapshotDate ?? null,
      headToHead,
      leaderName: leader?.name ?? null,
      threats,
    };
  } catch {
    return EMPTY_SMB_COMPETITORS;
  }
}

/**
 * Address normaliser for the same-building heuristic. Returns a
 * lowercase, whitespace-collapsed prefix (first 30 chars) or `null`
 * for missing/empty addresses. Two businesses share the same building
 * when their normalised addresses match.
 */
function addressKey(addr: string | null | undefined): string | null {
  if (!addr || typeof addr !== "string") return null;
  const trimmed = addr.toLowerCase().replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 30);
}

/**
 * Sort rule: mapslyScore desc (nulls last) then reviewCount desc
 * (nulls last). Returns a negative number when `a` should come first.
 */
function rankRows(a: CompetitorRow, b: CompetitorRow): number {
  const aScore = a.mapslyScore;
  const bScore = b.mapslyScore;
  if (aScore != null && bScore != null) {
    if (aScore !== bScore) return bScore - aScore;
  } else if (aScore != null) {
    return -1;
  } else if (bScore != null) {
    return 1;
  }
  const aCount = a.reviewCount ?? -1;
  const bCount = b.reviewCount ?? -1;
  return bCount - aCount;
}
