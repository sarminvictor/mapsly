// modules/cell-intel/meta-ads.ts · per-cell Meta Ad Library collector (Phase 6).
//
// Run ONCE per cell, cache 30 days, serve from DB if fresh. For a cell:
//   1. If a fresh (≤30d) AdMarketRun(platform=META) exists → served-from-DB ($0).
//   2. Else run the Apify Meta adapter for the cell's category+metro (one
//      service+city search), then persist:
//        - AdLibraryEntry rows (attributed to indexed businesses by pageId /
//          domain match) — the per-business ad creatives.
//        - AdMarketAdvertiser rows (per-advertiser aggregate for the cell).
//        - one AdMarketRun(platform=META) telemetry row (advertiserCount,
//          adCount, cost).
//
// MUST run inside an open CronRun (the Apify adapter enforces this via
// withCostCounter). Cell-dedup mirrors collect-cell-meta.ts; this variant is
// cellKey-driven + adds the AdMarketRun freshness marker + per-business
// AdLibraryEntry attribution.

import prisma, { Prisma } from "@/lib/prisma";
import {
  metaAdLibrarySearch,
  type MetaAdRow,
  type MetaAdvertiser,
} from "@/services/apify";
import { matchStrength } from "@/modules/ads-intel/match";
import {
  isCellRunFresh,
  latestAdMarketRun,
  CELL_INTEL_FRESHNESS_DAYS,
} from "./freshness";
import {
  resolveCellContext,
  hostOf,
  type CellContext,
  type CellBusiness,
} from "./cell-context";

/** Coerce a typed value to a Prisma Json input. */
function asJson(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

const MAX_SERVICES = 5;
const MAX_ADVERTISERS = 60;
const MAX_CREATIVES = 6;
const META_MAX_ITEMS = 150;

export interface CellMetaAdsResult {
  cellKey: string;
  /** "served-from-db" (fresh), "collected" (ran adapter), "skipped" (no cell). */
  outcome: "served-from-db" | "collected" | "skipped";
  advertiserCount: number;
  adCount: number;
  /** AdLibraryEntry rows persisted (per-business attribution). */
  entriesUpserted: number;
  costUsd: number;
  runId: string | null;
  errors: string[];
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
  seenAdIds: Set<string>;
  platforms: Set<string>;
  services: Set<string>;
  runningSince: Date | null;
  creatives: MarketCreative[];
}

function handleFromLinkUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/(?:instagram|facebook)\.com\/([a-zA-Z0-9._-]{2,})/i);
  return m ? m[1].replace(/\/+$/, "") : null;
}

