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
  bestRank,
  ctrForBestRank,
  deriveSearchQuickWins,
  estimatePatientsLost,
  type CompetitorRow,
  type KeywordRow,
  type PackSlot,
  type RankBucket,
  type SearchGap,
  type SmbSearchData,
} from "./types";

/** How many "you're not ranking for" gap rows to surface to Maria. */
const MAX_SEARCH_GAPS = 5;
/** How many competitor rows in the leaderboard before Maria's own
 *  appended row (if she's outside the top 10). */
const COMPETITOR_LEADERBOARD_SIZE = 10;

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
            latestEstMonthlyVisits: true,
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

      // Prefer DfS-truth `etv` for visits · fall back to (sv × CTR) for
      // pre-v0.12.11 rows where `latestEstMonthlyVisits` is still null.
      const bestRk = bestRank(bk.latestMapsRank, bk.latestOrganicRank);
      const estVisits =
        bk.latestEstMonthlyVisits != null
          ? Math.round(bk.latestEstMonthlyVisits)
          : Math.round((bk.keyword.searchVolume ?? 0) * ctrForBestRank(bestRk));

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
        estVisits,
      });

      const ms = bk.latestScanAt?.getTime() ?? null;
      if (ms != null && (mostRecentScanMs === null || ms > mostRecentScanMs)) {
        mostRecentScanMs = ms;
      }
    }

    rows.sort(rankRows);
    const visible = rows.slice(0, MAX_KEYWORDS);

    // Top 5 by raw search volume · Maria's "where the demand is" lens.
    // Sorted desc; keywords without a known volume (rare) sink to the
    // end. Slice 5 · pack slots already populated per row above.
    const topByVolume = [...rows]
      .filter((r) => (r.searchVolume ?? 0) > 0)
      .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
      .slice(0, 5);

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

    // 4) Demand-side + supply-side totals + rank-bucket breakdown.
    //    Uses the FULL row set (not visible-trimmed) so the totals are
    //    honest even when the table is capped at MAX_KEYWORDS.
    const totals = computeTotals(rows);

    // 5) Cell-aggregated GAPS · keywords competitors in Maria's
    //    (city, country) cell rank for that she does NOT. Zero new
    //    API calls · derived entirely from existing BusinessKeyword
    //    data.
    const searchGaps = await buildSearchGaps({
      ownBusinessId: own.id,
      ownKeywordIds: new Set(own.businessKeywords.map((bk) => bk.keywordId)),
      city: own.city,
      country: own.country,
    });

    // 6) Competitor leaderboard for the cell · sum est traffic across
    //    every business's tracked keywords · sort + slice top 10 ·
    //    always include Maria's row.
    const leaderboard = await buildCompetitorLeaderboard({
      ownBusinessId: own.id,
      ownName: own.name,
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
      topByVolume,
      allTrackedKeywords: rows,
      searchGaps,
      lastScanAt:
        mostRecentScanMs != null
          ? new Date(mostRecentScanMs)
          : (own.searchScanLastAt ?? null),
      totalEstPatientsLost,
      topQuickWins,
      totalSearchVolume: totals.totalSearchVolume,
      totalEstimatedVisits: totals.totalEstimatedVisits,
      rankBuckets: totals.rankBuckets,
      competitorLeaderboard: leaderboard.rows,
      competitorLeaderboardOwnRank: leaderboard.ownRank,
      competitorLeaderboardTotal: leaderboard.total,
    };
  } catch (err) {
    console.error("getSmbSearchData failed", err);
    return EMPTY_SMB_SEARCH;
  }
}

/**
 * Compute the headline totals + the Top-3 / Top-10 / 11+ rank-bucket
 * breakdown across Maria's tracked keywords. Uses the BEST of
 * (Maps rank, organic rank) per keyword so the bucket reflects
 * "did Google show me anywhere?", not which surface.
 *
 * Pure function · server-component-safe · no DB.
 */
function computeTotals(rows: readonly KeywordRow[]): {
  totalSearchVolume: number;
  totalEstimatedVisits: number;
  rankBuckets: RankBucket[];
} {
  const top3: RankBucket = {
    key: "top_3",
    keywordCount: 0,
    totalSearchVolume: 0,
    estimatedVisits: 0,
  };
  const top10: RankBucket = {
    key: "top_10",
    keywordCount: 0,
    totalSearchVolume: 0,
    estimatedVisits: 0,
  };
  const below10: RankBucket = {
    key: "below_10",
    keywordCount: 0,
    totalSearchVolume: 0,
    estimatedVisits: 0,
  };

  let totalSearchVolume = 0;
  let totalEstimatedVisits = 0;
  for (const r of rows) {
    const vol = r.searchVolume ?? 0;
    totalSearchVolume += vol;
    // Each row's estVisits is already DfS-truth (or CTR-fallback) ·
    // sum without re-computing.
    const visits = r.estVisits;
    totalEstimatedVisits += visits;

    const rank = bestRank(r.localPackRank, r.organicRank);
    if (rank != null && rank <= 3) {
      top3.keywordCount += 1;
      top3.totalSearchVolume += vol;
      top3.estimatedVisits += visits;
    } else if (rank != null && rank <= 10) {
      top10.keywordCount += 1;
      top10.totalSearchVolume += vol;
      top10.estimatedVisits += visits;
    } else {
      below10.keywordCount += 1;
      below10.totalSearchVolume += vol;
      // Visits at rank > 10 are negligible · keep contribution but
      // expect the number to be tiny.
      below10.estimatedVisits += visits;
    }
  }

  return {
    totalSearchVolume,
    totalEstimatedVisits,
    rankBuckets: [top3, top10, below10],
  };
}

