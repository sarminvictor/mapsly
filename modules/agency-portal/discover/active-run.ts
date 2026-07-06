// modules/agency-portal/discover/active-run.ts · resolve the enrichment run that
// is (or was most recently) enriching a discovery's leads. WP4-1 · the workbench
// pages read this so a slim "Enriching · N of M · updating live" banner can poll
// the WP3-3 progress endpoint and router.refresh() new rows in as they land.
//
// There is no discoveryId FK on EnrichmentRun (the same reality resolveEnrich-
// Phases in research/queries.ts works around), so a run is matched to a
// discovery by `EnrichmentRun.scopeRefsJson.cellKeys` overlapping the
// discovery's cellKeys. One bounded findMany, bucketed in JS. An ACTIVE
// (PENDING/RUNNING) run wins over any terminal one — that's the run the banner
// polls; a recently-terminal run is returned too (with its status) so the page
// can decide whether to poll a brief "just finished" beat.
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
  cellKeys: string[],
): Promise<ActiveRunInfo | null> {
  if (cellKeys.length === 0) return null;

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
    select: { id: true, status: true, scopeRefsJson: true },
  });

  const cellSet = new Set(cellKeys);
  let activeHit: ActiveRunInfo | null = null;
  let terminalHit: ActiveRunInfo | null = null;

  for (const r of runs) {
    const scope = (r.scopeRefsJson ?? {}) as { cellKeys?: unknown };
    const runCells = Array.isArray(scope.cellKeys)
      ? (scope.cellKeys.filter((k) => typeof k === "string") as string[])
      : [];
    if (!runCells.some((k) => cellSet.has(k))) continue;

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
 * Sum the credits actually settled against a discovery's cells — the real
 * "spend to date". EnrichmentRun has no discoveryId FK, so (as above) a run is
 * matched by its `scopeRefsJson.cellKeys` overlapping the discovery's cellKeys.
 * Only OK/PARTIAL runs are counted (a run settles `creditsCharged` on those
 * outcomes; PENDING/RUNNING/FAILED contribute 0). `creditsCharged` is already in
 * WHOLE credits — the same unit the header renders — so no usdToCredits wrapper.
 *
 * Replaces the read of `Discovery.spendToDateUsd`, a column nothing ever wrote
 * (stuck at its @default(0)) — which is why every surface showed "0 credits".
 *
 * Caveat (v1, accepted): a run whose cellKeys overlap two discoveries is counted
 * toward both — the same overlap limitation the enriched-count already carries.
 * Runs settled before `creditsCharged` shipped read 0 (minor under-report on old
 * research). Bounded scan, agency-scoped, indexed on (agencyId,status).
 */
export async function resolveSpendCreditsForDiscovery(
  agencyId: string,
  cellKeys: string[],
): Promise<number> {
  if (cellKeys.length === 0) return 0;

  const runs = await prisma.enrichmentRun.findMany({
    where: { agencyId, status: { in: ["OK", "PARTIAL"] } },
    orderBy: { startedAt: "desc" },
    take: 500,
    select: { creditsCharged: true, scopeRefsJson: true },
  });

  return sumCreditsForCellOverlap(runs, cellKeys);
}
