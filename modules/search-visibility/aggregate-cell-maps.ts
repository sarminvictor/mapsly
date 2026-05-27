// modules/search-visibility/aggregate-cell-maps.ts
//
// Cell-aggregated Maps SERP queries (S.5 / S.1 plan v2 cost-saver).
//
// Why this exists:
//   ranked_keywords gives us organic ranks per business. Maps positions
//   (the local 3-pack) are a separate signal. Naive approach would be
//   "for each business × each top keyword, run a Maps query" · cost
//   scales O(businesses × keywords).
//
//   Optimization · ONE Maps query for a keyword covers ALL businesses
//   in that geographic cell at once. We match item.cid against our
//   indexed Business.googleCid and upsert SerpResult(kind=MAPS) for
//   each match. Cost scales O(unique cells × top keywords).
//
// For the Calgary cell (~25 businesses, 30 aggregated top keywords):
//   30 queries × $0.002 = $0.06 vs 25×30 × $0.002 = $1.50 per scan.
//
// Caller: dispatchSearchScan enqueues ONE Worker job per unique cell.
// The Worker callback `/api/internal/trigger-search-scan` (mode=cell)
// invokes this function inside withCronRun.

import prisma from "@/lib/prisma";
import { serpLocalPack } from "@/services/dataforseo";

export interface AggregateCellMapsInput {
  /**
   * Identifies the geographic cell. We don't have a formal Cell model
   * for this — we identify a cell as (city, country) pair. All businesses
   * matching that pair are "in the cell."
   */
  city: string;
  country: string;
  /** GPS centroid for the Maps query · 25km radius. */
  centroidLat: number;
  centroidLng: number;
  /**
   * How many top-value keywords to query Maps for. 30 is the default
   * per the plan; bump if you want broader coverage at slightly more
   * cost ($0.002 per extra).
   */
  topN?: number;
}

export interface AggregateCellMapsResult {
  city: string;
  country: string;
  /** How many businesses we matched in this cell (have Business.googleCid). */
  cellBusinessCount: number;
  /** Keywords we ran a Maps query for. */
  keywordsQueried: number;
  /** Total SerpResult(kind=MAPS) rows we wrote. */
  serpRowsWritten: number;
  /** Per-business matches: which of our businesses appeared in which keyword's results. */
  matchedBusinessIds: string[];
}

const DEFAULT_TOP_N = 30;
const RADIUS_KM = 25;

export async function aggregateCellMaps(
  input: AggregateCellMapsInput,
): Promise<AggregateCellMapsResult> {
  const topN = input.topN ?? DEFAULT_TOP_N;

  // 1) Find the businesses in this cell that have a googleCid · we can
  //    only correlate Maps results by CID. Active + qualified only.
  const cellBusinesses = await prisma.business.findMany({
    where: {
      city: input.city,
      country: input.country,
      isActive: true,
      googleCid: { not: null },
    },
    select: { id: true, googleCid: true },
  });

  if (cellBusinesses.length === 0) {
    return {
      city: input.city,
      country: input.country,
      cellBusinessCount: 0,
      keywordsQueried: 0,
      serpRowsWritten: 0,
      matchedBusinessIds: [],
    };
  }

  const cidToBusinessId = new Map<string, string>();
  for (const b of cellBusinesses) {
    if (b.googleCid) cidToBusinessId.set(b.googleCid, b.id);
  }

  // 2) Pick top-N keywords by Σ (latestEstTrafficUsd) across all
  //    BusinessKeyword rows for these businesses. groupBy on keywordId,
  //    sort by sum desc, take top N.
  const businessIds = cellBusinesses.map((b) => b.id);
  const groups = await prisma.businessKeyword.groupBy({
    by: ["keywordId"],
    where: { businessId: { in: businessIds } },
    _sum: { latestEstTrafficUsd: true },
    orderBy: { _sum: { latestEstTrafficUsd: "desc" } },
    take: topN,
  });

  if (groups.length === 0) {
    return {
      city: input.city,
      country: input.country,
      cellBusinessCount: cellBusinesses.length,
      keywordsQueried: 0,
      serpRowsWritten: 0,
      matchedBusinessIds: [],
    };
  }

  const keywordIds = groups.map((g) => g.keywordId);
  const keywords = await prisma.keyword.findMany({
    where: { id: { in: keywordIds } },
    select: { id: true, keyword: true, language: true },
  });
  const keywordById = new Map(keywords.map((k) => [k.id, k]));

  // 3) For each keyword · run one Maps query GPS-anchored to the cell
  //    centroid · match items.cid against our cell businesses · upsert
  //    SerpResult(kind=MAPS).
  const coord = `${input.centroidLat},${input.centroidLng},${RADIUS_KM}`;
  const scannedAt = new Date();
  let serpRowsWritten = 0;
  const matchedBusinessIds = new Set<string>();

  for (const keywordId of keywordIds) {
    const kw = keywordById.get(keywordId);
    if (!kw) continue;

    try {
      const res = await serpLocalPack({
        keyword: kw.keyword,
        location_coordinate: coord,
        language_code: kw.language,
        depth: 20,
      });

      // Capture top-3 pack names · the per-keyword competitive view.
      const top3Names: (string | null)[] = [null, null, null];
      let idx = 0;
      for (const item of res.items) {
        if (idx < 3 && item.title) top3Names[idx++] = item.title;
        const cid = typeof item.cid === "string" ? item.cid : null;
        if (!cid) continue;
        const businessId = cidToBusinessId.get(cid);
        if (!businessId) continue;
        const mapsRank = item.rank_group ?? null;

        matchedBusinessIds.add(businessId);

        // Insert SerpResult(MAPS) for time-series · NOT upsert because
        // each scan is a new point in time.
        await prisma.serpResult.create({
          data: {
            keywordId: kw.id,
            businessId,
            scannedAt,
            kind: "MAPS",
            localPackRank: mapsRank,
            landingUrl: typeof item.url === "string" ? item.url : null,
            pack1Name: top3Names[0],
            pack2Name: top3Names[1],
            pack3Name: top3Names[2],
          },
        });
        serpRowsWritten += 1;

        // Refresh cached latestMapsRank on the BusinessKeyword join · keeps
        // table queries cheap.
        await prisma.businessKeyword.updateMany({
          where: { businessId, keywordId: kw.id },
          data: { latestMapsRank: mapsRank, latestScanAt: scannedAt },
        });
      }
    } catch (err) {
      console.warn(
        `[aggregate-cell-maps] keyword="${kw.keyword}" failed:`,
        err instanceof Error ? err.message : err,
      );
      // Continue · one keyword failure shouldn't kill the whole cell.
    }
  }

  return {
    city: input.city,
    country: input.country,
    cellBusinessCount: cellBusinesses.length,
    keywordsQueried: keywordIds.length,
    serpRowsWritten,
    matchedBusinessIds: Array.from(matchedBusinessIds),
  };
}
