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
  /** Set when getPlanSummary catches an error — page should show this instead of the empty state. */
  error?: string;
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

  if (process.env.NEXT_PHASE === "phase-production-build") {
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

  try {
    // v0.7.2 (INC-37): explicit SELECT prevents schema-drift breakage. When
    // a new Task column is added via Prisma client but not yet pushed to
    // Neon, the deployed app would throw "column does not exist" on
    // findMany-with-include. Listing fields explicitly only fetches what
    // we render — additive schema changes don't break the dashboard.
    const groups = await prisma.taskGroup.findMany({
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        domain: true,
        sortOrder: true,
        tasks: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          select: {
            id: true,
            title: true,
            effort: true,
            status: true,
            deps: true,
            tags: true,
          },
        },
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
  } catch (err) {
    // v0.7.2 (INC-37): surface the error instead of silently returning 0.
    // The page detects `error` field and shows an actionable message
    // (schema drift, Neon down, etc.) rather than the misleading
    // "no tasks · run pnpm seed:plan" empty state.
    console.error("[plan.ts] getPlanSummary failed:", err);
    return {
      error: err instanceof Error ? err.message : String(err),
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

  if (process.env.NEXT_PHASE === "phase-production-build") return null;

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
