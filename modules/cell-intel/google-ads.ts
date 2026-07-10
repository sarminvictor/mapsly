// modules/cell-intel/google-ads.ts · Google Ads collectors (Phase 6 · B1).
//
// TWO collectors, one shared vendor adapter:
//
//   runGoogleAdsForBusiness(businessId) — the PRIMARY, per-business path (B1).
//     For a business WITH a website, call adsSearch({ target: <host> }): every
//     returned creative belongs to that domain BY CONSTRUCTION, so we attribute
//     each to `businessId = business.id` with NO fuzzy name match. Persists
//     AdLibraryEntry(GOOGLE, businessId, …) + a per-business AdMarketRun(GOOGLE)
//     telemetry row, and stamps Business.googleAdsLastAt (the freshness cursor
//     the dispatch job rail reads). This is what the discover/enrichment flow
//     dispatches (per-business EnrichmentJob, mirroring lighthouse).
//
//   runGoogleAdsForCell(cellKey) — the per-CELL MARKET path (kept). Runs ONCE
//     per cell for the market-prevalence signal (advertiser count in the cell).
//     Used by the admin /api/internal/run-cell-intel route. It does NOT attribute
//     creatives to individual businesses (that's the per-business path's job) —
//     it records the cell's advertiser/ad counts on an AdMarketRun(GOOGLE) row.
//
// Both MUST run inside an open CronRun (the DataForSEO adapters enforce this).

