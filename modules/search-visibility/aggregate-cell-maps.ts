// modules/search-visibility/aggregate-cell-maps.ts
//
// S.6.2 · cell-wide SERP scan · Maps AND organic in one pass.
//
// Naming note: file/function still says "maps" for API stability —
// downstream cron callback and dispatcher reference these names — but
// since v0.13.2 we also run the organic SERP scan inline. Organic is
// cell-shareable for the SAME reason Maps is: one organic query for
// "botox calgary" returns the top 100 with domains, we match every
// cell business's normalized website domain in a single pass. Same
// O(unique cells × keywords) cost shape · adds ~$0.024/cell.
//
// Per cell, per keyword (~$0.004):
//   1. serp_local_pack    Maps Pack scan, match item.cid     → SerpResult(kind=MAPS)
//   2. serp_organic       organic scan, match item.domain    → SerpResult(kind=ORGANIC)
//
// Cell-aggregate Maps history:
//   v0.12.x (S.5): top-N keywords by Σ(latestEstTrafficUsd) — race
//                  condition where cell could fire before discovery
//                  populated rows (items=0).
//   v0.13.x (S.6): keyword set = union of cell business templates ·
//                  race fixed by construction (no dependency on
//                  BusinessKeyword rows existing first).
//   v0.13.2:        also runs organic SERP inline so latestOrganicRank
//                  populates · was missing in S.6, blocking the
//                  "Top 3 in Search" State Bar cell from showing
//                  honest numbers.
//
// Caller: dispatchSearchScan enqueues ONE Worker job per unique cell.
// The Worker callback `/api/internal/trigger-search-scan` (mode=cell)
// invokes this function inside withCronRun.

import { revalidateTag } from "next/cache";

import prisma from "@/lib/prisma";
import { serpLocalPack } from "@/services/dataforseo";
import { buildKeywordSetForCell } from "@/modules/local-intent/build-keyword-set";
import { locationCodeForCountry } from "@/modules/reviews/persist-helpers";

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
   * Legacy · ignored since S.6 (keyword count is now determined by the
   * template registry per industry · ~12 for medspa, expands as we
   * seed more industries). Kept for caller-signature compatibility.
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

const RADIUS_KM = 25;

export async function aggregateCellMaps(
  input: AggregateCellMapsInput,
): Promise<AggregateCellMapsResult> {
  // 1) Find the businesses in this cell. Need CID for Maps matching.
  //    We gate on googleCid here because Maps results can only be
  //    correlated via CID (organic ranks come from ranked_keywords
  //    per-biz, not this step).
  const cellBusinesses = await prisma.business.findMany({
    where: {
      city: input.city,
      country: input.country,
      isActive: true,
      googleCid: { not: null },
    },
    select: {
      id: true,
      googleCid: true,
      ownerUserId: true,
      category: true,
      city: true,
      country: true,
    },
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

  // 2) Build the cell's local-intent keyword set · union of every
  //    business's category × city templates. Source of truth is the
  //    `modules/local-intent` registry · no DB read needed for the
  //    keyword pool itself, removing the v0.12.x race condition where
  //    cell-aggregate could fire before BusinessKeyword rows existed.
  const expanded = buildKeywordSetForCell(
    cellBusinesses.map((b) => ({ category: b.category, city: b.city })),
  );

  if (expanded.length === 0) {
    // No business in this cell maps to a templated industry yet (e.g.
    // entire cell is restaurants while the restaurant industry stub is
    // empty). Skip cleanly.
    return {
      city: input.city,
      country: input.country,
      cellBusinessCount: cellBusinesses.length,
      keywordsQueried: 0,
      serpRowsWritten: 0,
      matchedBusinessIds: [],
    };
  }

  // 3) Ensure Keyword rows exist for every templated keyword so we can
  //    write SerpResult + cache latestMapsRank on BusinessKeyword. We
  //    upsert here because discover-local-intent may not have run yet
  //    for this cell · cell-aggregate is now self-sufficient.
  const locationCode = locationCodeForCountry(input.country);
  const language = "en";
  const keywordTextToRow = new Map<
    string,
    { id: string; keyword: string; language: string }
  >();
  for (const kw of expanded) {
    const row = await prisma.keyword.upsert({
      where: {
        keyword_locationCode_language: {
          keyword: kw.keyword,
          locationCode,
          language,
        },
      },
      create: {
        keyword: kw.keyword,
        locationCode,
        language,
        refreshedAt: new Date(),
      },
      update: {}, // existence-only; volume/CPC owned by discover-local-intent
      select: { id: true, keyword: true, language: true },
    });
    keywordTextToRow.set(kw.keyword, row);
  }
  const keywordById = new Map(
    Array.from(keywordTextToRow.values()).map((k) => [k.id, k]),
  );
  const keywordIds = Array.from(keywordById.keys());

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

        // Refresh cached latestMapsRank on the BusinessKeyword join.
        // Cell-aggregate is self-sufficient · if discover-local-intent
        // hasn't run for this biz yet, CREATE the row so Maria sees
        // her Maps rank on /search even before her per-biz organic
        // discovery completes. templateOrigin defaults to "core" ·
        // discover-local-intent will correct it via update on its run.
        const expandedKw = expanded.find((e) => e.keyword === kw.keyword);
        await prisma.businessKeyword.upsert({
          where: {
            businessId_keywordId: { businessId, keywordId: kw.id },
          },
          create: {
            businessId,
            keywordId: kw.id,
            source: "template",
            templateOrigin: expandedKw?.origin ?? "core",
            latestMapsRank: mapsRank,
            latestScanAt: scannedAt,
          },
          update: {
            latestMapsRank: mapsRank,
            latestScanAt: scannedAt,
            // Clear isLost · this biz IS in Maps for this keyword
            // this scan, even if discover-local-intent's prior
            // stale-mark sweep had flagged it from a missing
            // organic match (caveat #1 fix · S.6.6).
            isLost: false,
          },
        });
      }
    } catch (err) {
      console.warn(
        `[aggregate-cell-maps] Maps keyword="${kw.keyword}" failed:`,
        err instanceof Error ? err.message : err,
      );
      // Continue · one keyword failure shouldn't kill the whole cell.
    }

    // S.6.2 (revised) · organic SERP scan REMOVED.
    //   ranked_keywords (called by discover-local-intent.ts) already
    //   returns the biz's organic rank per keyword for free. Running
    //   serp_organic per keyword here would be a redundant $0.024/cell.
    //   Per Viktor's directive: ranked_keywords = main source for
    //   keywords + google search; serp_local_pack = Maps only.
  }

  // 4) Invalidate the SMB-search cache for every business owner whose
  //    rank data we just updated. Cache profile "minutes" so the page
  //    reflects fresh data on the next render but still benefits from
  //    short-window caching. Skips businesses without an owner (Maria
  //    hasn't claimed the listing yet).
  const ownersToRevalidate = new Set<string>();
  for (const b of cellBusinesses) {
    if (matchedBusinessIds.has(b.id) && b.ownerUserId) {
      ownersToRevalidate.add(b.ownerUserId);
    }
  }
  for (const userId of ownersToRevalidate) {
    revalidateTag(`smb-search-${userId}`, "minutes");
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
