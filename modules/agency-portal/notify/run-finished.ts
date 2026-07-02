// modules/agency-portal/notify/run-finished.ts · WP6-3 · the run-finished email
// sweep. A light poll (not a per-close hook) finds EnrichmentRuns that reached a
// terminal state since the last tick and haven't been emailed yet, then sends
// ONE Resend email per run with the outcome summary + a workbench deep-link.
//
// Why a poll and not `after()` inside closeRunIfDone: dispatch runs in a cron
// frame (no request scope), so `next/after` isn't reliably available there; and
// the sweep is naturally idempotent + bounded, matching the reviews-reconcile
// pattern. The "already emailed" marker lives in EnrichmentRun.meta.* JSON —
// NO schema migration (per the WP6-3 spec).
//
// Best-effort by contract: a send/DB hiccup logs + is skipped, never throws.
// No external paid API — Resend REST only (cost-tracked via the wrapping
// cronHandler's CronRun).

import prisma, { Prisma } from "@/lib/prisma";
import { absoluteUrl } from "@/lib/seo/canonical";
import { sendRunFinished } from "./email";

/** meta key that marks a run's finished-email as sent (idempotency, no migration). */
export const RUN_FINISHED_EMAIL_META_KEY = "runFinishedEmailAt";

/** Only look this far back so the sweep stays bounded (matches the poll cadence
 *  with generous slack for a missed tick). Filters on startedAt — there is no
 *  finishedAt index (WP6-3 note) — then checks finishedAt in JS. */
const LOOKBACK_MINUTES = 180;
/** Cap emails per tick so a backlog can't blow the cron budget. */
const MAX_PER_TICK = 50;

export interface RunFinishedSweepResult {
  scanned: number;
  sent: number;
  skippedNoRecipient: number;
  skippedNoDiscovery: number;
}

/**
 * Sweep recently-finished runs and email each once. Idempotent: a run whose
 * meta already carries RUN_FINISHED_EMAIL_META_KEY is skipped, and the marker is
 * stamped BEFORE nothing else can double-send within the same window.
 */
export async function sweepRunFinishedEmails(
  now: Date = new Date(),
): Promise<RunFinishedSweepResult> {
  const result: RunFinishedSweepResult = {
    scanned: 0,
    sent: 0,
    skippedNoRecipient: 0,
    skippedNoDiscovery: 0,
  };

  const since = new Date(now.getTime() - LOOKBACK_MINUTES * 60_000);
  const runs = await prisma.enrichmentRun.findMany({
    where: {
      status: { in: ["OK", "PARTIAL", "FAILED"] },
      finishedAt: { not: null },
      // Bound the scan on the indexed startedAt (WP6-3: no finishedAt index).
      startedAt: { gte: since },
    },
    orderBy: { startedAt: "desc" },
    take: 200,
    select: {
      id: true,
      agencyId: true,
      status: true,
      creditsHeld: true,
      creditsCharged: true,
      unitsCompleted: true,
      unitsRequested: true,
      actualUsd: true,
      scopeRefsJson: true,
      meta: true,
    },
  });

  for (const run of runs) {
    if (result.sent >= MAX_PER_TICK) break;
    result.scanned += 1;

    // Idempotency: already emailed?
    const meta = (run.meta ?? {}) as Record<string, unknown>;
    if (typeof meta[RUN_FINISHED_EMAIL_META_KEY] === "string") continue;

    // Recipient = the agency owner (fall back to any admin, then any member).
    const recipient = await resolveAgencyRecipient(run.agencyId);
    if (!recipient) {
      result.skippedNoRecipient += 1;
      // Stamp anyway so a permanently-recipientless agency isn't re-scanned
      // every tick (the run is closed; there is nobody to email).
      await stampEmailed(run.id, meta, now, "no-recipient");
      continue;
    }

    // Deep-link = the discovery whose cells overlap the run's scope.
    const scope = (run.scopeRefsJson ?? {}) as { cellKeys?: unknown };
    const runCells = Array.isArray(scope.cellKeys)
      ? (scope.cellKeys.filter((k) => typeof k === "string") as string[])
      : [];
    const discoveryId = await resolveDiscoveryForCells(run.agencyId, runCells);
    const workbenchUrl = discoveryId
      ? absoluteUrl(`/discover/${discoveryId}`)
      : absoluteUrl("/research");
    if (!discoveryId) result.skippedNoDiscovery += 1;

    const enriched = run.unitsCompleted ?? 0;
    const requested = run.unitsRequested ?? 0;
    const failed = Math.max(0, requested - enriched);
    const refunded = Math.max(
      0,
      (run.creditsHeld ?? 0) - (run.creditsCharged ?? 0),
    );

    const ok = await sendRunFinished({
      to: recipient.email,
      agencyName: recipient.agencyName,
      workbenchUrl,
      outcome: run.status as "OK" | "PARTIAL" | "FAILED",
      enriched,
      failed: run.status === "FAILED" ? 0 : failed,
      refunded,
    });

    // Stamp the marker regardless of send outcome: a false (no key / transient)
    // must not re-blast the same run every tick. If the key is missing (dev),
    // the run simply never emails — acceptable, and the marker records why.
    await stampEmailed(run.id, meta, now, ok ? "sent" : "send-failed");
    if (ok) result.sent += 1;
  }

  return result;
}

/** Resolve the best notify recipient for an agency (owner → admin → member).
 *  Shared with the WP6-2 weekly digest sweep. */
export async function resolveAgencyRecipient(
  agencyId: string,
): Promise<{ email: string; agencyName: string } | null> {
  const agency = await prisma.agency.findUnique({
    where: { id: agencyId },
    select: {
      name: true,
      members: {
        select: { role: true, user: { select: { email: true } } },
      },
    },
  });
  if (!agency) return null;
  const rank = (r: string) => (r === "OWNER" ? 0 : r === "ADMIN" ? 1 : 2);
  const best = [...agency.members]
    .filter((m) => !!m.user?.email)
    .sort((a, b) => rank(a.role) - rank(b.role))[0];
  if (!best?.user?.email) return null;
  return { email: best.user.email, agencyName: agency.name };
}

/** First discovery (of this agency) whose cellKeys overlap the run's cells. */
async function resolveDiscoveryForCells(
  agencyId: string,
  cellKeys: string[],
): Promise<string | null> {
  if (cellKeys.length === 0) return null;
  const d = await prisma.discovery.findFirst({
    where: { agencyId, cellKeys: { hasSome: cellKeys } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return d?.id ?? null;
}

/** Stamp the finished-email marker into meta (merge, never clobber). */
async function stampEmailed(
  runId: string,
  priorMeta: Record<string, unknown>,
  now: Date,
  status: string,
): Promise<void> {
  try {
    await prisma.enrichmentRun.update({
      where: { id: runId },
      data: {
        meta: {
          ...priorMeta,
          [RUN_FINISHED_EMAIL_META_KEY]: now.toISOString(),
          runFinishedEmailStatus: status,
        } as Prisma.InputJsonObject,
      },
      select: { id: true },
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "run-finished.stamp.failed",
        runId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