/**
 * Build the cell-wide competitor leaderboard · top 10 businesses in
 * Maria's (city, country) cell ranked by Σ latestEstTrafficUsd.
 * Maria's own row is included · always at her true position.
 *
 * If Maria is OUTSIDE the top 10, we still return her row appended
 * at the end as the 11th visible row so she sees her position.
 *
 * Returns null-rank when the cell has no businesses with
 * BusinessKeyword data yet (e.g. The Injectionist is first to scan).
 */
async function buildCompetitorLeaderboard(input: {
  ownBusinessId: string;
  ownName: string;
  city: string | null;
  country: string | null;
}): Promise<{
  rows: CompetitorRow[];
  ownRank: number | null;
  total: number;
}> {
  if (!input.city || !input.country) {
    return { rows: [], ownRank: null, total: 0 };
  }

  // Pull ALL businesses in cell + their per-keyword traffic value.
  // We do this with a single findMany grouped by businessId so we
  // can aggregate in memory · faster than N round-trips.
  const cellBusinesses = await prisma.business.findMany({
    where: {
      city: input.city,
      country: input.country,
      isActive: true,
    },
    select: {
      id: true,
      name: true,
      businessKeywords: {
        select: {
          latestEstTrafficUsd: true,
          latestEstMonthlyVisits: true,
          latestOrganicRank: true,
          latestMapsRank: true,
          keyword: { select: { searchVolume: true } },
        },
        take: 500, // bounded per business
      },
    },
    take: 500,
  });

  // Industry-baseline local conversion rate: ~2% of visits convert
  // into bookings/customers. Used to turn "visits/mo" into the
  // Maria-friendly "customers/mo" column.
  const LOCAL_CONVERSION_RATE = 0.02;

  // Aggregate per business.
  const aggregated: Array<{
    id: string;
    name: string;
    estTrafficUsd: number;
    totalSearchVolume: number;
    keywordCount: number;
    topThreeCount: number;
    estMonthlyCustomers: number;
  }> = [];
  for (const b of cellBusinesses) {
    if (b.businessKeywords.length === 0) continue;
    let estTraffic = 0;
    let searchVolume = 0;
    let topThree = 0;
    let visits = 0;
    for (const bk of b.businessKeywords) {
      estTraffic += bk.latestEstTrafficUsd ?? 0;
      searchVolume += bk.keyword?.searchVolume ?? 0;
      const r = bestRank(bk.latestMapsRank, bk.latestOrganicRank);
      if (r != null && r <= 3) topThree += 1;
      // Visits = DfS truth when set, CTR fallback otherwise.
      visits +=
        bk.latestEstMonthlyVisits != null
          ? bk.latestEstMonthlyVisits
          : (bk.keyword?.searchVolume ?? 0) * ctrForBestRank(r);
    }
    aggregated.push({
      id: b.id,
      name: b.name,
      estTrafficUsd: estTraffic,
      totalSearchVolume: searchVolume,
      keywordCount: b.businessKeywords.length,
      topThreeCount: topThree,
      estMonthlyCustomers: Math.round(visits * LOCAL_CONVERSION_RATE),
    });
  }

  if (aggregated.length === 0) {
    return { rows: [], ownRank: null, total: 0 };
  }

  // Sort by estMonthlyCustomers desc · tiebreak by topThreeCount desc.
  // We sort by customers (not raw $ traffic) because that's the column
  // Maria sees · keep the rank order honest to her display.
  aggregated.sort((a, b) => {
    if (b.estMonthlyCustomers !== a.estMonthlyCustomers) {
      return b.estMonthlyCustomers - a.estMonthlyCustomers;
    }
    return b.topThreeCount - a.topThreeCount;
  });

  const ownIndex = aggregated.findIndex((a) => a.id === input.ownBusinessId);
  const ownRank = ownIndex >= 0 ? ownIndex + 1 : null;
  const total = aggregated.length;

  const sliced = aggregated.slice(0, COMPETITOR_LEADERBOARD_SIZE);

  // If Maria is outside the visible top-N, append her as the (N+1)th
  // row so she always sees her position in context.
  const ownInSlice = sliced.some((a) => a.id === input.ownBusinessId);
  const appendOwn = !ownInSlice && ownIndex >= 0 ? [aggregated[ownIndex]] : [];

  const rows: CompetitorRow[] = [...sliced, ...appendOwn].map((a, i) => {
    const isOwn = a.id === input.ownBusinessId;
    return {
      id: a.id,
      // Use the actual rank, not the slice index, when this is Maria's
      // appended row (it'll be > 10).
      rank: isOwn ? (ownRank ?? i + 1) : i + 1,
      kind: isOwn ? "you" : "competitor",
      name: isOwn ? input.ownName : a.name,
      estTrafficUsd: a.estTrafficUsd,
      totalSearchVolume: a.totalSearchVolume,
      keywordCount: a.keywordCount,
      topThreeCount: a.topThreeCount,
      estMonthlyCustomers: a.estMonthlyCustomers,
    };
  });

  return { rows, ownRank, total };
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
