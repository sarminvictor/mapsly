// modules/cell-intel/meta-reconcile.ts · P5 (2026-07-10) — the Meta books-and-
// coverage reconciler, run by /api/cron/internal/meta-reconcile.
//
// Two duties, both keyed off AdMarketRun.detailJson written by the chunked
// collector (modules/cell-intel/meta-ads.ts):
//
//   A · COST BACKFILL. A timed-out actor run finalizes its Apify usage AFTER
//       our function window, so the collector booked an elapsed×memory ESTIMATE
//       (detailJson.costEstimated=true · INC-56). This sweep fetches each stored
//       apifyRunId's FINALIZED usage from the Apify API and corrects
//       AdMarketRun.costUsd — the books converge on truth within a tick or two.
//
//   B · CHUNK CONTINUATION. A collection that hit the wall budget recorded
//       PARTIAL with detailJson.pendingTargets > 0. PARTIAL anchors the 30-day
//       freshness gate, so nothing would ever finish those targets — this sweep
//       re-runs the collector with { ignoreFreshness: true }. Already-resolved
//       businesses are excluded by construction (buildPageTargets skips
//       fbPageId-havers) and verified chunk queries hit the 6h cache at $0, so
//       a continuation only pays for genuinely-new targets.
//
// Poll-continuation, NOT an Apify webhook — consistent with
// .claude/rules/realtime-runs-adr.md (poll + reconcile over held-open push on
// this stack). Bounded per run (scalability.md): ≤20 backfills + ≤2
// continuations per tick; the 10-min cron cadence drains the rest.

import prisma, { Prisma } from "@/lib/prisma";
import { runMetaAdsForCell } from "./meta-ads";

const APIFY_BASE_URL =
  process.env.APIFY_BASE_URL?.replace(/\/+$/, "") ?? "https://api.apify.com/v2";

/** Only reconcile recent rows — older ones are historical telemetry. */
const LOOKBACK_MS = 48 * 60 * 60 * 1000;
const MAX_BACKFILL_ROWS = 20;
const MAX_CONTINUATIONS = 2;
const FETCH_TIMEOUT_MS = 15_000;

export interface MetaReconcileSummary {
  estimatedSeen: number;
  backfilled: number;
  cellsPending: number;
  continued: number;
  continuations: { cellKey: string; outcome: string }[];
}

/** Fetch one Apify run's FINALIZED usage. Null = not finalized yet / unreadable
 *  (the sweep just retries next tick — never guesses). */
const APIFY_TERMINAL = new Set(["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"]);

/**
 * Fetch a run's finalized usage. Returns the number once we can TRUST it:
 * a positive usage, OR $0 on a run Apify has marked TERMINAL (a genuinely-free
 * or fully-reconciled run — accepting it clears the estimate flag instead of
 * looping forever and starving the take-20 window · verifier hole). null means
 * "not settled yet" (unreadable, or still-running with 0 usage) → retry next tick.
 */
async function fetchFinalizedUsage(runId: string): Promise<number | null> {
  const token = process.env.APIFY_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`${APIFY_BASE_URL}/actor-runs/${runId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      data?: { status?: string; stats?: { usageTotalUsd?: number } };
    };
    const usage = j.data?.stats?.usageTotalUsd;
    if (typeof usage === "number" && usage > 0) return usage;
    // $0: trust it only once the run is terminal (Apify finalized it at $0);
    // a still-running/queued run reporting 0 isn't settled — wait.
    if (j.data?.status && APIFY_TERMINAL.has(j.data.status)) return 0;
    return null;
  } catch {
    return null;
  }
}

/** Coerce a row's detailJson to a plain object (or empty). */
function detailOf(v: Prisma.JsonValue | null): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/**
 * One reconcile tick. MUST run inside an open CronRun (route wraps it) — the
 * continuation path spends real vendor $ that has to be attributed.
 */
export async function reconcileMetaRuns(
  now: Date = new Date(),
): Promise<MetaReconcileSummary> {
  const since = new Date(now.getTime() - LOOKBACK_MS);

  // ── A · cost backfill ──────────────────────────────────────────────────────
  const estimated = await prisma.adMarketRun.findMany({
    where: {
      platform: "META",
      ranAt: { gte: since },
      detailJson: { path: ["costEstimated"], equals: true },
    },
    select: { id: true, detailJson: true },
    orderBy: { ranAt: "asc" },
    take: MAX_BACKFILL_ROWS,
  });
  let backfilled = 0;
  for (const row of estimated) {
    const detail = detailOf(row.detailJson);
    const runIds = Array.isArray(detail.apifyRunIds)
      ? detail.apifyRunIds.filter((s): s is string => typeof s === "string")
      : [];
    if (runIds.length === 0) {
      // Nothing to reconcile against — clear the flag so the sweep stops
      // re-visiting a row that can never converge.
      await prisma.adMarketRun.update({
        where: { id: row.id },
        data: {
          detailJson: {
            ...detail,
            costEstimated: false,
            reconcileNote: "no-run-ids",
          } as Prisma.InputJsonValue,
        },
      });
      continue;
    }
    const usages = await Promise.all(runIds.map(fetchFinalizedUsage));
    if (usages.some((u) => u == null)) continue; // not finalized — next tick
    const total = usages.reduce<number>((s, u) => s + (u ?? 0), 0);
    await prisma.adMarketRun.update({
      where: { id: row.id },
      data: {
        costUsd: total,
        detailJson: {
          ...detail,
          costEstimated: false,
          reconciledAt: now.toISOString(),
        } as Prisma.InputJsonValue,
      },
    });
    backfilled += 1;
  }

  // ── B · chunk continuation ─────────────────────────────────────────────────
  const pendingRows = await prisma.adMarketRun.findMany({
    where: {
      platform: "META",
      ranAt: { gte: since },
      detailJson: { path: ["pendingTargets"], gt: 0 },
    },
    select: { cellKey: true },
    orderBy: { ranAt: "desc" },
    take: 50,
  });
  const cells: string[] = [];
  const seen = new Set<string>();
  for (const r of pendingRows) {
    if (!seen.has(r.cellKey)) {
      seen.add(r.cellKey);
      cells.push(r.cellKey);
    }
  }

  let continued = 0;
  const continuations: { cellKey: string; outcome: string }[] = [];
  for (const cellKey of cells) {
    if (continued >= MAX_CONTINUATIONS) break;
    // Only continue when the cell's NEWEST row still reports pending targets —
    // a prior continuation tick may already have finished it.
    const latest = await prisma.adMarketRun.findFirst({
      where: { cellKey, platform: "META" },
      orderBy: { ranAt: "desc" },
      select: { detailJson: true },
    });
    const pend = Number(detailOf(latest?.detailJson ?? null).pendingTargets);
    if (!Number.isFinite(pend) || pend <= 0) continue;
    const res = await runMetaAdsForCell(cellKey, now, {
      ignoreFreshness: true,
    });
    continued += 1;
    continuations.push({ cellKey, outcome: res.outcome });
  }

  return {
    estimatedSeen: estimated.length,
    backfilled,
    cellsPending: cells.length,
    continued,
    continuations,
  };
}
