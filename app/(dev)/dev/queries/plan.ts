import { cacheLife, cacheTag } from "next/cache";
import prisma from "@/lib/prisma";

export interface PhaseRow {
  id: string;
  description: string;
  effort: string;
  status:
    | "pending"
    | "in_progress"
    | "done"
    | "blocked"
    | "human-required"
    | "skipped"
    | "failed";
  deps: string;
  tags: string;
  groupId: string;
}

export interface TaskGroupSummary {
  id: string;
  name: string;
  description: string | null;
  domain: string;
  sortOrder: number;
  done: number;
  inProgress: number;
  pending: number;
  blocked: number;
  total: number;
  percent: number;
  rows: PhaseRow[];
}

export interface PlanSummary {
  total: number;
  done: number;
  inProgress: number;
  pending: number;
  blocked: number;
  humanRequired: number;
  percent: number;
  rows: PhaseRow[];
  groups: TaskGroupSummary[];
}

const STATUS_TO_UI = {
  DONE: "done",
  IN_PROGRESS: "in_progress",
  PENDING: "pending",
  BLOCKED: "blocked",
  HUMAN_REQUIRED: "human-required",
  SKIPPED: "skipped",
  FAILED: "failed",
} as const;

export async function getPlanSummary(): Promise<PlanSummary> {
  "use cache";
  cacheLife("seconds");
  cacheTag("dev-dashboard-plan");

  try {
    const groups = await prisma.taskGroup.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        tasks: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }] },
      },
    });

    const allRows: PhaseRow[] = [];
    const groupSummaries: TaskGroupSummary[] = groups.map((g) => {
      const rows: PhaseRow[] = g.tasks.map((t) => ({
        id: t.id,
        description: t.title,
        effort: t.effort ?? "",
        status: STATUS_TO_UI[t.status] as PhaseRow["status"],
        deps: t.deps ?? "",
        tags: t.tags ?? "",
        groupId: g.id,
      }));
      allRows.push(...rows);
      const done = rows.filter((r) => r.status === "done").length;
      const inProgress = rows.filter((r) => r.status === "in_progress").length;
      const pending = rows.filter((r) => r.status === "pending").length;
      const blocked = rows.filter(
        (r) => r.status === "blocked" || r.status === "failed",
      ).length;
      return {
        id: g.id,
        name: g.name,
        description: g.description,
        domain: g.domain,
        sortOrder: g.sortOrder,
        done,
        inProgress,
        pending,
        blocked,
        total: rows.length,
        percent: rows.length > 0 ? Math.round((done / rows.length) * 100) : 0,
        rows,
      };
    });

    const total = allRows.length;
    const done = allRows.filter((r) => r.status === "done").length;
    const inProgress = allRows.filter((r) => r.status === "in_progress").length;
    const pending = allRows.filter((r) => r.status === "pending").length;
    const blocked = allRows.filter(
      (r) => r.status === "blocked" || r.status === "failed",
    ).length;
    const humanRequired = allRows.filter(
      (r) => r.status === "human-required",
    ).length;

    return {
      total,
      done,
      inProgress,
      pending,
      blocked,
      humanRequired,
      percent: total > 0 ? Math.round((done / total) * 100) : 0,
      rows: allRows,
      groups: groupSummaries,
    };
  } catch {
    return {
      total: 0,
      done: 0,
      inProgress: 0,
      pending: 0,
      blocked: 0,
      humanRequired: 0,
      percent: 0,
      rows: [],
      groups: [],
    };
  }
}

// Single task fetch — for detail page
export async function getTaskDetail(id: string) {
  "use cache";
  cacheLife("seconds");
  cacheTag(`dev-task-${id}`);

  try {
    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        group: true,
        runs: { orderBy: { startedAt: "desc" }, take: 20 },
      },
    });
    return task;
  } catch {
    return null;
  }
}
