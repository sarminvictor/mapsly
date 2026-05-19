// Reads .claude/memory/sessions/*.json — one per autonomous build-loop session.
// Schema (informal, matches docs/dev-dashboard.md):
//   id, startedAt, endedAt, exit, tasksShipped, prsOpened, prsAutoMerged,
//   prsNeedsReview, incidentsNew, incidentsRecurring, scoreAvg, costUsd, tokensUsed

import { cacheLife, cacheTag } from "next/cache";
import { fetchRaw, listDir } from "./github-content";

export interface SessionRecord {
  id: string;
  startedAt: string;
  endedAt?: string;
  exit?: "token-budget-low" | "timeout" | "hard-halt" | "clean";
  tasksShipped?: Array<{
    phaseId: string;
    merged: boolean;
    scoreAggregate?: number;
  }>;
  prsOpened?: number[];
  prsAutoMerged?: number[];
  prsNeedsReview?: number[];
  incidentsNew?: string[];
  incidentsRecurring?: string[];
  scoreAvg?: number;
  costUsd?: number;
  tokensUsed?: { input: number; output: number; total: number };
}

export interface SessionsSummary {
  total: number;
  last7d: SessionRecord[];
  todayCount: number;
  thisWeekShipped: number;
  thisWeekAutoMerged: number;
  avgScore7d: number | null;
  totalCost7d: number;
  current: SessionRecord | null; // last non-finalized session
}

export async function getSessionsSummary(): Promise<SessionsSummary> {
  "use cache";
  cacheLife("seconds");
  cacheTag("dev-dashboard-sessions");

  const files = await listDir(".claude/memory/sessions");
  const jsonFiles = files.filter((f) => f.endsWith(".json"));

  const records: SessionRecord[] = [];
  for (const name of jsonFiles.slice(-30)) {
    // last 30 by name (date-based naming sorts)
    const text = await fetchRaw(`.claude/memory/sessions/${name}`);
    if (!text) continue;
    try {
      records.push(JSON.parse(text));
    } catch {
      /* corrupt session JSON — skip silently */
    }
  }

  // Filter to last 7 days (by startedAt or filename date).
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const last7d = records
    .filter((r) => {
      if (!r.startedAt) return true;
      return new Date(r.startedAt) >= sevenDaysAgo;
    })
    .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));

  const today = new Date().toISOString().slice(0, 10);
  const todayCount = last7d.filter((r) =>
    (r.startedAt ?? "").startsWith(today),
  ).length;

  const thisWeekShipped = last7d.reduce(
    (sum, r) => sum + (r.tasksShipped?.filter((t) => t.merged).length ?? 0),
    0,
  );
  const thisWeekAutoMerged = last7d.reduce(
    (sum, r) => sum + (r.prsAutoMerged?.length ?? 0),
    0,
  );
  const scores = last7d
    .flatMap((r) => r.tasksShipped ?? [])
    .map((t) => t.scoreAggregate)
    .filter((n): n is number => typeof n === "number");
  const avgScore7d =
    scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) /
        10
      : null;

  const totalCost7d = last7d.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  const current = last7d.find((r) => !r.endedAt) ?? null;

  return {
    total: records.length,
    last7d,
    todayCount,
    thisWeekShipped,
    thisWeekAutoMerged,
    avgScore7d,
    totalCost7d,
    current,
  };
}
