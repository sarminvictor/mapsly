// modules/search-visibility/discover-keywords.ts
//
// Per-business ranked_keywords discovery. Called by:
//   - Admin "Run SERP scan" button (single + bulk) on /admin/businesses
//   - Weekly cron (S.4 · paid-cell gated · ships in PR2)
//   - Worker callback /api/internal/trigger-search-scan
//
// For one business:
//   1. Skip if no website (can't query DfS without a domain)
//   2. Call ranked_keywords for the domain + the business's country location_code
//   3. Upsert Keyword rows (one per unique keyword + locationCode + language)
//   4. Upsert BusinessKeyword rows (business × keyword, with latest rank +
//      movement flags + estimated traffic value)
//   5. Upsert SerpResult(kind=ORGANIC) rows for time-series tracking
//   6. Stamp Business.searchScanLastAt = now
//
// MUST be called inside an open CronRun (assertCronContext via the
// downstream rankedKeywords adapter). The caller (Worker callback) is
// responsible for the withCronRun wrapper.
//
// Cost: ~$0.013 per business (verified on The Injectionist · 742 keywords
// returned). Cached 24h at the adapter layer so admin re-trigger within
// same day is free.

import prisma from "@/lib/prisma";
import { rankedKeywords } from "@/services/dataforseo";
import type { RankedKeywordsItem } from "@/services/dataforseo";
import { normalizeDomain } from "@/lib/url/normalize-domain";

import { locationCodeForCountry } from "@/modules/reviews/persist-helpers";

export interface DiscoverKeywordsResult {
  businessId: string;
  /** Skip-reason if discovery didn't run; "ran" otherwise. */
  status: "ran" | "no_website" | "no_business" | "no_results";
  /** Total ranked-keyword rows returned by DfS. */
  itemsReturned: number;
  /** Rows we persisted as BusinessKeyword (after dedup + null-domain skips). */
  keywordsTracked: number;
  /** Aggregate metrics from the response · null on skip. */
  metrics: {
    pos1: number;
    pos2to3: number;
    pos4to10: number;
    etv: number;
    estimatedPaidTrafficCost: number;
    isNew: number;
    isUp: number;
    isDown: number;
    isLost: number;
  } | null;
}

/**
 * Cap on per-business rows we persist. DfS sometimes returns 1000+ for
 * established domains; we cap so the BusinessKeyword table doesn't grow
 * unbounded. The cap is on rank-sorted rows so we keep the best 200.
 */
const MAX_KEYWORDS_PER_BUSINESS = 200;

export async function discoverKeywordsForBusiness(
  businessId: string,
): Promise<DiscoverKeywordsResult> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      website: true,
      country: true,
    },
  });

  if (!business) {
    return zeroResult(businessId, "no_business");
  }

  const domain = normalizeDomain(business.website);
  if (!domain) {
    return zeroResult(businessId, "no_website");
  }

  const locationCode = locationCodeForCountry(business.country);
  const language = "en"; // S.1 ships English-only; widen in S.6 when i18n lands

  const res = await rankedKeywords({
    target: domain,
    location_code: locationCode,
    language_code: language,
    limit: 1000,
    ignore_synonyms: true,
    filters: [["ranked_serp_element.serp_item.rank_group", "<=", 50]],
    order_by: ["ranked_serp_element.serp_item.rank_group,asc"],
  });

  if (res.itemsCount === 0) {
    // Still mark the scan as run so the cron picks freshly-scanned
    // businesses last on the next tick.
    await prisma.business.update({
      where: { id: businessId },
      data: { searchScanLastAt: new Date() },
    });
    return {
      businessId,
      status: "no_results",
      itemsReturned: 0,
      keywordsTracked: 0,
      metrics: res.organicMetrics,
    };
  }

  // Cap to top MAX_KEYWORDS_PER_BUSINESS by rank_group ascending.
  // Items already arrive sorted because we passed order_by, but defense
  // in depth.
  const items = res.items
    .filter(
      (i) =>
        i.keyword_data?.keyword &&
        i.ranked_serp_element?.serp_item?.rank_group != null,
    )
    .slice(0, MAX_KEYWORDS_PER_BUSINESS);

  const scannedAt = new Date();
  let persisted = 0;

  for (const item of items) {
    const persistedRow = await persistOne(
      businessId,
      locationCode,
      language,
      scannedAt,
      item,
    );
    if (persistedRow) persisted += 1;
  }

  await prisma.business.update({
    where: { id: businessId },
    data: { searchScanLastAt: scannedAt },
  });

  return {
    businessId,
    status: "ran",
    itemsReturned: res.itemsCount,
    keywordsTracked: persisted,
    metrics: res.organicMetrics,
  };
}

// ---- internals -----------------------------------------------------------

function zeroResult(
  businessId: string,
  status: DiscoverKeywordsResult["status"],
): DiscoverKeywordsResult {
  return {
    businessId,
    status,
    itemsReturned: 0,
    keywordsTracked: 0,
    metrics: null,
  };
}

