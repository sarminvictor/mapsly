// Weekly · snapshot-write
//
// Compute the Mapsly Score for each active business and write a fresh
// `BusinessSnapshot` row. The composite read by SMB dashboard (E.1),
// agency prospect detail (F.4), and Hunter filter eval (F.2) all live
// here — derive once weekly, denormalize for cheap reads.
//
// Pipeline (per business):
//   1. Gather raw signals from Business + Review aggregates +
//      LighthouseAudit (latest) + AdLibraryEntry (active count).
//   2. Derive 6 dimension sub-scores via `modules/scoring`.
//   3. Compose Mapsly Score (0–10) via `computeMapslyScore`.
//   4. Upsert `BusinessSnapshot` for today (composite + dimensions).
//
// No external API calls — runs entirely against Postgres. Cadence:
// weekly Monday 13:30 UTC per `vercel.json`, AFTER the upstream
// signal-collection handlers (business-profile-refresh, reviews-full-pull,
// serp-rank-scan, lighthouse-audit) have landed their week's data.

import { revalidateTag } from "next/cache";
import prisma, { Prisma } from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import { filterEligibleBusinesses } from "@/lib/reviews/should-collect";
import {
  computeMapslyScore,
  deriveBrandPresenceScore,
  deriveCommunicationScore,
  derivePricingTransparencyScore,
  deriveProfileCompletenessScore,
  deriveReputationScore,
  deriveTrustScore,
  type PillarSignals,
} from "@/modules/scoring";
import { runBatch, statusFromOutcome } from "../../_lib/batch";

const JOB = "weekly:snapshot-write";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const REVIEW_VELOCITY_WINDOW_DAYS = 30;
const REPLY_LATENCY_LOOKBACK = 20;

interface BusinessForScoring {
  id: string;
  slug: string;
  rating: number | null;
  reviewCount: number | null;
  photosCount: number | null;
  phone: string | null;
  website: string | null;
  hours: unknown;
  attributes: unknown;
  isClaimed: boolean;
  category: string | null;
  categories: string[];
  firstSeenOnGoogle: Date | null;
}

