/**
 * /admin/cron-runs · queries.
 *
 * Operational telemetry for every cron + admin-triggered job.
 * Surfaces:
 *   - Per-job aggregate (last-7d, total runs, total cost, status mix)
 *   - Recent runs list with status pills + drilldown
 *   - Per-run detail (meta JSON, itemsProcessed, cost, error message)
 */

import prisma from "@/lib/prisma";

export interface JobAggregate {
  job: string;
  totalRuns: number;
  okCount: number;
  failedCount: number;
  partialCount: number;
  runningCount: number;
  totalCostUsd: number;
  lastRunAt: Date | null;
  avgDurationSec: number | null;
}

export interface CronRunRow {
  id: string;
  job: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  itemsProcessed: number;
  costUsd: number | null;
  errorMessage: string | null;
  durationSec: number | null;
}

export interface CronRunListFilters {
  job?: string;
  status?: "OK" | "PARTIAL" | "FAILED" | "RUNNING" | "ALL";
  sinceDays?: number; // default 7
  limit?: number;
}

export interface CronRunListResult {
  rows: CronRunRow[];
  total: number;
  jobs: JobAggregate[];
  /** Distinct job names for the filter dropdown. */
  jobNames: string[];
}

export async function getCronRunsView(
  filters: CronRunListFilters = {},
): Promise<CronRunListResult> {
  const limit = Math.min(filters.limit ?? 100, 500);
  const sinceDays = filters.sinceDays ?? 7;
  const since = new Date(Date.now() - sinceDays * 86_400_000);

  const where: Record<string, unknown> = { startedAt: { gte: since } };
  if (filters.job && filters.job !== "ALL") where.job = filters.job;
  if (filters.status && filters.status !== "ALL") where.status = filters.status;

  const [rows, total, perJob, jobNames] = await Promise.all([
    prisma.cronRun.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: limit,
      select: {
        id: true,
        job: true,
        startedAt: true,
        finishedAt: true,
        status: true,
        itemsProcessed: true,
        costUsd: true,
        errorMessage: true,
      },
    }),
    prisma.cronRun.count({ where }),
    prisma.cronRun.groupBy({
      by: ["job", "status"],
      where: { startedAt: { gte: since } },
      _count: { id: true },
      _sum: { costUsd: true },
      _max: { startedAt: true },
    }),
    prisma.cronRun.findMany({
      select: { job: true },
      distinct: ["job"],
      orderBy: { job: "asc" },
      take: 100,
    }),
  ]);

  // Aggregate per-job from the groupBy.
  const byJob = new Map<string, JobAggregate>();
  for (const g of perJob) {
    const agg = byJob.get(g.job) ?? {
      job: g.job,
      totalRuns: 0,
      okCount: 0,
      failedCount: 0,
      partialCount: 0,
      runningCount: 0,
      totalCostUsd: 0,
      lastRunAt: null as Date | null,
      avgDurationSec: null,
    };
    agg.totalRuns += g._count.id;
    agg.totalCostUsd += g._sum.costUsd ?? 0;
    if (
      g._max.startedAt &&
      (!agg.lastRunAt || g._max.startedAt > agg.lastRunAt)
    ) {
      agg.lastRunAt = g._max.startedAt;
    }
    switch (g.status) {
      case "OK":
        agg.okCount += g._count.id;
        break;
      case "FAILED":
        agg.failedCount += g._count.id;
        break;
      case "PARTIAL":
        agg.partialCount += g._count.id;
        break;
      case "RUNNING":
        agg.runningCount += g._count.id;
        break;
    }
    byJob.set(g.job, agg);
  }

  return {
    rows: rows.map((r) => ({
      id: r.id,
      job: r.job,
      startedAt: r.startedAt.toISOString(),
      finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
      status: r.status,
      itemsProcessed: r.itemsProcessed,
      costUsd: r.costUsd,
      errorMessage: r.errorMessage,
      durationSec:
        r.finishedAt && r.startedAt
          ? Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000)
          : null,
    })),
    total,
    jobs: Array.from(byJob.values()).sort(
      (a, b) => (b.lastRunAt?.getTime() ?? 0) - (a.lastRunAt?.getTime() ?? 0),
    ),
    jobNames: jobNames.map((j) => j.job),
  };
}

export interface CronRunDetail {
  id: string;
  job: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  itemsProcessed: number;
  costUsd: number | null;
  errorMessage: string | null;
  durationSec: number | null;
  meta: unknown;
}

export async function getCronRunDetail(
  id: string,
): Promise<CronRunDetail | null> {
  const row = await prisma.cronRun.findUnique({ where: { id } });
  if (!row) return null;
  return {
    id: row.id,
    job: row.job,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    status: row.status,
    itemsProcessed: row.itemsProcessed,
    costUsd: row.costUsd,
    errorMessage: row.errorMessage,
    durationSec:
      row.finishedAt && row.startedAt
        ? Math.round(
            (row.finishedAt.getTime() - row.startedAt.getTime()) / 1000,
          )
        : null,
    meta: row.meta,
  };
}
