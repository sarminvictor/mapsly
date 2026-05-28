// modules/search-visibility/aggregate-cell-maps.ts
//
// S.6 · architecture C · cell-wide Maps SERP scan over the
// local-intent template set.
//
// Why this exists:
//   Maps positions (the local 3-pack) are location-anchored · ONE Maps
//   query for "botox calgary" covers EVERY business in the Calgary
//   cell at once. We match item.cid against Business.googleCid and
//   write SerpResult(kind=MAPS) per matched business + the top-3 pack
//   names for the competitive view.
//
// Keyword source change (vs S.5):
//   v0.12.x (S.5): top-N keywords by Σ(latestEstTrafficUsd) across
//                  the cell's BusinessKeyword rows. Suffered from a
//                  race · cell-aggregate could fire before discovery
//                  populated the rows, producing items=0 (INC-search-
//                  visibility-race · 2026-05-27).
//   v0.13.x (S.6): keyword set = union of every cell business's
//                  local-intent templates (industry × city × services).
//                  No dependency on BusinessKeyword existing first ·
//                  race fixed by construction. The set is the SAME one
//                  discover-local-intent persisted, so the cron can
//                  fire either step in any order.
//
// For Calgary medspa cell (~25 biz, ~12 templates): 12 × $0.002 =
// $0.024 vs $1.50 if we'd done per-biz. Cell-aggregate optimization
// preserved.
//
// Caller: dispatchSearchScan enqueues ONE Worker job per unique cell.
// The Worker callback `/api/internal/trigger-search-scan` (mode=cell)
// invokes this function inside withCronRun.

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
  // 1) Find the businesses in this cell that have a googleCid · we can
  //    only correlate Maps results by CID. Active + qualified only.
  const cellBusinesses = await prisma.business.findMany({
    where: {
      city: input.city,
      country: input.country,
      isActive: true,
      googleCid: { not: null },
    },
    select: { id: true, googleCid: true, category: true, city: true, country: true },
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
          },
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
