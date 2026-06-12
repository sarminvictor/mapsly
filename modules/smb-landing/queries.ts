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
import { serviceMentionWindowStart } from "@/lib/review-window";
import { buildOverviewForBusiness } from "@/modules/smb-home/queries";
import { ctrForBestRank } from "@/modules/smb-search/types";

import { buildLandingCopy } from "./copy";
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

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Max real market-events surfaced in the landing "what changed" band. */
const LANDING_EVENT_CAP = 6;

/** /l cites no unbacked benchmarks: strip the hardcoded "~89%" reply-rate
 * claim from fix metas (built in smb-home/derive.ts for the signed-in portal)
 * until per-cell computed benchmarks ship (improvement plan #5). */
function stripUnbackedMeta<F extends { meta?: string }>(fix: F): F {
  if (!fix.meta?.includes("89%")) return fix;
  const meta = fix.meta
    .replace(/Most businesses reply to about 89%(\s*·\s*)?/, "")
    .trim();
  return { ...fix, meta: meta || undefined };
}

/** Split a snapshot `cellKey` ("Medical Spa|Calgary|CA") into its cell coords.
 * The cell is keyed by the Discovery MARKET category (e.g. "Medical Spa"), which
 * differs from the raw Google category on `Business` (e.g. "Medical spa") — so
 * the `CellMetric` reference MUST be looked up by this key, not `biz.category`,
 * or the lookup silently misses (INC: landing industry-median bug). Returns null
 * for a malformed/empty key. */
