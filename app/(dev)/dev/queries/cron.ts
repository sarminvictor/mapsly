// CronRun aggregate · reads from Postgres via Prisma.
// Used by the "cost today" + "failures 24h" tiles.

import { cacheLife, cacheTag } from "next/cache";
import prisma from "@/lib/prisma";

export interface CronAggregate {
  costToday: number;
  costYesterday: number;
  failures24h: number;
  successful24h: number;
  totalRuns24h: number;
  recentJobs: Array<{
    job: string;
    status: string;
    costUsd: number;
    startedAt: string;
  }>;
}

export async function getCronAggregate(): Promise<CronAggregate> {
  "use cache";
  cacheLife("minutes");
  cacheTag("dev-dashboard-cron");

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return { costToday: 0, costYesterday: 0, recentJobs: [] };
  }


  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  try {
    const [costToday, costYest, failures, successes, recent] =
      await Promise.all([
        prisma.cronRun.aggregate({
          where: { startedAt: { gte: todayStart } },
          _sum: { costUsd: true },
        }),
        prisma.cronRun.aggregate({
          where: {
            startedAt: { gte: yesterdayStart, lt: todayStart },
          },
          _sum: { costUsd: true },
        }),
        prisma.cronRun.count({
          where: {
            startedAt: { gte: twentyFourHoursAgo },
            status: "FAILED",
          },
        }),
        prisma.cronRun.count({
          where: {
            startedAt: { gte: twentyFourHoursAgo },
            status: { not: "FAILED" },
          },
        }),
        prisma.cronRun.findMany({
          where: { startedAt: { gte: twentyFourHoursAgo } },
          orderBy: { startedAt: "desc" },
          take: 10,
          select: {
            job: true,
            status: true,
            costUsd: true,
            startedAt: true,
          },
        }),
      ]);

    return {
      costToday: Number(costToday._sum.costUsd ?? 0),
      costYesterday: Number(costYest._sum.costUsd ?? 0),
      failures24h: failures,
      successful24h: successes,
      totalRuns24h: failures + successes,
      recentJobs: recent.map((r) => ({
        job: r.job,
        status: r.status,
        costUsd: Number(r.costUsd ?? 0),
        startedAt: r.startedAt.toISOString(),
      })),
    };
  } catch {
    // Schema might not be applied yet, or DB unreachable in this build
    return {
      costToday: 0,
      costYesterday: 0,
      failures24h: 0,
      successful24h: 0,
      totalRuns24h: 0,
      recentJobs: [],
    };
  }
}
