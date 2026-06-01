// modules/ads-intel/collect-ads-intel.ts · the /ads collection pipeline.
//
// For a batch of businesses (Maria's own + same-market competitors), collect:
//   1. KEYWORD COSTS  · DataForSEO search_volume → cpc/competition/bids onto
//      the shared Keyword model (market-level · deduped per keyword+location).
//      Per business (TARGETS only) — competitors share the cell's keyword set.
//   2. GOOGLE ADS      · DataForSEO ads_search(target=domain) per business +
//      competitor → AdLibraryEntry(platform=GOOGLE). "Who advertises on Google."
//   3. META ADS        · per (category, city, country) MARKET CELL, NOT per
//      business: one service+city Ad Library search per cell → AdMarketAdvertiser
//      (see collect-cell-meta.ts). Cell-deduped + shared across the cell.
//
// All external calls flow through cost-counted adapters (they throw outside a
// CronRun). Google reconcile = new / heartbeat / ended. Bounded work per run
// (competitor cap + MAX_CELLS_PER_RUN) keeps a batch inside the function budget.

import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { keywordVolume, adsSearch } from "@/services/dataforseo";
import { adsServiceKeywords, locationCodeForCountry } from "./keyword-set";
import { matchStrength, nameMatches } from "./match";
import { collectCellMeta } from "./collect-cell-meta";

/** Same-market competitors pulled per business (bounded for cost + time). */
const MAX_COMPETITORS = 8;
/** Distinct (category, city, country) Meta market cells scanned per run. One
 *  warmed Apify run per cell is ~2-3 min, so a single cell + the DataForSEO
 *  pass fits the 300s Vercel function budget; additional cells in a bulk run
 *  are picked up by the weekly cron (cell-dedup guarantees none runs twice).
 *  Lifting this cap is the async Worker fan-out step (see client.ts Pattern A). */
const MAX_CELLS_PER_RUN = 1;
/** A creative is "active" if last seen within this window. */
const ACTIVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

interface BizLite {
  id: string;
  name: string;
  slug: string;
  category: string | null;
  categories: string[];
  city: string | null;
  country: string | null;
  domain: string | null;
  website: string | null;
  fbPageId: string | null;
  ownerUserId: string | null;
}

const BIZ_SELECT = {
  id: true,
  name: true,
  slug: true,
  category: true,
  categories: true,
  city: true,
  country: true,
  domain: true,
  website: true,
  fbPageId: true,
  ownerUserId: true,
} as const;

// ---- small helpers ------------------------------------------------------

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

/** Host from a stored domain/website (handles full URLs). */
function hostOf(biz: Pick<BizLite, "domain" | "website">): string | null {
  const raw = biz.domain ?? biz.website;
  if (!raw) return null;
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return (
      raw
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .split("/")[0] || null
    );
  }
}

interface AssignableAd {
  pageId?: string | null;
  pageName?: string | null;
  /** The input handle/URL the actor resolved this ad from (pageUrls path). */
  resolvedFromUrl?: string | null;
}
interface AssignableBiz {
  id: string;
  name: string;
  fbPageId: string | null;
  /** The FB handle we sent for this business in pageUrls (if any). */
  fbPageHandle?: string | null;
}

