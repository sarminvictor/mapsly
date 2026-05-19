// Parses PLAN.md tables into structured phase rows for the dashboard.
// PLAN.md format (per Mapsly convention):
//   | id | description | effort | status | deps | tags |
// status values we recognize: pending, in_progress, done, blocked, human-required

import { cacheLife, cacheTag } from "next/cache";
import { fetchRaw } from "./github-content";

export interface PhaseRow {
  id: string;
  description: string;
  effort: string;
  status: "pending" | "in_progress" | "done" | "blocked" | "human-required";
  deps: string;
  tags: string;
}

export interface PlanSummary {
  total: number;
  done: number;
  inProgress: number;
  pending: number;
  blocked: number;
  humanRequired: number;
  percent: number; // done / total
  rows: PhaseRow[];
}

const STATUS_MAP: Record<string, PhaseRow["status"]> = {
  done: "done",
  completed: "done",
  shipped: "done",
  in_progress: "in_progress",
  "in progress": "in_progress",
  inprogress: "in_progress",
  pending: "pending",
  blocked: "blocked",
  "human-required": "human-required",
  human_required: "human-required",
};

export async function getPlanSummary(): Promise<PlanSummary> {
  "use cache";
  cacheLife("seconds");
  cacheTag("dev-dashboard-plan");

  const text = await fetchRaw("PLAN.md");
  if (!text) return empty();

  const rows: PhaseRow[] = [];

  // Capture all markdown table rows that look like phase rows.
  // Phase IDs are like 1.2, 1.10.4, B.1 — alphanumeric + dots.
  // Skip header (| --- |) and column-header rows.
  for (const line of text.split("\n")) {
    const m = line.match(/^\|\s*([A-Z0-9][A-Z0-9.]*?)\s*\|/i);
    if (!m) continue;
    const id = m[1];
    if (id === "ID" || id.startsWith("-")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim());
    if (cells.length < 4) continue;
    const tagsCol = cells[5] ?? "";
    const rawStatus = cells[3]?.toLowerCase() ?? "pending";
    let status = STATUS_MAP[rawStatus] ?? "pending";
    if (tagsCol.includes("human-required") && status !== "done") {
      status = "human-required";
    }
    rows.push({
      id: cells[0],
      description: cells[1],
      effort: cells[2] ?? "",
      status,
      deps: cells[4] ?? "",
      tags: tagsCol,
    });
  }

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
  };
}

function empty(): PlanSummary {
  return {
    total: 0,
    done: 0,
    inProgress: 0,
    pending: 0,
    blocked: 0,
    humanRequired: 0,
    percent: 0,
    rows: [],
  };
}
