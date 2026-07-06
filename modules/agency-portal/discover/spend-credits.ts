// modules/agency-portal/discover/spend-credits.ts · pure money-aggregation for
// the discovery "credits to date" (SPEND-1). Kept in its own React-free, DB-free
// module (no `server-only`) so the invariant is unit-testable without a DB, per
// .claude/rules/testing.md — resolveSpendCreditsForDiscovery (active-run.ts) does
// the bounded query, then delegates the arithmetic here.

/**
 * Sum `creditsCharged` for every run whose `scopeRefsJson.cellKeys` overlaps the
 * discovery's cellKeys. The caller pre-filters runs to OK/PARTIAL (only those
 * settle a charge). Tolerant of a missing/malformed scope and a null charge.
 */
export function sumCreditsForCellOverlap(
  runs: readonly {
    creditsCharged: number | null;
    scopeRefsJson: unknown;
  }[],
  cellKeys: string[],
): number {
  if (cellKeys.length === 0) return 0;
  const cellSet = new Set(cellKeys);
  let total = 0;
  for (const r of runs) {
    const scope = (r.scopeRefsJson ?? {}) as { cellKeys?: unknown };
    const runCells = Array.isArray(scope.cellKeys)
      ? (scope.cellKeys.filter((k) => typeof k === "string") as string[])
      : [];
    if (runCells.some((k) => cellSet.has(k))) total += r.creditsCharged ?? 0;
  }
  return total;
}