function parseDateOrNull(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Build the service+city search terms for the cell's Meta market run. */
function buildSearchTerms(ctx: CellContext): string[] {
  const base = ctx.categorySlug.replace(/[_-]+/g, " ").trim();
  const city = ctx.cityLabel;
  const term = city ? `${base} ${city}`.trim() : base;
  return [term].filter((t) => t.length >= 2).slice(0, MAX_SERVICES);
}

/**
 * Attribute a Meta ad to exactly one indexed business by strongest signal:
 *   1. exact fbPageId match (the page id we cached for that business),
 *   2. a distinctive page-name token match (fallback, generic words excluded).
 * Domain attribution falls back to the advertiser handle vs the business host.
 * Returns the businessId or null (competitor not in our index).
 */
function attributeAd(
  row: MetaAdRow,
  byPageId: Map<string, string>,
  businesses: readonly CellBusiness[],
): string | null {
  const pid = row.pageId || "";
  if (pid && byPageId.has(pid)) return byPageId.get(pid)!;

  const handle = handleFromLinkUrl(row.linkUrl);
  if (handle) {
    for (const b of businesses) {
      const host = hostOf(b);
      // handle like "soleabrickell" vs host "soleabrickell.com"
      if (host && host.split(".")[0] === handle.toLowerCase()) return b.id;
    }
  }

  let best: { id: string; score: number } | null = null;
  for (const b of businesses) {
    const score = matchStrength(row.pageName, b.name);
    if (score > 0 && (!best || score > best.score)) best = { id: b.id, score };
  }
  return best?.id ?? null;
}

/**
 * Collect the Meta ad market for one cell, gated by the 30-day freshness window.
 * MUST run inside an open CronRun.
 */
export async function runMetaAdsForCell(
  cellKey: string,
  now: Date = new Date(),
): Promise<CellMetaAdsResult> {
  const result: CellMetaAdsResult = {
    cellKey,
    outcome: "skipped",
    advertiserCount: 0,
    adCount: 0,
    entriesUpserted: 0,
    costUsd: 0,
    runId: null,
    errors: [],
  };

  // 1 · freshness gate — serve from DB if a recent run exists.
  const last = await latestAdMarketRun(cellKey, "META");
  if (isCellRunFresh(last?.ranAt ?? null, now, CELL_INTEL_FRESHNESS_DAYS)) {
    result.outcome = "served-from-db";
    return result;
  }

  // 2 · resolve cell context (category, metro, businesses, location code).
  const ctx = await resolveCellContext(cellKey);
  if (!ctx) {
    result.errors.push(`unresolvable-cell:${cellKey}`);
    return result;
  }

  const searchTerms = buildSearchTerms(ctx);
  if (searchTerms.length === 0) {
    result.errors.push(`no-search-terms:${cellKey}`);
    return result;
  }

  // 3 · ONE Meta market run for the cell.
  const country2 = (ctx.country || "US").toUpperCase().slice(0, 2);
  let rows: MetaAdRow[] = [];
  let advertisers: MetaAdvertiser[] = [];
  try {
    const out = await metaAdLibrarySearch({
      searchTerms,
      countries: [country2],
      activeStatus: "active",
      maxItems: META_MAX_ITEMS,
    });
    rows = out.rows;
    advertisers = out.advertisers ?? [];
    result.costUsd = out.usageTotalUsd;
    result.runId = out.runId;
  } catch (e) {
    result.errors.push(`meta-run:${(e as Error).message}`.slice(0, 200));
    // Record a FAILED run so the gate doesn't trip on a partial DB state.
    await prisma.adMarketRun.create({
      data: {
        cellKey,
        platform: "META",
        status: "FAILED",
        costUsd: result.costUsd,
        advertiserCount: 0,
        adCount: 0,
      },
    });
    return result;
  }

  // pageId → businessId for fast attribution (cached fbPageId).
  const byPageId = new Map<string, string>();
  for (const b of ctx.businesses) {
    if (b.fbPageId) byPageId.set(b.fbPageId, b.id);
  }

  // 4 · aggregate rows → advertiser level (dedupe ad ids across terms).
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
    for (const p of r.platforms ?? []) g.platforms.add(p);
    if (r.searchTerm) g.services.add(r.searchTerm);
    if (!g.handle) g.handle = handleFromLinkUrl(r.linkUrl);
    const sd = parseDateOrNull(r.startDate);
    if (sd && (!g.runningSince || sd < g.runningSince)) g.runningSince = sd;
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

  // 4b · merge the advertiser FACET (dynamic_filter_options.pages). For keyword
  // searches this is Meta's PRIMARY signal — it returns "who advertises for this
  // term" + an ad count even when it withholds the per-creative results GraphQL
  // from an automated session (the common case → 0 creative rows). Without this,
  // a cell whose only signal is the facet records 0 advertisers (the meta_ads
  // "always 0" bug: rows were consumed, the facet was dropped on the floor).
  for (const a of advertisers) {
    const pid = a.pageId || "";
    if (!pid) continue;
    let g = byPage.get(pid);
    if (!g) {
      g = {
        pageId: pid,
        pageName: a.pageName ?? "(unknown)",
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
    if ((!g.pageName || g.pageName === "(unknown)") && a.pageName)
      g.pageName = a.pageName;
    if (a.searchTerm) g.services.add(a.searchTerm);
    // Facet ad count (no creatives attached) — take it when it exceeds the
    // creative-derived count so the advertiser's activity isn't undercounted.
    if (typeof a.adCount === "number" && a.adCount > g.adCount)
      g.adCount = a.adCount;
  }

  // 5 · upsert AdMarketAdvertiser (per-advertiser cell aggregate).
  const top = [...byPage.values()]
    .sort((a, b) => b.adCount - a.adCount)
    .slice(0, MAX_ADVERTISERS);

  for (const g of top) {
    const matchedBusinessId = byPageId.get(g.pageId) ?? null;
    try {
      await prisma.adMarketAdvertiser.upsert({
        where: {
          category_city_country_platform_pageId: {
            category: ctx.categorySlug,
            city: ctx.cityLabel,
            country: ctx.country,
            platform: "META",
            pageId: g.pageId,
          },
        },
        create: {
          category: ctx.categorySlug,
          city: ctx.cityLabel,
          country: ctx.country,
          locationCode: ctx.locationCode,
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
          lastSeenAt: now,
        },
      });
      result.advertiserCount += 1;
    } catch (e) {
      result.errors.push(`advertiser:${(e as Error).message}`.slice(0, 200));
    }
  }

  // 6 · persist AdLibraryEntry rows for ads attributable to indexed businesses.
  // Derives signal-ready fields (platforms, displayFormat, collationCount,
  // variant counts). Keyed on globally-unique externalAdId so a re-run upserts.
  for (const r of rows) {
    if (!r.id) continue;
    const businessId = attributeAd(r, byPageId, ctx.businesses);
    if (!businessId) continue; // competitor-only ads live in AdMarketAdvertiser
    result.adCount += 1;
    const data = {
      businessId,
      platform: "META" as const,
      advertiserName: r.pageName ?? null,
      pageId: r.pageId || null,
      adCreativeBody: r.adCreativeBody ?? null,
      linkTitle: r.linkTitle ?? null,
      linkCaption: r.linkCaption ?? null,
      ctaText: r.ctaText ?? null,
      displayFormat: r.displayFormat ?? null,
      previewImageUrl: r.imageUrl ?? null,
      landingUrl: r.linkUrl ?? null,
      platforms: r.platforms ?? [],
      collationCount: r.collationCount ?? null,
      startedAt: parseDateOrNull(r.startDate),
      endedAt: parseDateOrNull(r.endDate),
      isActive: r.isActive ?? true,
    };
    try {
      await prisma.adLibraryEntry.upsert({
        where: { externalAdId: r.id },
        create: {
          ...data,
          externalAdId: r.id,
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

  // 7 · telemetry run row (freshness marker + dashboard counts).
  await prisma.adMarketRun.create({
    data: {
      cellKey,
      platform: "META",
      status: result.errors.length > 0 ? "PARTIAL" : "OK",
      costUsd: result.costUsd,
      advertiserCount: result.advertiserCount,
      adCount: result.adCount,
    },
  });

  result.outcome = "collected";
  return result;
}
