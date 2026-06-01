/**
 * SMB /ads · server query.
 *
 * `getSmbAdsData(userId)` returns Maria's market-intelligence payload, split
 * into two blocks:
 *   • GOOGLE — keyword costs (shared Keyword model) + own ad count + a
 *     market leaderboard of top Google advertisers (AdLibraryEntry GOOGLE,
 *     aggregated per business in the cell) + cost suggestions.
 *   • META   — the cell market (AdMarketAdvertiser): advertisers + creatives +
 *     platform spread + own status + platform/creative suggestions.
 *
 * Cache: `'use cache'` + `cacheLife('hours')` + `cacheTag('smb-ads-${userId}')`
 * (the ads crons + admin trigger revalidate this tag). Pattern 1 build-guard +
 * try/catch both return EMPTY. No external API in the request path.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";
import {
  adsServiceKeywords,
  locationCodeForCountry,
} from "@/modules/ads-intel/keyword-set";
import {
  EMPTY_SMB_ADS,
  buildGoogleSuggestions,
  buildPersonalizedMetaSuggestions,
  competitionLabelFromIndex,
  curateQuickWins,
  opportunityScore,
  pickBestOpportunity,
  type AdFormatStat,
  type AdKeywordCost,
  type CompetitionBucket,
  type GoogleAdvertiserRow,
  type MarketServiceStat,
  type MetaAdvertiserCard,
  type MetaCreative,
  type MetaPlatformStat,
  type SmbAdsData,
} from "./types";

const MAX_KEYWORD_ROWS = 16;
const MAX_GOOGLE_LEADERS = 10;
const MAX_META_ADVERTISERS = 12;
const MAX_GALLERY_CREATIVES = 6;

function asBucket(s: string | null): CompetitionBucket | null {
  return s === "LOW" || s === "MEDIUM" || s === "HIGH" ? s : null;
}

/** Coerce the AdMarketAdvertiser.creatives JSON into typed cards. Dedupes by
 *  externalAdId — an ad can match several of a cell's search terms, so older
 *  stored rows may carry the same creative twice (React-key collision). */
function parseCreatives(json: unknown): MetaCreative[] {
  if (!Array.isArray(json)) return [];
  const out: MetaCreative[] = [];
  const seen = new Set<string>();
  for (const c of json) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const id = typeof o.externalAdId === "string" ? o.externalAdId : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      externalAdId: id,
      body: typeof o.body === "string" ? o.body : null,
      previewUrl: typeof o.previewUrl === "string" ? o.previewUrl : null,
      format: typeof o.format === "string" ? o.format : null,
      landingUrl: typeof o.landingUrl === "string" ? o.landingUrl : null,
      platforms: Array.isArray(o.platforms)
        ? o.platforms.filter((p): p is string => typeof p === "string")
        : [],
    });
    if (out.length >= MAX_GALLERY_CREATIVES) break;
  }
  return out;
}

/** Normalize a raw Ad Library displayFormat → a Maria-friendly label. */
function formatLabel(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.toUpperCase();
  if (v.includes("VIDEO")) return "Video";
  if (v.includes("IMAGE") || v === "PHOTO") return "Image";
  if (v.includes("CAROUSEL") || v === "DCO" || v.includes("DPA"))
    return "Carousel";
  return "Other";
}

/** Parse AdMarketInsight.serviceMix JSON → typed list. Dedupes by service name
 *  (case-insensitive) — the model occasionally repeats a service; a duplicate
 *  would collide React keys + double-count. Keeps the highest ad count. */
function parseServiceMix(json: unknown): { service: string; ads: number }[] {
  if (!Array.isArray(json)) return [];
  const byName = new Map<string, { service: string; ads: number }>();
  for (const o of json) {
    if (!o || typeof o !== "object") continue;
    const r = o as Record<string, unknown>;
    if (typeof r.service !== "string" || !r.service.trim()) continue;
    const service = r.service.trim();
    const ads = typeof r.ads === "number" && r.ads >= 0 ? Math.round(r.ads) : 0;
    const key = service.toLowerCase();
    const prev = byName.get(key);
    if (!prev) byName.set(key, { service, ads });
    else if (ads > prev.ads) prev.ads = ads;
  }
  return [...byName.values()].sort((a, b) => b.ads - a.ads).slice(0, 12);
}

