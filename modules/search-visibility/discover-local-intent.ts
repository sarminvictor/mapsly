// modules/search-visibility/discover-local-intent.ts
//
// S.6.2 (revised) · the canonical per-business discovery pipeline.
//
// PER VIKTOR'S 2026-05-28 DIRECTIVE · `ranked_keywords` is the primary
// keyword + google-search-rank source. Templates are a secondary
// overlay that gives us:
//   1. The Maps-scannable keyword set (city × industry × services)
//   2. The "she should rank for this but doesn't" opportunity set
//      that ranked_keywords can't surface (it only returns keywords
//      she already ranks for organically)
//
// 3-stage pipeline per call:
//
//   STAGE 1 · ranked_keywords (~$0.013)
//     One call · returns up to 200 keywords with rank + volume + CPC
//     + etv + estimated_paid_traffic_cost + movement flags. Upsert
//     BusinessKeyword rows with source="ranked", templateOrigin=null.
//
//   STAGE 2 · template overlay
//     Build industry × city templates (~12 for medspa). For each:
//       - If a ranked row exists for this (biz, keyword) → UPDATE that
//         row to set templateOrigin · keeps source="ranked"
//       - Otherwise → CREATE a pure-template row · source="template",
//         templateOrigin set, all rank fields null until Maps scans
//
//   STAGE 3 · keyword_volume backfill (~$0.001 per gap-keyword)
//     For the pure-template rows created in stage 2 (those NOT in
//     Maria's organic portfolio), call DfS keyword_volume in one
//     batch to fill volume + CPC. Cheap.
//
// The Maps scan is a SEPARATE step (aggregate-cell-maps.ts) that
// runs at the cell level, not per-business. It only scans the
// template set so cost stays bounded.
//
// MUST be called inside an open CronRun · all 3 DfS calls assert
// cron context per `.claude/rules/cost-discipline.md`.

import { revalidateTag } from "next/cache";

import prisma from "@/lib/prisma";
import {
  keywordVolume,
  rankedKeywords,
  type RankedKeywordsItem,
} from "@/services/dataforseo";
import { buildKeywordSetForBusiness } from "@/modules/local-intent/build-keyword-set";
import type { ExpandedKeyword } from "@/modules/local-intent/templates";
import { locationCodeForCountry } from "@/modules/reviews/persist-helpers";
import { normalizeDomain } from "@/lib/url/normalize-domain";

export type DiscoverLocalIntentStatus =
  | "ran"
  | "no_business"
  | "no_city"
  | "no_website"
  | "unknown_industry"
  | "empty_template_set";

export interface DiscoverLocalIntentResult {
  businessId: string;
  status: DiscoverLocalIntentStatus;
  /** Industry the business mapped to (null for skipped). */
  industry: string | null;
  /** Stage 1 · keywords returned by ranked_keywords (capped). */
  rankedKeywordsCount: number;
  /** Stage 2 · template keywords expanded for this biz. */
  templatesBuilt: number;
  /** Stage 2 · templates that matched an existing ranked row · we
   *  just stamped templateOrigin on that row. */
  templatesMatchedRanked: number;
  /** Stage 2 · pure-template rows we created (template keyword not
   *  in Maria's ranked portfolio). */
  templatesCreatedPure: number;
  /** Stage 3 · pure-template keywords for which keyword_volume
   *  returned a non-null search_volume. */
  volumePopulated: number;
}

/** Cap on per-business ranked_keywords rows. DfS sometimes returns
 *  1000+; we cap on rank-sorted top 200 so the BusinessKeyword table
 *  doesn't grow unbounded. */
const MAX_RANKED_PER_BUSINESS = 200;