export const GET = cronHandler(JOB, async ({ runId }) => {
  const limit = clampLimitFromEnv(DEFAULT_LIMIT, MAX_LIMIT);

  const businesses = (await prisma.business.findMany({
    where: { isActive: true },
    select: {
      id: true,
      slug: true,
      rating: true,
      reviewCount: true,
      photosCount: true,
      phone: true,
      website: true,
      hours: true,
      attributes: true,
      isClaimed: true,
      category: true,
      categories: true,
      firstSeenOnGoogle: true,
    },
    take: limit,
    orderBy: { lastRefreshedAt: { sort: "asc", nulls: "first" } },
  })) as BusinessForScoring[];

  // Paid-cell gate · only snapshot cells with a paid business (same gate as the
  // collection crons). No-op while MAPSLY_COLLECT_REVIEWS_ALLOW_ALL=1.
  const eligible = new Set(
    await filterEligibleBusinesses(businesses.map((b) => b.id)),
  );
  const scoped = businesses.filter((b) => eligible.has(b.id));

  const revalidatedSlugs = new Set<string>();
  let snapshotsWritten = 0;

  const outcome = await runBatch(scoped, async (biz: BusinessForScoring) => {
    const signals = await gatherSignals(biz);

    const reputation = deriveReputationScore({
      rating: signals.rating,
      reviewCount: signals.reviewCount,
      velocityLast30d: signals.velocityLast30d,
    });
    const communication = deriveCommunicationScore({
      replyRate: signals.replyRate,
      avgReplyLatencyHours: signals.avgReplyLatencyHours,
    });
    const profileCompleteness = deriveProfileCompletenessScore({
      hasPhone: signals.hasPhone,
      hasWebsite: signals.hasWebsite,
      hasHours: signals.hasHours,
      photosCount: signals.photosCount,
      hasCategory: signals.hasCategory,
      hasQandA: signals.hasQandA,
    });
    const trust = deriveTrustScore({
      verified: signals.verified,
      claimed: signals.claimed,
      businessAgeYears: signals.businessAgeYears,
      hasProfilePhoto: signals.hasProfilePhoto,
      hasRecentReply: signals.hasRecentReply,
    });
    const pricingTransparency = derivePricingTransparencyScore({
      hasPricingPage: signals.hasPricingPage,
      hasServicesList: signals.hasServicesList,
      hasGbpServices: signals.hasGbpServices,
    });
    const brandPresence = deriveBrandPresenceScore({
      lighthousePerformance: signals.lighthousePerformance,
      lighthouseSeo: signals.lighthouseSeo,
      hasSchema: signals.hasSchema,
      hasActiveAds: signals.hasActiveAds,
      hasSocialLinks: signals.hasSocialLinks,
    });

    const mapslyScore = computeMapslyScore({
      reputation,
      communication,
      profileCompleteness,
      trust,
      pricingTransparency,
      brandPresence,
    });

    // Scoring v2 · persist the raw pillar-input bag so cell-aggregate +
    // pillar-scoring read one row (no Serp/Lighthouse/Ads re-join). The pillars
    // themselves are graded later, against the cell reference.
    const pillarSignals = {
      rating: signals.rating,
      reviewCount: signals.reviewCount,
      velocityLast30d: signals.velocityLast30d,
      replyRate: signals.replyRate,
      localPackRank: signals.localPackRank,
      organicRankBest: signals.organicRankBest,
      shareOfVoice: signals.shareOfVoice,
      keywordsRanked: signals.keywordsRanked,
      hasPhone: signals.hasPhone,
      hasWebsite: signals.hasWebsite,
      hasHours: signals.hasHours,
      isClaimed: signals.claimed,
      photoCount: signals.photosCount,
      categoryCount: signals.categoryCount,
      lighthousePerformance: signals.lighthousePerformance,
      lighthouseSeo: signals.lighthouseSeo,
      lcpSeconds: signals.lcpSeconds,
      hasSchema: signals.hasSchema,
      hasBookingCta: signals.hasBookingCta,
      hasPhoneAboveFold: signals.hasPhoneAboveFold,
      napConsistent: signals.napConsistent,
      hasActiveAds: signals.hasActiveAds,
      hasActiveGoogleAds: signals.hasActiveGoogleAds,
      hasActiveMetaAds: signals.hasActiveMetaAds,
      metaAdCount: signals.metaAdCount,
      estMonthlyAdSpend: signals.estMonthlyAdSpend,
      brandHijack: signals.brandHijack,
    } satisfies PillarSignals;

    // Day-granularity snapshot date so a daily re-run idempotent-upserts.
    const snapshotDate = todayUtcMidnight();

    await prisma.businessSnapshot.upsert({
      where: {
        businessId_snapshotDate: {
          businessId: biz.id,
          snapshotDate,
        },
      },
      create: {
        businessId: biz.id,
        snapshotDate,
        rating: signals.rating,
        reviewCount: signals.reviewCount,
        photosCount: signals.photosCount,
        replyRate: signals.replyRate,
        velocityLast30d: signals.velocityLast30d,
        mapslyScore,
        reputationScore: reputation,
        communicationScore: communication,
        profileCompletenessScore: profileCompleteness,
        trustScore: trust,
        pricingTransparencyScore: pricingTransparency,
        brandPresenceScore: brandPresence,
        signalsJson: pillarSignals as Prisma.InputJsonValue,
      },
      update: {
        rating: signals.rating,
        reviewCount: signals.reviewCount,
        photosCount: signals.photosCount,
        replyRate: signals.replyRate,
        velocityLast30d: signals.velocityLast30d,
        mapslyScore,
        reputationScore: reputation,
        communicationScore: communication,
        profileCompletenessScore: profileCompleteness,
        trustScore: trust,
        pricingTransparencyScore: pricingTransparency,
        brandPresenceScore: brandPresence,
        signalsJson: pillarSignals as Prisma.InputJsonValue,
      },
    });

    snapshotsWritten += 1;
    revalidatedSlugs.add(biz.slug);
  });

  for (const slug of revalidatedSlugs) {
    revalidateTag(`business-${slug}`, "weeks");
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
      snapshotsWritten,
      failureSample: outcome.failures.slice(0, 5).map((f) => ({
        businessId: (f.item as BusinessForScoring).id,
        error: f.error,
      })),
    },
  };
});