function sameHandle(
  a: string | null | undefined,
  b: string | null | undefined,
) {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/**
 * Assign each Meta ad to EXACTLY ONE business, by strongest signal:
 *   1. exact fbPageId match (cached numeric page id),
 *   2. exact resolvedFromUrl match (the handle WE sent — reliable even when the
 *      page name shares no distinctive token, e.g. "Leah V Skin Care"),
 *   3. a distinctive page-name token match (fallback).
 * A Meta page belongs to one advertiser and `externalAdId` is globally unique,
 * so a one-to-many assignment makes the second business's reconcile collide on
 * insert. Pure + exported for testing.
 */
export function assignMetaAdsToBusinesses<T extends AssignableAd>(
  rows: readonly T[],
  named: readonly AssignableBiz[],
): Map<string, T[]> {
  const perBiz = new Map<string, T[]>();
  for (const r of rows) {
    let best: { id: string; score: number } | null = null;
    for (const biz of named) {
      let score: number;
      if (biz.fbPageId && r.pageId && r.pageId === biz.fbPageId) {
        score = Number.MAX_SAFE_INTEGER;
      } else if (sameHandle(r.resolvedFromUrl, biz.fbPageHandle)) {
        score = Number.MAX_SAFE_INTEGER - 1;
      } else {
        score = matchStrength(r.pageName, biz.name);
      }
      if (score > 0 && (!best || score > best.score)) {
        best = { id: biz.id, score };
      }
    }
    if (best) {
      const arr = perBiz.get(best.id);
      if (arr) arr.push(r);
      else perBiz.set(best.id, [r]);
    }
  }
  return perBiz;
}

/** Exported for unit tests only. */
export const __test = { matchStrength, nameMatches };

// ---- reconcile ----------------------------------------------------------

interface EntryData {
  advertiserName?: string | null;
  advertiserExternalId?: string | null;
  pageId?: string | null;
  adCreativeBody?: string | null;
  ctaText?: string | null;
  linkTitle?: string | null;
  linkCaption?: string | null;
  displayFormat?: string | null;
  previewImageUrl?: string | null;
  landingUrl?: string | null;
  startedAt?: Date | null;
  endedAt?: Date | null;
  isActive?: boolean;
  collationCount?: number | null;
  platforms?: string[];
}

async function reconcileEntries(
  businessId: string,
  platform: "GOOGLE" | "META",
  rows: Array<{ externalAdId: string; data: EntryData }>,
): Promise<{ created: number; updated: number; ended: number }> {
  const known = await prisma.adLibraryEntry.findMany({
    where: { businessId, platform },
    select: { externalAdId: true, isActive: true },
  });
  const knownMap = new Map(known.map((k) => [k.externalAdId, k]));
  const seen = new Set<string>();
  let created = 0;
  let updated = 0;

  for (const r of rows) {
    if (!r.externalAdId) continue;
    seen.add(r.externalAdId);
    const ex = knownMap.get(r.externalAdId);
    if (ex) {
      await prisma.adLibraryEntry.update({
        where: { externalAdId: r.externalAdId },
        data: {
          ...r.data,
          lastSeenAt: new Date(),
          ...(ex.isActive ? {} : { isActive: true, endedAt: null }),
        },
      });
      updated += 1;
    } else {
      // Upsert (not create) keyed on the globally-unique externalAdId: if the
      // ad already exists under a DIFFERENT business (re-attributed across runs
      // as page-name matching shifts), re-point it here instead of colliding.
      await prisma.adLibraryEntry.upsert({
        where: { externalAdId: r.externalAdId },
        create: {
          ...r.data,
          externalAdId: r.externalAdId,
          businessId,
          platform,
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
        },
        update: {
          ...r.data,
          businessId,
          platform,
          lastSeenAt: new Date(),
          isActive: true,
          endedAt: null,
        },
      });
      created += 1;
    }
  }

  const stale = known
    .filter((k) => k.isActive && !seen.has(k.externalAdId))
    .map((k) => k.externalAdId);
  let ended = 0;
  if (stale.length > 0) {
    const upd = await prisma.adLibraryEntry.updateMany({
      where: { externalAdId: { in: stale } },
      data: { isActive: false, endedAt: new Date() },
    });
    ended = upd.count;
  }
  return { created, updated, ended };
}

// ---- per-step collectors ------------------------------------------------

/** Upsert market-level keyword cost data (cpc/competition/bids) for a
 *  business's service terms. Shared across the city cell via the unique
 *  (keyword, locationCode, language) key. */
async function collectKeywordCosts(biz: BizLite): Promise<number> {
  const keywords = adsServiceKeywords({
    category: biz.category,
    city: biz.city,
    serviceNames: biz.categories,
  });
  if (keywords.length === 0) return 0;
  const locationCode = locationCodeForCountry(biz.country);
  const { rows } = await keywordVolume({
    keywords,
    location_code: locationCode,
    language_code: "en",
  });
  let n = 0;
  for (const r of rows) {
    if (!r.keyword) continue;
    const competition =
      typeof r.competition === "string" ? r.competition : null;
    await prisma.keyword.upsert({
      where: {
        keyword_locationCode_language: {
          keyword: r.keyword.toLowerCase(),
          locationCode,
          language: "en",
        },
      },
      create: {
        keyword: r.keyword.toLowerCase(),
        locationCode,
        language: "en",
        searchVolume: r.search_volume ?? null,
        cpc: r.cpc ?? null,
        competition,
        competitionIndex: r.competition_index ?? null,
        lowTopOfPageBid: r.low_top_of_page_bid ?? null,
        highTopOfPageBid: r.high_top_of_page_bid ?? null,
        refreshedAt: new Date(),
      },
      update: {
        searchVolume: r.search_volume ?? null,
        cpc: r.cpc ?? null,
        competition,
        competitionIndex: r.competition_index ?? null,
        lowTopOfPageBid: r.low_top_of_page_bid ?? null,
        highTopOfPageBid: r.high_top_of_page_bid ?? null,
        refreshedAt: new Date(),
      },
    });
    n += 1;
  }
  return n;
}

/** Pull a business's Google ad creatives (Transparency) by its domain. */
async function collectGoogleAds(biz: BizLite): Promise<void> {
  const host = hostOf(biz);
  if (!host) return;
  const { items } = await adsSearch({
    target: host,
    location_code: locationCodeForCountry(biz.country),
    platform: "all",
    format: "all",
    depth: 40,
  });
  const rows = items
    .filter((it) => it.creative_id)
    .map((it) => ({
      externalAdId: String(it.creative_id),
      data: {
        advertiserName: biz.name,
        advertiserExternalId: it.advertiser_id ?? null,
        adCreativeBody: it.title ?? null,
        displayFormat: it.format ?? null,
        previewImageUrl: it.preview_image?.url ?? null,
        landingUrl: it.url ?? null,
        startedAt: parseDateOrNull(it.first_shown),
        endedAt: parseDateOrNull(it.last_shown),
        isActive: isRecentlyActive(it.last_shown),
        platforms: [] as string[],
      } satisfies EntryData,
    }));
  await reconcileEntries(biz.id, "GOOGLE", rows);
}

// ---- batch orchestrator -------------------------------------------------

export interface CollectAdsResult {
  businesses: number;
  keywordsUpserted: number;
  metaAds: number;
  metaRunUsd: number;
  errors: string[];
}

/**
 * Collect ads intelligence for a batch of businesses + their competitors.
 * MUST run inside an open CronRun (the adapters enforce this).
 */
export interface CollectAdsOptions {
  /** DataForSEO keyword-cost + Google-ad collection (fast). Default true. */
  dfs?: boolean;
  /** Meta Ad Library batched actor run (slow · own cron). Default true. */
  meta?: boolean;
}

export async function collectAdsForBatch(
  businessIds: readonly string[],
  opts: CollectAdsOptions = {},
): Promise<CollectAdsResult> {
  const doDfs = opts.dfs ?? true;
  const doMeta = opts.meta ?? true;
  const result: CollectAdsResult = {
    businesses: 0,
    keywordsUpserted: 0,
    metaAds: 0,
    metaRunUsd: 0,
    errors: [],
  };
  if (businessIds.length === 0) return result;

  const targets = await prisma.business.findMany({
    where: { id: { in: [...businessIds] }, isActive: true },
    select: BIZ_SELECT,
  });

  // Collect the full set of businesses we'll scan (targets + their
  // competitors) so Meta runs once across all unique names.
  const allById = new Map<string, BizLite>();
  const competitorsByTarget = new Map<string, BizLite[]>();

  for (const t of targets) {
    allById.set(t.id, t);
    const competitors =
      t.category && t.city
        ? await prisma.business.findMany({
            where: {
              category: t.category,
              city: t.city,
              isActive: true,
              id: { not: t.id },
            },
            take: MAX_COMPETITORS,
            orderBy: { reviewCount: "desc" },
            select: BIZ_SELECT,
          })
        : [];
    competitorsByTarget.set(t.id, competitors);
    for (const c of competitors) allById.set(c.id, c);
  }

  const everyBiz = Array.from(allById.values());

  if (doDfs) {
    // 1 · keyword costs — TARGETS only. Market-level (per keyword+location);
    // competitors share the target's keyword set, so paying for a per-
    // competitor pull would be wasted spend.
    for (const biz of targets) {
      try {
        result.keywordsUpserted += await collectKeywordCosts(biz);
      } catch (e) {
        result.errors.push(
          `kw:${biz.slug}:${(e as Error).message}`.slice(0, 200),
        );
      }
    }
    // 2 · Google ads — every business (targets + competitors = "who advertises").
    for (const biz of everyBiz) {
      try {
        await collectGoogleAds(biz);
      } catch (e) {
        result.errors.push(
          `google:${biz.slug}:${(e as Error).message}`.slice(0, 200),
        );
      }
    }
  }

  // 3 · Meta · the CELL MARKET path. Group the scanned businesses into
  // (category, city, country) cells and run ONE Meta service+city market search
  // per unique cell (collectCellMeta) — shared across every business in it, NOT
  // per business. This is the cell-dedup pattern (mirrors SERP); the probe
  // proved service+city keyword search returns relevant local advertisers,
  // unlike the noisy business-NAME search the old per-business path used.
  if (doMeta) {
    const cells = new Map<string, BizLite[]>();
    for (const b of everyBiz) {
      if (!b.category || !b.city) continue;
      const key = `${b.category}||${b.city}||${b.country ?? ""}`;
      const arr = cells.get(key);
      if (arr) arr.push(b);
      else cells.set(key, [b]);
    }
    // Cells containing a TARGET first (those are what this run is "about"),
    // then bounded so an inline run stays inside the function budget.
    const targetIds = new Set(targets.map((t) => t.id));
    const orderedCells = [...cells.values()].sort((a, b) => {
      const at = a.some((x) => targetIds.has(x.id)) ? 0 : 1;
      const bt = b.some((x) => targetIds.has(x.id)) ? 0 : 1;
      return at - bt;
    });
    for (const members of orderedCells.slice(0, MAX_CELLS_PER_RUN)) {
      const head = members[0]!;
      try {
        const out = await collectCellMeta({
          category: head.category!,
          city: head.city!,
          country: head.country ?? "US",
          businessIds: members.map((m) => m.id),
        });
        result.metaAds += out.advertisers;
        result.metaRunUsd += out.runUsd;
        result.errors.push(...out.errors);
      } catch (e) {
        result.errors.push(`cell-meta:${(e as Error).message}`.slice(0, 200));
      }
    }
  }

  // Stamp freshness + revalidate the owner-facing cache for target businesses.
  const now = new Date();
  for (const t of targets) {
    // Only the DataForSEO pass advances the freshness cursor; the Meta cron
    // follows it (orders by adsScanLastAt desc) and must not reset it.
    if (doDfs) {
      await prisma.business.update({
        where: { id: t.id },
        data: { adsScanLastAt: now },
      });
    }
    if (t.ownerUserId) {
      try {
        revalidateTag(`smb-ads-${t.ownerUserId}`, "hours");
      } catch {
        // revalidateTag only works inside a Next request/render scope. From a
        // standalone script (or if the store is missing) the data is already
        // written — the next cached read picks it up. Never fail the run on it.
      }
    }
  }
  result.businesses = targets.length;
  return result;
}
