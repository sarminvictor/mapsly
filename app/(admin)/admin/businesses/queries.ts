/**
 * /admin/businesses · queries.
 *
 * Filtered list of Business rows for the admin operational surface.
 * Default filter: qualificationStatus = QUALIFIED. Additional filters
 * passed via URL search params (state-as-URL pattern · share / bookmark
 * a filtered view).
 */

import prisma from "@/lib/prisma";

export type StatusFilter =
  | "QUALIFIED"
  | "DISQUALIFIED"
  | "UNREACHABLE"
  | "FAILED"
  | "NOT_QUALIFIED"
  | "ALL";

export type ReviewFreshnessFilter =
  | "ALL"
  | "NEVER"
  | "STALE_7D"
  | "STALE_30D"
  | "IN_FLIGHT"
  | "FRESH";

export interface BusinessListFilters {
  status?: StatusFilter;
  city?: string;
  country?: string;
  category?: string;
  hasEmail?: boolean;
  reviewFreshness?: ReviewFreshnessFilter;
  q?: string; // name search
  limit?: number;
  cursor?: string;
}

export interface BusinessRow {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  country: string | null;
  category: string;
  qualificationStatus: string;
  qualificationFlags: string[];
  rating: number | null;
  reviewCount: number | null;
  emailDiscovered: string | null;
  emailDiscoverySource: string | null;
  reviewsFirstPulledAt: string | null;
  reviewsLastDeltaAt: string | null;
  pendingReviewsTaskId: string | null;
  latestReviewPostedAt: string | null;
  servicesCount: number;
  reviewsInDb: number;
}

