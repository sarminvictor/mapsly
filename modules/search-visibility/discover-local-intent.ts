// modules/search-visibility/discover-local-intent.ts
//
// S.6 · architecture C · the canonical discovery for the SMB /search
// page. Replaces ranked_keywords as the keyword source.
//
// For one business:
//   1. Build local-intent keyword set from category × city templates
//      (+ services flags · all-on for S.6 until services-detect lands)
//   2. Upsert Keyword rows (one per (keyword, locationCode, language))
//   3. Optionally call DfS keyword_volume in a single batch to fill
//      searchVolume/CPC (one cheap call per business, ~$0.075)
//   4. Upsert BusinessKeyword rows with source="template" +
//      templateOrigin · ranks remain null until cell-aggregate-maps
//      and per-biz serpOrganic run
//   5. Stamp Business.searchScanLastAt = now
//
// MUST be called inside an open CronRun · the keyword_volume call
// asserts cron context per `.claude/rules/cost-discipline.md`.
//
// Cost: ~$0.001 per keyword (volume API · batched) · ~$0.025 for a
// 25-keyword medspa = $0.025/business · much cheaper than the legacy
// $0.013 ranked_keywords + ~30 scattershot Maps queries.

import prisma from "@/lib/prisma";
import { keywordVolume } from "@/services/dataforseo";
import { buildKeywordSetForBusiness } from "@/modules/local-intent/build-keyword-set";
import type { ExpandedKeyword } from "@/modules/local-intent/templates";
import { locationCodeForCountry } from "@/modules/reviews/persist-helpers";

export type DiscoverLocalIntentStatus =
  | "ran"
  | "no_business"
  | "no_city"
  | "unknown_industry"
  | "empty_template_set";

export interface DiscoverLocalIntentResult {
  businessId: string;
  status: DiscoverLocalIntentStatus;
  /** Industry the business mapped to (null for skipped). */
  industry: string | null;
  /** Number of keywords in the local-intent set we tried to persist. */
  keywordsBuilt: number;
  /** Number of keywords we actually wrote (Keyword + BusinessKeyword). */
  keywordsTracked: number;
  /** Number of keywords we got fresh volume data for from DfS. */
  volumePopulated: number;
}

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
    },
  });
  if (!business) {
    return zeroResult(businessId, "no_business");
  }
  if (!business.city) {
    return zeroResult(businessId, "no_city");
  }

  // 1. Build the canonical set · services-detect not yet wired (S.7)
  //    so we pass serviceFlags=null to enable every service template.
  const built = buildKeywordSetForBusiness({
    category: business.category,
    city: business.city,
    serviceFlags: null,
  });

  if (!built.industry) {
    return { ...zeroResult(businessId, "unknown_industry"), industry: null };
  }
  if (built.keywords.length === 0) {
    return {
      ...zeroResult(businessId, "empty_template_set"),
      industry: built.industry,
    };
  }

  const locationCode = locationCodeForCountry(business.country);
  const language = "en"; // S.6.1 ships fr-CA

  const scannedAt = new Date();

  // 2. Fetch volume for every keyword in one batch (DfS supports 1000).
  //    We do this BEFORE upserting Keyword rows so the rows get
  //    populated correctly from the get-go.
  const volumeRows = await fetchVolumes(
    built.keywords.map((k) => k.keyword),
    locationCode,
    language,
  );

  let keywordsTracked = 0;
  let volumePopulated = 0;

  // 3. Upsert each keyword + BusinessKeyword.
  for (const expanded of built.keywords) {
    const persisted = await persistOne({
      businessId: business.id,
      locationCode,
      language,
      scannedAt,
      expanded,
      volumeRow: volumeRows.get(expanded.keyword.toLowerCase()) ?? null,
    });
    if (persisted) {
      keywordsTracked += 1;
      if (volumeRows.has(expanded.keyword.toLowerCase())) {
        volumePopulated += 1;
      }
    }
  }

  await prisma.business.update({
    where: { id: business.id },
    data: { searchScanLastAt: scannedAt },
  });

  return {
    businessId: business.id,
    status: "ran",
    industry: built.industry,
    keywordsBuilt: built.keywords.length,
    keywordsTracked,
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
    keywordsBuilt: 0,
    keywordsTracked: 0,
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
  // Defensive · keywordVolume schema caps at 1000. Medspa ships ~12; we
  // won't hit this, but a future industry could.
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

async function persistOne(input: {
  businessId: string;
  locationCode: number;
  language: string;
  scannedAt: Date;
  expanded: ExpandedKeyword;
  volumeRow: VolumeRow | null;
}): Promise<boolean> {
  const keywordText = input.expanded.keyword.trim().toLowerCase();
  if (!keywordText) return false;

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
      searchVolume: input.volumeRow?.searchVolume ?? null,
      cpc: input.volumeRow?.cpc ?? null,
      competition: input.volumeRow?.competition ?? null,
      refreshedAt: input.scannedAt,
    },
    update: {
      // Volume + CPC churn over time · refresh whenever we re-discover.
      searchVolume: input.volumeRow?.searchVolume ?? undefined,
      cpc: input.volumeRow?.cpc ?? undefined,
      competition: input.volumeRow?.competition ?? undefined,
      refreshedAt: input.scannedAt,
    },
    select: { id: true },
  });

  // 2. Upsert BusinessKeyword · source="template" so the SMB /search
  //    page picks it up (legacy "ranked" rows are excluded by the
  //    queries.ts filter).
  await prisma.businessKeyword.upsert({
    where: {
      businessId_keywordId: {
        businessId: input.businessId,
        keywordId: keyword.id,
      },
    },
    create: {
      businessId: input.businessId,
      keywordId: keyword.id,
      source: "template",
      templateOrigin: input.expanded.origin,
      // Ranks remain null until cell-aggregate-maps + per-biz organic
      // SERP scan run later in the pipeline.
      latestOrganicRank: null,
      latestMapsRank: null,
      latestEstTrafficUsd: null,
      latestEstMonthlyVisits: null,
      latestScanAt: input.scannedAt,
      isNew: false,
      isUp: false,
      isDown: false,
      isLost: false,
    },
    update: {
      // Re-running discovery should NOT clobber existing ranks · the
      // SERP scan step owns those fields. We only touch metadata here.
      source: "template",
      templateOrigin: input.expanded.origin,
      latestScanAt: input.scannedAt,
    },
  });

  return true;
}