/**
 * Aggregate the raw signals required to derive sub-scores. Pulls reviews
 * + lighthouse + ad-library counts in parallel; defensive null handling
 * throughout (any missing signal contributes 0 to its sub-score, never
 * NaN propagates per `modules/scoring/sub-scores.clamp01`).
 */
async function gatherSignals(biz: BusinessForScoring) {
  const velocityCutoff = new Date(
    Date.now() - REVIEW_VELOCITY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );

  const [
    velocityLast30d,
    recentReviews,
    latestLighthouse,
    googleAdsCount,
    metaLibCount,
    metaMarketCount,
    businessKeywords,
    adSpendAgg,
  ] = await Promise.all([
    prisma.review.count({
      where: { businessId: biz.id, postedAt: { gte: velocityCutoff } },
    }),
    prisma.review.findMany({
      where: { businessId: biz.id },
      select: {
        ownerReplied: true,
        ownerReplyAt: true,
        postedAt: true,
      },
      orderBy: { postedAt: "desc" },
      take: REPLY_LATENCY_LOOKBACK,
    }),
    prisma.lighthouseAudit.findFirst({
      where: { businessId: biz.id },
      orderBy: { auditedAt: "desc" },
      select: {
        performance: true,
        seo: true,
        lcp: true,
        napConsistent: true,
        hasLocalBusinessSchema: true,
        hasBookingCtaAboveFold: true,
        hasPhoneAboveFold: true,
      },
    }),
    // Google presence · Google Ads Transparency Center, stored per-business on
    // AdLibraryEntry with platform=GOOGLE.
    prisma.adLibraryEntry.count({
      where: { businessId: biz.id, isActive: true, platform: "GOOGLE" },
    }),
    // Meta presence · per-business AdLibraryEntry rows tagged platform=META…
    prisma.adLibraryEntry.count({
      where: { businessId: biz.id, isActive: true, platform: "META" },
    }),
    // …plus the cell-market table (AdMarketAdvertiser, META) matched back to this
    // business — the cell-model migration moved most Meta data here, so a
    // Meta-only advertiser still registers as advertising.
    prisma.adMarketAdvertiser.count({
      where: { matchedBusinessId: biz.id, isActive: true },
    }),
    // Search-visibility ranks (BusinessKeyword · the /search source of truth) +
    // ad-spend estimate · feed the Visibility + Advertising pillars (v2).
    prisma.businessKeyword.findMany({
      where: { businessId: biz.id, isLost: false },
      select: { latestOrganicRank: true, latestMapsRank: true },
      take: 500,
    }),
    prisma.adLibraryEntry.aggregate({
      where: { businessId: biz.id, isActive: true },
      _sum: { spendMidHigh: true },
    }),
  ]);
  const metaAdsCount = metaLibCount + metaMarketCount;
  const activeAdsCount = googleAdsCount + metaAdsCount;

  // Visibility signals derived from the business's tracked keywords.
  const mapsRanks = businessKeywords
    .map((k) => k.latestMapsRank)
    .filter((x): x is number => x != null);
  const organicRanks = businessKeywords
    .map((k) => k.latestOrganicRank)
    .filter((x): x is number => x != null);
  const localPackRank = mapsRanks.length > 0 ? Math.min(...mapsRanks) : null;
  const organicRankBest =
    organicRanks.length > 0 ? Math.min(...organicRanks) : null;
  const trackedKw = businessKeywords.length;
  const shareOfVoice =
    trackedKw > 0
      ? (mapsRanks.filter((r) => r <= 3).length / trackedKw) * 100
      : null;
  const keywordsRanked = organicRanks.filter((r) => r <= 10).length;
  const estMonthlyAdSpend = adSpendAgg._sum.spendMidHigh ?? null;

  const replyRate =
    recentReviews.length > 0
      ? recentReviews.filter((r) => r.ownerReplied).length /
        recentReviews.length
      : null;
  const avgReplyLatencyHours = averageReplyLatencyHours(recentReviews);
  const hasRecentReply = recentReviews.some(
    (r) =>
      r.ownerReplied &&
      r.ownerReplyAt &&
      r.ownerReplyAt.getTime() >=
        velocityCutoff.getTime() - 60 * 24 * 60 * 60 * 1000,
  );

  return {
    rating: biz.rating,
    reviewCount: biz.reviewCount,
    velocityLast30d,
    replyRate,
    avgReplyLatencyHours,
    hasPhone: typeof biz.phone === "string" && biz.phone.length > 0,
    hasWebsite: typeof biz.website === "string" && biz.website.length > 0,
    hasHours: biz.hours != null,
    photosCount: biz.photosCount,
    hasCategory: typeof biz.category === "string" && biz.category.length > 0,
    hasQandA: hasAttribute(biz.attributes, "qanda"),
    verified: biz.isClaimed,
    claimed: biz.isClaimed,
    businessAgeYears: yearsOnGoogle(biz.firstSeenOnGoogle),
    hasProfilePhoto: hasAttribute(biz.attributes, "profile_photo"),
    hasRecentReply,
    hasPricingPage: hasAttribute(biz.attributes, "pricing_page"),
    hasServicesList: hasAttribute(biz.attributes, "services_list"),
    hasGbpServices: hasAttribute(biz.attributes, "gbp_services"),
    lighthousePerformance: latestLighthouse?.performance ?? null,
    lighthouseSeo: latestLighthouse?.seo ?? null,
    hasSchema: latestLighthouse?.hasLocalBusinessSchema ?? null,
    hasActiveAds: activeAdsCount > 0,
    hasSocialLinks: hasAttribute(biz.attributes, "social_links"),
    // ── Scoring v2 pillar signals (persisted as BusinessSnapshot.signalsJson) ──
    localPackRank,
    organicRankBest,
    shareOfVoice,
    keywordsRanked,
    categoryCount: Array.isArray(biz.categories) ? biz.categories.length : null,
    lcpSeconds: latestLighthouse?.lcp ?? null,
    napConsistent: latestLighthouse?.napConsistent ?? null,
    hasBookingCta: latestLighthouse?.hasBookingCtaAboveFold ?? null,
    hasPhoneAboveFold: latestLighthouse?.hasPhoneAboveFold ?? null,
    hasActiveGoogleAds: googleAdsCount > 0,
    hasActiveMetaAds: metaAdsCount > 0,
    metaAdCount: metaAdsCount,
    estMonthlyAdSpend,
    brandHijack: null,
  };
}

