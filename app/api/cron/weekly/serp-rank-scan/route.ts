// Weekly · serp-rank-scan
//
// For each tracked `Keyword`, pull the latest organic SERP + Maps local
// pack and persist a `SerpResult` row. Joins SERP results back to our
// `Business` index by domain (organic) or by `cid` (local pack) so the
// dashboard's competitive view can show "where I rank vs Sara's Spa".
//
// Source: `services/dataforseo/serp-organic` +
// `services/dataforseo/serp-local-pack` (both Live tier, cached 24h).
//
// Cadence: weekly Monday 12:00 UTC per `vercel.json`. Bounded to 75
// keywords per run — most agencies track 10–30 keywords; 75 covers
// ~5 agencies' worth of keyword sets per invocation, and we rotate by
// `Keyword.refreshedAt asc nulls first` so the freshest data prevails.

import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import { serpOrganic, serpLocalPack } from "@/services/dataforseo";
import { runBatch, statusFromOutcome } from "../../_lib/batch";

const JOB = "weekly:serp-rank-scan";
const DEFAULT_LIMIT = 75;
const MAX_LIMIT = 250;
const SERP_DEPTH = 30;
const LOCAL_PACK_DEPTH = 20;

interface KeywordRow {
  id: string;
  keyword: string;
  locationCode: number;
  language: string;
}

export const GET = cronHandler(JOB, async ({ runId }) => {
  const limit = clampLimitFromEnv(DEFAULT_LIMIT, MAX_LIMIT);

  const keywords = (await prisma.keyword.findMany({
    select: {
      id: true,
      keyword: true,
      locationCode: true,
      language: true,
    },
    take: limit,
    orderBy: { refreshedAt: { sort: "asc", nulls: "first" } },
  })) as KeywordRow[];

  // Pre-index domains we know — minimizes DB lookups per item.
  const knownBusinessesByDomain = await loadKnownBusinessDomains();
  const knownBusinessesByCid = await loadKnownBusinessCids();

  const revalidatedKeywords = new Set<string>();
  let totalRows = 0;
  let totalLocalPackHits = 0;

  const outcome = await runBatch(keywords, async (kw: KeywordRow) => {
    const [organicRes, localRes] = await Promise.all([
      serpOrganic({
        keyword: kw.keyword,
        location_code: kw.locationCode,
        language_code: kw.language,
        depth: SERP_DEPTH,
      }),
      serpLocalPack({
        keyword: kw.keyword,
        location_code: kw.locationCode,
        language_code: kw.language,
        depth: LOCAL_PACK_DEPTH,
      }),
    ]);

    // Build per-business rows for any of our businesses that appear in
    // organic OR the local pack. The same business may have both an
    // organic + local-pack rank; we coalesce into one SerpResult row.
    type PerBizRanking = {
      businessId: string | null;
      organicRank: number | null;
      organicAbsRank: number | null;
      localPackRank: number | null;
      landingUrl: string | null;
    };
    const perBiz = new Map<string, PerBizRanking>();

    for (const item of organicRes.items) {
      if (item.type !== "organic" && item.type !== "answer_box") continue;
      const domain = normalizeDomain(item.domain);
      if (!domain) continue;
      const bizId = knownBusinessesByDomain.get(domain) ?? null;
      const key = bizId ?? `__domain:${domain}`;
      const prev = perBiz.get(key);
      perBiz.set(key, {
        businessId: bizId,
        organicRank: prev?.organicRank ?? item.rank_group ?? null,
        organicAbsRank: prev?.organicAbsRank ?? item.rank_absolute ?? null,
        localPackRank: prev?.localPackRank ?? null,
        landingUrl: prev?.landingUrl ?? item.url ?? null,
      });
    }

    // First three local-pack rows are the 3-pack; track all + ranks beyond
    // 3 still as `localPackRank` (the column tolerates >3 for analysis).
    const top3: Array<{ title: string | null }> = [];
    for (const item of localRes.items) {
      if (item.type !== "maps_search") continue;
      if (top3.length < 3) top3.push({ title: item.title ?? null });
      const cid = typeof item.cid === "string" ? item.cid : null;
      const bizId = cid ? (knownBusinessesByCid.get(cid) ?? null) : null;
      const key =
        bizId ?? (cid ? `__cid:${cid}` : `__rank:${item.rank_group ?? "x"}`);
      const prev = perBiz.get(key);
      perBiz.set(key, {
        businessId: bizId,
        organicRank: prev?.organicRank ?? null,
        organicAbsRank: prev?.organicAbsRank ?? null,
        localPackRank: prev?.localPackRank ?? item.rank_group ?? null,
        landingUrl: prev?.landingUrl ?? item.url ?? null,
      });
      if (item.rank_group != null && item.rank_group <= 3) {
        totalLocalPackHits += 1;
      }
    }

    // Only persist rows for businesses we recognize (businessId not null).
    // Unknown competitors are valuable as aggregate top-3 names but a
    // SerpResult row without `businessId` adds noise without a clear use.
    const scannedAt = new Date();
    for (const ranking of perBiz.values()) {
      if (!ranking.businessId) continue;
      try {
        await prisma.serpResult.create({
          data: {
            keywordId: kw.id,
            businessId: ranking.businessId,
            scannedAt,
            localPackRank: ranking.localPackRank,
            organicRank: ranking.organicRank,
            organicAbsRank: ranking.organicAbsRank,
            landingUrl: ranking.landingUrl,
            pack1Name: top3[0]?.title ?? null,
            pack2Name: top3[1]?.title ?? null,
            pack3Name: top3[2]?.title ?? null,
          },
        });
        totalRows += 1;
      } catch {
        // FK or other write error — log via outer batch failure path by
        // re-throwing only if it's a systemic issue. Per-item swallow.
      }
    }

    // Stamp keyword.refreshedAt regardless of how many businesses matched.
    await prisma.keyword.update({
      where: { id: kw.id },
      data: { refreshedAt: scannedAt },
    });

    revalidatedKeywords.add(kw.id);
  });

  for (const kwId of revalidatedKeywords) {
    revalidateTag(`kw-${kwId}`, "weeks");
  }

  return {
    itemsProcessed: outcome.succeeded,
    status: statusFromOutcome(outcome),
    meta: {
      runId,
      limit,
      attempted: outcome.attempted,
      succeeded: outcome.succeeded,
      failed: outcome.failures.length,
      totalRows,
      totalLocalPackHits,
      failureSample: outcome.failures.slice(0, 5).map((f) => ({
        keyword: (f.item as KeywordRow).keyword,
        error: f.error,
      })),
    },
  };
});