import prisma from "@/lib/prisma";
import { parseCellKey } from "@/lib/cell";
import { adsAdvertisers, adsSearch } from "@/services/dataforseo";
import { locationCodeForCountry } from "@/modules/ads-intel/keyword-set";
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
 * Persist one Google creative as an AdLibraryEntry(GOOGLE), upserting by
 * creative_id. Shared by the per-business + per-cell paths so both write the
 * SAME shape.
 *
 * B1 · landingUrl FIX: `it.url` is the creative's link on the Transparency
 * platform (e.g. adstransparency.google.com/…), NOT the ad's landing page. The
 * old code stored it in `landingUrl`, which polluted the signal layer's
 * landing-host rollup (rollupAds' landingHostCount / landingIsHomepageOnly).
 * Google Ads Transparency exposes no landing URL, so we store `landingUrl: null`
 * and keep the transparency link where it belongs (linkTitle is a display slot;
 * we leave it unset — the preview image + advertiser name carry the card).
 */
async function upsertGoogleCreative(
  it: import("@/services/dataforseo").AdsCreativeItem,
  businessId: string | null,
  now: Date,
): Promise<void> {
  const data = {
    businessId,
    platform: "GOOGLE" as const,
    advertiserName: it.title ?? null,
    advertiserExternalId: it.advertiser_id ?? null,
    adCreativeBody: it.title ?? null,
    displayFormat: it.format ?? null,
    previewImageUrl: it.preview_image?.url ?? null,
    // B1 · Google Ads Transparency carries no landing page — `it.url` is the
    // transparency link, not a landing URL. Store null so the signal layer's
    // landing-host rollup isn't fed garbage.
    landingUrl: null,
    startedAt: parseDateOrNull(it.first_shown),
    endedAt: parseDateOrNull(it.last_shown),
    isActive: isRecentlyActive(it.last_shown),
    platforms: [] as string[],
  };
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
}

export interface BusinessGoogleAdsResult {
  businessId: string;
  outcome: "collected" | "skipped" | "no-website" | "error";
  adCount: number;
  entriesUpserted: number;
  errors: string[];
}

/**
 * B1 · Collect one business's OWN Google ads reliably, by targeting the
 * ads_search on the business's website host. Every returned creative belongs to
 * that domain BY CONSTRUCTION, so each is attributed to `businessId = id` with
 * no fuzzy match. Persists AdLibraryEntry(GOOGLE, businessId, …) + a per-business
 * AdMarketRun(GOOGLE) telemetry row, and stamps Business.googleAdsLastAt (the
 * freshness cursor the dispatch job rail reads). MUST run inside an open CronRun.
 *
 * A website-less business returns outcome:"no-website" (no host to target) —
 * the dispatch never queues one (google_ads is WEBSITE_DEPENDENT), but the guard
 * keeps the collector safe if called directly.
 */
export async function runGoogleAdsForBusiness(
  businessId: string,
  now: Date = new Date(),
): Promise<BusinessGoogleAdsResult> {
  const result: BusinessGoogleAdsResult = {
    businessId,
    outcome: "skipped",
    adCount: 0,
    entriesUpserted: 0,
    errors: [],
  };

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, domain: true, website: true, cellKey: true },
  });
  if (!business) {
    result.errors.push(`unknown-business:${businessId}`);
    return result;
  }

  const host = hostOf(business);
  if (!host) {
    result.outcome = "no-website";
    return result;
  }

  // The cell's country drives the DataForSEO location code (US=2840, CA=2124).
  // Fall back to the US default when the business has no parseable cellKey.
  const parsedCell = business.cellKey ? parseCellKey(business.cellKey) : null;
  const locationCode = locationCodeForCountry(parsedCell?.country ?? "US");
  // AdMarketRun.cellKey is required — use the business's cell (or a business-
  // scoped marker when it has none) so the telemetry row still resolves.
  // TRUTH UNIFICATION (2026-07-06) · ALWAYS business-keyed. Keying this
  // telemetry row by the shared cellKey made every consumer that groupBys
  // AdMarketRun by cellKey (coverage matrix, drawer, prevalence signal) read
  // "google ran for the whole cell" after ONE business's per-business job —
  // and its advertiserCount (0/1) clobbered the market-prevalence signal.
  const runCellKey = `business:${business.id}`;

  try {
    const { items } = await adsSearch({
      target: host,
      location_code: locationCode,
      language_code: "en",
      platform: "all",
      format: "all",
      depth: 40,
    });
    for (const it of items) {
      if (!it.creative_id) continue;
      result.adCount += 1;
      try {
        // target-host attribution → this business, by construction.
        await upsertGoogleCreative(it, business.id, now);
        result.entriesUpserted += 1;
      } catch (e) {
        result.errors.push(`entry:${(e as Error).message}`.slice(0, 200));
      }
    }
  } catch (e) {
    result.errors.push(`creatives:${(e as Error).message}`.slice(0, 200));
    // A DfS ads_search throw is a TRANSIENT vendor error, not a structural skip.
    // Surface it as outcome:"error" (→ reason "google_ads_error") so the dispatch
    // soft-fail ladder RETRIES it instead of dying terminal on attempt 1 — before
    // this, a swallowed throw returned outcome:"skipped" and 49/122 google_ads
    // jobs on the dental run were one-shot FAILED though 11/13 hand-retries later
    // succeeded (they were transient). See run-forensics-dental-2026-07-10.
    result.outcome = "error";
    await prisma.adMarketRun.create({
      data: {
        cellKey: runCellKey,
        platform: "GOOGLE",
        status: "FAILED",
        costUsd: 0,
        advertiserCount: 0,
        adCount: 0,
      },
    });
    return result;
  }

  // Stamp the per-business freshness cursor (the dispatch reads it) + a
  // telemetry AdMarketRun. advertiserCount=1 — this business IS the advertiser.
  await prisma.$transaction([
    prisma.business.update({
      where: { id: business.id },
      data: { googleAdsLastAt: now },
    }),
    prisma.adMarketRun.create({
      data: {
        cellKey: runCellKey,
        platform: "GOOGLE",
        status: result.errors.length > 0 ? "PARTIAL" : "OK",
        costUsd: 0,
        advertiserCount: result.adCount > 0 ? 1 : 0,
        adCount: result.adCount,
      },
    }),
  ]);

  result.outcome = "collected";
  return result;
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
        try {
          await upsertGoogleCreative(it, businessId, now);
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
