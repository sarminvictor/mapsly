/**
 * Public landing-page server queries.
 *
 * `resolveLandingToken(param)` is the lookup gate: parse the `/l/[param]`
 * segment, find the LandingPage by its numeric token, check active, verify the
 * cosmetic slug matches (mismatch → null → 404). Not cached — a single indexed
 * unique lookup, and it's the access gate.
 *
 * `getLandingData(businessId)` assembles the page payload from the business's
 * REAL latest snapshot + section tables + the market-cell reference
 * (CellMetric, AdMarketAdvertiser, peer reviews), reusing
 * `buildOverviewForBusiness` (the same market-overview core behind `/home`).
 * Cached per business (`landing-${businessId}`).
 *
 * Per `.claude/rules/cache-components.md` Pattern 1, both short-circuit during
 * the Vercel build phase (no Neon WebSocket) — returning `null`, which the page
 * renders as `notFound()`.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";
import { buildOverviewForBusiness } from "@/modules/smb-home/queries";

import { parseLandingParam } from "./token";
import {
  EMPTY_LANDING_ADS,
  EMPTY_LANDING_REVIEWS,
  EMPTY_LANDING_SEARCH,
  EMPTY_LANDING_WEBSITE,
  LANDING_WEBSITE_CHECK_LABELS,
  type LandingAdsData,
  type LandingChange,
  type LandingData,
  type LandingGap,
  type LandingReviewsData,
  type LandingSearchData,
  type LandingWebsiteCheck,
  type LandingWebsiteData,
} from "./types";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface ResolvedLanding {
  landingPageId: string;
  businessId: string;
  slug: string;
  token: string;
}

/** Resolve a `/l/[param]` segment to its landing page, or null (→ 404). */
export async function resolveLandingToken(
  param: string,
): Promise<ResolvedLanding | null> {
  if (process.env.NEXT_PHASE === "phase-production-build") return null;
  const parsed = parseLandingParam(param);
  if (!parsed) return null;
  try {
    const lp = await prisma.landingPage.findUnique({
      where: { token: parsed.token },
      select: {
        id: true,
        businessId: true,
        slug: true,
        token: true,
        isActive: true,
      },
    });
    if (!lp || !lp.isActive) return null;
    if (lp.slug !== parsed.slug) return null;
    return {
      landingPageId: lp.id,
      businessId: lp.businessId,
      slug: lp.slug,
      token: lp.token,
    };
  } catch {
    return null;
  }
}

