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

import { cronHandler } from "@/lib/middleware/no-live-api";
import { sweepRunFinishedEmails } from "@/modules/agency-portal/notify/run-finished";

const JOB = "internal:run-finished-emails";

export const GET = cronHandler(JOB, async () => {
  const summary = await sweepRunFinishedEmails();
  return {
    itemsProcessed: summary.sent,
    meta: { ...summary },
  };
});

export const POST = GET;