function parseCellKey(
  key: string | null,
): { category: string; city: string; country: string } | null {
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
          snapshots: {
            take: 1,
            orderBy: { snapshotDate: "desc" },
            select: { cellKey: true },
          },
        },
      }),
    ]);

    if (!biz) return null;

    // Every cohort (reviews, ads, market reference) is keyed by the unified
    // GEO market cell encoded in the snapshot cellKey ("Medical Spa|Miami|US"),
    // so a Beauty-salon and a Medical-spa inside the same discovery radius
    // compare against the SAME market.
    const marketCell = parseCellKey(biz.snapshots[0]?.cellKey ?? null);

    // Review-comparison cohort + rank are drawn from the unified GEO cell (the
    // discovery radius), NOT the raw category×city — so a Beauty-salon and a
    // Medical-spa inside Miami's radius compare against the SAME market. The
    // members are every business sharing the owner's snapshot cellKey (e.g.
    // "Medical Spa|Miami|US"). Matches the rankedTotal, which already uses the
    // geo CellMetric.sampleSize.
    const ownCellKey = biz.snapshots[0]?.cellKey ?? null;
    const cellMemberIds = ownCellKey
      ? (
          await prisma.businessSnapshot.findMany({
            where: {
              cellKey: ownCellKey,
              business: { isActive: true, qualificationStatus: "QUALIFIED" },
            },
            distinct: ["businessId"],
            select: { businessId: true },
          })
        ).map((s) => s.businessId)
      : [];

    const [
      keywordRows,
      ownGoogleAdCount,
      ownMetaAdsAgg,
      adCompetitors,
      adAgg,
      reviewTotal,
      reviewReplied,
      reviewCohort,
      audit,
      cellMetric,
      betterReviewed,
      serviceMentionRows,
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
      // Own META ads live in AdMarketAdvertiser (matched by businessId), NOT
      // AdLibraryEntry (Google only). A Meta-only advertiser would otherwise
      // show "0 ads / you run none" while the table lists it running 9.
      prisma.adMarketAdvertiser.aggregate({
        where: { matchedBusinessId: businessId, isActive: true },
        _sum: { activeAdCount: true },
      }),
      marketCell
        ? prisma.adMarketAdvertiser.findMany({
            where: { ...marketCell, isActive: true },
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
      marketCell
        ? prisma.adMarketAdvertiser.aggregate({
            where: { ...marketCell, isActive: true },
            _count: { _all: true },
            _sum: { activeAdCount: true },
          })
        : Promise.resolve(null),
      prisma.review.count({ where: { businessId } }),
      prisma.review.count({ where: { businessId, ownerReplied: true } }),
      cellMemberIds.length > 0
        ? prisma.business.findMany({
            where: {
              id: { in: cellMemberIds },
              isActive: true,
              reviewCount: { not: null },
            },
            orderBy: { reviewCount: "desc" },
            take: 8,
            select: { id: true, name: true, rating: true, reviewCount: true },
          })
        : Promise.resolve([]),
      prisma.lighthouseAudit.findFirst({
        where: { businessId },
        // id tiebreak keeps "latest" deterministic if two audits share a timestamp.
        orderBy: [{ auditedAt: "desc" }, { id: "desc" }],
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
      marketCell
        ? prisma.cellMetric.findFirst({
            where: marketCell,
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
      cellMemberIds.length > 0 && biz.reviewCount != null
        ? prisma.business.count({
            where: {
              id: { in: cellMemberIds },
              isActive: true,
              reviewCount: { gt: biz.reviewCount },
            },
          })
        : Promise.resolve(0),
      // Review themes · AI-tagged Review.mentionedServices (canonical
      // BusinessService names), aggregated over ALL collected reviews — the
      // landing wants the full picture, no 12-month window. Same unnest+GROUP
      // BY shape AND the same 12-calendar-bucket window as modules/reviews/trends.ts (shared via lib/review-window) so /l and /reviews always show identical counts. Replaces Google's noisy
      // placeTopics ("YYC 18", "april 9") as the themes source.
      prisma.$queryRaw<{ name: string; count: bigint }[]>`
        SELECT name, COUNT(*)::bigint AS count
        FROM "Review", unnest("mentionedServices") AS name
        WHERE "businessId" = ${businessId}
          AND "postedAt" >= ${serviceMentionWindowStart()}
        GROUP BY name
        ORDER BY count DESC
        LIMIT 6
      `,
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

    const search = buildSearch(
      keywordRows,
      overview?.visibility ?? null,
      biz.city,
    );
    // "Ads you're running" = own Google ads + own Meta ads (matched advertiser).
    const ownAdCount =
      ownGoogleAdCount + (ownMetaAdsAgg._sum.activeAdCount ?? 0);
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
      serviceMentions: mapServiceMentions(serviceMentionRows),
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

    const hasAnyData =
      search.hasData ||
      adsDetail.hasData ||
      reviews.hasData ||
      websiteDetail.hasData ||
      (overview?.mapslyScore ?? null) != null;

    const core: Omit<LandingData, "copy"> = {
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
      events: (overview?.events ?? []).slice(0, LANDING_EVENT_CAP),
      search,
      adsDetail,
      reviews,
      websiteDetail,
      fixes: (overview?.topFixes ?? []).map(stripUnbackedMeta),
      lastSnapshotAt: overview?.lastSnapshotAt ?? null,
      hasAnyData,
    };
    return { ...core, copy: buildLandingCopy(core) };
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
  city: string | null,
): LandingSearchData {
  if (rows.length === 0) return { ...EMPTY_LANDING_SEARCH, pillar };

  let bestRank: number | null = null;
  let youGet = 0;
  let total = 0;
  for (const r of rows) {
    // Per-keyword best rank across organic + Maps.
    let rowRank: number | null = null;
    for (const v of [r.latestOrganicRank, r.latestMapsRank]) {
      if (v != null && (rowRank == null || v < rowRank)) rowRank = v;
    }
    if (rowRank != null && (bestRank == null || rowRank < bestRank)) {
      bestRank = rowRank;
    }
    const sv = r.keyword.searchVolume ?? 0;
    if (sv) total += sv;
    // Captured traffic (NOT raw volume): a top-3 business gets a CTR share of a
    // keyword, never 100% of its searches — summing raw volume claimed "you took
    // all the traffic." Use DfS estimated visits when present; else CTR-weight by
    // best rank (etv is null for Maps rankings, which had zeroed local-pack
    // capture and undercounted "near me" terms).
    youGet +=
      r.latestEstMonthlyVisits ??
      (rowRank != null ? sv * ctrForBestRank(rowRank) : 0);
  }

  const topKeywords = [...rows]
    .sort(
      (a, b) => (b.keyword.searchVolume ?? 0) - (a.keyword.searchVolume ?? 0),
    )
    .slice(0, 8)
    .map((r) => ({
      keyword: r.keyword.keyword,
      service: deriveService(r.keyword.keyword, city),
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

/** Best-guess service label from a local-intent keyword (strip the city). */
function deriveService(keyword: string, city: string | null): string {
  let s = keyword;
  if (city) {
    const idx = s.toLowerCase().indexOf(city.toLowerCase());
    if (idx >= 0) s = (s.slice(0, idx) + s.slice(idx + city.length)).trim();
  }
  s = s.replace(/\s+/g, " ").trim();
  if (!s) s = keyword;
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
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
  serviceMentions: { label: string; count: number }[];
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
  const themes = p.serviceMentions;
  const hasData =
    p.rating != null ||
    p.reviewCount != null ||
    themes.length > 0 ||
    p.total > 0;

  if (!hasData) return { ...EMPTY_LANDING_REVIEWS, pillar: p.pillar };

  // Cohort ranked by review count. Two display scenarios:
  //  · you're in the top 3 → show ranks 1–5 (the table fades out below)
  //  · you're below 3      → show ranks 1–3, then your real row after a gap
  const ranked = [...p.cohort].sort(
    (a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0),
  );
  const ownInTop3 = ranked.slice(0, 3).some((c) => c.id === p.businessId);
  const top = ranked
    .slice(0, ownInTop3 ? 5 : 3)
    .map((c, i) => peerRow(c, i + 1, p));
  const competitors = [...top];
  if (!ownInTop3 && (p.yourRank != null || p.reviewCount != null)) {
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

/** AI-tagged service mentions (the unnest+count rows over
 * `Review.mentionedServices`) → the themes shape. Deliberately NO fallback to
 * Google's raw placeTopics ("YYC 18", "april 9" — the noise this replaced):
 * zero rows = empty themes, and the section shows its empty-state copy. */
function mapServiceMentions(
  rows: { name: string; count: bigint | number }[],
): { label: string; count: number }[] {
  const out: { label: string; count: number }[] = [];
  for (const r of rows) {
    const count = Number(r.count);
    if (r.name && Number.isFinite(count) && count > 0)
      out.push({ label: r.name, count });
  }
  return out;
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