export interface BusinessListResult {
  rows: BusinessRow[];
  total: number;
  nextCursor: string | null;
  /** Filter-aware aggregates for the stat strip. */
  stats: {
    qualified: number;
    disqualified: number;
    unreachable: number;
    failed: number;
    notQualified: number;
    withEmail: number;
    withReviews: number;
    inFlight: number;
  };
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Fetch a filtered + paginated list of businesses for the admin table.
 * Heavy WHERE composition done once; counts run in parallel.
 */
export async function getBusinessList(
  filters: BusinessListFilters = {},
): Promise<BusinessListResult> {
  const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const status = filters.status ?? "QUALIFIED";

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

  // Build the WHERE clause progressively.
  const where: Record<string, unknown> = {};
  if (status !== "ALL") {
    where.qualificationStatus = status;
  }
  if (filters.city) where.city = filters.city;
  if (filters.country) where.country = filters.country;
  if (filters.category) where.category = filters.category;
  if (filters.hasEmail === true) where.emailDiscovered = { not: null };
  if (filters.hasEmail === false) where.emailDiscovered = null;

  switch (filters.reviewFreshness) {
    case "NEVER":
      where.reviewsFirstPulledAt = null;
      break;
    case "IN_FLIGHT":
      where.pendingReviewsTaskId = { not: null };
      break;
    case "STALE_30D":
      where.OR = [
        { reviewsLastDeltaAt: null, reviewsFirstPulledAt: { not: null } },
        { reviewsLastDeltaAt: { lt: thirtyDaysAgo } },
      ];
      break;
    case "STALE_7D":
      where.OR = [
        { reviewsLastDeltaAt: null, reviewsFirstPulledAt: { not: null } },
        { reviewsLastDeltaAt: { lt: sevenDaysAgo } },
      ];
      break;
    case "FRESH":
      where.reviewsLastDeltaAt = { gte: sevenDaysAgo };
      break;
  }

  if (filters.q) {
    where.OR = [
      { name: { contains: filters.q, mode: "insensitive" } },
      { city: { contains: filters.q, mode: "insensitive" } },
    ];
  }

  const [rows, total, statsRaw] = await Promise.all([
    prisma.business.findMany({
      where,
      take: limit + 1,
      cursor: filters.cursor ? { id: filters.cursor } : undefined,
      skip: filters.cursor ? 1 : 0,
      orderBy: [
        { qualifiedAt: { sort: "desc", nulls: "last" } },
        { id: "asc" },
      ],
      select: {
        id: true,
        name: true,
        slug: true,
        city: true,
        country: true,
        category: true,
        qualificationStatus: true,
        qualificationFlags: true,
        rating: true,
        reviewCount: true,
        emailDiscovered: true,
        emailDiscoverySource: true,
        reviewsFirstPulledAt: true,
        reviewsLastDeltaAt: true,
        pendingReviewsTaskId: true,
        latestReviewPostedAt: true,
        _count: {
          select: {
            services: true,
            reviews: true,
          },
        },
      },
    }),
    prisma.business.count({ where }),
    prisma.business.groupBy({
      by: ["qualificationStatus"],
      _count: { id: true },
    }),
  ]);

  const stats = {
    qualified:
      statsRaw.find((s) => s.qualificationStatus === "QUALIFIED")?._count.id ??
      0,
    disqualified:
      statsRaw.find((s) => s.qualificationStatus === "DISQUALIFIED")?._count
        .id ?? 0,
    unreachable:
      statsRaw.find((s) => s.qualificationStatus === "UNREACHABLE")?._count
        .id ?? 0,
    failed:
      statsRaw.find((s) => s.qualificationStatus === "FAILED")?._count.id ?? 0,
    notQualified:
      statsRaw.find((s) => s.qualificationStatus === "NOT_QUALIFIED")?._count
        .id ?? 0,
    withEmail: await prisma.business.count({
      where: { ...where, emailDiscovered: { not: null } },
    }),
    withReviews: await prisma.business.count({
      where: { ...where, reviewsFirstPulledAt: { not: null } },
    }),
    inFlight: await prisma.business.count({
      where: { ...where, pendingReviewsTaskId: { not: null } },
    }),
  };

  const hasMore = rows.length > limit;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;

  return {
    rows: trimmed.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      city: r.city,
      country: r.country,
      category: r.category,
      qualificationStatus: r.qualificationStatus,
      qualificationFlags: r.qualificationFlags,
      rating: r.rating,
      reviewCount: r.reviewCount,
      emailDiscovered: r.emailDiscovered,
      emailDiscoverySource: r.emailDiscoverySource,
      reviewsFirstPulledAt: r.reviewsFirstPulledAt
        ? r.reviewsFirstPulledAt.toISOString()
        : null,
      reviewsLastDeltaAt: r.reviewsLastDeltaAt
        ? r.reviewsLastDeltaAt.toISOString()
        : null,
      pendingReviewsTaskId: r.pendingReviewsTaskId,
      latestReviewPostedAt: r.latestReviewPostedAt
        ? r.latestReviewPostedAt.toISOString()
        : null,
      servicesCount: r._count.services,
      reviewsInDb: r._count.reviews,
    })),
    total,
    nextCursor: hasMore ? trimmed[trimmed.length - 1]!.id : null,
    stats,
  };
}

/** Distinct values for the city/country/category dropdowns. */
export async function getFilterFacets(): Promise<{
  cities: string[];
  countries: string[];
  categories: string[];
}> {
  const [cities, countries, categories] = await Promise.all([
    prisma.business.findMany({
      where: { city: { not: null } },
      select: { city: true },
      distinct: ["city"],
      take: 200,
      orderBy: { city: "asc" },
    }),
    prisma.business.findMany({
      where: { country: { not: null } },
      select: { country: true },
      distinct: ["country"],
      take: 50,
      orderBy: { country: "asc" },
    }),
    prisma.business.findMany({
      select: { category: true },
      distinct: ["category"],
      take: 100,
      orderBy: { category: "asc" },
    }),
  ]);

  return {
    cities: cities.map((c) => c.city!).filter(Boolean),
    countries: countries.map((c) => c.country!).filter(Boolean),
    categories: categories.map((c) => c.category).filter(Boolean),
  };
}
