// GET /api/agency/runs/[id]/progress · WP3-3 lead-by-lead progress endpoint.
//
// Per `.claude/rules/realtime-runs-adr.md` (poll + Redis, NOT SSE): the
// EnrichingStep polls this ~every 3s and the live workbench (WP4-1
// LiveWorkbenchBanner) ~every 4s. It reads the Redis
// run-progress counters ONLY (no Prisma on the hot path) and answers with an
// ETag; an unchanged poll is a 304 (empty body, ~zero cost). The DB remains the
// source of truth — the dispatch tick's updateRunProgress SEEDS/CORRECTS the
// counters each tick, so a Redis miss/blip self-heals; on a miss here we fall
// back to a single Prisma count so the bar still moves.
//
// Per `.claude/rules/security.md`:
//   - Auth-gated · agency resolved from the session, never a query param.
//   - No cross-agency leak · the run must belong to the caller's agency (checked
//     via a cheap indexed findFirst on the fallback; the Redis path is keyed by
//     runId which is a cuid, but we STILL gate on ownership before returning).
//
// Per `.claude/rules/performance.md` · `private, no-store` + ETag/304.

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { readRunProgress } from "@/modules/enrichment/run-progress-counter";

export interface RunProgress {
  done: number;
  total: number;
  failed: number;
  /** 2026-07-10 · businesses waiting out a retry backoff (QUEUED, future
   *  nextAttemptAt). Lets the banner render "44 of 45 · 1 retrying" during the
   *  backoff tail instead of a frozen-looking "44 of 45". Subset of the
   *  outstanding (total − done − failed) set; 0 once terminal. */
  retrying: number;
  status: string;
  /** WP4-6 · close receipt (credits). Present once the run is terminal; the
   *  EnrichingStep done-state + workbench header show held/charged/refunded.
   *  Refunded = held − charged (the quote-vs-actual + fresh-cache diff). */
  creditsHeld?: number;
  creditsCharged?: number;
  /** WB-COL-2 · the run's purchased enrichment-type tokens (sanitized
   *  `enrichmentsJson`). Present ONLY in the terminal payload — LiveRunGate
   *  forwards them on the enrich-finished bus so the workbench can auto-show
   *  the bought data's columns, surviving a reload-mid-run (runs last
   *  minutes-to-hours per realtime-runs-adr). */
  enrichments?: string[];
}

function etagOf(p: RunProgress): string {
  // Include the receipt so the 304 short-circuit still fires a fresh 200 the
  // tick the run closes (charged flips from 0 → the settled amount). retrying
  // is in the key so the banner updates as jobs enter/leave the backoff tail.
  return `"${p.done}-${p.total}-${p.failed}-${p.retrying}-${p.status}-${p.creditsCharged ?? ""}"`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse | Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id: runId } = await params;

  const member = await prisma.agencyMember.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: { agencyId: true },
  });
  if (!member) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Ownership gate · the run must belong to the caller's agency. One cheap
  // indexed read (agencyId, status); returns the DB status for the fallback +
  // to enrich the Redis payload (Redis stores it too, but the DB is truth).
  const run = await prisma.enrichmentRun.findFirst({
    where: { id: runId, agencyId: member.agencyId },
    select: {
      status: true,
      unitsRequested: true,
      unitsCompleted: true,
      creditsHeld: true,
      creditsCharged: true,
      // WB-COL-2 · the purchased types — same row, ~zero marginal cost; only
      // serialized into the terminal payload below.
      enrichmentsJson: true,
    },
  });
  if (!run) {
    // Cross-agency / missing → 404 (never leak another agency's run).
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Redis-first read (no further DB). On a miss (Redis unavailable OR not seeded
  // yet) fall back to the run's own DB counters so the bar still moves.
  const redis = await readRunProgress(runId);
  const raw: RunProgress = redis
    ? {
        done: redis.done,
        total: redis.total > 0 ? redis.total : run.unitsRequested,
        failed: redis.failed,
        retrying: redis.retrying,
        status: redis.status ?? run.status,
      }
    : {
        done: run.unitsCompleted,
        total: run.unitsRequested,
        failed: 0,
        // The DB row carries no retry-tail count; the next tick's Redis seed
        // supplies it. 0 is the safe fallback (banner just omits the hint).
        retrying: 0,
        status: run.status,
      };

  // WP4-3 · clamp to the BUSINESS unit. Since 2026-07-10 bumpRunProgress is
  // itself business-unit (it only counts a business once its LAST family job
  // terminates), so the raw counters no longer march in family-sized jumps — the
  // "46→89→31" sawtooth is fixed at the source. This clamp stays as a cheap
  // belt-and-suspenders for the rare concurrent double-count (two of a business's
  // families terminating in the same instant), so the client never sees
  // done>total (>100%) or a done+failed sum past N. The next tick's
  // updateRunProgress re-seeds the exact business counts either way.
  const total = Math.max(0, raw.total);
  const failed = Math.min(Math.max(0, raw.failed), total);
  const done = Math.min(Math.max(0, raw.done), Math.max(0, total - failed));
  // retrying is a subset of the still-outstanding businesses (total−done−failed),
  // clamped so a stale/over-count can never exceed what's actually in flight.
  // `|| 0` also coerces a legacy/absent counter (undefined/NaN) to 0 so the
  // payload never serializes a null.
  const retrying = Math.min(
    Math.max(0, raw.retrying || 0),
    Math.max(0, total - done - failed),
  );
  // WP4-6 · attach the close receipt once the run is terminal (charged is only
  // meaningful after settle). A still-running run omits it (undefined) so the
  // EnrichingStep shows the receipt only in the done-state.
  const terminal =
    raw.status === "OK" || raw.status === "PARTIAL" || raw.status === "FAILED";
  // WB-COL-2 · sanitize the purchased tokens (Zod-lite: array of strings,
  // anything else → []) — enrichmentsJson is our own write, but the payload
  // shape must never depend on trusting it.
  const enrichments = Array.isArray(run.enrichmentsJson)
    ? run.enrichmentsJson.filter((t): t is string => typeof t === "string")
    : [];
  const progress: RunProgress = {
    done,
    failed,
    total,
    retrying,
    status: raw.status,
    ...(terminal
      ? {
          creditsHeld: run.creditsHeld,
          creditsCharged: run.creditsCharged,
          enrichments,
        }
      : {}),
  };

  const etag = etagOf(progress);
  const inm = request.headers.get("if-none-match");
  const headers = {
    "Cache-Control": "private, no-store",
    ETag: etag,
  };
  if (inm && inm === etag) {
    return new Response(null, { status: 304, headers });
  }
  return NextResponse.json(progress, { headers });
}
