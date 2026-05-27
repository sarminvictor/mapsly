/**
 * SMB search visibility · server query.
 *
 * Surface: `getSmbSearchData(userId)` — returns the user's own business
 * + a per-keyword visibility view (latest Maps rank, organic rank,
 * week-over-week delta) for the `/(smb)/search` route.
 *
 * Data sources (S.1+S.2 plan):
 *   - BusinessKeyword (per-(biz × kw) join) · latestOrganicRank,
 *     latestMapsRank, latestEstTrafficUsd, latestScanAt
 *   - SerpResult(kind=MAPS) · most-recent scan per keyword for the
 *     pack1/2/3 names (the competitive 3-pack view)
 *   - SerpResult(kind=ORGANIC|MAPS) · last ≥6-day-old scan per (keyword
 *     × kind) for week-over-week delta
 *
 * Returns the EMPTY shape (`ownedBusinessId === ""`) when:
 *   - the user has no claimed business yet (post-signup / onboarding)
 *   - we're in Vercel's build phase (NEXT_PHASE guard, INC-27)
 *   - Prisma throws (degrades to "looks empty" rather than 500 crash)
 *
 * Cache: `'use cache'` + `cacheLife('hours')` ·
 * `cacheTag('smb-search-${userId}')` per `.claude/rules/caching.md`.
 * The S.2 weekly cron `revalidateTag(s)` after its dispatch lands.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

import {
  EMPTY_SMB_SEARCH,
  MAX_KEYWORDS,
  deriveSearchQuickWins,
  estimatePatientsLost,
  type KeywordRow,
  type PackSlot,
  type SearchGap,
  type SmbSearchData,
} from "./types";

/** How many "you're not ranking for" gap rows to surface to Maria. */
const MAX_SEARCH_GAPS = 5;

/**
 * Sort rule · in-Maps-pack first (best rank first), then rows with an
 * organic rank (best first), then by estimated traffic value desc.
 * Maria's eye scans top-to-bottom; the highest-value visible wins come
 * first.
 */
function rankRows(a: KeywordRow, b: KeywordRow): number {
  const aInPack = a.localPackRank != null && a.localPackRank <= 3;
  const bInPack = b.localPackRank != null && b.localPackRank <= 3;
  if (aInPack && bInPack) {
    return (a.localPackRank ?? 99) - (b.localPackRank ?? 99);
  }
  if (aInPack) return -1;
  if (bInPack) return 1;

  const aHasOrg = a.organicRank != null;
  const bHasOrg = b.organicRank != null;
  if (aHasOrg && bHasOrg) {
    return (a.organicRank ?? 999) - (b.organicRank ?? 999);
  }
  if (aHasOrg) return -1;
  if (bHasOrg) return 1;

  return (b.searchVolume ?? 0) - (a.searchVolume ?? 0);
}

