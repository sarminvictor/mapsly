/**
 * Cold-email signal gatherer — the REAL per-business data the copy engine
 * (modules/cold/copy.ts) renders into each touch. Everything here is computed
 * from Mapsly's own snapshots + section tables, so every claim in an email is
 * backed by data the recipient can verify on their /l report.
 *
 * Honesty discipline: a field is null/0 when we genuinely don't have it, and
 * the copy engine omits any line whose signal is absent — we never fabricate a
 * number or name a competitor we can't show (cold-email audit 2026-06-14).
 *
 * Cell-level ad market totals are identical for every business in a cell, so
 * they're memoized per cellKey for the duration of a process (cheap for both
 * the send cron and the all-companies HTML preview).
 */
import prisma from "@/lib/prisma";

export interface ColdSignals {
  businessId: string;
  businessName: string;
  city: string | null;
  category: string | null;
  /** Customer noun for this category ("patients" / "clients" / …). */
  noun: string;

  rating: number | null;
  reviewCount: number | null;

  /** Best-position market rank + cell size (e.g. 73 of 256). Stored on the
   * latest snapshot's pillarRanks.master — refreshed weekly. */
  rank: number | null;
  rankTotal: number | null;
  /** Overall Mapsly score 0–10. */
  mapslyScore: number | null;

  /** Reviews with no owner reply, and the subset at 1–2★. */
  unanswered: number;
  unansweredNegative: number;

  /** Mobile LCP rounded to whole seconds — only when ≥ 4s (a credible hook). */
  websiteSlowSeconds: number | null;
  /** Lighthouse mobile performance 0–100, or null. */
  websiteScore: number | null;

  /** Own active ads (Google creatives + matched Meta). */
  ownAds: number;
  /** Whole-cell active ads + advertiser count (Meta + Google). */
  marketActiveAds: number;
  marketAdvertiserCount: number;
  /** Rivals advertising in the same city+category (excludes self). */
  competitorAdsCount: number;
}

/** Map of category → customer noun (med-spa campaign is "patients"). */
function nounFor(category: string | null): string {
  const c = (category ?? "").toLowerCase();
  if (/med spa|medical|spa|aesthetic|derma|clinic|botox|laser|wellness/.test(c))
    return "patients";
  if (/salon|hair|nail|lash|barber|beauty/.test(c)) return "clients";
  return "customers";
}

interface Cell {
  category: string;
  city: string;
  country: string;
}
function parseCell(key: string | null): Cell | null {
  if (!key) return null;
  const parts = key.split("|");
  if (parts.length < 3) return null;
  const country = parts[parts.length - 1]!.trim();
  const city = parts[parts.length - 2]!.trim();
  const category = parts
    .slice(0, parts.length - 2)
    .join("|")
    .trim();
  if (!category || !city || !country) return null;
  return { category, city, country };
}

/** Per-process memo of cell-wide ad totals (same for every member of a cell). */
const cellAdCache = new Map<
  string,
  { advertisers: number; activeAds: number }
>();

async function marketAds(
  cellKey: string,
  cell: Cell,
): Promise<{ advertisers: number; activeAds: number }> {
  const cached = cellAdCache.get(cellKey);
  if (cached) return cached;
  // Meta advertisers live in AdMarketAdvertiser; Google ads live per-creative in
  // AdLibraryEntry on the cell's qualified members (mirrors the /l report).
  const memberIds = (
    await prisma.businessSnapshot.findMany({
      where: {
        cellKey,
        business: { isActive: true, qualificationStatus: "QUALIFIED" },
      },
      distinct: ["businessId"],
      select: { businessId: true },
    })
  ).map((s) => s.businessId);
  const [metaAgg, googleRows] = await Promise.all([
    prisma.adMarketAdvertiser.aggregate({
      where: { ...cell, isActive: true },
      _count: { _all: true },
      _sum: { activeAdCount: true },
    }),
    memberIds.length > 0
      ? prisma.adLibraryEntry.findMany({
          where: {
            platform: "GOOGLE",
            isActive: true,
            businessId: { in: memberIds },
          },
          select: { businessId: true },
        })
      : Promise.resolve([] as { businessId: string | null }[]),
  ]);
  const googleAdvertisers = new Set(
    googleRows.map((g) => g.businessId).filter(Boolean) as string[],
  );
  const result = {
    advertisers: (metaAgg._count._all ?? 0) + googleAdvertisers.size,
    activeAds: (metaAgg._sum.activeAdCount ?? 0) + googleRows.length,
  };
  cellAdCache.set(cellKey, result);
  return result;
}

/** Gather the full cold-signal set for a business, or null if it's gone. */
export async function gatherColdSignals(
  businessId: string,
): Promise<ColdSignals | null> {
  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      city: true,
      category: true,
      rating: true,
      reviewCount: true,
      snapshots: {
        take: 1,
        orderBy: { snapshotDate: "desc" },
        select: {
          cellKey: true,
          cellSize: true,
          pillarRanks: true,
          pillarScore: true,
        },
      },
      lighthouseAudits: {
        take: 1,
        orderBy: { auditedAt: "desc" },
        select: { lcp: true, performance: true },
      },
      adLibraryEntries: { where: { isActive: true }, select: { id: true } },
    },
  });
  if (!biz) return null;

  const snap = biz.snapshots[0] ?? null;
  const master = (
    snap?.pillarRanks as { master?: { rank?: number; of?: number } } | null
  )?.master;
  const rank = typeof master?.rank === "number" ? master.rank : null;
  const rankTotal =
    typeof master?.of === "number" ? master.of : (snap?.cellSize ?? null);

  const [unanswered, unansweredNegative, ownMetaAgg] = await Promise.all([
    prisma.review.count({ where: { businessId, ownerReplied: false } }),
    prisma.review.count({
      where: { businessId, ownerReplied: false, stars: { lte: 2 } },
    }),
    prisma.adMarketAdvertiser.aggregate({
      where: { matchedBusinessId: businessId, isActive: true },
      _sum: { activeAdCount: true },
    }),
  ]);
  const ownAds =
    biz.adLibraryEntries.length + (ownMetaAgg._sum.activeAdCount ?? 0);

  const cell = parseCell(snap?.cellKey ?? null);
  const market =
    cell && snap?.cellKey
      ? await marketAds(snap.cellKey, cell)
      : { advertisers: 0, activeAds: 0 };

  let competitorAdsCount = 0;
  if (ownAds === 0 && biz.city && biz.category) {
    const rivals = await prisma.adLibraryEntry.findMany({
      where: {
        isActive: true,
        businessId: { not: businessId },
        business: { city: biz.city, category: biz.category },
      },
      select: { businessId: true },
      distinct: ["businessId"],
      take: 50,
    });
    competitorAdsCount = rivals.length;
  }

  const lcp = biz.lighthouseAudits[0]?.lcp ?? null;
  return {
    businessId: biz.id,
    businessName: biz.name,
    city: biz.city,
    category: biz.category,
    noun: nounFor(biz.category),
    rating: biz.rating,
    reviewCount: biz.reviewCount,
    rank,
    rankTotal,
    mapslyScore: snap?.pillarScore ?? null,
    unanswered,
    unansweredNegative,
    websiteSlowSeconds: lcp != null && lcp >= 4 ? Math.round(lcp) : null,
    websiteScore: biz.lighthouseAudits[0]?.performance ?? null,
    ownAds,
    marketActiveAds: market.activeAds,
    marketAdvertiserCount: market.advertisers,
    competitorAdsCount,
  };
}
