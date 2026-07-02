// Weekly cron · market-moved-digest (WP6-2)
//
// For each agency with an ACTIVE research, diffs the past week's refreshed data
// (new matching businesses / new 1–2★ reviews / competitor Meta ads appearing)
// against each research's cells and sends ONE Resend digest email deep-linked to
// the workbench — Tuesday's reason to return + the re-enrich nudge. SUPPRESSED
// per agency when nothing moved. See modules/agency-portal/notify/market-digest.ts.
//
// Runs Tuesday 13:00 UTC (~morning US) — AFTER the weekly reviews/lighthouse/ads
// crons have refreshed the data it diffs. No external PAID API (Resend REST
// only); the wrapping CronRun tracks the tick. Bounded per agency + per tick.
//
// Auth: Bearer CRON_SECRET (server-to-server, enforced by cronHandler).

import { cronHandler } from "@/lib/middleware/no-live-api";
import { sweepMarketDigests } from "@/modules/agency-portal/notify/market-digest";

const JOB = "weekly:market-moved-digest";

export const GET = cronHandler(JOB, async () => {
  const summary = await sweepMarketDigests();
  return {
    itemsProcessed: summary.sent,
    meta: { ...summary },
  };
});

export const POST = GET;
