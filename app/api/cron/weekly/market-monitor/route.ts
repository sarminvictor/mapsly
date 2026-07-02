// Weekly cron · market-monitor (WP6-12 · "why now" timing triggers)
//
// Plan-gated ($99+ · GROWTH/AGENCY_PRO/BOUTIQUE) weekly sweep that surfaces
// local-intent timing signals per active research — "a competitor started
// advertising this week" / "X dropped out of the local 3-pack" — persisted as
// `market_signal` ProductEvents the workbench feed reads, and folded into the
// WP6-2 digest for gated plans. See modules/agency-portal/notify/market-monitor.ts.
//
// Runs Monday 06:00 UTC (before the Tuesday digest so its signals are fresh).
// COST: reads ONLY already-refreshed data (AdLibraryEntry / SerpResult) — makes
// NO new external DfS/Apify calls, so there is nothing to cost-cap here (a future
// LIVE re-scan variant would gate + cap; the $99+ gate is already in place).
// Bounded per agency + per tick. Auth: Bearer CRON_SECRET (via cronHandler).

import { cronHandler } from "@/lib/middleware/no-live-api";
import { sweepMarketMonitor } from "@/modules/agency-portal/notify/market-monitor";

const JOB = "weekly:market-monitor";

export const GET = cronHandler(JOB, async () => {
  const summary = await sweepMarketMonitor();
  return {
    itemsProcessed: summary.signalsFound,
    meta: { ...summary },
  };
});

export const POST = GET;