/** Assemble the full landing payload for a business, or null (→ 404). */
export async function getLandingData(
  businessId: string,
): Promise<LandingData | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`landing-${businessId}`);

  if (process.env.NEXT_PHASE === "phase-production-build") return null;
  if (!businessId || typeof businessId !== "string") return null;

  try {
    const [overview, biz] = await Promise.all([
      buildOverviewForBusiness(businessId),
      prisma.business.findUnique({
        where: { id: businessId },
        select: {
          id: true,
          name: true,
          slug: true,
          category: true,
          address: true,
          city: true,
          province: true,
          country: true,
          website: true,
          rating: true,
          reviewCount: true,
          placeTopics: true,
        },
      }),
    ]);

    if (!biz) return null;

    const inCell = Boolean(biz.city && biz.country);
    const cellWhere = inCell
      ? { category: biz.category, city: biz.city!, country: biz.country! }
      : null;

    const [
      keywordRows,
      ownAdCount,
      adCompetitors,
      adAgg,
      reviewTotal,
      reviewReplied,
      reviewCohort,
      audit,
      cellMetric,
      betterReviewed,
    ] = await Promise.all([
      prisma.businessKeyword.findMany({
        where: { businessId },
        take: 200,
        select: {
          latestOrganicRank: true,
          latestMapsRank: true,
          latestEstMonthlyVisits: true,
          keyword: { select: { keyword: true, searchVolume: true } },
        },
      }),
      prisma.adLibraryEntry.count({ where: { businessId, isActive: true } }),
      cellWhere
        ? prisma.adMarketAdvertiser.findMany({
            where: { ...cellWhere, isActive: true },
            orderBy: { activeAdCount: "desc" },
            take: 6,
            select: {
              pageName: true,
              platforms: true,
              activeAdCount: true,
              matchedBusinessId: true,
            },
          })
        : Promise.resolve([]),
      cellWhere
        ? prisma.adMarketAdvertiser.aggregate({
            where: { ...cellWhere, isActive: true },
            _count: { _all: true },
            _sum: { activeAdCount: true },
          })
        : Promise.resolve(null),
      prisma.review.count({ where: { businessId } }),
      prisma.review.count({ where: { businessId, ownerReplied: true } }),
      cellWhere
        ? prisma.business.findMany({
            where: { ...cellWhere, isActive: true, reviewCount: { not: null } },
            orderBy: { reviewCount: "desc" },
            take: 8,
            select: { id: true, name: true, rating: true, reviewCount: true },
          })
        : Promise.resolve([]),
      prisma.lighthouseAudit.findFirst({
        where: { businessId },
        orderBy: { auditedAt: "desc" },
        select: {
          performance: true,
          seo: true,
          lcp: true,
          cls: true,
          inp: true,
          hasLocalBusinessSchema: true,
          hasFaqSchema: true,
          hasBookingCtaAboveFold: true,
          hasPhoneAboveFold: true,
          napConsistent: true,
          contentWithoutJs: true,
          auditedAt: true,
        },
      }),
      cellWhere
        ? prisma.cellMetric.findFirst({
            where: cellWhere,
            select: {
              lighthousePerfP50: true,
              reviewCountP50: true,
              reviewCountP90: true,
              ratingP50: true,
              distributions: true,
              sampleSize: true,
            },
          })
        : Promise.resolve(null),
      cellWhere && biz.reviewCount != null
        ? prisma.business.count({
            where: {
              ...cellWhere,
              isActive: true,
              reviewCount: { gt: biz.reviewCount },
            },
          })
        : Promise.resolve(0),
    ]);

    // Per-peer review aggregates (reply rate + 30d trend) over the cohort + self.
    const peerIds = Array.from(
      new Set([businessId, ...reviewCohort.map((c) => c.id)]),
    );
    const since30 = new Date(Date.now() - THIRTY_DAYS_MS);
    const [peerTotals, peerReplied, peerRecent] = await Promise.all([
      prisma.review.groupBy({
        by: ["businessId"],
        where: { businessId: { in: peerIds } },
        _count: { _all: true },
      }),
      prisma.review.groupBy({
        by: ["businessId"],
        where: { businessId: { in: peerIds }, ownerReplied: true },
        _count: { _all: true },
      }),
      prisma.review.groupBy({
        by: ["businessId"],
        where: { businessId: { in: peerIds }, postedAt: { gte: since30 } },
        _count: { _all: true },
      }),
    ]);
    const totalsMap = new Map(
      peerTotals.map((r) => [r.businessId, r._count._all]),
    );
    const repliedMap = new Map(
      peerReplied.map((r) => [r.businessId, r._count._all]),
    );
    const recentMap = new Map(
      peerRecent.map((r) => [r.businessId, r._count._all]),
    );

    const search = buildSearch(keywordRows, overview?.visibility ?? null);
    const adsDetail = buildAds(
      ownAdCount,
      adCompetitors,
      adAgg,
      businessId,
      overview?.ads ?? null,
      overview?.adsApplicable ?? null,
    );
    const reviews = buildReviews({
      rating: biz.rating,
      reviewCount: biz.reviewCount,
      total: reviewTotal,
      replied: reviewReplied,
      placeTopics: biz.placeTopics,
      cohort: reviewCohort,
      businessId,
      pillar: overview?.reputation ?? null,
      yourRank: biz.reviewCount != null ? betterReviewed + 1 : null,
      rankedTotal: cellMetric?.sampleSize ?? null,
      trend30d: recentMap.get(businessId) ?? 0,
      totalsMap,
      repliedMap,
      recentMap,
    });
    const websiteDetail = buildWebsite(
      audit,
      biz.website,
      overview?.website ?? null,
      cellMetric?.lighthousePerfP50 ?? null,
      industryBestPerf(cellMetric?.distributions),
    );
    const gap = buildGap(biz.category, search);
    const changes = buildChanges(
      overview?.rankDelta ?? null,
      overview?.rank ?? null,
      biz.rating,
      search,
      reviews,
      biz.category.replace(/_/g, " "),
    );

    const hasAnyData =
      search.hasData ||
      adsDetail.hasData ||
      reviews.hasData ||
      websiteDetail.hasData ||
      (overview?.mapslyScore ?? null) != null;

    return {
      businessId: biz.id,
      name: biz.name,
      slug: biz.slug,
      token: "",
      category: biz.category,
      address: biz.address,
      city: biz.city,
      province: biz.province,
      cellLabel: biz.city ?? biz.province ?? null,
      mapslyScore: overview?.mapslyScore ?? null,
      rank: overview?.rank ?? null,
      total: overview?.total ?? null,
      rankDelta: overview?.rankDelta ?? null,
      googleRating: biz.rating,
      reviewCount: biz.reviewCount,
      reputation: overview?.reputation ?? null,
      visibility: overview?.visibility ?? null,
      ads: overview?.ads ?? null,
      website: overview?.website ?? null,
      profile: overview?.profile ?? null,
      adsApplicable: overview?.adsApplicable ?? null,
      changes,
      search,
      adsDetail,
      reviews,
      websiteDetail,
      fixes: overview?.topFixes ?? [],
      gap,
      lastSnapshotAt: overview?.lastSnapshotAt ?? null,
      hasAnyData,
    };
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------- section builders */

type KeywordRow = {
  latestOrganicRank: number | null;
  latestMapsRank: number | null;
  latestEstMonthlyVisits: number | null;
  keyword: { keyword: string; searchVolume: number | null };
};

function buildSearch(
  rows: KeywordRow[],
  pillar: number | null,
): LandingSearchData {
  if (rows.length === 0) return { ...EMPTY_LANDING_SEARCH, pillar };

  let bestRank: number | null = null;
  let youGet = 0;
  let total = 0;
  for (const r of rows) {
    for (const v of [r.latestOrganicRank, r.latestMapsRank]) {
      if (v != null && (bestRank == null || v < bestRank)) bestRank = v;
    }
    if (r.latestEstMonthlyVisits) youGet += r.latestEstMonthlyVisits;
    if (r.keyword.searchVolume) total += r.keyword.searchVolume;
  }

  const topKeywords = [...rows]
    .sort(
      (a, b) => (b.keyword.searchVolume ?? 0) - (a.keyword.searchVolume ?? 0),
    )
    .slice(0, 8)
    .map((r) => ({
      keyword: r.keyword.keyword,
      volume: r.keyword.searchVolume,
      organicRank: r.latestOrganicRank,
      mapsRank: r.latestMapsRank,
      estCustomers:
        r.latestEstMonthlyVisits != null
          ? Math.round(r.latestEstMonthlyVisits)
          : null,
    }));

  return {
    hasData: true,
    bestRank,
    keywordsTracked: rows.length,
    searchesYouGet: youGet > 0 ? Math.round(youGet) : null,
    searchesTotal: total > 0 ? Math.round(total) : null,
    topKeywords,
    pillar,
  };
}

type AdvertiserRow = {
  pageName: string;
  platforms: string[];
  activeAdCount: number;
  matchedBusinessId: string | null;
};

function buildAds(
  ownAdCount: number,
  advertisers: AdvertiserRow[],
  agg: {
    _count: { _all: number };
    _sum: { activeAdCount: number | null };
  } | null,
  businessId: string,
  pillar: number | null,
  adsApplicable: boolean | null,
): LandingAdsData {
  const competitors = advertisers.map((a) => ({
    name: a.pageName,
    platforms: a.platforms,
    activeAds: a.activeAdCount,
    isOwn: a.matchedBusinessId === businessId,
  }));
  const marketAdvertiserCount = agg?._count._all ?? 0;
  const marketActiveAds = agg?._sum.activeAdCount ?? 0;
  const hasData = ownAdCount > 0 || competitors.length > 0;
  if (!hasData) {
    return { ...EMPTY_LANDING_ADS, pillar, adsApplicable };
  }
  return {
    hasData: true,
    ownAdCount,
    marketAdvertiserCount,
    marketActiveAds,
    competitors,
    pillar,
    adsApplicable,
  };
}

type CohortRow = {
  id: string;
  name: string;
  rating: number | null;
  reviewCount: number | null;
};

function buildReviews(p: {
  rating: number | null;
  reviewCount: number | null;
  total: number;
  replied: number;
  placeTopics: unknown;
  cohort: CohortRow[];
  businessId: string;
  pillar: number | null;
  yourRank: number | null;
  rankedTotal: number | null;
  trend30d: number;
  totalsMap: Map<string, number>;
  repliedMap: Map<string, number>;
  recentMap: Map<string, number>;
}): LandingReviewsData {
  const replyRate = p.total > 0 ? p.replied / p.total : null;
  const unanswered = Math.max(0, p.total - p.replied);
  const themes = parseThemes(p.placeTopics);
  const hasData =
    p.rating != null ||
    p.reviewCount != null ||
    themes.length > 0 ||
    p.total > 0;

  if (!hasData) return { ...EMPTY_LANDING_REVIEWS, pillar: p.pillar };

  // Top peers by review count + your own row (so the table shows "1,2,3 … you").
  const ranked = [...p.cohort].sort(
    (a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0),
  );
  const top = ranked.slice(0, 3).map((c, i) => peerRow(c, i + 1, p));
  const ownInTop = ranked.slice(0, 3).some((c) => c.id === p.businessId);
  const competitors = [...top];
  if (!ownInTop && (p.yourRank != null || p.reviewCount != null)) {
    competitors.push({
      name: "Your business",
      rating: p.rating,
      reviewCount: p.reviewCount,
      trend30d: p.trend30d,
      responseRate: replyRate,
      rank: p.yourRank ?? competitors.length + 1,
      isOwn: true,
    });
  }

  return {
    hasData: true,
    rating: p.rating,
    reviewCount: p.reviewCount,
    replyRate,
    unanswered,
    trend30d: p.trend30d,
    yourRank: p.yourRank,
    rankedTotal: p.rankedTotal,
    themes,
    competitors,
    pillar: p.pillar,
  };
}

function peerRow(
  c: CohortRow,
  rank: number,
  p: {
    businessId: string;
    totalsMap: Map<string, number>;
    repliedMap: Map<string, number>;
    recentMap: Map<string, number>;
  },
) {
  const total = p.totalsMap.get(c.id) ?? 0;
  const replied = p.repliedMap.get(c.id) ?? 0;
  return {
    name: c.name,
    rating: c.rating,
    reviewCount: c.reviewCount,
    trend30d: p.recentMap.get(c.id) ?? 0,
    responseRate: total > 0 ? replied / total : null,
    rank,
    isOwn: c.id === p.businessId,
  };
}

/** Google's extracted place topics: { "botox": 12, "lip filler": 8, ... }. */
function parseThemes(v: unknown): { label: string; count: number }[] {
  if (v == null || typeof v !== "object" || Array.isArray(v)) return [];
  const out: { label: string; count: number }[] = [];
  for (const [label, raw] of Object.entries(v as Record<string, unknown>)) {
    const count = typeof raw === "number" ? raw : Number(raw);
    if (Number.isFinite(count) && count > 0) out.push({ label, count });
  }
  return out.sort((a, b) => b.count - a.count).slice(0, 6);
}

type AuditRow = {
  performance: number | null;
  seo: number | null;
  lcp: number | null;
  cls: number | null;
  inp: number | null;
  hasLocalBusinessSchema: boolean | null;
  hasFaqSchema: boolean | null;
  hasBookingCtaAboveFold: boolean | null;
  hasPhoneAboveFold: boolean | null;
  napConsistent: boolean | null;
  contentWithoutJs: boolean | null;
  auditedAt: Date;
};

function buildWebsite(
  audit: AuditRow | null,
  websiteUrl: string | null,
  pillar: number | null,
  industryMedian: number | null,
  industryBest: number | null,
): LandingWebsiteData {
  const hasWebsite = Boolean(websiteUrl);
  const isHttps = websiteUrl ? websiteUrl.startsWith("https://") : null;

  const measured: Record<string, boolean | null> = {
    loadsFast: audit?.lcp != null ? audit.lcp <= 2.5 : null,
    smoothScroll: audit?.cls != null ? audit.cls <= 0.1 : null,
    quickToRespond: audit?.inp != null ? audit.inp <= 200 : null,
    foundOnGoogle: audit?.seo != null ? audit.seo >= 80 : null,
    phoneAboveFold: audit?.hasPhoneAboveFold ?? null,
    bookingAboveFold: audit?.hasBookingCtaAboveFold ?? null,
    localBusinessSchema: audit?.hasLocalBusinessSchema ?? null,
    faqSchema: audit?.hasFaqSchema ?? null,
    napConsistent: audit?.napConsistent ?? null,
    worksWithoutJs: audit?.contentWithoutJs ?? null,
    secure: hasWebsite ? isHttps : null,
    hasWebsite,
  };
  const detailFor: Record<string, string | null> = {
    loadsFast:
      audit?.lcp != null
        ? `Your LCP: ${audit.lcp.toFixed(1)}s · good is under 2.5s`
        : null,
    smoothScroll:
      audit?.cls != null
        ? `Your CLS: ${audit.cls.toFixed(2)} · good is under 0.1`
        : null,
    quickToRespond:
      audit?.inp != null
        ? `Your INP: ${Math.round(audit.inp)}ms · good is under 200ms`
        : null,
    foundOnGoogle:
      audit?.seo != null ? `SEO health: ${Math.round(audit.seo)}/100` : null,
    phoneAboveFold: null,
    bookingAboveFold: null,
    localBusinessSchema: null,
    faqSchema: null,
    napConsistent: null,
    worksWithoutJs: null,
    secure: hasWebsite
      ? isHttps
        ? "Served over https"
        : "Not secure (http)"
      : null,
    hasWebsite: hasWebsite ? websiteUrl : "No website on record",
  };

  const checks: LandingWebsiteCheck[] = LANDING_WEBSITE_CHECK_LABELS.map(
    (c) => {
      const pass = measured[c.key] ?? null;
      let detail = detailFor[c.key];
      if (detail == null)
        detail =
          pass === true
            ? "Present"
            : pass === false
              ? "Missing"
              : "Not measured";
      return { key: c.key, label: c.label, pass, detail };
    },
  );
  const passCount = checks.filter((c) => c.pass === true).length;
  const hasData = audit != null || hasWebsite;

  if (!hasData) return { ...EMPTY_LANDING_WEBSITE, pillar };

  return {
    hasData: true,
    websiteUrl,
    performance: audit?.performance ?? null,
    seo: audit?.seo ?? null,
    industryMedian,
    industryBest,
    checks,
    passCount,
    totalChecks: checks.length,
    pillar,
  };
}

/** Best (top-decile) cohort website performance from the CellMetric breakpoints. */
function industryBestPerf(distributions: unknown): number | null {
  if (distributions == null || typeof distributions !== "object") return null;
  const d = distributions as Record<string, unknown>;
  for (const key of [
    "lighthousePerformance",
    "websitePerformance",
    "performance",
    "lighthousePerf",
  ]) {
    const bucket = d[key];
    if (bucket && typeof bucket === "object") {
      const p90 = (bucket as Record<string, unknown>).p90;
      if (typeof p90 === "number" && Number.isFinite(p90))
        return Math.round(p90);
    }
  }
  return null;
}

/** Market-gap "problem → solution" callout from the search split + missing keywords. */
function buildGap(
  category: string,
  search: LandingSearchData,
): LandingGap | null {
  if (
    !search.hasData ||
    search.searchesYouGet == null ||
    search.searchesTotal == null
  ) {
    return null;
  }
  const youGet = roundNice(search.searchesYouGet);
  const others = roundNice(
    Math.max(0, search.searchesTotal - search.searchesYouGet),
  );
  const cat = category.toLowerCase().replace(/_/g, " ");
  const missing = search.topKeywords
    .filter((k) => {
      const best = [k.organicRank, k.mapsRank].filter(
        (r): r is number => r != null,
      );
      return best.length === 0 || Math.min(...best) > 3;
    })
    .slice(0, 2)
    .map((k) => `"${k.keyword}"`);

  return {
    problem: `You show up for ~${fmt(youGet)} searches a month. The other ~${fmt(others)} go to other ${cat}s.`,
    solution:
      missing.length > 0
        ? `Win the searches you're missing — like ${missing.join(" and ")}.`
        : `Climb into the top 3 for the searches that send patients to your competitors.`,
  };
}

/** The three "what changed in your area this week" insight cards. */
function buildChanges(
  rankDelta: number | null,
  rank: number | null,
  rating: number | null,
  search: LandingSearchData,
  reviews: LandingReviewsData,
  cat: string,
): LandingChange[] {
  // Card 1 · ranking risk (real rank + rating; projection from review pace).
  const spots = Math.max(1, Math.abs(rankDelta ?? 2));
  const days = 30 + (reviews.trend30d % 30);
  const card1: LandingChange = {
    id: "rank",
    title:
      (rankDelta ?? 0) > 0
        ? "Your ranking is holding"
        : "Your ranking is slipping",
    meta: `${days} days out`,
    value: rank != null ? String(rank) : "—",
    valueSuffix: `→ ${spots} risk`,
    stars: rating,
    barPct: rank != null ? Math.min(85, 42 + spots * 12) : 30,
    barColor: "gold",
    desc: `At your competitors' review pace, you could drop ${spots} spot${
      spots === 1 ? "" : "s"
    } on Google in about ${days} days.`,
    faded: false,
  };

  // Card 2 · customers leaking to competitors (≈1% of missed searches convert).
  const lostSearches =
    search.searchesTotal != null && search.searchesYouGet != null
      ? Math.max(0, search.searchesTotal - search.searchesYouGet)
      : 0;
  const lostCustomers = Math.max(0, Math.round(lostSearches * 0.01));
  const card2: LandingChange = {
    id: "customers",
    title: "Customers you're losing",
    meta: "this month",
    value: lostCustomers > 0 ? String(lostCustomers) : "—",
    valueSuffix: "people",
    stars: null,
    barPct: lostCustomers > 0 ? 76 : 22,
    barColor: "coral",
    desc: `Customers we tracked searching for ${cat} who went to nearby competitors instead — with their names and reasons.`,
    faded: false,
  };

  // Card 3 · ads teaser (faded preview / unlock with Pro).
  const card3: LandingChange = {
    id: "ads",
    title: "Ads running, phone not ringing",
    meta: "out of sync",
    value: "+40",
    valueSuffix: "%",
    stars: null,
    barPct: 92,
    barColor: "green",
    desc: "Ad spend up while reviews and calls stay flat — a sign the ads aren't converting.",
    faded: true,
  };

  return [card1, card2, card3];
}

function roundNice(n: number): number {
  if (n < 10) return Math.max(0, Math.round(n));
  if (n < 100) return Math.round(n / 5) * 5;
  return Math.round(n / 10) * 10;
}
function fmt(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}
