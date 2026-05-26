/**
 * SMB ads · server query.
 *
 * Surface: `getSmbAdsData(userId)` — returns Maria's own business +
 * active ads grouped into keyword lanes, INCLUDING competitor ads
 * from businesses in the same `category` + `city` so the page is a
 * true competitive-intel view (not just "look at your own ads").
 *
 * Cache strategy per `.claude/rules/caching.md`:
 *   - `'use cache'` + `cacheLife('hours')` — the daily ad-library
 *     cron is the source of truth.
 *   - `cacheTag('smb-ads-${userId}')` — per-user; cron revalidates.
 *
 * Per `.claude/rules/cache-components.md` Pattern 1, EMPTY_SMB_ADS is
 * the full shape of the declared return type. Build-phase short-
 * circuit + catch block both return EMPTY so the page prerenders
 * cleanly even when Neon WebSockets aren't available (INC-27).
 *
 * Per `.claude/rules/performance.md`, `select`s are explicit and we
 * cap both own + competitor queries at 200 / 600 rows respectively
 * to bound work. Maria's lane grid is capped at MAX_LANES = 14 in
 * the UI per `.claude/rules/ui-ux-smb.md`.
 *
 * Per `.claude/rules/security.md`, this helper does NOT enforce auth
 * — the page handler is responsible for `unauthorized()`. Competitor
 * ad data is public-by-source (Meta Ad Library / Google Transparency
 * are public databases), so no cross-business leak issue.
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

const MAX_OWN_ADS = 200;
const MAX_COMPETITOR_ADS = 600;
const MAX_COMPETITORS = 40;

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
    // 1 · Maria's own business identity + services list + city.
    const own = await prisma.business.findFirst({
      where: { ownerUserId: userId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        category: true,
        categories: true,
        city: true,
      },
    });

    if (!own) return EMPTY_SMB_ADS;

    // 2 · Sibling competitors in the same category + city (excluding
    //     Maria herself). We cap at MAX_COMPETITORS to bound the
    //     downstream ad query; in dense metros this is generous.
    const competitors =
      own.category && own.city
        ? await prisma.business.findMany({
            where: {
              category: own.category,
              city: own.city,
              isActive: true,
              id: { not: own.id },
            },
            take: MAX_COMPETITORS,
            orderBy: { reviewCount: "desc" },
            select: { id: true, name: true },
          })
        : [];

    const competitorIdToName = new Map(competitors.map((c) => [c.id, c.name]));

    // 3 · Maria's own active ads.
    const ownAdsRows = await prisma.adLibraryEntry.findMany({
      where: { businessId: own.id, isActive: true },
      orderBy: [{ matchedKeyword: "asc" }, { lastSeenAt: "desc" }],
      take: MAX_OWN_ADS,
      select: {
        id: true,
        platform: true,
        adCreativeBody: true,
        landingUrl: true,
        matchedKeyword: true,
        lastSeenAt: true,
        businessId: true,
      },
    });

    // 4 · Competitor active ads in the same market.
    const competitorAdsRows = competitors.length
      ? await prisma.adLibraryEntry.findMany({
          where: {
            businessId: { in: competitors.map((c) => c.id) },
            isActive: true,
          },
          orderBy: [{ matchedKeyword: "asc" }, { lastSeenAt: "desc" }],
          take: MAX_COMPETITOR_ADS,
          select: {
            id: true,
            platform: true,
            adCreativeBody: true,
            landingUrl: true,
            matchedKeyword: true,
            lastSeenAt: true,
            businessId: true,
          },
        })
      : [];

    // 5 · Normalise both into a single AdEntry array with parallel
    //     keyword + raw business id arrays for `groupIntoLanes`.
    type Row = (typeof ownAdsRows)[number];
    const allRows: Row[] = [...ownAdsRows, ...competitorAdsRows];

    if (allRows.length === 0) {
      return {
        ownedBusinessId: own.id,
        name: own.name,
        category: own.category ?? "",
        totalActiveAds: 0,
        offKeywordCount: 0,
        lanesCovered: 0,
        openLanes: 0,
        competitorCount: 0,
        lanes: [],
        refreshedAt: null,
      };
    }

    const services = own.categories ?? [];

    const ads: AdEntry[] = allRows.map((r) => {
      const isOwn = r.businessId === own.id;
      return {
        id: r.id,
        platform: (r.platform === "GOOGLE"
          ? "GOOGLE"
          : "META") as SmbAdPlatform,
        adCreativeBody: r.adCreativeBody,
        landingUrl: r.landingUrl,
        lastSeenAt: r.lastSeenAt,
        advertiserName: isOwn
          ? null
          : (competitorIdToName.get(r.businessId ?? "") ?? null),
        isOwn,
      };
    });
    const keywords = allRows.map((r) => r.matchedKeyword);

    const lanes = groupIntoLanes(ads, services, MAX_LANES, keywords);

    // 6 · Aggregate derived counts for the state bar.
    const totalActiveAds = ownAdsRows.length;
    const offKeywordCount = lanes
      .filter((l) => l.isOffKeyword)
      .reduce((n, l) => n + l.ownCount, 0);
    const lanesCovered = lanes.reduce(
      (n, l) => (l.ownCount > 0 ? n + 1 : n),
      0,
    );
    const openLanes = lanes.reduce(
      (n, l) => (l.status === "open" && !l.isOffKeyword ? n + 1 : n),
      0,
    );
    const distinctCompetitors = new Set<string>();
    for (const lane of lanes) {
      for (const advertiser of lane.topCompetitors) {
        distinctCompetitors.add(advertiser);
      }
    }
    const competitorCount = distinctCompetitors.size;

    let refreshedAt: Date | null = null;
    for (const r of allRows) {
      if (!refreshedAt || r.lastSeenAt > refreshedAt) {
        refreshedAt = r.lastSeenAt;
      }
    }

    return {
      ownedBusinessId: own.id,
      name: own.name,
      category: own.category ?? "",
      totalActiveAds,
      offKeywordCount,
      lanesCovered,
      openLanes,
      competitorCount,
      lanes,
      refreshedAt,
    };
  } catch (e) {
    // Per `.claude/rules/observability.md`, log and degrade — never
    // 500 a Maria-facing page over a transient DB blip.

    console.error("[smb-ads] query failed:", e);
    return EMPTY_SMB_ADS;
  }
}
