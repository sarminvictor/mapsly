/**
 * S.6.4 · cell-wide keyword pool · sortable + paginated + filterable
 * on the CLIENT for smooth interaction (Viktor 2026-05-28).
 *
 * Returns every keyword ANY business in the (city, country) cell has
 * a BusinessKeyword row for · unioned and deduped. Maria's ranks come
 * along when she has them. Server returns all rows in one go; the
 * KeywordVisibilityTable client component handles sort + filter +
 * pagination locally so toggling/sorting doesn't reload the page.
 *
 * Cap at 500 rows for payload sanity · 200-ish is the typical Calgary
 * cell size after the ranked_keywords + templates pipeline.
 */

import prisma from "@/lib/prisma";

import { locationCodeForCountry } from "@/modules/reviews/persist-helpers";

const HARD_CAP = 500;

export interface CellKeywordTableInput {
  /** Maria's business id · used to look up HER ranks. */
  ownBusinessId: string;
  /** Cell · businesses in this (city, country) form the keyword pool. */
  city: string | null;
  country: string | null;
}

export interface CellKeywordTableRow {
  id: string;
  keyword: string;
  searchVolume: number | null;
  /** Maria's Maps rank for this keyword · null if she's not ranked or
   *  we haven't scanned Maps for this keyword (Maps only runs on the
   *  templated subset). */
  mapsRank: number | null;
  /** Maria's organic rank · null if she's not ranked in the top 100. */
  organicRank: number | null;
  /** True when this keyword came from a "service" template (e.g.
   *  "belkyra calgary"). Drives the "your service" badge. */
  isServiceKeyword: boolean;
}

export interface CellKeywordTableResult {
  rows: CellKeywordTableRow[];
  /** Industry label for the table heading · from Maria's business
   *  category, falling back to the first cell business if missing. */
  industryLabel: string | null;
  /** True when Maria ranks (Maps OR organic) for at least one row
   *  in the cell pool. Drives the empty-filtered state copy. */
  anyRankForMe: boolean;
}

export async function getCellKeywordTable(
  input: CellKeywordTableInput,
): Promise<CellKeywordTableResult> {
  const empty: CellKeywordTableResult = {
    rows: [],
    industryLabel: null,
    anyRankForMe: false,
  };

  if (!input.city || !input.country) return empty;

  const locationCode = locationCodeForCountry(input.country);

  // 1. Get every Keyword that ANY cell business has a non-lost
  //    BusinessKeyword row for (union, deduped by Keyword.id). Cap
  //    at HARD_CAP rows by search volume desc. The `isLost: false`
  //    filter prevents stale "she dropped out of organic" rows from
  //    polluting the cell pool (caveat #1 fix · S.6.6).
  const cellKeywords = await prisma.keyword.findMany({
    where: {
      locationCode,
      language: "en",
      businessKeywords: {
        some: {
          isLost: false,
          business: {
            city: input.city,
            country: input.country,
            isActive: true,
          },
        },
      },
    },
    orderBy: { searchVolume: { sort: "desc", nulls: "last" } },
    take: HARD_CAP,
    select: { id: true, keyword: true, searchVolume: true },
  });

  if (cellKeywords.length === 0) return empty;

  // 2. Pull Maria's BusinessKeyword rows for any of these keywords ·
  //    one keyword can be ranked source AND/OR templated · we just
  //    want her ranks + the templateOrigin flag.
  const keywordIds = cellKeywords.map((k) => k.id);
  const myRows = await prisma.businessKeyword.findMany({
    where: {
      businessId: input.ownBusinessId,
      keywordId: { in: keywordIds },
      isLost: false,
    },
    select: {
      keywordId: true,
      latestMapsRank: true,
      latestOrganicRank: true,
      templateOrigin: true,
    },
  });
  const myRowsByKw = new Map(myRows.map((r) => [r.keywordId, r]));

  // 3. Merge into table rows.
  const rows: CellKeywordTableRow[] = cellKeywords.map((k) => {
    const mine = myRowsByKw.get(k.id) ?? null;
    return {
      id: k.id,
      keyword: k.keyword,
      searchVolume: k.searchVolume,
      mapsRank: mine?.latestMapsRank ?? null,
      organicRank: mine?.latestOrganicRank ?? null,
      isServiceKeyword: mine?.templateOrigin === "service",
    };
  });

  const anyRankForMe = rows.some(
    (r) => r.mapsRank != null || r.organicRank != null,
  );

  // 4. Heading label · use Maria's business category if it's in the
  //    cell · falls back to whatever business shows up first.
  const ownBiz = await prisma.business.findUnique({
    where: { id: input.ownBusinessId },
    select: { category: true },
  });
  const industryLabel = ownBiz?.category ?? null;

  return { rows, industryLabel, anyRankForMe };
}
