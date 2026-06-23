// modules/cell-intel/google-ads.ts · per-cell Google Ads collector (Phase 6).
//
// Run ONCE per cell, cache 30 days, serve from DB if fresh. For a cell:
//   1. If a fresh (≤30d) AdMarketRun(platform=GOOGLE) exists → served-from-DB.
//   2. Else:
//        a. adsAdvertisers(categoryKeyword, locationCode) — who's running Google
//           ads for the cell's service in this geo (Transparency Center).
//        b. adsSearch(advertiser_ids=topN) — pull those advertisers' creatives.
//        c. persist AdLibraryEntry(platform=GOOGLE), attributing to indexed
//           businesses by advertiser domain when present, else competitor (null
//           businessId), and one AdMarketRun(platform=GOOGLE) telemetry row.
//
// MUST run inside an open CronRun (the DataForSEO adapters enforce this).

import prisma from "@/lib/prisma";
import { adsAdvertisers, adsSearch } from "@/services/dataforseo";
import {
  isCellRunFresh,
  latestAdMarketRun,
  CELL_INTEL_FRESHNESS_DAYS,
} from "./freshness";
import {
  resolveCellContext,
  hostOf,
  representativeKeywords,
  type CellBusiness,
} from "./cell-context";

/** Top advertisers (by approx ad count) whose creatives we pull per cell. */
const MAX_ADVERTISERS = 15;
/** A creative is "active" if last shown within this window. */
const ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface CellGoogleAdsResult {
  cellKey: string;
  outcome: "served-from-db" | "collected" | "skipped";
  advertiserCount: number;
  adCount: number;
  entriesUpserted: number;
  costUsd: number;
  errors: string[];
}

function parseDateOrNull(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function isRecentlyActive(lastShown: string | null | undefined): boolean {
  const d = parseDateOrNull(lastShown);
  if (!d) return false;
  return Date.now() - d.getTime() < ACTIVE_WINDOW_MS;
}

/**
 * Attribute a Google creative's advertiser to an indexed business when the
 * advertiser display name matches the business host's brand stem. Google
 * Transparency rows carry no domain on the creative, so we match on the
 * advertiser title vs the business name/host. Returns null for competitors.
 */
function attributeAdvertiser(
  advertiserName: string | null | undefined,
  businesses: readonly CellBusiness[],
): string | null {
  const name = (advertiserName ?? "").toLowerCase().trim();
  if (!name) return null;
  for (const b of businesses) {
    const host = hostOf(b);
    const stem = host ? host.split(".")[0] : null;
    if (stem && stem.length >= 4 && name.includes(stem)) return b.id;
    const bn = b.name.toLowerCase().trim();
    if (bn.length >= 4 && (name.includes(bn) || bn.includes(name))) return b.id;
  }
  return null;
}

/**
 * Collect the Google ad market for one cell, gated by the 30-day freshness
 * window. MUST run inside an open CronRun.
 */
export async function runGoogleAdsForCell(
  cellKey: string,
  now: Date = new Date(),
): Promise<CellGoogleAdsResult> {
  const result: CellGoogleAdsResult = {
    cellKey,
    outcome: "skipped",
    advertiserCount: 0,
    adCount: 0,
    entriesUpserted: 0,
    costUsd: 0,
    errors: [],
  };

  // 1 · freshness gate.
  const last = await latestAdMarketRun(cellKey, "GOOGLE");
  if (isCellRunFresh(last?.ranAt ?? null, now, CELL_INTEL_FRESHNESS_DAYS)) {
    result.outcome = "served-from-db";
    return result;
  }

  // 2 · resolve cell context.
  const ctx = await resolveCellContext(cellKey);
  if (!ctx) {
    result.errors.push(`unresolvable-cell:${cellKey}`);
    return result;
  }

  const keyword = representativeKeywords(ctx)[0];
  if (!keyword) {
    result.errors.push(`no-keyword:${cellKey}`);
    return result;
  }

  // 3 · who advertises on Google for this service in this geo.
  let advertiserIds: string[] = [];
  try {
    const { items } = await adsAdvertisers({
      keyword,
      location_code: ctx.locationCode,
      language_code: "en",
    });
    advertiserIds = items
      .slice()
      .sort((a, b) => (b.approx_ads_count ?? 0) - (a.approx_ads_count ?? 0))
      .map((it) => it.advertiser_id)
      .filter((id): id is string => Boolean(id))
      .slice(0, MAX_ADVERTISERS);
    result.advertiserCount = advertiserIds.length;
  } catch (e) {
    result.errors.push(`advertisers:${(e as Error).message}`.slice(0, 200));
    await prisma.adMarketRun.create({
      data: {
        cellKey,
        platform: "GOOGLE",
        status: "FAILED",
        costUsd: result.costUsd,
        advertiserCount: 0,
        adCount: 0,
      },
    });
    return result;
  }

  // 4 · pull the top advertisers' creatives (one ads_search call · ≤25 ids).
  if (advertiserIds.length > 0) {
    try {
      const { items } = await adsSearch({
        advertiser_ids: advertiserIds,
        location_code: ctx.locationCode,
        language_code: "en",
        platform: "all",
        format: "all",
        depth: 40,
      });
      for (const it of items) {
        if (!it.creative_id) continue;
        const businessId = attributeAdvertiser(it.title, ctx.businesses);
        result.adCount += 1;
        const data = {
          businessId,
          platform: "GOOGLE" as const,
          advertiserName: it.title ?? null,
          advertiserExternalId: it.advertiser_id ?? null,
          adCreativeBody: it.title ?? null,
          displayFormat: it.format ?? null,
          previewImageUrl: it.preview_image?.url ?? null,
          landingUrl: it.url ?? null,
          startedAt: parseDateOrNull(it.first_shown),
          endedAt: parseDateOrNull(it.last_shown),
          isActive: isRecentlyActive(it.last_shown),
          platforms: [] as string[],
        };
        try {
          await prisma.adLibraryEntry.upsert({
            where: { externalAdId: String(it.creative_id) },
            create: {
              ...data,
              externalAdId: String(it.creative_id),
              firstSeenAt: now,
              lastSeenAt: now,
            },
            update: { ...data, lastSeenAt: now },
          });
          result.entriesUpserted += 1;
        } catch (e) {
          result.errors.push(`entry:${(e as Error).message}`.slice(0, 200));
        }
      }
    } catch (e) {
      result.errors.push(`creatives:${(e as Error).message}`.slice(0, 200));
    }
  }

  // 5 · telemetry run row.
  await prisma.adMarketRun.create({
    data: {
      cellKey,
      platform: "GOOGLE",
      status: result.errors.length > 0 ? "PARTIAL" : "OK",
      costUsd: result.costUsd,
      advertiserCount: result.advertiserCount,
      adCount: result.adCount,
    },
  });

  result.outcome = "collected";
  return result;
}