async function persistOne(
  businessId: string,
  locationCode: number,
  language: string,
  scannedAt: Date,
  item: RankedKeywordsItem,
): Promise<boolean> {
  const keywordText = item.keyword_data.keyword.trim().toLowerCase();
  if (!keywordText) return false;

  const serp = item.ranked_serp_element?.serp_item ?? null;
  const rank = serp?.rank_group ?? null;
  if (rank == null) return false;

  const kinfo = item.keyword_data.keyword_info ?? null;
  const searchVolume = kinfo?.search_volume ?? null;
  const cpc = kinfo?.cpc ?? null;
  const competition = kinfo?.competition_level ?? null;

  // 1. Upsert Keyword (unique on keyword + locationCode + language)
  const keyword = await prisma.keyword.upsert({
    where: {
      keyword_locationCode_language: {
        keyword: keywordText,
        locationCode,
        language,
      },
    },
    create: {
      keyword: keywordText,
      locationCode,
      language,
      searchVolume,
      cpc,
      competition,
      refreshedAt: scannedAt,
    },
    update: {
      // Refresh embedded metrics opportunistically · ranked_keywords
      // returns current values so we keep them fresh.
      searchVolume: searchVolume ?? undefined,
      cpc: cpc ?? undefined,
      competition: competition ?? undefined,
      refreshedAt: scannedAt,
    },
    select: { id: true },
  });

  // 2. DfS-truth traffic estimates · we prefer their numbers over our
  //    CTR curve. `etv` = estimated monthly clicks at this rank;
  //    `estimated_paid_traffic_cost` = USD value of those clicks at the
  //    keyword's CPC. Both come from DfS's own model, calibrated on
  //    real SERP click data.
  //
  //    Fallback only when DfS omits the value (rare · happens on some
  //    long-tail rows). The fallback uses the SAME CTR curve we used
  //    pre-v0.12.11 so pre-existing rows stay consistent until refreshed.
  const etv = serp?.etv ?? null;
  const dfsTrafficCost = serp?.estimated_paid_traffic_cost ?? null;

  const estMonthlyVisits =
    etv != null
      ? etv
      : searchVolume != null
        ? searchVolume * fallbackCtrForRank(rank)
        : null;

  const estTrafficUsd =
    dfsTrafficCost != null
      ? dfsTrafficCost
      : searchVolume != null && cpc != null
        ? searchVolume * cpc * fallbackCtrForRank(rank)
        : null;

  // 3. Upsert BusinessKeyword (unique on businessId + keywordId)
  await prisma.businessKeyword.upsert({
    where: {
      businessId_keywordId: { businessId, keywordId: keyword.id },
    },
    create: {
      businessId,
      keywordId: keyword.id,
      source: "ranked",
      latestOrganicRank: rank,
      latestMapsRank: null,
      latestLandingUrl: serp?.url ?? null,
      latestEstTrafficUsd: estTrafficUsd,
      latestEstMonthlyVisits: estMonthlyVisits,
      latestScanAt: scannedAt,
      isNew: serp?.is_new === true,
      isUp: serp?.is_up === true,
      isDown: serp?.is_down === true,
      isLost: false,
    },
    update: {
      latestOrganicRank: rank,
      latestLandingUrl: serp?.url ?? null,
      latestEstTrafficUsd: estTrafficUsd,
      latestEstMonthlyVisits: estMonthlyVisits,
      latestScanAt: scannedAt,
      isNew: serp?.is_new === true,
      isUp: serp?.is_up === true,
      isDown: serp?.is_down === true,
      // isLost cleared on every successful re-scan (DfS doesn't surface
      // it on the returned items · the metric only counts at aggregate).
      isLost: false,
    },
  });

  // 4. Insert SerpResult row for time-series tracking
  await prisma.serpResult.create({
    data: {
      keywordId: keyword.id,
      businessId,
      scannedAt,
      kind: "ORGANIC",
      organicRank: rank,
      organicAbsRank: serp?.rank_absolute ?? null,
      landingUrl: serp?.url ?? null,
    },
  });

  return true;
}

/**
 * FALLBACK CTR by Google organic rank · used ONLY when DfS omits `etv`
 * and `estimated_paid_traffic_cost` (rare, mostly long-tail rows).
 * Source: composite of public 2024–2025 CTR studies (Backlinko, Sistrix).
 *
 * Primary source of truth is DfS — see persistOne() above.
 */
function fallbackCtrForRank(rank: number): number {
  if (rank === 1) return 0.39;
  if (rank === 2) return 0.18;
  if (rank === 3) return 0.1;
  if (rank === 4) return 0.07;
  if (rank === 5) return 0.05;
  if (rank <= 10) return 0.025;
  if (rank <= 20) return 0.008;
  if (rank <= 50) return 0.002;
  return 0.0005;
}
