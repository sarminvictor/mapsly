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
 * The latest SUCCESSFUL AdMarketRun row for a (cellKey, platform), or null if
 * the cell has never had a successful run for that platform. Used by every
 * collector to decide serve-from-DB vs re-fetch.
 *
 * WP1-6 · filters `status IN ('OK','PARTIAL')` — a FAILED run (each collector
 * writes one in its catch) must NOT satisfy the freshness gate. Without this a
 * failed cell was masked as "fresh" for 30 days and never retried, and its data
 * never landed. Only a run that actually produced data (OK, or PARTIAL with
 * some errors) counts as a freshness anchor.
 */
export async function latestAdMarketRun(
  cellKey: string,
  platform: CellIntelPlatform,
): Promise<{ id: string; ranAt: Date; status: string } | null> {
  const row = await prisma.adMarketRun.findFirst({
    where: { cellKey, platform, status: { in: ["OK", "PARTIAL"] } },
    orderBy: { ranAt: "desc" },
    select: { id: true, ranAt: true, status: true },
  });
  return row ?? null;
}

/** Default backoff before a FAILED (blocked/timeout) Meta cell is eligible for
 *  a dead-letter retry — long enough to let a transient Meta soft-block clear,
 *  short enough that a walled cell isn't stranded for the 30-day freshness TTL. */
export const META_RETRY_BACKOFF_HOURS = 6;

/**
 * R2 · DEAD-LETTER re-queue query. Finds cells whose MOST-RECENT Meta run is a
 * FAILED marker (blocked/timeout/error — R0 writes one) older than the backoff
 * window AND that have no fresher successful (OK/PARTIAL) run. These are the
 * targets the R0 taxonomy caught as silent failures; the dispatch/cron picks
 * them up for a retry on a fresh IP instead of losing them for 30 days.
 *
 * Reuses `AdMarketRun.status` + `ranAt` only — NO new column/migration. A cell
 * that later succeeds writes an OK/PARTIAL row with a newer `ranAt`, so it drops
 * out of this query automatically (its latest run is no longer the FAILED one).
 *
 * `now` is explicit (pure/testable, PPR-safe — no argless `new Date()`, INC-09).
 */
export async function cellsDueForMetaRetry(
  now: Date = new Date(),
  opts: { backoffHours?: number; limit?: number } = {},
): Promise<string[]> {
  const backoffHours = opts.backoffHours ?? META_RETRY_BACKOFF_HOURS;
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 500));
  const cutoff = new Date(now.getTime() - backoffHours * 60 * 60 * 1000);

  // Candidate FAILED markers past the backoff. We over-fetch a bounded batch,
  // then keep only cells whose LATEST run (any status) is still this FAILED row
  // — i.e. no OK/PARTIAL/newer run has superseded it.
  const failed = await prisma.adMarketRun.findMany({
    where: { platform: "META", status: "FAILED", ranAt: { lt: cutoff } },
    orderBy: { ranAt: "desc" },
    select: { cellKey: true, ranAt: true },
    take: limit * 4,
  });

  // Newest FAILED-past-cutoff marker per cell (the list is ranAt-desc, so the
  // first hit per cell IS its newest FAILED).
  const newestFailedByCell = new Map<string, Date>();
  for (const f of failed) {
    if (!newestFailedByCell.has(f.cellKey))
      newestFailedByCell.set(f.cellKey, f.ranAt);
  }
  const candidateCells = [...newestFailedByCell.keys()];
  if (candidateCells.length === 0) return [];

  // CODE-REVIEW #1 · one batched query instead of a per-cell findFirst (the old
  // N+1). The newest run overall per candidate cell: if that equals the cell's
  // newest FAILED marker, no fresher (OK/PARTIAL or newer-FAILED) run has
  // superseded it → the cell is still stuck FAILED and is due for retry.
  const maxByCell = await prisma.adMarketRun.groupBy({
    by: ["cellKey"],
    where: { cellKey: { in: candidateCells }, platform: "META" },
    _max: { ranAt: true },
  });
  const latestByCell = new Map<string, number>();
  for (const g of maxByCell) {
    if (g._max.ranAt) latestByCell.set(g.cellKey, g._max.ranAt.getTime());
  }

  const due: string[] = [];
  for (const [cellKey, failedAt] of newestFailedByCell) {
    // Due iff the newest run overall IS this FAILED marker (nothing newer
    // succeeded after it — a later OK/PARTIAL would make latest > failedAt).
    if (latestByCell.get(cellKey) === failedAt.getTime()) {
      due.push(cellKey);
      if (due.length >= limit) break;
    }
  }
  return due;
}
