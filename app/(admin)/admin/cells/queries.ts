/**
 * /admin/cells · queries
 *
 * Reads the CellMetric market-reference rows for the admin table. `noStore()`
 * for freshness (the page is admin-only, re-rendered after a manual recompute).
 */

import { unstable_noStore as noStore } from "next/cache";

import prisma from "@/lib/prisma";

export interface CellRow {
  cellKey: string;
  category: string;
  city: string;
  country: string;
  sampleSize: number;
  confidence: string;
  ratingP50: number | null;
  reviewCountP50: number | null;
  reviewCountP90: number | null;
  photoCountP50: number | null;
  replyRateP50: number | null;
  lighthousePerfP50: number | null;
  shareOfVoiceP50: number | null;
  adPrevalence: number | null;
  computedAt: Date;
}

export interface CellStats {
  totalCells: number;
  highConfidence: number;
  businessesCovered: number;
  lastComputedAt: Date | null;
}

export async function getCellStats(): Promise<CellStats> {
  noStore();
  const [agg, high, latest] = await Promise.all([
    prisma.cellMetric.aggregate({
      _count: { _all: true },
      _sum: { sampleSize: true },
    }),
    prisma.cellMetric.count({ where: { confidence: "high" } }),
    prisma.cellMetric.findFirst({
      orderBy: { computedAt: "desc" },
      select: { computedAt: true },
    }),
  ]);
  return {
    totalCells: agg._count._all,
    highConfidence: high,
    businessesCovered: agg._sum.sampleSize ?? 0,
    lastComputedAt: latest?.computedAt ?? null,
  };
}

export async function getCellList(limit = 200): Promise<CellRow[]> {
  noStore();
  return prisma.cellMetric.findMany({
    orderBy: [{ sampleSize: "desc" }, { category: "asc" }, { city: "asc" }],
    take: limit,
    select: {
      cellKey: true,
      category: true,
      city: true,
      country: true,
      sampleSize: true,
      confidence: true,
      ratingP50: true,
      reviewCountP50: true,
      reviewCountP90: true,
      photoCountP50: true,
      replyRateP50: true,
      lighthousePerfP50: true,
      shareOfVoiceP50: true,
      adPrevalence: true,
      computedAt: true,
    },
  });
}