export async function discoverLocalIntentForBusiness(
  businessId: string,
): Promise<DiscoverLocalIntentResult> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      category: true,
      city: true,
      country: true,
      website: true,
      ownerUserId: true,
    },
  });
  if (!business) return zeroResult(businessId, "no_business");
  if (!business.city) return zeroResult(businessId, "no_city");
  if (!business.website) return zeroResult(businessId, "no_website");

  const locationCode = locationCodeForCountry(business.country);
  const language = "en";
  const scannedAt = new Date();

  // ────────────────────────────────────────────────────────────────
  // STAGE 1 · ranked_keywords · primary discovery
  // ────────────────────────────────────────────────────────────────
  const domain = normalizeDomain(business.website);
  if (!domain) return zeroResult(businessId, "no_website");

  const rankedRes = await rankedKeywords({
    target: domain,
    location_code: locationCode,
    language_code: language,
    limit: 1000,
    ignore_synonyms: true,
    filters: [["ranked_serp_element.serp_item.rank_group", "<=", 50]],
    order_by: ["ranked_serp_element.serp_item.rank_group,asc"],
  });

  const rankedItems = rankedRes.items
    .filter(
      (i) =>
        i.keyword_data?.keyword &&
        i.ranked_serp_element?.serp_item?.rank_group != null,
    )
    .slice(0, MAX_RANKED_PER_BUSINESS);

  /** keyword text (lowercased) → BusinessKeyword we just upserted.
   *  Used by stage 2 to detect template/ranked overlap. */
  const rankedByKeyword = new Map<
    string,
    { businessKeywordId: string; keywordId: string }
  >();

  for (const item of rankedItems) {
    const persisted = await persistRanked({
      businessId,
      locationCode,
      language,
      scannedAt,
      item,
    });
    if (persisted) {
      rankedByKeyword.set(persisted.keywordText, {
        businessKeywordId: persisted.businessKeywordId,
        keywordId: persisted.keywordId,
      });
    }
  }

  // ────────────────────────────────────────────────────────────────
  // STAGE 2 · template overlay
  // ────────────────────────────────────────────────────────────────
  const built = buildKeywordSetForBusiness({
    category: business.category,
    city: business.city,
    serviceFlags: null, // services-detect integration · S.7
  });

  if (!built.industry) {
    // No template overlay possible · ranked_keywords alone is the
    // dataset for this business. Still mark the scan timestamp.
    await prisma.business.update({
      where: { id: business.id },
      data: { searchScanLastAt: scannedAt },
    });
    return {
      businessId: business.id,
      status: "unknown_industry",
      industry: null,
      rankedKeywordsCount: rankedByKeyword.size,
      templatesBuilt: 0,
      templatesMatchedRanked: 0,
      templatesCreatedPure: 0,
      volumePopulated: 0,
    };
  }

  let templatesMatchedRanked = 0;
  let templatesCreatedPure = 0;
  const pureTemplates: ExpandedKeyword[] = [];

  for (const t of built.keywords) {
    const ranked = rankedByKeyword.get(t.keyword);
    if (ranked) {
      // Overlap · stamp templateOrigin on the existing ranked row.
      await prisma.businessKeyword.update({
        where: { id: ranked.businessKeywordId },
        data: { templateOrigin: t.origin },
      });
      templatesMatchedRanked += 1;
    } else {
      // Pure-template row · needs a Keyword row first, then a
      // BusinessKeyword row with no ranks. Stage 3 fills volume.
      pureTemplates.push(t);
    }
  }

  // STAGE 3 · keyword_volume for pure templates (so they have volume).
  let volumePopulated = 0;
  if (pureTemplates.length > 0) {
    const volumes = await fetchVolumes(
      pureTemplates.map((t) => t.keyword),
      locationCode,
      language,
    );

    for (const t of pureTemplates) {
      const vol = volumes.get(t.keyword.toLowerCase()) ?? null;

      // Upsert Keyword + create pure-template BusinessKeyword row.
      const kwRow = await prisma.keyword.upsert({
        where: {
          keyword_locationCode_language: {
            keyword: t.keyword,
            locationCode,
            language,
          },
        },
        create: {
          keyword: t.keyword,
          locationCode,
          language,
          searchVolume: vol?.searchVolume ?? null,
          cpc: vol?.cpc ?? null,
          competition: vol?.competition ?? null,
          refreshedAt: scannedAt,
        },
        update: {
          searchVolume: vol?.searchVolume ?? undefined,
          cpc: vol?.cpc ?? undefined,
          competition: vol?.competition ?? undefined,
          refreshedAt: scannedAt,
        },
        select: { id: true },
      });

      await prisma.businessKeyword.upsert({
        where: {
          businessId_keywordId: {
            businessId: business.id,
            keywordId: kwRow.id,
          },
        },
        create: {
          businessId: business.id,
          keywordId: kwRow.id,
          source: "template",
          templateOrigin: t.origin,
          latestScanAt: scannedAt,
        },
        update: {
          // Don't clobber ranks here · cell-aggregate-maps owns those.
          templateOrigin: t.origin,
          latestScanAt: scannedAt,
        },
      });

      templatesCreatedPure += 1;
      if (vol?.searchVolume != null) volumePopulated += 1;
    }
  }

  // Mark stale rows · any source="ranked" BusinessKeyword for this
  // biz that we DIDN'T touch this scan (latestScanAt < scannedAt)
  // means DfS no longer returns this keyword for her domain → she
  // dropped out of top-50 organic. Flag isLost=true so queries can
  // exclude them · keeps "Top 3 in Search" + leaderboard counts
  // self-healing on re-scan (S.6.6 caveat #1 · Viktor 2026-05-28).
  //
  // Note · persistRanked()'s upsert update path resets isLost=false
  // for every row DfS DID return, so we don't need to un-flag here.
  await prisma.businessKeyword.updateMany({
    where: {
      businessId: business.id,
      source: "ranked",
      latestScanAt: { lt: scannedAt },
    },
    data: { isLost: true },
  });

  await prisma.business.update({
    where: { id: business.id },
    data: { searchScanLastAt: scannedAt },
  });

  // Invalidate the SMB-search cache for this business's owner.
  if (business.ownerUserId) {
    revalidateTag(`smb-search-${business.ownerUserId}`, "minutes");
  }

  return {
    businessId: business.id,
    status: "ran",
    industry: built.industry,
    rankedKeywordsCount: rankedByKeyword.size,
    templatesBuilt: built.keywords.length,
    templatesMatchedRanked,
    templatesCreatedPure,
    volumePopulated,
  };
}

