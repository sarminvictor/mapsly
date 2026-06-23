// modules/cell-intel/freshness.ts · per-cell run freshness gate (Phase 6).
//
// Every cell-intel collector (Meta ads, Google ads, SERP) runs ONCE per cell
// and caches its result in the DB for 30 days. Before re-fetching from a paid
// vendor, the collector asks: did we already run this cell+platform within the
// freshness window? If yes — serve from the DB at $0; if no (or never) — run.
//
// The freshness cursor is the most-recent `AdMarketRun(cellKey, platform)`. The
// SERP layer also uses `AdMarketRun(platform="SERP")` as its run-marker so all
// three layers share one gate + one telemetry row shape.
//
// All time math takes an explicit `now` so it's pure/testable AND safe under
// Next 16 PPR (no argless `new Date()` — INC-09). Mirrors lib/cell.ts.

import prisma from "@/lib/prisma";

/** Default cache window for cell intelligence: 30 days. */
export const CELL_INTEL_FRESHNESS_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/** AdMarketRun.platform values used by the cell-intel layers. */
export type CellIntelPlatform = "META" | "GOOGLE" | "SERP";

/**
 * True if a run that happened at `lastRunAt` is still inside the freshness
 * window relative to `now`. `null` (never run) is always stale. The boundary
 * is inclusive of `days` — exactly `days` old is still fresh, so a daily/weekly
 * cron with minor jitter doesn't needlessly re-pay on the boundary tick.
 */
export function isCellRunFresh(
  lastRunAt: Date | null,
  now: Date,
  days = CELL_INTEL_FRESHNESS_DAYS,
): boolean {
  if (!lastRunAt) return false;
  const ageMs = now.getTime() - lastRunAt.getTime();
  if (ageMs < 0) return true; // clock skew: a future run is treated as fresh
  return ageMs <= days * MS_PER_DAY;
}

/**
 * The latest AdMarketRun row for a (cellKey, platform), or null if the cell has
 * never been run for that platform. Used by every collector to decide
 * serve-from-DB vs re-fetch.
 */
export async function latestAdMarketRun(
  cellKey: string,
  platform: CellIntelPlatform,
): Promise<{ id: string; ranAt: Date; status: string } | null> {
  const row = await prisma.adMarketRun.findFirst({
    where: { cellKey, platform },
    orderBy: { ranAt: "desc" },
    select: { id: true, ranAt: true, status: true },
  });
  return row ?? null;
}
