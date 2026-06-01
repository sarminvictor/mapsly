// modules/ads-intel/collect-cell-meta.ts · cell-level Meta market intelligence.
//
// For a (category, city, country) MARKET CELL: consolidate the services across
// every business in the cell, run ONE Meta Ad Library service+city keyword
// search (e.g. "botox miami"), and upsert AdMarketAdvertiser rows — the market:
// who advertises for these services here, on which platforms, with what
// creatives. Advertisers are matched back to our indexed businesses where
// possible (caching fbPageId) so the /ads page can flag "you" + dedup.
//
// This is the CELL-DEDUP pattern (mirrors the SERP cell aggregate): run ONCE
// per cell, shared across every business in it — NOT per business. The probe
// (scripts/probe-botox-miami.ts) proved the plain service+city keyword search
// returns ~100% relevant local advertisers, unlike business-NAME search.
//
// MUST run inside an open CronRun (the Apify adapter enforces this).

import prisma, { Prisma } from "@/lib/prisma";
import { metaAdLibrarySearch, type MetaAdRow } from "@/services/apify";
import {
  analyzeAdCreatives,
  DEFAULT_AD_INSIGHTS_MODEL,
  MIN_CREATIVES_TO_ANALYZE,
} from "@/services/ai";
import { locationCodeForCountry } from "./keyword-set";
import { matchStrength } from "./match";

/** Coerce a typed value to a Prisma Json input (mirrors business-discovery). */
function asJson(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

/** Service search-terms per cell run (bounds the warmed Apify run's time). */
const MAX_SERVICES = 5;
/** Advertiser rows kept per cell (top by ad volume). */
const MAX_ADVERTISERS = 60;
/** Representative creatives kept per advertiser (the gallery + P5 AI input). */
const MAX_CREATIVES = 6;
const META_MAX_ITEMS = 150;

export interface CellRef {
  category: string;
  city: string;
  country: string;
  businessIds: readonly string[];
}

export interface CellMetaResult {
  advertisers: number;
  creatives: number;
  runUsd: number;
  searchTerms: string[];
  /** Whether AI creative insights were (re)generated for the cell this run. */
  aiInsights: boolean;
  errors: string[];
}

export interface CellMetaOptions {
  /** Run the rule-bounded AI creative analysis (P5 · cost-gated). Default true. */
  ai?: boolean;
}

interface MarketCreative {
  externalAdId: string;
  body: string | null;
  previewUrl: string | null;
  format: string | null;
  landingUrl: string | null;
  platforms: string[];
  startedAt: string | null;
}

interface Agg {
  pageId: string;
  pageName: string;
  handle: string | null;
  adCount: number;
  /** Distinct ad ids seen — dedupes adCount + creatives across search terms. */
  seenAdIds: Set<string>;
  platforms: Set<string>;
  services: Set<string>;
  runningSince: Date | null;
  creatives: MarketCreative[];
}

/** Pull an IG/FB handle out of a Meta linkUrl (instagram.com/<h> · facebook.com/<h>). */
function handleFromLinkUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/(?:instagram|facebook)\.com\/([a-zA-Z0-9._-]{2,})/i);
  return m ? m[1].replace(/\/+$/, "") : null;
}

/**
 * Collect the Meta ad market for one cell. Returns counts + the run's cost.
 * Idempotent reconcile: advertisers not seen this run are marked inactive.
 */