export function averageReplyLatencyHours(
  reviews: ReadonlyArray<{
    ownerReplied: boolean;
    ownerReplyAt: Date | null;
    postedAt: Date;
  }>,
): number | null {
  const replied = reviews.filter((r) => r.ownerReplied && r.ownerReplyAt);
  if (replied.length === 0) return null;
  let sumMs = 0;
  for (const r of replied) {
    sumMs += (r.ownerReplyAt as Date).getTime() - r.postedAt.getTime();
  }
  const avgHours = sumMs / replied.length / (60 * 60 * 1000);
  return avgHours >= 0 ? avgHours : 0;
}

export function yearsOnGoogle(firstSeen: Date | null): number | null {
  if (!firstSeen) return null;
  const ms = Date.now() - firstSeen.getTime();
  if (ms <= 0) return 0;
  return ms / (365.25 * 24 * 60 * 60 * 1000);
}

/**
 * Test a Business.attributes JSON blob for a named attribute.
 * Conservative: returns null when shape isn't an object → that maps to
 * "unknown" in the sub-score derivation (contributes 0, not 1).
 */
export function hasAttribute(attributes: unknown, key: string): boolean | null {
  if (attributes == null || typeof attributes !== "object") return null;
  const obj = attributes as Record<string, unknown>;
  const v = obj[key];
  if (v == null) return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return Boolean(v);
}

export function todayUtcMidnight(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
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
  REVIEW_VELOCITY_WINDOW_DAYS,
  REPLY_LATENCY_LOOKBACK,
  averageReplyLatencyHours,
  yearsOnGoogle,
  hasAttribute,
  todayUtcMidnight,
  clampLimitFromEnv,
};
