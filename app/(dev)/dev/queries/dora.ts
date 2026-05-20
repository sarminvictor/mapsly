// DORA (DevOps Research and Assessment) four-key metrics.
// Derived from TaskRun + incidents.md + Task table — no extra infra needed.

import { cacheLife, cacheTag } from "next/cache";
import prisma from "@/lib/prisma";

export interface DoraMetrics {
  deployFrequency: { last7d: number; last30d: number };
  leadTimeP50Hours: number | null;
  leadTimeP95Hours: number | null;
  changeFailureRate: { last7d: number; last30d: number };
  mttrHours: number | null;
}

export async function getDoraMetrics(): Promise<DoraMetrics> {
  "use cache";
  cacheLife("minutes");
  cacheTag("dev-dashboard-dora");

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return {
      deployFrequency: { last7d: 0, last30d: 0 },
      leadTimeP50Hours: null,
      leadTimeP95Hours: null,
      changeFailureRate: { last7d: 0 },
      mttrHours: null,
    };
  }


  const now = new Date();
  const since7d = new Date(now.getTime() - 7 * 86400_000);
  const since30d = new Date(now.getTime() - 30 * 86400_000);

  try {
    const [runs7d, runs30d, doneTasks] = await Promise.all([
      prisma.taskRun.findMany({
        where: { startedAt: { gte: since7d } },
        select: { outcome: true, prNumber: true },
      }),
      prisma.taskRun.findMany({
        where: { startedAt: { gte: since30d } },
        select: { outcome: true, prNumber: true },
      }),
      prisma.task.findMany({
        where: { status: "DONE", completedAt: { gte: since30d } },
        select: { createdAt: true, completedAt: true },
      }),
    ]);

    const merges = (runs: typeof runs7d) =>
      new Set(
        runs
          .filter((r) => r.outcome === "SUCCESS" && r.prNumber != null)
          .map((r) => r.prNumber),
      ).size;

    const failureRate = (runs: typeof runs7d) => {
      if (runs.length === 0) return 0;
      const failed = runs.filter((r) => r.outcome === "FAILED").length;
      return Math.round((failed / runs.length) * 100);
    };

    const leadTimes = doneTasks
      .map(
        (t) =>
          ((t.completedAt!.getTime() - t.createdAt.getTime()) / 3600_000) | 0,
      )
      .sort((a, b) => a - b);

    const pct = (arr: number[], p: number) => {
      if (arr.length === 0) return null;
      const idx = Math.min(arr.length - 1, Math.floor(arr.length * p));
      return arr[idx];
    };

    return {
      deployFrequency: { last7d: merges(runs7d), last30d: merges(runs30d) },
      leadTimeP50Hours: pct(leadTimes, 0.5),
      leadTimeP95Hours: pct(leadTimes, 0.95),
      changeFailureRate: {
        last7d: failureRate(runs7d),
        last30d: failureRate(runs30d),
      },
      mttrHours: null, // requires incident open/close timestamps which we don't yet store structured
    };
  } catch {
    return {
      deployFrequency: { last7d: 0, last30d: 0 },
      leadTimeP50Hours: null,
      leadTimeP95Hours: null,
      changeFailureRate: { last7d: 0, last30d: 0 },
      mttrHours: null,
    };
  }
}
