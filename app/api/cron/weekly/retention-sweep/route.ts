// WP9-1 · Retention sweep for job-bookkeeping tables.
//
// EnrichmentJob (up to 25k rows per full run), EnrichmentStageRun (5 rows per
// AI-researched business), and CellSnapshot grow forever with no cleanup — at
// scale they slow the runId-filtered hot queries even with the WP0 indexes.
// This weekly cron prunes them with conservative retention:
//   • EnrichmentJob: delete terminal rows (DONE/SKIPPED_FRESH) whose run
//     finished > 30d ago; keep FAILED for 90d (support/debugging).
//   • EnrichmentStageRun: compact to the latest row per (businessId, stage) —
//     older recomputations of the same stage are dead weight.
//   • CellSnapshot: cap to the newest N per (trackedLocationId, cellKey).
//   • CreditLedger is NOT pruned here — it is a financial record (archive past
//     12 months is a separate, out-of-band job).
//
// Bounded work per invocation (scalability rule). Cost-tracked via cronHandler.
// UNSCHEDULED by default in vercel.json — see docs/data-cadence.md §3; add a
// `0 4 * * 0` weekly entry when ready. The schedule-resolves CI test will then
// require this handler to keep existing.

import { after } from "next/server";

import prisma from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";

const JOB = "weekly:retention-sweep";
const MS_PER_DAY = 86_400_000;
const TERMINAL_KEEP_DAYS = 30;
const FAILED_KEEP_DAYS = 90;
const CELL_SNAPSHOTS_PER_CELL = 12; // ~3 months of weekly snapshots
/** Cap deletes per invocation so a huge backlog can't blow the 300s budget. */
const MAX_JOB_DELETE = 20_000;

export const GET = cronHandler(JOB, async () => {
  const now = Date.now();
  const terminalCutoff = new Date(now - TERMINAL_KEEP_DAYS * MS_PER_DAY);
  const failedCutoff = new Date(now - FAILED_KEEP_DAYS * MS_PER_DAY);

  // 1 · EnrichmentJob — terminal rows on runs that finished long ago. Join via
  // the run's finishedAt (a job has no own finishedAt for SKIPPED_FRESH), so
  // resolve the eligible run ids first, then delete their terminal jobs.
  const oldRuns = await prisma.enrichmentRun.findMany({
    where: { finishedAt: { lt: terminalCutoff } },
    select: { id: true },
    take: 5_000,
    orderBy: { finishedAt: "asc" },
  });
  const oldRunIds = oldRuns.map((r) => r.id);

  let jobsDeleted = 0;
  if (oldRunIds.length > 0) {
    const doneDel = await prisma.enrichmentJob.deleteMany({
      where: {
        runId: { in: oldRunIds },
        status: { in: ["DONE", "SKIPPED_FRESH"] },
      },
    });
    jobsDeleted += doneDel.count;
  }
  // FAILED kept longer, pruned only past the 90d window.
  const veryOldRuns = await prisma.enrichmentRun.findMany({
    where: { finishedAt: { lt: failedCutoff } },
    select: { id: true },
    take: 5_000,
    orderBy: { finishedAt: "asc" },
  });
  if (veryOldRuns.length > 0) {
    const failedDel = await prisma.enrichmentJob.deleteMany({
      where: {
        runId: { in: veryOldRuns.map((r) => r.id) },
        status: "FAILED",
      },
    });
    jobsDeleted += failedDel.count;
  }

  // 2 · EnrichmentStageRun — keep only the newest per (businessId, stage). Do the
  // dedup in a bounded post-response pass so it never blocks the tick close.
  after(async () => {
    try {
      await compactStageRuns();
      await capCellSnapshots();
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "retention.sweep.after.error",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  });

  return {
    status: "OK" as const,
    itemsProcessed: jobsDeleted,
    meta: {
      jobsDeleted,
      oldRunIds: oldRunIds.length,
      capped: jobsDeleted >= MAX_JOB_DELETE,
    },
  };
});

/** Delete all but the newest EnrichmentStageRun per (businessId, stage). */
async function compactStageRuns(): Promise<number> {
  // Bounded: operate on the businesses with the most stage rows first.
  const groups = await prisma.enrichmentStageRun.groupBy({
    by: ["businessId", "stage"],
    _count: { _all: true },
    having: { businessId: { _count: { gt: 1 } } },
    orderBy: { businessId: "asc" },
    take: 2_000,
  });
  let deleted = 0;
  for (const g of groups) {
    const keep = await prisma.enrichmentStageRun.findFirst({
      where: { businessId: g.businessId, stage: g.stage },
      orderBy: { computedAt: "desc" },
      select: { id: true },
    });
    if (!keep) continue;
    const del = await prisma.enrichmentStageRun.deleteMany({
      where: {
        businessId: g.businessId,
        stage: g.stage,
        id: { not: keep.id },
      },
    });
    deleted += del.count;
  }
  return deleted;
}

/** Cap CellSnapshot to the newest N per (trackedLocationId, cellKey). */
async function capCellSnapshots(): Promise<number> {
  const groups = await prisma.cellSnapshot.groupBy({
    by: ["trackedLocationId", "cellKey"],
    _count: { _all: true },
    having: { trackedLocationId: { _count: { gt: CELL_SNAPSHOTS_PER_CELL } } },
    orderBy: { trackedLocationId: "asc" },
    take: 2_000,
  });
  let deleted = 0;
  for (const g of groups) {
    const keep = await prisma.cellSnapshot.findMany({
      where: { trackedLocationId: g.trackedLocationId, cellKey: g.cellKey },
      orderBy: { capturedAt: "desc" },
      take: CELL_SNAPSHOTS_PER_CELL,
      select: { id: true },
    });
    const keepIds = keep.map((k) => k.id);
    const del = await prisma.cellSnapshot.deleteMany({
      where: {
        trackedLocationId: g.trackedLocationId,
        cellKey: g.cellKey,
        id: { notIn: keepIds },
      },
    });
    deleted += del.count;
  }
  return deleted;
}
