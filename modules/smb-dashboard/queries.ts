/**
 * SMB dashboard · server queries.
 *
 * Surface: `getSmbDashboardData(userId)` — returns the latest
 * `BusinessSnapshot` of the user's owned business, denormalised into a
 * flat `SmbDashboardData` for the page to render. Returns the EMPTY shape
 * (ownedBusinessId === "") when:
 *
 *   - the user has no claimed business yet (post-signup / onboarding state)
 *   - we're in Vercel's build phase (NEXT_PHASE guard, INC-27)
 *   - Prisma throws (degrades to "looks empty" rather than 500 crash)
 *
 * The page handler reads `data.ownedBusinessId === ""` and renders an
 * onboarding-style empty state (Maria's first visit).
 *
 * Cache strategy per `.claude/rules/caching.md`:
 *
 *   - `'use cache'` + `cacheLife('minutes')` — Maria refreshes the page
 *     occasionally during the day; minutes-fresh is plenty (the underlying
 *     snapshot only refreshes weekly via the C.9 cron). A more generous
 *     profile (hours) is tempting but if Maria takes an action — replies
 *     to a review, fixes a profile field — she wants to see the change
 *     reflected next page-load. The C.9 cron will `revalidateTag` after
 *     each snapshot write so cold-data fresh-feel is fine.
 *   - `cacheTag('smb-dashboard-${userId}')` — per-user; the C.9 cron
 *     revalidates this tag for every business it touches.
 *
 * Per `.claude/rules/cache-components.md` Pattern 1, the EMPTY shape is
 * the full shape of the declared return type — TypeScript catches partial
 * shapes at literal-comparison time. Build-phase short-circuit + catch
 * block both return EMPTY so the dashboard prerenders cleanly.
 *
 * Per `.claude/rules/performance.md`, `select`s are explicit.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

import { EMPTY_SMB_DASHBOARD, type SmbDashboardData } from "./types";

/**
 * Fetch the SMB dashboard payload for the signed-in user.
 *
 * Returns `EMPTY_SMB_DASHBOARD` (ownedBusinessId === "") for the no-biz
 * / build / failure cases. Callers check `data.ownedBusinessId === ""`
 * and render the onboarding empty state.
 *
 * The function does NOT enforce auth — the page handler MUST verify the
 * session and dispatch `unauthorized()` if missing. This helper just
 * runs a `where: { ownerUserId }` query against whatever userId it's
 * given.
 */
export async function getSmbDashboardData(
  userId: string,
): Promise<SmbDashboardData> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`smb-dashboard-${userId}`);

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
            snapshotDate: true,
          },
        },
      },
    });

    if (!business) {
      return EMPTY_SMB_DASHBOARD;
    }

    const snap = business.snapshots[0] ?? null;

    return {
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
      lastSnapshotAt: snap?.snapshotDate ?? null,
    };
  } catch {
    return EMPTY_SMB_DASHBOARD;
  }
}
