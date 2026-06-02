/**
 * Public landing-page server queries.
 *
 * `resolveLandingToken(param)` is the lookup gate: it parses the `/l/[param]`
 * segment, finds the LandingPage by its numeric token, checks it's active, and
 * verifies the cosmetic slug matches (mismatch → null → 404). Not cached — a
 * single indexed unique lookup, and it's the access gate.
 *
 * `getLandingData(businessId)` assembles the page payload from the business's
 * REAL latest snapshot + section tables, reusing `buildOverviewForBusiness`
 * (the same market-overview core behind `/home`). Cached per business
 * (`landing-${businessId}`) so the cron's snapshot writes can revalidate it.
 *
 * Per `.claude/rules/cache-components.md` Pattern 1, both short-circuit during
 * the Vercel build phase (no Neon WebSocket) — returning `null`, which the
 * page renders as `notFound()`.
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
  type LandingData,
  type LandingReviewsData,
  type LandingSearchData,
  type LandingWebsiteCheck,
  type LandingWebsiteData,
} from "./types";

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
    // Cosmetic slug must match the stored one — the link can't be edited to probe.
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

    const [
      keywordRows,
      ownAdCount,
      adCompetitors,
      reviewTotal,
      reviewReplied,
      reviewCompetitors,
      audit,
    ] = await Promise.all([
      prisma.businessKeyword.findMany({
        where: { businessId },
        take: 100,
        select: {
          latestOrganicRank: true,
          latestMapsRank: true,
          latestEstMonthlyVisits: true,
          keyword: { select: { keyword: true, searchVolume: true } },
        },
      }),
      prisma.adLibraryEntry.count({
        where: { businessId, isActive: true },
      }),
      inCell
        ? prisma.adMarketAdvertiser.findMany({
            where: {
              category: biz.category,
              city: biz.city!,
              country: biz.country!,
              isActive: true,
            },
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
      prisma.review.count({ where: { businessId } }),
      prisma.review.count({ where: { businessId, ownerReplied: true } }),
      inCell
        ? prisma.business.findMany({
            where: {
              category: biz.category,
              city: biz.city!,
              country: biz.country!,
              isActive: true,
              reviewCount: { not: null },
            },
            orderBy: { reviewCount: "desc" },
            take: 5,
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
    ]);

    const search = buildSearch(keywordRows, overview?.visibility ?? null);
    const adsDetail = buildAds(
      ownAdCount,
      adCompetitors,
      businessId,
      overview?.ads ?? null,
      overview?.adsApplicable ?? null,
    );
    const reviews = buildReviews(
      biz.rating,
      biz.reviewCount,
      reviewTotal,
      reviewReplied,
      biz.placeTopics,
      reviewCompetitors,
      businessId,
      overview?.reputation ?? null,
    );
    const websiteDetail = buildWebsite(
      audit,
      biz.website,
      overview?.website ?? null,
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
      token: "", // filled by the route from the resolved landing
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
      events: overview?.events ?? [],
      search,
      adsDetail,
      reviews,
      websiteDetail,
      fixes: overview?.topFixes ?? [],
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
  for (const r of rows) {
    for (const v of [r.latestOrganicRank, r.latestMapsRank]) {
      if (v != null && (bestRank == null || v < bestRank)) bestRank = v;
    }
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
  const hasData = ownAdCount > 0 || competitors.length > 0;
  if (!hasData) return { ...EMPTY_LANDING_ADS, pillar, adsApplicable };
  return { hasData: true, ownAdCount, competitors, pillar, adsApplicable };
}

type ReviewCompetitorRow = {
  id: string;
  name: string;
  rating: number | null;
  reviewCount: number | null;
};

function buildReviews(
  rating: number | null,
  reviewCount: number | null,
  total: number,
  replied: number,
  placeTopics: unknown,
  competitors: ReviewCompetitorRow[],
  businessId: string,
  pillar: number | null,
): LandingReviewsData {
  const replyRate = total > 0 ? replied / total : null;
  const unanswered = Math.max(0, total - replied);
  const themes = parseThemes(placeTopics);
  const hasData =
    rating != null || reviewCount != null || themes.length > 0 || total > 0;

  if (!hasData) return { ...EMPTY_LANDING_REVIEWS, pillar };

  return {
    hasData: true,
    rating,
    reviewCount,
    replyRate,
    unanswered,
    themes,
    competitors: competitors.map((c) => ({
      name: c.name,
      rating: c.rating,
      reviewCount: c.reviewCount,
      isOwn: c.id === businessId,
    })),
    pillar,
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
): LandingWebsiteData {
  const hasWebsite = Boolean(websiteUrl);
  const isHttps = websiteUrl ? websiteUrl.startsWith("https://") : null;

  // Map measurements onto the 12 plain-English checks (null = couldn't measure).
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
    hasWebsite: hasWebsite,
  };

  const checks: LandingWebsiteCheck[] = LANDING_WEBSITE_CHECK_LABELS.map(
    (c) => ({
      key: c.key,
      label: c.label,
      pass: measured[c.key] ?? null,
    }),
  );
  const passCount = checks.filter((c) => c.pass === true).length;
  const hasData = audit != null || hasWebsite;

  if (!hasData) return { ...EMPTY_LANDING_WEBSITE, pillar };

  return {
    hasData: true,
    websiteUrl,
    performance: audit?.performance ?? null,
    seo: audit?.seo ?? null,
    checks,
    passCount,
    totalChecks: checks.length,
    pillar,
  };
}