// ---- helpers ------------------------------------------------------------

function zeroResult(
  businessId: string,
  status: DiscoverLocalIntentStatus,
): DiscoverLocalIntentResult {
  return {
    businessId,
    status,
    industry: null,
    rankedKeywordsCount: 0,
    templatesBuilt: 0,
    templatesMatchedRanked: 0,
    templatesCreatedPure: 0,
    volumePopulated: 0,
  };
}

interface VolumeRow {
  searchVolume: number | null;
  cpc: number | null;
  competition: string | null;
}

async function fetchVolumes(
  keywords: string[],
  locationCode: number,
  language: string,
): Promise<Map<string, VolumeRow>> {
  const batch = keywords.slice(0, 1000);
  if (batch.length === 0) return new Map();

  const res = await keywordVolume({
    keywords: batch,
    location_code: locationCode,
    language_code: language,
  });

  const map = new Map<string, VolumeRow>();
  for (const row of res.rows) {
    map.set(row.keyword.toLowerCase(), {
      searchVolume: row.search_volume ?? null,
      cpc: row.cpc ?? null,
      competition: row.competition ?? null,
    });
  }
  return map;
}

interface PersistRankedResult {
  keywordText: string;
  keywordId: string;
  businessKeywordId: string;
}

async function persistRanked(input: {
  businessId: string;
  locationCode: number;
  language: string;
  scannedAt: Date;
  item: RankedKeywordsItem;
}): Promise<PersistRankedResult | null> {
  const keywordText = input.item.keyword_data.keyword.trim().toLowerCase();
  if (!keywordText) return null;

  const serp = input.item.ranked_serp_element?.serp_item ?? null;
  const rank = serp?.rank_group ?? null;
  if (rank == null) return null;

  const kinfo = input.item.keyword_data.keyword_info ?? null;
  const searchVolume = kinfo?.search_volume ?? null;
  const cpc = kinfo?.cpc ?? null;
  const competitionLevel = kinfo?.competition_level ?? null;

  const etv = serp?.etv ?? null;
  const dfsTrafficCost = serp?.estimated_paid_traffic_cost ?? null;

  // 1. Upsert Keyword (unique on keyword + locationCode + language)
  const keyword = await prisma.keyword.upsert({
    where: {
      keyword_locationCode_language: {
        keyword: keywordText,
        locationCode: input.locationCode,
        language: input.language,
      },
    },
    create: {
      keyword: keywordText,
      locationCode: input.locationCode,
      language: input.language,
      searchVolume,
      cpc,
      competition: competitionLevel,
      refreshedAt: input.scannedAt,
    },
    update: {
      searchVolume: searchVolume ?? undefined,
      cpc: cpc ?? undefined,
      competition: competitionLevel ?? undefined,
      refreshedAt: input.scannedAt,
    },
    select: { id: true },
  });

  // 2. Upsert BusinessKeyword (unique on businessId + keywordId)
  //    source="ranked" by default · templateOrigin filled in stage 2
  //    if the keyword matches a template.
  const bk = await prisma.businessKeyword.upsert({
    where: {
      businessId_keywordId: {
        businessId: input.businessId,
        keywordId: keyword.id,
      },
    },
    create: {
      businessId: input.businessId,
      keywordId: keyword.id,
      source: "ranked",
      // templateOrigin is set in stage 2 if applicable; defaults to null.
      latestOrganicRank: rank,
      latestMapsRank: null,
      latestLandingUrl: serp?.url ?? null,
      latestEstTrafficUsd: dfsTrafficCost,
      latestEstMonthlyVisits: etv,
      latestScanAt: input.scannedAt,
      isNew: serp?.is_new === true,
      isUp: serp?.is_up === true,
      isDown: serp?.is_down === true,
      isLost: false,
    },
    update: {
      // Refresh ranked fields · DON'T clear templateOrigin (set in
      // stage 2) and DON'T touch latestMapsRank (cell-aggregate owns
      // that field). source stays "ranked" since that's still the
      // origin even if the row pre-existed as "template".
      source: "ranked",
      latestOrganicRank: rank,
      latestLandingUrl: serp?.url ?? null,
      latestEstTrafficUsd: dfsTrafficCost,
      latestEstMonthlyVisits: etv,
      latestScanAt: input.scannedAt,
      isNew: serp?.is_new === true,
      isUp: serp?.is_up === true,
      isDown: serp?.is_down === true,
      isLost: false,
    },
    select: { id: true },
  });

  // 3. Insert SerpResult(ORGANIC) row for time-series tracking.
  await prisma.serpResult.create({
    data: {
      keywordId: keyword.id,
      businessId: input.businessId,
      scannedAt: input.scannedAt,
      kind: "ORGANIC",
      organicRank: rank,
      organicAbsRank: serp?.rank_absolute ?? null,
      landingUrl: serp?.url ?? null,
    },
  });

  return {
    keywordText,
    keywordId: keyword.id,
    businessKeywordId: bk.id,
  };
}
