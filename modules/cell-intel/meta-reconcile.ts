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
// INC-58 · hard per-cell bound: initial attempt + at most this many total rows
// inside the lookback. Past it the cell is parked (pending marker zeroed) —
// even a PARTIAL-looping cell can't burn proxy $ for the whole 48h window.
const MAX_CELL_ATTEMPTS_IN_WINDOW = 4;
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
// INC-58 · $0 on a terminal run is only believable once the run has been
// terminal for a while — the 04:36 hvac row got its REAL $0.77 zeroed because
// the backfill read a wrong field 3.5 min after terminal and trusted "$0 +
// terminal". With the field fixed this is a belt, not the fix.
const ZERO_USAGE_GRACE_MS = 15 * 60_000;

/**
 * Fetch a run's finalized usage. Returns the number once we can TRUST it:
 * a positive usage, OR $0 on a run Apify marked TERMINAL at least
 * ZERO_USAGE_GRACE_MS ago (a genuinely-free run — accepting it clears the
 * estimate flag instead of looping forever and starving the take-20 window).
 * null means "not settled yet" → retry next tick.
 *
 * INC-58 · usage lives at `data.usageTotalUsd` (TOP-LEVEL) — reading
 * `data.stats.usageTotalUsd` (which never existed) made every backfill see
 * undefined and the terminal-$0 branch zeroed REAL spend.
 */
async function fetchFinalizedUsage(
  runId: string,
  now: Date,
): Promise<number | null> {
  const token = process.env.APIFY_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`${APIFY_BASE_URL}/actor-runs/${runId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as {
      data?: {
        status?: string;
        finishedAt?: string;
        usageTotalUsd?: number;
        stats?: { usageTotalUsd?: number };
      };
    };
    const usage = j.data?.usageTotalUsd ?? j.data?.stats?.usageTotalUsd;
    if (typeof usage === "number" && usage > 0) return usage;
    // $0: trust it only on a run that has been TERMINAL for the grace window —
    // a just-terminal (or still-running) run reporting 0 isn't settled: wait.
    if (j.data?.status && APIFY_TERMINAL.has(j.data.status)) {
      const finishedAt = j.data.finishedAt
        ? Date.parse(j.data.finishedAt)
        : NaN;
      if (
        Number.isFinite(finishedAt) &&
        now.getTime() - finishedAt >= ZERO_USAGE_GRACE_MS
      ) {
        return 0;
      }
    }
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
    const usages = await Promise.all(
      runIds.map((id) => fetchFinalizedUsage(id, now)),
    );
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
  // INC-58 · continuation is for BUDGET-STOPPED collections that made REAL
  // progress — the newest row must be PARTIAL (some chunk verified/salvaged)
  // with pendingTargets > 0. A hard-FAILED 0-progress row (a blocked cell, e.g.
  // Meta fingerprint-blocking the session) must NEVER be auto-continued: the
  // first shipped version retried the blocked hvac cell every 10 minutes at
  // ~$0.9/attempt (caught + neutralized by hand within ~25 min). FAILED cells
  // stay on the purchase-path retry (user-driven, freshness-gate-free). A
  // per-cell attempt CAP inside the lookback bounds even the PARTIAL path so a
  // pathological cell can't loop for the whole 48h window.
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
    // Gate 1 · the cell's NEWEST row must be a REAL-PROGRESS partial that still
    // reports pending targets (a prior tick may have finished it; a FAILED
    // newest row means the last attempt yielded nothing → stop).
    const latest = await prisma.adMarketRun.findFirst({
      where: { cellKey, platform: "META" },
      orderBy: { ranAt: "desc" },
      select: { status: true, detailJson: true },
    });
    const pend = Number(detailOf(latest?.detailJson ?? null).pendingTargets);
    if (latest?.status !== "PARTIAL") continue;
    if (!Number.isFinite(pend) || pend <= 0) continue;
    // Gate 2 · per-cell attempt cap inside the lookback: initial attempt + at
    // most MAX_CELL_ATTEMPTS_IN_WINDOW total rows. Past it, park the cell (zero
    // the pending marker so the scan stops re-visiting it).
    const attemptsInWindow = await prisma.adMarketRun.count({
      where: { cellKey, platform: "META", ranAt: { gte: since } },
    });
    if (attemptsInWindow >= MAX_CELL_ATTEMPTS_IN_WINDOW) {
      // Park the cell: zero the newest row's pending marker so the scan stops
      // re-visiting it (best-effort, one row).
      const newest = await prisma.adMarketRun.findFirst({
        where: { cellKey, platform: "META" },
        orderBy: { ranAt: "desc" },
        select: { id: true, detailJson: true },
      });
      if (newest) {
        await prisma.adMarketRun.update({
          where: { id: newest.id },
          data: {
            detailJson: {
              ...detailOf(newest.detailJson),
              pendingTargets: 0,
              reconcileNote: "attempt-cap-reached",
            } as Prisma.InputJsonValue,
          },
        });
      }
      continue;
    }
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