export async function collectCellMeta(
  cell: CellRef,
  opts: CellMetaOptions = {},
): Promise<CellMetaResult> {
  const result: CellMetaResult = {
    advertisers: 0,
    creatives: 0,
    runUsd: 0,
    searchTerms: [],
    aiInsights: false,
    errors: [],
  };
  if (!cell.category || !cell.city || cell.businessIds.length === 0) {
    return result;
  }

  // 1 · consolidated services across the cell (active, distinct, by frequency).
  const services = await prisma.businessService.findMany({
    where: { businessId: { in: [...cell.businessIds] }, isActive: true },
    select: { name: true },
  });
  const freq = new Map<string, number>();
  for (const s of services) {
    const n = s.name.trim().toLowerCase();
    if (n) freq.set(n, (freq.get(n) ?? 0) + 1);
  }
  let serviceNames = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SERVICES)
    .map(([n]) => n);
  // Fallback to the category itself if no services are captured yet.
  if (serviceNames.length === 0) serviceNames = [cell.category.toLowerCase()];

  const searchTerms = serviceNames.map((s) => `${s} ${cell.city}`.trim());
  result.searchTerms = searchTerms;

  // 2 · ONE Meta market run for the cell.
  const country2 = (cell.country ?? "US").toUpperCase().slice(0, 2);
  let rows: MetaAdRow[] = [];
  try {
    const out = await metaAdLibrarySearch({
      searchTerms,
      countries: [country2],
      activeStatus: "active",
      maxItems: META_MAX_ITEMS,
    });
    rows = out.rows;
    result.runUsd = out.usageTotalUsd;
  } catch (e) {
    result.errors.push(`cell-meta:${(e as Error).message}`.slice(0, 200));
    return result;
  }

  // 3 · aggregate rows → advertiser-level.
  const byPage = new Map<string, Agg>();
  for (const r of rows) {
    const pid = r.pageId || "";
    if (!pid) continue;
    let g = byPage.get(pid);
    if (!g) {
      g = {
        pageId: pid,
        pageName: r.pageName ?? "(unknown)",
        handle: null,
        adCount: 0,
        seenAdIds: new Set<string>(),
        platforms: new Set<string>(),
        services: new Set<string>(),
        runningSince: null,
        creatives: [],
      };
      byPage.set(pid, g);
    }
    // platforms / services / handle / runningSince aggregate over every row
    // (idempotent — an ad matching 2 services is valid for both).
    for (const p of r.platforms ?? []) g.platforms.add(p);
    if (r.searchTerm) g.services.add(r.searchTerm);
    if (!g.handle) g.handle = handleFromLinkUrl(r.linkUrl);
    const sd = r.startDate ? new Date(r.startDate) : null;
    if (
      sd &&
      !Number.isNaN(sd.getTime()) &&
      (!g.runningSince || sd < g.runningSince)
    ) {
      g.runningSince = sd;
    }
    // adCount + creatives dedupe by ad id — one ad can match several of the
    // cell's search terms, so the same ad can stream in more than once.
    if (r.id && !g.seenAdIds.has(r.id)) {
      g.seenAdIds.add(r.id);
      g.adCount += 1;
      if (g.creatives.length < MAX_CREATIVES) {
        g.creatives.push({
          externalAdId: r.id,
          body: r.adCreativeBody ?? null,
          previewUrl: r.imageUrl ?? null,
          format: r.displayFormat ?? null,
          landingUrl: r.linkUrl ?? null,
          platforms: r.platforms ?? [],
          startedAt: r.startDate ?? null,
        });
      }
    }
  }

  // 4 · match advertisers to our cell businesses (for the "you" flag + caching).
  const bizes = await prisma.business.findMany({
    where: { id: { in: [...cell.businessIds] } },
    select: { id: true, name: true, fbPageId: true },
  });
  const matchAdvToBiz = (g: Agg): string | null => {
    for (const b of bizes)
      if (b.fbPageId && b.fbPageId === g.pageId) return b.id;
    let best: { id: string; score: number } | null = null;
    for (const b of bizes) {
      const score = matchStrength(g.pageName, b.name);
      if (score > 0 && (!best || score > best.score))
        best = { id: b.id, score };
    }
    return best?.id ?? null;
  };

  // 5 · upsert advertisers (top by ad volume) + reconcile unseen → inactive.
  const locationCode = locationCodeForCountry(cell.country);
  const seenPageIds: string[] = [];
  const top = [...byPage.values()]
    .sort((a, b) => b.adCount - a.adCount)
    .slice(0, MAX_ADVERTISERS);

  for (const g of top) {
    seenPageIds.push(g.pageId);
    const matchedBusinessId = matchAdvToBiz(g);
    if (matchedBusinessId) {
      const b = bizes.find((x) => x.id === matchedBusinessId);
      if (b && !b.fbPageId) {
        await prisma.business
          .update({ where: { id: b.id }, data: { fbPageId: g.pageId } })
          .catch(() => {});
      }
    }
    await prisma.adMarketAdvertiser.upsert({
      where: {
        category_city_country_platform_pageId: {
          category: cell.category,
          city: cell.city,
          country: cell.country,
          platform: "META",
          pageId: g.pageId,
        },
      },
      create: {
        category: cell.category,
        city: cell.city,
        country: cell.country,
        locationCode,
        platform: "META",
        pageId: g.pageId,
        pageName: g.pageName,
        handle: g.handle,
        activeAdCount: g.adCount,
        platforms: [...g.platforms],
        matchedServices: [...g.services],
        runningSince: g.runningSince,
        creatives: asJson(g.creatives),
        matchedBusinessId,
        isActive: true,
      },
      update: {
        pageName: g.pageName,
        handle: g.handle ?? undefined,
        activeAdCount: g.adCount,
        platforms: [...g.platforms],
        matchedServices: [...g.services],
        runningSince: g.runningSince,
        creatives: asJson(g.creatives),
        matchedBusinessId,
        isActive: true,
        lastSeenAt: new Date(),
      },
    });
    result.advertisers += 1;
    result.creatives += g.creatives.length;
  }

  // Reconcile: advertisers previously active in this cell but absent now → off.
  await prisma.adMarketAdvertiser.updateMany({
    where: {
      category: cell.category,
      city: cell.city,
      country: cell.country,
      platform: "META",
      isActive: true,
      pageId: { notIn: seenPageIds.length > 0 ? seenPageIds : ["__none__"] },
    },
    data: { isActive: false, lastSeenAt: new Date() },
  });

  // 6 · AI · rule-bounded creative analysis for the cell (P5). Cost-gated: only
  // when there's enough signal; cached 7d so it runs once per cell per refresh,
  // never per business. Best-effort — never fail the collection on AI.
  if (opts.ai !== false) {
    const creativesForAi = top
      .flatMap((g) => g.creatives)
      .filter((c) => (c.body ?? "").trim().length > 0)
      .map((c) => ({ body: c.body, format: c.format, platforms: c.platforms }));
    if (creativesForAi.length >= MIN_CREATIVES_TO_ANALYZE) {
      try {
        const insights = await analyzeAdCreatives({
          category: cell.category,
          city: cell.city,
          services: serviceNames,
          creatives: creativesForAi,
        });
        await prisma.adMarketInsight.upsert({
          where: {
            category_city_country_platform: {
              category: cell.category,
              city: cell.city,
              country: cell.country,
              platform: "META",
            },
          },
          create: {
            category: cell.category,
            city: cell.city,
            country: cell.country,
            platform: "META",
            serviceMix: asJson(insights.serviceMix),
            promos: asJson(insights.promos),
            creativesAnalyzed: creativesForAi.length,
            model: DEFAULT_AD_INSIGHTS_MODEL,
          },
          update: {
            serviceMix: asJson(insights.serviceMix),
            promos: asJson(insights.promos),
            creativesAnalyzed: creativesForAi.length,
            model: DEFAULT_AD_INSIGHTS_MODEL,
            generatedAt: new Date(),
          },
        });
        result.aiInsights = true;
      } catch (e) {
        result.errors.push(`cell-ai:${(e as Error).message}`.slice(0, 200));
      }
    }
  }

  return result;
}
