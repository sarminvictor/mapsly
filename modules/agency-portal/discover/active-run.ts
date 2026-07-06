// modules/agency-portal/discover/active-run.ts · resolve the enrichment run that
// is (or was most recently) enriching a discovery's leads. WP4-1 · the workbench
// pages read this so a slim "Enriching · N of M · updating live" banner can poll
// the WP3-3 progress endpoint and router.refresh() new rows in as they land.
//
// Wave-3 FK (2026-07-06) · runs now persist `discoveryId` at creation, so
// attribution is exact. Pre-FK rows (discoveryId null) fall back to the old
// `scopeRefsJson.cellKeys`-overlap heuristic. One bounded findMany, bucketed in
// JS. An ACTIVE (PENDING/RUNNING) run wins over any terminal one — that's the
// run the banner polls; a recently-terminal run is returned too (with its
// status) so the page can decide whether to poll a brief "just finished" beat.
//
// Per `.claude/rules/security.md` · agency-scoped (never another agency's run).
// Per `.claude/rules/scalability.md` · bounded `take`, indexed (agencyId,status).

import "server-only";

import prisma from "@/lib/prisma";
import { sumCreditsForCellOverlap } from "./spend-credits";

export interface ActiveRunInfo {
  runId: string;
  /** PENDING | RUNNING (active) | OK | PARTIAL | FAILED (terminal). */
  status: string;
  /** True while the run is still enriching (PENDING/RUNNING) — the banner polls
   *  + router.refresh()es only while this is true. */
  active: boolean;
}

const RECENT_TERMINAL_WINDOW_MS = 60_000;

/**
 * Resolve the run to surface for a discovery's workbench, or null when none
 * overlaps. ACTIVE runs win; else a run that closed within the last 60s is
 * returned so the banner can show a brief terminal beat + one final refresh.
 * Bounded scan of the agency's recent runs (matches resolveEnrichPhases).
 */
export async function resolveActiveRunForDiscovery(
  agencyId: string,
  discoveryId: string,
  cellKeys: string[],
): Promise<ActiveRunInfo | null> {
  const recentCutoff = new Date(Date.now() - RECENT_TERMINAL_WINDOW_MS);
  const runs = await prisma.enrichmentRun.findMany({
    where: {
      agencyId,
      OR: [
        { status: { in: ["PENDING", "RUNNING"] } },
        { finishedAt: { gte: recentCutoff } },
      ],
    },
    orderBy: { startedAt: "desc" },
    take: 50,
    select: { id: true, status: true, discoveryId: true, scopeRefsJson: true },
  });

  const cellSet = new Set(cellKeys);
  let activeHit: ActiveRunInfo | null = null;
  let terminalHit: ActiveRunInfo | null = null;

  for (const r of runs) {
    // FK first (exact); pre-FK rows fall back to the cellKeys overlap.
    if (r.discoveryId != null) {
      if (r.discoveryId !== discoveryId) continue;
    } else {
      const scope = (r.scopeRefsJson ?? {}) as { cellKeys?: unknown };
      const runCells = Array.isArray(scope.cellKeys)
        ? (scope.cellKeys.filter((k) => typeof k === "string") as string[])
        : [];
      if (!runCells.some((k) => cellSet.has(k))) continue;
    }

    const active = r.status === "PENDING" || r.status === "RUNNING";
    if (active) {
      // First active hit wins (runs are startedAt desc → the newest active run).
      if (!activeHit)
        activeHit = { runId: r.id, status: r.status, active: true };
    } else if (!terminalHit) {
      terminalHit = { runId: r.id, status: r.status, active: false };
    }
  }

  // Prefer the active run (the banner polls it); else the recently-finished one.
  return activeHit ?? terminalHit;
}

/**
 * Sum the credits actually settled against a discovery — the real "spend to
 * date". Wave-3 FK: runs with `discoveryId` are attributed exactly; pre-FK rows
 * (null) fall back to the cellKeys-overlap heuristic (a run overlapping two
 * discoveries was counted by both — the FK ends that for new runs). Only
 * OK/PARTIAL runs count (`creditsCharged` settles on those outcomes) and it is
 * already WHOLE credits — the unit the header renders.
 */
export async function resolveSpendCreditsForDiscovery(
  agencyId: string,
  discoveryId: string,
  cellKeys: string[],
): Promise<number> {
  const runs = await prisma.enrichmentRun.findMany({
    where: { agencyId, status: { in: ["OK", "PARTIAL"] } },
    orderBy: { startedAt: "desc" },
    take: 500,
    select: { creditsCharged: true, discoveryId: true, scopeRefsJson: true },
  });

  let total = 0;
  const legacy: { creditsCharged: number; scopeRefsJson: unknown }[] = [];
  for (const r of runs) {
    if (r.discoveryId != null) {
      if (r.discoveryId === discoveryId) total += r.creditsCharged;
    } else {
      legacy.push(r);
    }
  }
  return total + sumCreditsForCellOverlap(legacy, cellKeys);
}
