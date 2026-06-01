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
};

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
    };
  } catch {
    return EMPTY_OWNER_PILLAR_STANDING;
  }
}
