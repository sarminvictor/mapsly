// In-flight task · live "what is the loop currently doing?"
// Source of truth: Postgres Task table where status=IN_PROGRESS,
// joined with the most-recent TaskRun for that task.

import { cacheLife, cacheTag } from "next/cache";
import prisma from "@/lib/prisma";

export interface InFlightTask {
  taskId: string;
  title: string;
  status: "IN_PROGRESS" | "RECENT";
  lastSessionId: string | null;
  startedAt: Date | null;
  branchName: string | null;
  runOutcome: string | null;
  runScoreAggregate: number | null;
  parallelLane: string | null;
}

export async function getInFlight(): Promise<InFlightTask | null> {
  "use cache";
  cacheLife("seconds");
  cacheTag("dev-dashboard-inflight");

  // Prefer an actually-running TaskRun (outcome=IN_PROGRESS).
  // Don't trust Task.status alone — that stays IN_PROGRESS while PRs await review.
  const active = await prisma.task.findFirst({
    where: {
      status: "IN_PROGRESS",
      runs: {
        some: { outcome: "IN_PROGRESS" },
      },
    },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      title: true,
      lastSessionId: true,
      startedAt: true,
      parallelLane: true,
      runs: {
        take: 1,
        orderBy: { startedAt: "desc" },
        select: {
          outcome: true,
          scoreAggregate: true,
          branchName: true,
        },
      },
    },
  });

  if (active) {
    return {
      taskId: active.id,
      title: active.title,
      status: "IN_PROGRESS",
      lastSessionId: active.lastSessionId,
      startedAt: active.startedAt,
      branchName: active.runs[0]?.branchName ?? null,
      runOutcome: active.runs[0]?.outcome ?? null,
      runScoreAggregate: active.runs[0]?.scoreAggregate ?? null,
      parallelLane: active.parallelLane,
    };
  }

  // Otherwise show the most-recent completed run
  const recent = await prisma.taskRun.findFirst({
    where: { outcome: { in: ["SUCCESS", "PARTIAL", "FAILED", "INCOMPLETE"] } },
    orderBy: { startedAt: "desc" },
    select: {
      sessionId: true,
      startedAt: true,
      outcome: true,
      scoreAggregate: true,
      branchName: true,
      task: {
        select: {
          id: true,
          title: true,
          parallelLane: true,
        },
      },
    },
  });

  if (!recent?.task) return null;

  return {
    taskId: recent.task.id,
    title: recent.task.title,
    status: "RECENT",
    lastSessionId: recent.sessionId,
    startedAt: recent.startedAt,
    branchName: recent.branchName,
    runOutcome: recent.outcome,
    runScoreAggregate: recent.scoreAggregate,
    parallelLane: recent.task.parallelLane,
  };
}