export async function getSmbSearchData(userId: string): Promise<SmbSearchData> {
  "use cache";
  cacheLife("hours");
  cacheTag(`smb-search-${userId}`);

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_SMB_SEARCH;
  }

  if (!userId || typeof userId !== "string") {
    return EMPTY_SMB_SEARCH;
  }

  try {
    // 1) Find Maria's claimed business + her latest BusinessKeyword rows.
    //    BusinessKeyword caches latest ranks · single SELECT, no JOIN to
    //    SerpResult for the hot path.
    const own = await prisma.business.findFirst({
      where: { ownerUserId: userId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        city: true,
        country: true,
        searchScanLastAt: true,
        businessKeywords: {
          orderBy: { latestEstTrafficUsd: { sort: "desc", nulls: "last" } },
          take: 200,
          select: {
            keywordId: true,
            latestOrganicRank: true,
            latestMapsRank: true,
            latestEstTrafficUsd: true,
            latestScanAt: true,
            isNew: true,
            isUp: true,
            isDown: true,
            keyword: {
              select: {
                id: true,
                keyword: true,
                searchVolume: true,
              },
            },
          },
        },
      },
    });

    if (!own) {
      return EMPTY_SMB_SEARCH;
    }

    if (own.businessKeywords.length === 0) {
      // Maria has a business but no keywords tracked yet (admin hasn't run
      // SERP scan). Return the empty shape with ownedBusinessId set so the
      // page renders the "scan pending" copy instead of the full empty
      // state. Gaps stay empty — without Maria's own data, comparing to
      // cell-mates isn't meaningful yet.
      return {
        ...EMPTY_SMB_SEARCH,
        ownedBusinessId: own.id,
        name: own.name,
        city: own.city,
      };
    }

    // 2) Fetch supporting SerpResult rows in one pass:
    //    - latest MAPS scan per keyword (for pack1/2/3 names)
    //    - any scan ≥6 days older per (keyword × kind) (for prev-week delta)
    const keywordIds = own.businessKeywords.map((bk) => bk.keywordId);
    const recentSerp = await prisma.serpResult.findMany({
      where: {
        businessId: own.id,
        keywordId: { in: keywordIds },
      },
      orderBy: { scannedAt: "desc" },
      take: 600, // 200 keywords × ~3 historical rows per kind = bounded
      select: {
        keywordId: true,
        kind: true,
        scannedAt: true,
        localPackRank: true,
        organicRank: true,
        pack1Name: true,
        pack2Name: true,
        pack3Name: true,
      },
    });

    // Group by (keywordId, kind) so we can pick latest + previous.
    type SerpScan = (typeof recentSerp)[number];
    const byKwKind = new Map<string, SerpScan[]>();
    for (const s of recentSerp) {
      const key = `${s.keywordId}:${s.kind}`;
      const arr = byKwKind.get(key);
      if (arr) arr.push(s);
      else byKwKind.set(key, [s]);
    }

    const rows: KeywordRow[] = [];
    let mostRecentScanMs: number | null = null;

    for (const bk of own.businessKeywords) {
      if (!bk.keyword) continue;
      const mapsScans = byKwKind.get(`${bk.keywordId}:MAPS`) ?? [];
      const organicScans = byKwKind.get(`${bk.keywordId}:ORGANIC`) ?? [];

      // Previous-week scan per kind · oldest ≤ 6 days older than latest.
      const [prevMapsRank, prevOrganicRank] = [
        pickPreviousWeek(mapsScans, "localPackRank"),
        pickPreviousWeek(organicScans, "organicRank"),
      ];

      // Pack names come from the latest MAPS scan · gives us the
      // competitive 3-pack view per keyword.
      const latestMaps = mapsScans[0] ?? null;
      const packSlots = buildPackSlots({
        pack1Name: latestMaps?.pack1Name ?? null,
        pack2Name: latestMaps?.pack2Name ?? null,
        pack3Name: latestMaps?.pack3Name ?? null,
        ownLocalPackRank: bk.latestMapsRank,
        ownName: own.name,
      });

      const estLost = estimatePatientsLost({
        searchVolume: bk.keyword.searchVolume,
        localPackRank: bk.latestMapsRank,
      });

      rows.push({
        id: bk.keyword.id,
        keyword: bk.keyword.keyword,
        searchVolume: bk.keyword.searchVolume,
        localPackRank: bk.latestMapsRank,
        organicRank: bk.latestOrganicRank,
        prevLocalPackRank: prevMapsRank,
        prevOrganicRank: prevOrganicRank,
        scannedAt: bk.latestScanAt,
        packSlots,
        estPatientsLost: estLost,
      });

      const ms = bk.latestScanAt?.getTime() ?? null;
      if (ms != null && (mostRecentScanMs === null || ms > mostRecentScanMs)) {
        mostRecentScanMs = ms;
      }
    }

    rows.sort(rankRows);
    const visible = rows.slice(0, MAX_KEYWORDS);

    // 3) Hero KPIs from the FULL set of rows (not just visible).
    let bestLocalPackRank: number | null = null;
    let keywordsInLocalPack = 0;
    let keywordsImproved = 0;
    for (const r of rows) {
      if (r.localPackRank != null && r.localPackRank <= 3) {
        keywordsInLocalPack += 1;
        if (bestLocalPackRank === null || r.localPackRank < bestLocalPackRank) {
          bestLocalPackRank = r.localPackRank;
        }
      }
      const localImproved =
        r.prevLocalPackRank != null &&
        r.localPackRank != null &&
        r.localPackRank < r.prevLocalPackRank;
      const orgImproved =
        r.prevOrganicRank != null &&
        r.organicRank != null &&
        r.organicRank < r.prevOrganicRank;
      const newlyLocal = r.prevLocalPackRank == null && r.localPackRank != null;
      const newlyOrg = r.prevOrganicRank == null && r.organicRank != null;
      if (localImproved || orgImproved || newlyLocal || newlyOrg) {
        keywordsImproved += 1;
      }
    }

    const totalEstPatientsLost = rows.reduce(
      (sum, r) => sum + r.estPatientsLost,
      0,
    );
    const topQuickWins = deriveSearchQuickWins(rows);

    // 4) Cell-aggregated GAPS · keywords competitors in Maria's
    //    (city, country) cell rank for that she does NOT. Zero new
    //    API calls · derived entirely from existing BusinessKeyword
    //    data.
    const searchGaps = await buildSearchGaps({
      ownBusinessId: own.id,
      ownKeywordIds: new Set(own.businessKeywords.map((bk) => bk.keywordId)),
      city: own.city,
      country: own.country,
    });

    return {
      ownedBusinessId: own.id,
      name: own.name,
      city: own.city,
      bestLocalPackRank,
      keywordsTracked: rows.length,
      keywordsInLocalPack,
      keywordsImprovedThisWeek: keywordsImproved,
      keywords: visible,
      searchGaps,
      lastScanAt:
        mostRecentScanMs != null
          ? new Date(mostRecentScanMs)
          : (own.searchScanLastAt ?? null),
      totalEstPatientsLost,
      topQuickWins,
    };
  } catch (err) {
    console.error("getSmbSearchData failed", err);
    return EMPTY_SMB_SEARCH;
  }
}

