/**
 * Scoring v2 · pillar-scoring pass
 *
 * The third weekly pass (after snapshot-write writes signals, after
 * cell-aggregate builds the market reference). For each active business it:
 *   1. Grades the 5 pillars against the business's `CellMetric` (market-relative,
 *      or absolute fallback when no cell ref exists yet).
 *   2. Revives MSI — ranks every metro and finally writes `msiRank` / `msiTotal`
 *      (NULL until now) plus the inverse `msiPercentile` ("top 22%").
 *   3. Writes all pillar outputs back onto the latest `BusinessSnapshot` row.
 *
 * `runPillarScoring` is the shared entry point for the `weekly:pillar-score`
 * cron AND the `/admin/businesses` "Recompute scores" trigger.
 */

import prisma, { Prisma } from "@/lib/prisma";
import {
  computePillars,
  msiPercentile,
  rankByMsiInMetros,
  type PillarSignals,
} from "@/modules/scoring";
import {
  cellKeyOf,
  parseCellReference,
  signalsFromSnapshot,
} from "./cell-metrics";

const DEFAULT_LIMIT = 5000;
const WRITE_CHUNK = 25;

export interface PillarScoringSummary {
  businessesScored: number;
  cellsUsed: number;
  metrosRanked: number;
  withCellRef: number;
}

export async function runPillarScoring(opts?: {
  limit?: number;
}): Promise<PillarScoringSummary> {
  const limit = Math.max(1, opts?.limit ?? DEFAULT_LIMIT);

  // Latest snapshot per active business + the geo we rank/grade within.
  const snapshots = await prisma.businessSnapshot.findMany({
    where: { business: { isActive: true } },
    orderBy: [{ businessId: "asc" }, { snapshotDate: "desc" }],
    distinct: ["businessId"],
    take: limit,
    select: {
      id: true,
      businessId: true,
      signalsJson: true,
      rating: true,
      reviewCount: true,
      photosCount: true,
      replyRate: true,
      velocityLast30d: true,
      mapslyScore: true,
      business: {
        select: {
          category: true,
          city: true,
          province: true,
          country: true,
        },
      },
    },
  });

  // Resolve each business's signal bag once.
  const signalsById = new Map<string, PillarSignals>();
  for (const r of snapshots) signalsById.set(r.id, signalsFromSnapshot(r));

  // MSI · rank within metro (country|province|city), write rank/total at last.
  const msiInputs = snapshots.map((r) => ({
    businessId: r.businessId,
    mapslyScore: r.mapslyScore,
    reviewCount: r.reviewCount,
    hasActiveAds: signalsById.get(r.id)?.hasActiveAds ?? null,
    metro: `${r.business.country ?? ""}|${r.business.province ?? ""}|${
      r.business.city ?? ""
    }`,
  }));
  const msiMap = rankByMsiInMetros(msiInputs, (i) => i.metro);
  const metrosRanked = new Set(msiInputs.map((i) => i.metro)).size;

  // Market reference per cell.
  const cellRows = await prisma.cellMetric.findMany({
    select: {
      cellKey: true,
      sampleSize: true,
      confidence: true,
      adPrevalence: true,
      distributions: true,
    },
  });
  const cellMap = new Map(cellRows.map((c) => [c.cellKey, c]));
  const cellsUsed = new Set<string>();
  let withCellRef = 0;

  const updates: { id: string; data: Prisma.BusinessSnapshotUpdateInput }[] =
    [];
  for (const r of snapshots) {
    const { category, city, country } = r.business;
    const cellKey =
      category && city && country ? cellKeyOf(category, city, country) : null;
    const cellRow = cellKey ? (cellMap.get(cellKey) ?? null) : null;
    const cellRef = parseCellReference(cellRow ?? null);
    if (cellRef) {
      withCellRef += 1;
      if (cellKey) cellsUsed.add(cellKey);
    }

    const result = computePillars(signalsById.get(r.id)!, cellRef);
    const msi = msiMap.get(r.businessId);
    const pct = msi ? msiPercentile(msi.msiRank, msi.msiTotal) : null;

    updates.push({
      id: r.id,
      data: {
        reputationPillar: result.reputation,
        visibilityPillar: result.visibility,
        profilePillar: result.profile,
        websitePillar: result.website,
        adsPillar: result.advertising,
        adsApplicable: result.adsApplicable,
        pillarScore: result.master,
        msiRank: msi?.msiRank ?? null,
        msiTotal: msi?.msiTotal ?? null,
        msiPercentile: pct,
        cellKey,
        cellConfidence: cellRef?.confidence ?? null,
      },
    });
  }

  for (let i = 0; i < updates.length; i += WRITE_CHUNK) {
    const chunk = updates.slice(i, i + WRITE_CHUNK);
    await Promise.all(
      chunk.map((u) =>
        prisma.businessSnapshot.update({ where: { id: u.id }, data: u.data }),
      ),
    );
  }

  return {
    businessesScored: snapshots.length,
    cellsUsed: cellsUsed.size,
    metrosRanked,
    withCellRef,
  };
}
