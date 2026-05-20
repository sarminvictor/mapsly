// Cost projection · breaks down API spend by vendor / by-day / projected
// month-end. Reads CronRun.costUsd which every adapter increments via
// lib/cost/cost-counter.ts.

import { cacheLife, cacheTag } from "next/cache";
import prisma from "@/lib/prisma";

export interface CostBreakdown {
  totalToday: number;
  totalThisWeek: number;
  totalThisMonth: number;
  projectedMonthEnd: number;
  byVendor: Array<{ vendor: string; usd: number; calls: number }>;
  byJob: Array<{ job: string; usd: number; runs: number }>;
  dailyTrend: Array<{ date: string; usd: number }>;
  budget: { dailyUsd: number; haltPct: number; status: "ok" | "warn" | "halt" };
}

// Per-call cost reference (USD)
// These are reasonable estimates per .claude/rules/cost-discipline.md.
// Real costs land in CronRun.costUsd via lib/cost/cost-counter.ts.
export const COST_REFERENCE = {
  "dataforseo-maps": 0.0006,
  "dataforseo-serp": 0.001,
  "dataforseo-reviews": 0.0006,
  "dataforseo-keyword": 0.00001, // per keyword in batch of 1000
  "dataforseo-lighthouse": 0.005,
  "openai-mini-input": 0.00015 / 1000, // per token (gpt-5.4-mini estimate)
  "openai-mini-output": 0.0006 / 1000,
  "openai-nano-input": 0.00003 / 1000, // gpt-5.4-nano cheaper
  "openai-nano-output": 0.00015 / 1000,
  "anthropic-haiku-input": 0.00025 / 1000,
  "anthropic-haiku-output": 0.00125 / 1000,
  "resend-email": 0.0004,
  "apify-cu": 0.00025,
} as const;

export async function getCostBreakdown(): Promise<CostBreakdown> {
  "use cache";
  cacheLife("minutes");
  cacheTag("dev-dashboard-cost");

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return {
      totalToday: 0,
      totalThisWeek: 0,
      totalThisMonth: 0,
      projectedMonthEnd: 0,
      byVendor: [],
      byJob: [],
      dailyTrend: [],
      budget: { dailyUsd: 0, haltPct: 0, status: "ok" as const },
    };
  }

  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfWeek = new Date(now.getTime() - 7 * 86400_000);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOf30dAgo = new Date(now.getTime() - 30 * 86400_000);

  try {
    const [today, week, month, jobs, daily] = await Promise.all([
      prisma.cronRun.aggregate({
        where: { startedAt: { gte: startOfToday } },
        _sum: { costUsd: true },
      }),
      prisma.cronRun.aggregate({
        where: { startedAt: { gte: startOfWeek } },
        _sum: { costUsd: true },
      }),
      prisma.cronRun.aggregate({
        where: { startedAt: { gte: startOfMonth } },
        _sum: { costUsd: true },
      }),
      prisma.cronRun.groupBy({
        by: ["job"],
        where: { startedAt: { gte: startOfWeek } },
        _sum: { costUsd: true },
        _count: { _all: true },
        orderBy: { _sum: { costUsd: "desc" } },
        take: 12,
      }),
      prisma.$queryRaw<Array<{ d: Date; usd: number | null }>>`
        SELECT DATE_TRUNC('day', "startedAt") AS d,
               SUM("costUsd") AS usd
        FROM "CronRun"
        WHERE "startedAt" > ${startOf30dAgo}
        GROUP BY 1
        ORDER BY 1 DESC
        LIMIT 30
      `,
    ]);

    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
    ).getDate();
    const monthSoFar = Number(month._sum.costUsd ?? 0);
    const projectedMonthEnd =
      dayOfMonth > 0 ? (monthSoFar / dayOfMonth) * daysInMonth : 0;

    const budget = await prisma.costBudget.findUnique({
      where: { scope: "global" },
    });

    const dailyBudget = budget?.dailyBudgetUsd ?? 5; // default $5/day soft cap
    const todayUsd = Number(today._sum.costUsd ?? 0);
    let status: "ok" | "warn" | "halt" = "ok";
    if (todayUsd >= dailyBudget * (budget?.haltThresholdPct ?? 1))
      status = "halt";
    else if (todayUsd >= dailyBudget * (budget?.alertThresholdPct ?? 0.8))
      status = "warn";

    // Aggregate per-vendor from job names (job convention: "vendor:operation")
    const byVendorMap = new Map<string, { usd: number; calls: number }>();
    for (const j of jobs) {
      const vendor = j.job.split(":")[0] ?? "other";
      const acc = byVendorMap.get(vendor) ?? { usd: 0, calls: 0 };
      acc.usd += Number(j._sum.costUsd ?? 0);
      acc.calls += j._count._all;
      byVendorMap.set(vendor, acc);
    }
    const byVendor = [...byVendorMap.entries()]
      .map(([vendor, v]) => ({ vendor, usd: v.usd, calls: v.calls }))
      .sort((a, b) => b.usd - a.usd);

    return {
      totalToday: todayUsd,
      totalThisWeek: Number(week._sum.costUsd ?? 0),
      totalThisMonth: monthSoFar,
      projectedMonthEnd,
      byVendor,
      byJob: jobs.map((j) => ({
        job: j.job,
        usd: Number(j._sum.costUsd ?? 0),
        runs: j._count._all,
      })),
      dailyTrend: daily.map((d) => ({
        date: d.d.toISOString().slice(0, 10),
        usd: Number(d.usd ?? 0),
      })),
      budget: {
        dailyUsd: dailyBudget,
        haltPct: budget?.haltThresholdPct ?? 1,
        status,
      },
    };
  } catch {
    return {
      totalToday: 0,
      totalThisWeek: 0,
      totalThisMonth: 0,
      projectedMonthEnd: 0,
      byVendor: [],
      byJob: [],
      dailyTrend: [],
      budget: { dailyUsd: 5, haltPct: 1, status: "ok" },
    };
  }
}
