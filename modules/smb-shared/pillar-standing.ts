/**
 * SMB shared · owner pillar standing (Scoring v2)
 *
 * Lean cached read of the owned business's latest pillar scores + market
 * standing, used by the shared `SmbPageHeader` to show a per-page pillar badge
 * (e.g. "Reputation 7.8 /10 · #5 of 38") on every /(smb) page.
 *
 * Per `.claude/rules/cache-components.md` Pattern 1 — `EMPTY_OWNER_PILLAR_STANDING`
 * is the full shape, returned during the build phase / no-business / error so
 * the route prerenders without opening a Neon WebSocket.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

export type PillarKey =
  | "reputation"
  | "visibility"
  | "profile"
  | "website"
  | "advertising";

export interface OwnerPillarStanding {
  /** True once the pillar-score pass has written a pillarScore. */
  hasData: boolean;
  reputation: number | null;
  visibility: number | null;
  profile: number | null;
  website: number | null;
  advertising: number | null;
  adsApplicable: boolean | null;
  msiRank: number | null;
  msiTotal: number | null;
  msiPercentile: number | null;
  /** Per-pillar rank within the cell (1 = best) + how many were ranked on it. */
  ranks: Partial<Record<PillarKey, { rank: number; of: number }>> | null;
  /** Businesses in the cell (informational; the rank denominator is `of`). */
  cellSize: number | null;
}

export const EMPTY_OWNER_PILLAR_STANDING: OwnerPillarStanding = {
  hasData: false,
  reputation: null,
  visibility: null,
  profile: null,
  website: null,
  advertising: null,
  adsApplicable: null,
  msiRank: null,
  msiTotal: null,
  msiPercentile: null,
  ranks: null,
  cellSize: null,
};

function parseRanks(
  v: unknown,
): Partial<Record<PillarKey, { rank: number; of: number }>> | null {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const keys: PillarKey[] = [
    "reputation",
    "visibility",
    "profile",
    "website",
    "advertising",
  ];
  const out: Partial<Record<PillarKey, { rank: number; of: number }>> = {};
  for (const k of keys) {
    const e = o[k];
    if (e != null && typeof e === "object" && !Array.isArray(e)) {
      const r = (e as Record<string, unknown>).rank;
      const n = (e as Record<string, unknown>).of;
      if (
        typeof r === "number" &&
        Number.isFinite(r) &&
        typeof n === "number" &&
        Number.isFinite(n)
      ) {
        out[k] = { rank: r, of: n };
      }
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

export async function getOwnerPillarStanding(
  userId: string,
): Promise<OwnerPillarStanding> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`smb-pillars-${userId}`);

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_OWNER_PILLAR_STANDING;
  }
  if (!userId || typeof userId !== "string") {
    return EMPTY_OWNER_PILLAR_STANDING;
  }

  try {
    const business = await prisma.business.findFirst({
      where: { ownerUserId: userId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: {
        snapshots: {
          take: 1,
          orderBy: { snapshotDate: "desc" },
          select: {
            pillarScore: true,
            reputationPillar: true,
            visibilityPillar: true,
            profilePillar: true,
            websitePillar: true,
            adsPillar: true,
            adsApplicable: true,
            msiRank: true,
            msiTotal: true,
            msiPercentile: true,
            pillarRanks: true,
            cellSize: true,
          },
        },
      },
    });

    const snap = business?.snapshots[0] ?? null;
    if (!snap || snap.pillarScore == null) return EMPTY_OWNER_PILLAR_STANDING;

    return {
      hasData: true,
      reputation: snap.reputationPillar,
      visibility: snap.visibilityPillar,
      profile: snap.profilePillar,
      website: snap.websitePillar,
      advertising: snap.adsPillar,
      adsApplicable: snap.adsApplicable,
      msiRank: snap.msiRank,
      msiTotal: snap.msiTotal,
      msiPercentile: snap.msiPercentile,
      ranks: parseRanks(snap.pillarRanks),
      cellSize: snap.cellSize,
    };
  } catch {
    return EMPTY_OWNER_PILLAR_STANDING;
  }
}