/**
 * Build a (normalized-domain → businessId) lookup table from active
 * businesses with a website. Done once per cron invocation; the lookup
 * is hot during the per-keyword inner loop and a per-row DB query would
 * be slower by ~100× on a 1000-business catalog.
 */
async function loadKnownBusinessDomains(): Promise<Map<string, string>> {
  const businesses = await prisma.business.findMany({
    where: { isActive: true, website: { not: null } },
    select: { id: true, website: true },
    take: 50_000,
  });
  const out = new Map<string, string>();
  for (const b of businesses) {
    const d = normalizeDomain(b.website);
    if (d && !out.has(d)) out.set(d, b.id);
  }
  return out;
}

/** Build (cid → businessId) lookup table. */
async function loadKnownBusinessCids(): Promise<Map<string, string>> {
  const businesses = await prisma.business.findMany({
    where: { isActive: true, googleCid: { not: null } },
    select: { id: true, googleCid: true },
    take: 50_000,
  });
  const out = new Map<string, string>();
  for (const b of businesses) {
    if (b.googleCid && !out.has(b.googleCid)) out.set(b.googleCid, b.id);
  }
  return out;
}

/**
 * Normalize a domain for comparison. Returns lowercased host without
 * `www.` prefix; null on parse failure or unsupported URL shape.
 *
 *   "https://www.SoleaBrickell.com/about" → "soleabrickell.com"
 *   "soleabrickell.com"                   → "soleabrickell.com"
 *   ""                                    → null
 */
export function normalizeDomain(
  input: string | null | undefined,
): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;
  try {
    // If it parses as URL, use the host.
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function clampLimitFromEnv(defaultLimit: number, max: number): number {
  const raw = process.env.CRON_WEEKLY_LIMIT;
  if (!raw) return defaultLimit;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultLimit;
  return Math.max(1, Math.min(parsed, max));
}

export const __test = {
  JOB,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  SERP_DEPTH,
  LOCAL_PACK_DEPTH,
  normalizeDomain,
  clampLimitFromEnv,
};