/**
 * Find keywords other paid businesses in Maria's (city, country) cell
 * rank for that she doesn't. Sorted by competitor traffic value desc.
 *
 * Pure DB query · zero API calls. Skipped when:
 *   - Maria's business has no city/country (no cell-mates lookup possible)
 *   - No other businesses in the cell have BusinessKeyword data yet
 *
 * Returns at most `MAX_SEARCH_GAPS` (5) rows.
 */
async function buildSearchGaps(input: {
  ownBusinessId: string;
  ownKeywordIds: Set<string>;
  city: string | null;
  country: string | null;
}): Promise<SearchGap[]> {
  if (!input.city || !input.country) return [];

  // Find other businesses in the same cell · scoped by city + country
  // is intentionally narrow · matches dispatchSearchScan's cell shape.
  const cellMates = await prisma.business.findMany({
    where: {
      city: input.city,
      country: input.country,
      isActive: true,
      id: { not: input.ownBusinessId },
    },
    select: { id: true },
    take: 200,
  });
  if (cellMates.length === 0) return [];

  const cellMateIds = cellMates.map((b) => b.id);

  // Pull all BusinessKeyword rows for cell-mates · group by keywordId.
  // We do this in-memory rather than via groupBy because we want to
  // pick "best rank" + "competitor count" per keyword in one pass.
  const competitorKeywords = await prisma.businessKeyword.findMany({
    where: {
      businessId: { in: cellMateIds },
      // Only meaningful ranks · skip rows still pending the first scan.
      latestOrganicRank: { not: null },
    },
    select: {
      keywordId: true,
      latestOrganicRank: true,
      latestEstTrafficUsd: true,
      keyword: {
        select: {
          id: true,
          keyword: true,
          searchVolume: true,
        },
      },
    },
    take: 1000,
  });

  // Aggregate per keyword.
  type Agg = {
    keywordId: string;
    keyword: string;
    searchVolume: number | null;
    competitorsRanking: number;
    bestCompetitorRank: number | null;
    estCompetitorTrafficUsd: number;
  };
  const byKeyword = new Map<string, Agg>();
  for (const c of competitorKeywords) {
    // Filter out keywords Maria already tracks.
    if (input.ownKeywordIds.has(c.keywordId)) continue;
    if (!c.keyword) continue;
    const a = byKeyword.get(c.keywordId) ?? {
      keywordId: c.keywordId,
      keyword: c.keyword.keyword,
      searchVolume: c.keyword.searchVolume,
      competitorsRanking: 0,
      bestCompetitorRank: null,
      estCompetitorTrafficUsd: 0,
    };
    a.competitorsRanking += 1;
    if (
      c.latestOrganicRank != null &&
      (a.bestCompetitorRank == null ||
        c.latestOrganicRank < a.bestCompetitorRank)
    ) {
      a.bestCompetitorRank = c.latestOrganicRank;
    }
    a.estCompetitorTrafficUsd += c.latestEstTrafficUsd ?? 0;
    byKeyword.set(c.keywordId, a);
  }

  // Top-N by competitor traffic value desc · then by competitor count
  // as a tie-breaker.
  return Array.from(byKeyword.values())
    .sort((x, y) => {
      const v = y.estCompetitorTrafficUsd - x.estCompetitorTrafficUsd;
      if (v !== 0) return v;
      return y.competitorsRanking - x.competitorsRanking;
    })
    .slice(0, MAX_SEARCH_GAPS)
    .map((a) => ({
      id: a.keywordId,
      keyword: a.keyword,
      searchVolume: a.searchVolume,
      competitorsRanking: a.competitorsRanking,
      bestCompetitorRank: a.bestCompetitorRank,
      estCompetitorTrafficUsd: a.estCompetitorTrafficUsd,
    }));
}

