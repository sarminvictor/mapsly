// Internal cron · run-finished-emails (WP6-3)
//
// Sweeps EnrichmentRuns that reached a terminal state (OK/PARTIAL/FAILED) since
// the last tick and haven't been emailed yet, and sends ONE Resend email per
// run with the outcome summary + a workbench deep-link — pulling closed-tab
// users back to the leads they paid for. Idempotent via an EnrichmentRun.meta
// marker (no schema migration). See modules/agency-portal/notify/run-finished.ts.
//
// Auth: Bearer CRON_SECRET (server-to-server, not rate-limited per
// .claude/rules/scalability.md — enforced by cronHandler). No external PAID API
// (Resend REST only); the wrapping CronRun tracks the tick. Bounded per tick.
//
// Runs every 2 min alongside the dispatch tick so a finished run is emailed
// within ~a couple minutes of close. POST-triggerable from admin without a
// schedule change.
//
// Neon idle gate (GET only): a scheduled tick with no freshly-closed run to
// email skips WITHOUT touching Prisma (the wake flag is armed by closeRunIfDone
// + the FT-2 direct terminal-run creator), so the endpoint can suspend between
// runs. The gate wraps OUTSIDE cronHandler — otherwise the CronRun row would be
// opened before the skip. Fails OPEN. POST (admin kick) always runs.

import { verifyCronAuth } from "@/lib/auth/cron-secret";
import { cronHandler } from "@/lib/middleware/no-live-api";
import {
  shouldRunCronTick,
  recordCronTick,
  GATED_CRON,
} from "@/lib/cron/idle-gate";
import { sweepRunFinishedEmails } from "@/modules/agency-portal/notify/run-finished";

const JOB = GATED_CRON.runFinishedEmails;

const inner = cronHandler(JOB, async () => {
  const summary = await sweepRunFinishedEmails();
  // Idle = nothing emailed this tick → clear the wake flag so the next tick can
  // skip. A run closing re-arms it (markCronWork in closeRunIfDone); the safety
  // scan re-tries any send that errored.
  await recordCronTick(JOB, { idle: summary.sent === 0 });
  return {
    itemsProcessed: summary.sent,
    meta: { ...summary },
  };
});

export async function GET(req: Request): Promise<Response> {
  // Re-verify auth here (cheap, no Prisma) so a skipped tick still 401s an
  // unauthorized caller; the inner cronHandler re-verifies on the run path.
  if (verifyCronAuth(req).ok && !(await shouldRunCronTick(JOB))) {
    return Response.json({ ok: true, skipped: "idle" });
  }
  return inner(req);
}

export async function POST(req: Request): Promise<Response> {
  return inner(req);
}
