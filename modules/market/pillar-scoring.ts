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
  PILLARS,
  rankByMsiInMetros,
  type CellReference,
  type Pillar,
  type PillarResult,
  type PillarSignals,
} from "@/modules/scoring";
import {
  cellKeyOf,
  parseCellReference,
  signalsFromSnapshot,
} from "./cell-metrics";
import { loadTrackedMarkets, resolveMarketCell } from "./market-category";

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

  // Latest snapshot per active, QUALIFIED business + the geo we rank/grade
  // within. Comparison/ranking is QUALIFIED-only everywhere — unclaimed,
  // review-less, or unreachable listings are not real competitors and must
  // never inflate a cell's denominator ("#X of N nearby" counts qualified).
  const snapshots = await prisma.businessSnapshot.findMany({
    where: { business: { isActive: true, qualificationStatus: "QUALIFIED" } },
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
          categoryIds: true,
          city: true,
          province: true,
          country: true,
          lat: true,
          lng: true,
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

  // Market reference per cell (grouped by Discovery market · see cell-metrics).
  const markets = await loadTrackedMarkets();
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

  // Pass 1 · compute each business's pillar result + its cell.
  interface Scored {
    id: string;
    businessId: string;
    cellKey: string | null;
    cellConfidence: string | null;
    result: PillarResult;
  }
  const scored: Scored[] = [];
  for (const r of snapshots) {
    const cell = resolveMarketCell(r.business, markets);
    const cellKey =
      cell.category && cell.city && cell.country
        ? cellKeyOf(cell.category, cell.city, cell.country)
        : null;
    const cellRow = cellKey ? (cellMap.get(cellKey) ?? null) : null;
    const cellRef: CellReference | null = parseCellReference(cellRow ?? null);
    if (cellRef) {
      withCellRef += 1;
      if (cellKey) cellsUsed.add(cellKey);
    }
    scored.push({
      id: r.id,
      businessId: r.businessId,
      cellKey,
      cellConfidence: cellRef?.confidence ?? null,
      result: computePillars(signalsById.get(r.id)!, cellRef),
    });
  }

  // Pass 2 · per-cell, per-pillar ranks — each page shows "your rank BY that
  // pillar" (e.g. by reviews on /reviews), not the overall MSI rank. We rank
  // over EVERY qualified business in the cell: a business with no score for a
  // pillar is treated as 0 and sinks to the bottom (counted, never dropped) — so
  // the denominator is always the full cell, e.g. "#2 of 25", not "#2 of 4".
  // Standard competition ranking ("1 2 2 4"): tied scores (the field of 0s)
  // share a rank instead of getting an arbitrary sequential order.
  const ranksByBiz = new Map<
    string,
    Partial<Record<Pillar | "master", { rank: number; of: number }>>
  >();
  const cellSizeByBiz = new Map<string, number>();
  const byCell = new Map<string, Scored[]>();
  for (const s of scored) {
    const key = s.cellKey ?? "__none__";
    let members = byCell.get(key);
    if (!members) {
      members = [];
      byCell.set(key, members);
    }
    members.push(s);
  }
  for (const members of byCell.values()) {
    const of = members.length; // every qualified business in the cell
    for (const s of members) cellSizeByBiz.set(s.businessId, of);
    for (const p of PILLARS) {
      // null pillar score → 0 so unmeasured businesses are counted and ranked at
      // the bottom rather than excluded from the denominator.
      const sorted = members
        .map((m) => ({ biz: m.businessId, v: m.result[p] ?? 0 }))
        .sort((a, b) => b.v - a.v);
      let prevValue: number | null = null;
      let prevRank = 0;
      sorted.forEach((entry, i) => {
        const rank =
          prevValue !== null && entry.v === prevValue ? prevRank : i + 1;
        prevValue = entry.v;
        prevRank = rank;
        const rec = ranksByBiz.get(entry.biz) ?? {};
        rec[p] = { rank, of };
        ranksByBiz.set(entry.biz, rec);
      });
    }
    // Overall standing rank — by the master (consolidated) score, same
    // null→0 + competition-ranking rules. Stored under `master` so the
    // weekly overview's "moved ▲/▼ N positions" delta has a stable
    // per-week record to diff against next cycle (forward-only · no migration).
    {
      const sorted = members
        .map((m) => ({ biz: m.businessId, v: m.result.master ?? 0 }))
        .sort((a, b) => b.v - a.v);
      let prevValue: number | null = null;
      let prevRank = 0;
      sorted.forEach((entry, i) => {
        const rank =
          prevValue !== null && entry.v === prevValue ? prevRank : i + 1;
        prevValue = entry.v;
        prevRank = rank;
        const rec = ranksByBiz.get(entry.biz) ?? {};
        rec.master = { rank, of };
        ranksByBiz.set(entry.biz, rec);
      });
    }
  }

  // Pass 3 · build the writes.
  const updates: { id: string; data: Prisma.BusinessSnapshotUpdateInput }[] =
    [];
  for (const s of scored) {
    const msi = msiMap.get(s.businessId);
    const pct = msi ? msiPercentile(msi.msiRank, msi.msiTotal) : null;
    const ranks = ranksByBiz.get(s.businessId) ?? {};
    updates.push({
      id: s.id,
      data: {
        reputationPillar: s.result.reputation,
        visibilityPillar: s.result.visibility,
        profilePillar: s.result.profile,
        websitePillar: s.result.website,
        adsPillar: s.result.advertising,
        adsApplicable: s.result.adsApplicable,
        pillarScore: s.result.master,
        msiRank: msi?.msiRank ?? null,
        msiTotal: msi?.msiTotal ?? null,
        msiPercentile: pct,
        cellKey: s.cellKey,
        cellConfidence: s.cellConfidence,
        pillarRanks: ranks as Prisma.InputJsonValue,
        cellSize: cellSizeByBiz.get(s.businessId) ?? null,
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