/**
 * From a desc-sorted scan list for ONE keyword + one kind, pick the
 * scan ≥6 days older than the latest. Returns the chosen rank value
 * (the column passed via `pickField`) or null when no prior scan exists.
 *
 * The 6-day cutoff means a fresh weekly cron tick + last week's tick
 * resolve as "latest" vs "previous." A mid-week admin re-trigger won't
 * be mistaken for last week.
 */
function pickPreviousWeek<
  K extends "localPackRank" | "organicRank",
  T extends { scannedAt: Date } & Partial<Record<K, number | null>>,
>(scansDesc: T[], field: K): number | null {
  if (scansDesc.length < 2) return null;
  const latest = scansDesc[0];
  const cutoffMs = latest.scannedAt.getTime() - 6 * 24 * 60 * 60 * 1000;
  for (let i = 1; i < scansDesc.length; i++) {
    if (scansDesc[i].scannedAt.getTime() <= cutoffMs) {
      return scansDesc[i][field] ?? null;
    }
  }
  return null;
}

/**
 * Build the 3-slot local-pack view for one keyword.
 *
 *   1. If Maria's own rank matches this slot, use "You" + kind=you.
 *   2. Else if SerpResult has a named occupant, use it + kind=competitor.
 *   3. Else mark the slot empty.
 */
function buildPackSlots(input: {
  pack1Name: string | null;
  pack2Name: string | null;
  pack3Name: string | null;
  ownLocalPackRank: number | null;
  ownName: string;
}): PackSlot[] {
  const occupants: Array<string | null> = [
    input.pack1Name,
    input.pack2Name,
    input.pack3Name,
  ];
  const ownRank = input.ownLocalPackRank;
  return ([1, 2, 3] as const).map((rank) => {
    if (ownRank != null && ownRank === rank) {
      return { rank, name: "You", kind: "you" } as PackSlot;
    }
    const captured = occupants[rank - 1];
    if (captured && captured.trim() !== "") {
      return { rank, name: captured, kind: "competitor" } as PackSlot;
    }
    return { rank, name: "—", kind: "empty" } as PackSlot;
  });
}
