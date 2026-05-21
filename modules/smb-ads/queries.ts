/**
 * SMB ads · server query.
 *
 * Surface: `getSmbAdsData(userId)` — returns the user's own business +
 * the active ads we've spotted, grouped into keyword lanes. Returns
 * the EMPTY shape (`ownedBusinessId === ""`) when:
 *
 *   - the user has no claimed business yet (post-signup / onboarding)
 *   - we're in Vercel's build phase (NEXT_PHASE guard, INC-27)
 *   - Prisma throws (degrades to "looks empty" rather than 500 crash)
 *
 * Cache strategy per `.claude/rules/caching.md`:
 *
 *   - `'use cache'` + `cacheLife('hours')` — the C.8 daily ad-library
 *     cron is the source of truth; the latest snapshot of ads barely
 *     drifts inside an hour.
 *   - `cacheTag('smb-ads-${userId}')` — per-user; cron explicitly
 *     revalidates this tag when it lands new ads.
 *
 * Per `.claude/rules/cache-components.md` Pattern 1, EMPTY_SMB_ADS is
 * the full shape of the declared return type. Build-phase short-
 * circuit + catch block both return EMPTY so the page prerenders
 * cleanly even when Neon WebSockets aren't available (INC-27).
 *
 * Per `.claude/rules/performance.md`, `select`s are explicit and the
 * query takes at most 200 rows — Maria's surfaces don't render long
 * tables (`.claude/rules/ui-ux-smb.md`).
 *
 * Per `.claude/rules/security.md`, this helper does NOT enforce auth —
 * the page handler is responsible for `unauthorized()`.
 *
 * For E.5 first ship: only the user's own business's ads. Competitor
 * ad expansion (same category + city) is a follow-up captured in the
 * PLAN. The first ship gives Maria visibility into her own ad pipeline.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

import {
  EMPTY_SMB_ADS,
  MAX_LANES,
  groupIntoLanes,
  type AdEntry,
  type SmbAdPlatform,
  type SmbAdsData,
} from "./types";

export async function getSmbAdsData(userId: string): Promise<SmbAdsData> {
  "use cache";
  cacheLife("hours");
  cacheTag(`smb-ads-${userId}`);

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_SMB_ADS;
  }

  if (!userId || typeof userId !== "string") {
    return EMPTY_SMB_ADS;
  }

  try {
    // 1) Fetch the user's own business identity + the services proxy
    //    we use to flag off-keyword lanes.
    const own = await prisma.business.findFirst({
      where: { ownerUserId: userId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        category: true,
        categories: true,
      },
    });

    if (!own) {
      return EMPTY_SMB_ADS;
    }

    // 2) Fetch active ads for this business. We cap at 200 — well above
    //    what any single SMB will have running, but bounded per
    //    `.claude/rules/scalability.md`.
    const rows = await prisma.adLibraryEntry.findMany({
      where: { businessId: own.id, isActive: true },
      orderBy: [{ matchedKeyword: "asc" }, { lastSeenAt: "desc" }],
      take: 200,
      select: {
        id: true,
        platform: true,
        adCreativeBody: true,
        landingUrl: true,
        matchedKeyword: true,
        lastSeenAt: true,
      },
    });

    if (rows.length === 0) {
      return {
        ownedBusinessId: own.id,
        name: own.name,
        category: own.category,
        totalActiveAds: 0,
        offKeywordCount: 0,
        lanes: [],
        refreshedAt: null,
      };
    }

    // 3) Normalise + bucket. We keep the raw matchedKeyword in a
    //    parallel array so `groupIntoLanes` can key lanes off it
    //    without needing to widen `AdEntry`.
    const services = own.categories ?? [];

    const ads: AdEntry[] = rows.map((r) => ({
      id: r.id,
      // Narrow Prisma's full AdPlatform enum to the two we render.
      // TikTok is captured in DB but we don't show it yet — fall it
      // into META visually as a neutral "social" until we ship a
      // dedicated chip in a follow-up.
      platform: (r.platform === "GOOGLE" ? "GOOGLE" : "META") as SmbAdPlatform,
      adCreativeBody: r.adCreativeBody,
      landingUrl: r.landingUrl,
      lastSeenAt: r.lastSeenAt,
    }));
    const keywords = rows.map((r) => r.matchedKeyword);

    const lanes = groupIntoLanes(ads, services, MAX_LANES, keywords);

    const offKeywordCount = lanes
      .filter((l) => l.isOffKeyword)
      .reduce((n, l) => n + l.ads.length, 0);

    // The most-recent lastSeenAt across all rows. Used for the
    // "Refreshed X ago" footer. Date math without a date library.
    let refreshedAt: Date | null = null;
    for (const r of rows) {
      if (!refreshedAt || r.lastSeenAt > refreshedAt) {
        refreshedAt = r.lastSeenAt;
      }
    }

    return {
      ownedBusinessId: own.id,
      name: own.name,
      category: own.category,
      totalActiveAds: rows.length,
      offKeywordCount,
      lanes,
      refreshedAt,
    };
  } catch (e) {
    // Per `.claude/rules/observability.md`, log and degrade — never
    // 500 a Maria-facing page over a transient DB blip.
    // eslint-disable-next-line no-console
    console.error("[smb-ads] query failed:", e);
    return EMPTY_SMB_ADS;
  }
}
