// modules/cell-intel/serp.ts · per-cell SERP collector (Phase 6).
//
// Run ONCE per cell, cache 30 days, serve from DB if fresh. For a cell:
//   1. If a fresh (≤30d) AdMarketRun(platform=SERP) exists → served-from-DB.
//   2. Else, for the cell's representative keyword:
//        a. upsert the Keyword row (shared market-level cost layer),
//        b. ONE DEEP maps scan (depth ~300) → attribute a Maps rank to ~EVERY
//           business via Google CID (100% populated → not the fuzzy title match
//           that reached ~17 of 400) → SerpResult(kind=MAPS),
//        c. ONE deeper serpOrganic scan (depth 100) → attribute organic ranks by
//           domain, SKIPPING booking/social hosts (vagaro/instagram) so a
//           platform "website" can't steal a ranking → SerpResult(kind=ORGANIC),
//        d. rankedKeywords for a SMALL selected set of businesses (cap) →
//           upsert Keyword + BusinessKeyword with etv / visits / traffic-value,
//        e. one AdMarketRun(platform=SERP) telemetry row.
//
// AdMarketRun is reused as the per-cell run marker for ALL three layers so the
// freshness gate + dashboard telemetry share one shape (platform="SERP").
//
// MUST run inside an open CronRun (the DataForSEO adapters enforce this).

import prisma, { Prisma } from "@/lib/prisma";
import { mapsSearch, serpOrganic, rankedKeywords } from "@/services/dataforseo";
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

/** Businesses we pull a full ranked_keywords portfolio for (cost-bounded). */
const MAX_RANKED_KEYWORD_BIZ = 3;
/** Max ranked_keywords rows persisted per business (best-ranked first). */
const MAX_RANKED_ROWS_PER_BIZ = 50;
/** Deep maps listing limit — attribute a maps rank to ~EVERY business in the
 *  cell (the old 3-result web local-pack reached ~1). Business-Listings search,
 *  CID-matched. */
const MAPS_SCAN_DEPTH = 300;
/** Organic scan depth — reach beyond the head-term top-20 without tripping the
 *  DfS transport timeout that a depth-100 scrape hit. */
const ORGANIC_SCAN_DEPTH = 50;

/**
 * Booking / social / aggregator hosts many SMBs list as their "website"
 * (e.g. a barber whose only site is vagaro.com or an instagram.com page). A SERP
 * result on one of these is the PLATFORM's ranking, not the business's, so we
 * NEVER reverse-attribute an organic result by these domains — the same
 * platform-domain false-positive the google_ads per-business rebuild fixed. Maps
 * attribution is unaffected (it keys off the business's own Google CID).
 */
const PLATFORM_HOSTS = new Set([
  "vagaro.com",
  "fresha.com",
  "booksy.com",
  "setmore.com",
  "squareup.com",
  "square.site",
  "getsquire.com",
  "trafft.com",
  "schedulicity.com",
  "instagram.com",
  "facebook.com",
  "m.facebook.com",
  "linktr.ee",
  "google.com",
  "sites.google.com",
  "wixsite.com",
  "business.site",
]);
function isPlatformHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (PLATFORM_HOSTS.has(h)) return true;
  // subdomains (e.g. crownbarbershop.setmore.com, foo.square.site).
  for (const p of PLATFORM_HOSTS) if (h.endsWith("." + p)) return true;
  return false;
}

export interface CellSerpResult {
  cellKey: string;
  outcome: "served-from-db" | "collected" | "skipped";
  keyword: string | null;
  /** SerpResult rows written (Maps + Organic, attributed to indexed biz). */
  serpRowsWritten: number;
  /** BusinessKeyword rows upserted from ranked_keywords. */
  businessKeywordsUpserted: number;
  costUsd: number;
  errors: string[];
}

/** Match a SERP item title/domain back to an indexed business. */
function matchByTitle(
  title: string | null | undefined,
  businesses: readonly CellBusiness[],
): string | null {
  const t = (title ?? "").toLowerCase().trim();
  if (!t) return null;
  for (const b of businesses) {
    const bn = b.name.toLowerCase().trim();
    if (bn.length >= 3 && (t.includes(bn) || bn.includes(t))) return b.id;
  }
  return null;
}

function matchByDomain(
  domain: string | null | undefined,
  byHost: Map<string, string>,
): string | null {
  if (!domain) return null;
  const host = domain.toLowerCase().replace(/^www\./, "");
  return byHost.get(host) ?? null;
}

/**
 * Collect SERP intelligence for one cell, gated by the 30-day freshness window.
 * MUST run inside an open CronRun.
 */
