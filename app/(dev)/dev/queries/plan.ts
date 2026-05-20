// Task summary · reads from the Postgres Task table (source of truth).
// Falls back to PLAN.md parser if DB is unreachable (initial deploy, env issues).

import { cacheLife, cacheTag } from "next/cache";
import prisma from "@/lib/prisma";
import { fetchRaw } from "./github-content";

export interface PhaseRow {
  id: string;
  description: string;
  effort: string;
  status: "pending" | "in_progress" | "done" | "blocked" | "human-required";
  deps: string;
  tags: string;
  scoreAvg?: number | null;
  prNumber?: number | null;
  prUrl?: string | null;
  completedAt?: string | null;
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
  source: "db" | "plan-md";
}

const STATUS_TO_UI = {
  DONE: "done",
  IN_PROGRESS: "in_progress",
  PENDING: "pending",
  BLOCKED: "blocked",
  HUMAN_REQUIRED: "human-required",
  SKIPPED: "pending",
  FAILED: "blocked",
} as const;

async function fromDb(): Promise<PlanSummary | null> {
  try {
    const tasks = await prisma.task.findMany({
      orderBy: [{ phase: "asc" }, { id: "asc" }],
    });
    if (tasks.length === 0) return null;
    const rows: PhaseRow[] = tasks.map((t) => ({
      id: t.id,
      description: t.title,
      effort: t.effort ?? "",
      status: STATUS_TO_UI[t.status] as PhaseRow["status"],
      deps: t.deps ?? "",
      tags: t.tags ?? "",
      scoreAvg: t.scoreAvg,
      prNumber: t.prNumber,
      prUrl: t.prUrl,
      completedAt: t.completedAt?.toISOString() ?? null,
    }));
    return summarize(rows, "db");
  } catch {
    return null;
  }
}

const STATUS_MAP: Record<string, PhaseRow["status"]> = {
  done: "done",
  completed: "done",
  shipped: "done",
  in_progress: "in_progress",
  pending: "pending",
  blocked: "blocked",
  "human-required": "human-required",
  human_required: "human-required",
};

async function fromPlanMd(): Promise<PlanSummary> {
  const text = await fetchRaw("PLAN.md");
  if (!text) return summarize([], "plan-md");
  const rows: PhaseRow[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\|\s*([A-Z0-9][A-Z0-9.]*?)\s*\|/i);
    if (!m) continue;
    const id = m[1];
    if (id === "ID") continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 4) continue;
    const rawStatus = (cells[3] ?? "pending").toLowerCase();
    const tags = cells[5] ?? "";
    let status = STATUS_MAP[rawStatus] ?? "pending";
    if (tags.includes("human-required") && status !== "done") {
      status = "human-required";
    }
    rows.push({
      id: cells[0],
      description: cells[1],
      effort: cells[2] ?? "",
      status,
      deps: cells[4] ?? "",
      tags,
    });
  }
  return summarize(rows, "plan-md");
}

function summarize(rows: PhaseRow[], source: "db" | "plan-md"): PlanSummary {
  const total = rows.length;
  const done = rows.filter((r) => r.status === "done").length;
  const inProgress = rows.filter((r) => r.status === "in_progress").length;
  const pending = rows.filter((r) => r.status === "pending").length;
  const blocked = rows.filter((r) => r.status === "blocked").length;
  const humanRequired = rows.filter(
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
    rows,
    source,
  };
}

export async function getPlanSummary(): Promise<PlanSummary> {
  "use cache";
  cacheLife("seconds");
  cacheTag("dev-dashboard-plan");

  const db = await fromDb();
  if (db) return db;
  return fromPlanMd();
}
