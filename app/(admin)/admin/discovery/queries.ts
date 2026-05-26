/**
 * /admin/discovery · server-side data fetching.
 *
 * Admin operations need fresh data — last-second deletes, in-flight
 * runs, real-time aggregates — so these are `noStore()` per
 * `.claude/rules/caching.md` "When to skip caching". The whole page
 * weighs maybe 10 indexed reads on a busy day; not caching is cheap.
 */

import { unstable_noStore as noStore } from "next/cache";

import prisma from "@/lib/prisma";

export interface DiscoveryStats {
  totalRuns: number;
  successRuns: number;
  totalNewBusinesses: number;
  totalCostUsd: number;
  activeCells: number;
  windowDays: number;
}

export interface AdminLocationRow {
  id: string;
  city: string;
  province: string | null;
  country: string;
  lat: number;
  lng: number;
  radiusKm: number;
  isActive: boolean;
  businessCount: number;
  lastRunAt: Date | null;
  totalRuns: number;
  totalNewFound: number;
  totalCostUsd: number;
  verifiedAt: Date;
  // Qualification aggregates
  qualifiedCount: number;
  disqualifiedCount: number;
  unreachableCount: number;
  lastQualifyAt: Date | null;
}

export interface AdminCategoryGroup {
  id: string;
  dataforseoId: string;
  label: string;
  groupKey: string | null;
  isActive: boolean;
  createdAt: Date;
  locations: AdminLocationRow[];
  // Aggregates across all locations
  locationCount: number;
  totalBusinesses: number;
  totalCostUsd: number;
}

export interface RecentRunRow {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: "RUNNING" | "OK" | "PARTIAL" | "FAILED";
  totalReturned: number;
  newBusinesses: number;
  duplicates: number;
  errors: number;
  costUsd: number;
  radiusKm: number;
  categoryLabel: string;
  city: string;
  country: string;
  errorMessage: string | null;
}

const WINDOW_DAYS = 30;

/** Top stats banner — last 30 days. */
export async function getDiscoveryStats(): Promise<DiscoveryStats> {
  noStore();
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const [runAgg, successCount, activeCells] = await Promise.all([
    prisma.discoveryRun.aggregate({
      where: { startedAt: { gte: since } },
      _count: { id: true },
      _sum: { newBusinesses: true, costUsd: true },
    }),
    prisma.discoveryRun.count({
      where: { startedAt: { gte: since }, status: "OK" },
    }),
    prisma.trackedLocation.count({ where: { isActive: true } }),
  ]);
  return {
    totalRuns: runAgg._count.id ?? 0,
    successRuns: successCount,
    totalNewBusinesses: runAgg._sum.newBusinesses ?? 0,
    totalCostUsd: runAgg._sum.costUsd ?? 0,
    activeCells,
    windowDays: WINDOW_DAYS,
  };
}

/**
 * Full category-grouped registry payload. Locations are ordered by
 * lastRunAt desc (recently-active cells float to the top within each
 * group). Categories are sorted by label A→Z.
 */
export async function getDiscoveryRegistry(): Promise<AdminCategoryGroup[]> {
  noStore();
  const categories = await prisma.businessCategory.findMany({
    orderBy: { label: "asc" },
    include: {
      trackedLocations: {
        orderBy: [{ lastRunAt: "desc" }, { city: "asc" }],
        select: {
          id: true,
          city: true,
          province: true,
          country: true,
          lat: true,
          lng: true,
          radiusKm: true,
          isActive: true,
          businessCount: true,
          lastRunAt: true,
          totalRuns: true,
          totalNewFound: true,
          totalCostUsd: true,
          verifiedAt: true,
          qualifiedCount: true,
          disqualifiedCount: true,
          unreachableCount: true,
          lastQualifyAt: true,
        },
      },
    },
  });

  return categories.map((c) => {
    const totalBusinesses = c.trackedLocations.reduce(
      (sum, l) => sum + l.businessCount,
      0,
    );
    const totalCostUsd = c.trackedLocations.reduce(
      (sum, l) => sum + l.totalCostUsd,
      0,
    );
    return {
      id: c.id,
      dataforseoId: c.dataforseoId,
      label: c.label,
      groupKey: c.groupKey,
      isActive: c.isActive,
      createdAt: c.createdAt,
      locations: c.trackedLocations,
      locationCount: c.trackedLocations.length,
      totalBusinesses,
      totalCostUsd,
    };
  });
}

/** Last 20 runs across all cells — drives the "Recent runs" table. */
export async function getRecentDiscoveryRuns(): Promise<RecentRunRow[]> {
  noStore();
  const runs = await prisma.discoveryRun.findMany({
    orderBy: { startedAt: "desc" },
    take: 20,
    include: {
      category: { select: { label: true } },
      trackedLocation: { select: { city: true, country: true } },
    },
  });
  return runs.map((r) => ({
    id: r.id,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    status: r.status,
    totalReturned: r.totalReturned,
    newBusinesses: r.newBusinesses,
    duplicates: r.duplicates,
    errors: r.errors,
    costUsd: r.costUsd,
    radiusKm: r.radiusKm,
    categoryLabel: r.category.label,
    city: r.trackedLocation.city,
    country: r.trackedLocation.country,
    errorMessage: r.errorMessage,
  }));
}

/** Category IDs already in the registry — used to filter the picker. */
export async function getRegisteredCategoryIds(): Promise<Set<string>> {
  noStore();
  const rows = await prisma.businessCategory.findMany({
    select: { dataforseoId: true },
  });
  return new Set(rows.map((r) => r.dataforseoId));
}