export async function runSerpForCell(
  cellKey: string,
  now: Date = new Date(),
  opts: { force?: boolean } = {},
): Promise<CellSerpResult> {
  const result: CellSerpResult = {
    cellKey,
    outcome: "skipped",
    keyword: null,
    serpRowsWritten: 0,
    businessKeywordsUpserted: 0,
    costUsd: 0,
    errors: [],
  };

  // 1 · freshness gate (opts.force bypasses it — admin re-run / redesign re-scan).
  if (!opts.force) {
    const last = await latestAdMarketRun(cellKey, "SERP");
    if (isCellRunFresh(last?.ranAt ?? null, now, CELL_INTEL_FRESHNESS_DAYS)) {
      result.outcome = "served-from-db";
      return result;
    }
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
  result.keyword = keyword;

  // Reverse-attribution maps. CID is the RELIABLE key for maps results (every
  // listing carries its cid; 100% populated from discovery) — build it first.
  // byHost is the fallback for ORGANIC results (which carry a domain, not a cid);
  // it SKIPS platform hosts so a booking/social "website" can't steal a ranking.
  const byCid = new Map<string, string>();
  const byHost = new Map<string, string>();
  for (const b of ctx.businesses) {
    if (b.googleCid) byCid.set(b.googleCid, b.id);
    const host = hostOf(b);
    if (host && !isPlatformHost(host)) byHost.set(host, b.id);
  }

  // 3 · upsert the shared Keyword row (market-level, cell-deduped).
  let keywordId: string;
  try {
    const kw = await prisma.keyword.upsert({
      where: {
        keyword_locationCode_language: {
          keyword: keyword.toLowerCase(),
          locationCode: ctx.locationCode,
          language: "en",
        },
      },
      create: {
        keyword: keyword.toLowerCase(),
        locationCode: ctx.locationCode,
        language: "en",
        refreshedAt: now,
      },
      update: { refreshedAt: now },
      select: { id: true },
    });
    keywordId = kw.id;
  } catch (e) {
    result.errors.push(`keyword:${(e as Error).message}`.slice(0, 200));
    await prisma.adMarketRun.create({
      data: {
        cellKey,
        platform: "SERP",
        status: "FAILED",
        costUsd: result.costUsd,
        advertiserCount: 0,
        adCount: 0,
      },
    });
    return result;
  }

  // 4 · ONE DEEP Maps scan → attribute a maps rank to ~EVERY business in the
  // cell via Google CID (reliable + platform-proof; 100% populated). This is the
  // core fix: the old depth-20 title/domain match reached ~17 of a 400-biz cell;
  // depth-300 CID-matching reaches essentially all of them.
  try {
    // Use Business Listings (Maps) search — the SAME endpoint discovery used to
    // build this cell, so every returned row carries a `cid` matching our stored
    // googleCid. It returns the FULL category listing ranked by Maps prominence
    // (up to ~1000), NOT the 3-result web local-pack, so we attribute a maps rank
    // to ~every business. The array order IS the maps rank. Category-filtered to
    // the cell's vertical, so the top-3 are the real "3-pack" (not adjacent hair
    // salons a web local-pack mixes in).
    const { items } = await mapsSearch({
      categories: [ctx.categorySlug],
      location_coordinate: ctx.locationCoordinate,
      language_code: "en",
      limit: MAPS_SCAN_DEPTH,
    });
    const pack = items.slice(0, 3).map((it) => it.title ?? null);
    const mapsRows: Prisma.SerpResultCreateManyInput[] = [];
    const mapsSeen = new Set<string>();
    let mapsRank = 0;
    for (const it of items) {
      mapsRank += 1;
      // CID is the reliable key (100% populated, same discovery source);
      // title/domain only for the rare row missing a cid.
      const businessId =
        (it.cid && byCid.get(it.cid)) ||
        matchByTitle(it.title, ctx.businesses) ||
        matchByDomain(it.domain, byHost);
      if (!businessId || mapsSeen.has(businessId)) continue;
      mapsSeen.add(businessId);
      mapsRows.push({
        keywordId,
        businessId,
        kind: "MAPS",
        scannedAt: now,
        localPackRank: mapsRank <= 3 ? mapsRank : null,
        organicAbsRank: mapsRank,
        landingUrl: it.url ?? null,
        pack1Name: pack[0] ?? null,
        pack2Name: pack[1] ?? null,
        pack3Name: pack[2] ?? null,
      });
    }
    if (mapsRows.length > 0) {
      await prisma.serpResult.createMany({ data: mapsRows });
      result.serpRowsWritten += mapsRows.length;
    }
  } catch (e) {
    result.errors.push(`maps:${(e as Error).message}`.slice(0, 200));
  }

  // 5 · ONE organic scan → reverse-attribute per-business organic ranks.
  try {
    const { items } = await serpOrganic({
      keyword,
      location_code: ctx.locationCode,
      language_code: "en",
      device: "mobile",
      depth: ORGANIC_SCAN_DEPTH,
    });
    // WP9-9 · same batching as the Maps section — one createMany, bounded rows.
    const organicRows: Prisma.SerpResultCreateManyInput[] = [];
    for (const it of items) {
      if (it.type !== "organic") continue;
      const businessId =
        matchByDomain(it.domain, byHost) ??
        matchByTitle(it.title, ctx.businesses);
      if (!businessId) continue;
      organicRows.push({
        keywordId,
        businessId,
        kind: "ORGANIC",
        scannedAt: now,
        organicRank: it.rank_group ?? null,
        organicAbsRank: it.rank_absolute ?? null,
        landingUrl: it.url ?? null,
      });
    }
    if (organicRows.length > 0) {
      await prisma.serpResult.createMany({ data: organicRows });
      result.serpRowsWritten += organicRows.length;
    }
  } catch (e) {
    result.errors.push(`organic:${(e as Error).message}`.slice(0, 200));
  }

  // 6 · rankedKeywords for a SMALL selected set (businesses with a domain).
  // One Live call per business returns the full portfolio with etv +
  // traffic-value; cap the set hard so the cell stays cheap.
  const ranked = ctx.businesses
    .filter((b) => hostOf(b) != null)
    .slice(0, MAX_RANKED_KEYWORD_BIZ);

  for (const biz of ranked) {
    const host = hostOf(biz);
    if (!host) continue;
    try {
      const { items } = await rankedKeywords({
        target: host,
        location_code: ctx.locationCode,
        language_code: "en",
        limit: 1000,
        filters: [["ranked_serp_element.serp_item.rank_group", "<=", 50]],
        order_by: ["ranked_serp_element.serp_item.rank_group,asc"],
      });
      for (const item of items.slice(0, MAX_RANKED_ROWS_PER_BIZ)) {
        const kwText = item.keyword_data.keyword?.trim();
        if (!kwText) continue;
        const info = item.keyword_data.keyword_info ?? null;
        const serp = item.ranked_serp_element?.serp_item ?? null;

        const competition =
          typeof info?.competition_level === "string"
            ? info.competition_level
            : null;

        const k = await prisma.keyword.upsert({
          where: {
            keyword_locationCode_language: {
              keyword: kwText.toLowerCase(),
              locationCode: ctx.locationCode,
              language: "en",
            },
          },
          create: {
            keyword: kwText.toLowerCase(),
            locationCode: ctx.locationCode,
            language: "en",
            searchVolume: info?.search_volume ?? null,
            cpc: info?.cpc ?? null,
            competition,
            refreshedAt: now,
          },
          update: {
            searchVolume: info?.search_volume ?? null,
            cpc: info?.cpc ?? null,
            competition,
            refreshedAt: now,
          },
          select: { id: true },
        });

        await prisma.businessKeyword.upsert({
          where: {
            businessId_keywordId: { businessId: biz.id, keywordId: k.id },
          },
          create: {
            businessId: biz.id,
            keywordId: k.id,
            source: "ranked",
            latestOrganicRank: serp?.rank_group ?? null,
            latestLandingUrl: serp?.url ?? null,
            latestEstTrafficUsd: serp?.estimated_paid_traffic_cost ?? null,
            latestEstMonthlyVisits: serp?.etv ?? null,
            latestScanAt: now,
            isNew: serp?.is_new ?? false,
            isUp: serp?.is_up ?? false,
            isDown: serp?.is_down ?? false,
          },
          update: {
            latestOrganicRank: serp?.rank_group ?? null,
            latestLandingUrl: serp?.url ?? null,
            latestEstTrafficUsd: serp?.estimated_paid_traffic_cost ?? null,
            latestEstMonthlyVisits: serp?.etv ?? null,
            latestScanAt: now,
            isNew: serp?.is_new ?? false,
            isUp: serp?.is_up ?? false,
            isDown: serp?.is_down ?? false,
          },
        });
        result.businessKeywordsUpserted += 1;
      }
    } catch (e) {
      result.errors.push(
        `ranked:${biz.slug}:${(e as Error).message}`.slice(0, 200),
      );
    }
  }

  // 7 · telemetry run row (reuse AdMarketRun with platform="SERP").
  await prisma.adMarketRun.create({
    data: {
      cellKey,
      platform: "SERP",
      status: result.errors.length > 0 ? "PARTIAL" : "OK",
      costUsd: result.costUsd,
      advertiserCount: 0,
      adCount: result.serpRowsWritten,
    },
  });

  result.outcome = "collected";
  return result;
}