/** Parse AdMarketInsight.promos JSON → typed list. */
function parsePromos(
  json: unknown,
): { label: string; offer: string; price: string | null }[] {
  if (!Array.isArray(json)) return [];
  const out: { label: string; offer: string; price: string | null }[] = [];
  for (const o of json) {
    if (!o || typeof o !== "object") continue;
    const r = o as Record<string, unknown>;
    if (typeof r.offer !== "string" || !r.offer.trim()) continue;
    out.push({
      label: typeof r.label === "string" ? r.label : "",
      offer: r.offer.trim(),
      price: typeof r.price === "string" && r.price.trim() ? r.price : null,
    });
    if (out.length >= 8) break;
  }
  return out;
}

export async function getSmbAdsData(userId: string): Promise<SmbAdsData> {
  "use cache";
  cacheLife("hours");
  cacheTag(`smb-ads-${userId}`);

  if (process.env.NEXT_PHASE === "phase-production-build") return EMPTY_SMB_ADS;
  if (!userId || typeof userId !== "string") return EMPTY_SMB_ADS;

  try {
    const own = await prisma.business.findFirst({
      where: { ownerUserId: userId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        category: true,
        categories: true,
        city: true,
        country: true,
        adsScanLastAt: true,
      },
    });
    if (!own) return EMPTY_SMB_ADS;

    const locationCode = locationCodeForCountry(own.country);
    const cell = { category: own.category, city: own.city };

    // ─── GOOGLE · keyword costs ────────────────────────────────────────────
    const keywordSet = adsServiceKeywords({
      category: own.category,
      city: own.city,
      serviceNames: own.categories,
    });
    const keywordRows = keywordSet.length
      ? await prisma.keyword.findMany({
          where: { keyword: { in: keywordSet }, locationCode },
          select: {
            keyword: true,
            searchVolume: true,
            cpc: true,
            competition: true,
            competitionIndex: true,
            lowTopOfPageBid: true,
            highTopOfPageBid: true,
          },
        })
      : [];
    const keywordCosts: AdKeywordCost[] = keywordRows
      .map((r) => ({
        keyword: r.keyword,
        searchVolume: r.searchVolume,
        cpc: r.cpc,
        competition: asBucket(r.competition),
        competitionIndex: r.competitionIndex,
        lowBid: r.lowTopOfPageBid,
        highBid: r.highTopOfPageBid,
        opportunity: opportunityScore({
          searchVolume: r.searchVolume,
          cpc: r.cpc,
          competitionIndex: r.competitionIndex,
        }),
      }))
      .sort((a, b) => b.opportunity - a.opportunity)
      .slice(0, MAX_KEYWORD_ROWS);

    const volumes = keywordCosts
      .map((k) => k.searchVolume ?? 0)
      .filter((v) => v > 0);
    const totalSearchVolume = volumes.reduce((s, v) => s + v, 0);
    const cpcs = keywordCosts
      .map((k) => k.cpc)
      .filter((c): c is number => c != null && c > 0);
    const avgCpc =
      cpcs.length > 0
        ? Math.round((cpcs.reduce((s, c) => s + c, 0) / cpcs.length) * 100) /
          100
        : null;
    const idxs = keywordCosts
      .map((k) => k.competitionIndex)
      .filter((i): i is number => i != null);
    const avgIdx =
      idxs.length > 0 ? idxs.reduce((s, i) => s + i, 0) / idxs.length : null;
    const bestOpportunity = pickBestOpportunity(keywordCosts);

    // ─── GOOGLE · own ads + market leaderboard ─────────────────────────────
    // All active Google creatives across our tracked businesses in the cell.
    const googleAds =
      cell.category && cell.city
        ? await prisma.adLibraryEntry.findMany({
            where: {
              platform: "GOOGLE",
              isActive: true,
              business: {
                category: cell.category,
                city: cell.city,
                isActive: true,
              },
            },
            select: {
              businessId: true,
              business: { select: { name: true, domain: true } },
            },
          })
        : [];
    const googleByBiz = new Map<
      string,
      { name: string; domain: string | null; adCount: number }
    >();
    for (const a of googleAds) {
      if (!a.businessId) continue;
      const g = googleByBiz.get(a.businessId);
      if (g) g.adCount += 1;
      else
        googleByBiz.set(a.businessId, {
          name: a.business?.name ?? "A nearby business",
          domain: a.business?.domain ?? null,
          adCount: 1,
        });
    }
    const ownAdCountGoogle = own.id
      ? (googleByBiz.get(own.id)?.adCount ?? 0)
      : 0;
    const ranked = [...googleByBiz.entries()].sort(
      (a, b) => b[1].adCount - a[1].adCount,
    );
    const topGoogleAdvertisers: GoogleAdvertiserRow[] = ranked
      .slice(0, MAX_GOOGLE_LEADERS)
      .map(([id, g], i) => ({
        id,
        name: g.name,
        rank: i + 1,
        isOwn: id === own.id,
        adCount: g.adCount,
        domain: g.domain,
      }));
    const ownGoogleRank = ranked.findIndex(([id]) => id === own.id);

    const googleSuggestions = buildGoogleSuggestions({
      ownAdCount: ownAdCountGoogle,
      advertiserCount: googleByBiz.size - (ownAdCountGoogle > 0 ? 1 : 0),
      bestOpportunity,
      topAdvertiser: topGoogleAdvertisers.find((a) => !a.isOwn)
        ? {
            name: topGoogleAdvertisers.find((a) => !a.isOwn)!.name,
            adCount: topGoogleAdvertisers.find((a) => !a.isOwn)!.adCount,
          }
        : null,
    });

    // ─── META · the cell market (AdMarketAdvertiser) ───────────────────────
    const metaRows =
      cell.category && cell.city
        ? await prisma.adMarketAdvertiser.findMany({
            where: {
              category: cell.category,
              city: cell.city,
              country: own.country ?? "US",
              platform: "META",
              isActive: true,
            },
            orderBy: { activeAdCount: "desc" },
            select: {
              pageId: true,
              pageName: true,
              handle: true,
              activeAdCount: true,
              platforms: true,
              runningSince: true,
              creatives: true,
              matchedBusinessId: true,
            },
          })
        : [];

    const metaAdvertisers: MetaAdvertiserCard[] = metaRows
      .slice(0, MAX_META_ADVERTISERS)
      .map((m) => ({
        pageId: m.pageId,
        name: m.pageName,
        handle: m.handle,
        isOwn: m.matchedBusinessId === own.id,
        adCount: m.activeAdCount,
        platforms: m.platforms,
        runningSince: m.runningSince,
        creatives: parseCreatives(m.creatives),
      }));

    // Platform spread across the whole cell (the optimization signal).
    const platCount = new Map<string, number>();
    for (const m of metaRows)
      for (const p of m.platforms)
        platCount.set(p, (platCount.get(p) ?? 0) + 1);
    const metaTotal = metaRows.length;
    const platformSpread: MetaPlatformStat[] = [...platCount.entries()]
      .map(([platform, advertisers]) => ({
        platform,
        advertisers,
        share: metaTotal > 0 ? advertisers / metaTotal : 0,
      }))
      .sort((a, b) => b.advertisers - a.advertisers);

    const ownMeta = metaRows.find((m) => m.matchedBusinessId === own.id);
    const ownMetaAdCount = ownMeta?.activeAdCount ?? 0;
    const ownMetaPlatforms = ownMeta?.platforms ?? [];
    const metaAdvertiserCount = metaRows.filter(
      (m) => m.matchedBusinessId !== own.id,
    ).length;
    const totalActiveAds = metaRows.reduce((s, m) => s + m.activeAdCount, 0);

    // Format mix — DETERMINISTIC, from the creatives' displayFormat (no AI).
    const fmtCount = new Map<string, number>();
    let fmtTotal = 0;
    for (const m of metaRows) {
      for (const c of parseCreatives(m.creatives)) {
        const label = formatLabel(c.format);
        if (!label) continue;
        fmtCount.set(label, (fmtCount.get(label) ?? 0) + 1);
        fmtTotal += 1;
      }
    }
    const formatMix: AdFormatStat[] = [...fmtCount.entries()]
      .map(([format, ads]) => ({
        format,
        ads,
        share: fmtTotal > 0 ? ads / fmtTotal : 0,
      }))
      .sort((a, b) => b.ads - a.ads);

    // Maria's own services — drives the service "win" gap + the youOffer flag.
    const ownServiceRows = await prisma.businessService.findMany({
      where: { businessId: own.id, isActive: true },
      select: { name: true },
    });
    const ownServices = ownServiceRows.map((s) => s.name);
    const ownServiceSet = new Set(ownServices.map((s) => s.toLowerCase()));

    // AI-extracted serviceMix + promos for the cell (P5 · pipeline-generated).
    const insightRow =
      cell.category && cell.city
        ? await prisma.adMarketInsight.findUnique({
            where: {
              category_city_country_platform: {
                category: cell.category,
                city: cell.city,
                country: own.country ?? "US",
                platform: "META",
              },
            },
            select: { serviceMix: true, promos: true, generatedAt: true },
          })
        : null;
    const rawServiceMix = parseServiceMix(insightRow?.serviceMix);
    const svcTotal = rawServiceMix.reduce((s, r) => s + r.ads, 0);
    const serviceMix: MarketServiceStat[] = rawServiceMix.map((r) => ({
      service: r.service,
      ads: r.ads,
      share: svcTotal > 0 ? r.ads / svcTotal : 0,
      youOffer: ownServiceSet.has(r.service.toLowerCase()),
    }));
    const promos = parsePromos(insightRow?.promos);

    const metaSuggestions = buildPersonalizedMetaSuggestions({
      ownAdCount: ownMetaAdCount,
      ownPlatforms: ownMetaPlatforms,
      advertiserCount: metaAdvertiserCount,
      ownServices,
      formatMix,
      serviceMix,
      promos,
    });

    const hasData =
      keywordCosts.length > 0 ||
      topGoogleAdvertisers.length > 0 ||
      metaAdvertisers.length > 0;

    return {
      ownedBusinessId: own.id,
      name: own.name,
      category: own.category ?? "",
      city: own.city ?? "",
      google: {
        ownAdCount: ownAdCountGoogle,
        totalSearchVolume,
        avgCpc,
        competition: competitionLabelFromIndex(
          avgIdx != null ? Math.round(avgIdx) : null,
        ),
        bestOpportunity,
        keywordCosts,
        topAdvertisers: topGoogleAdvertisers,
        advertiserCount: googleByBiz.size,
        ownRank: ownGoogleRank >= 0 ? ownGoogleRank + 1 : null,
        suggestions: googleSuggestions,
      },
      meta: {
        ownAdCount: ownMetaAdCount,
        ownPlatforms: ownMetaPlatforms,
        advertiserCount: metaAdvertiserCount,
        totalActiveAds,
        platformSpread,
        advertisers: metaAdvertisers,
        formatMix,
        serviceMix,
        promos,
        analyzedAt: insightRow?.generatedAt ?? null,
        suggestions: metaSuggestions,
      },
      quickWins: curateQuickWins(googleSuggestions, metaSuggestions),
      refreshedAt: own.adsScanLastAt ?? null,
      hasData,
    };
  } catch (e) {
    console.error("[smb-ads] query failed:", e);
    return EMPTY_SMB_ADS;
  }
}
