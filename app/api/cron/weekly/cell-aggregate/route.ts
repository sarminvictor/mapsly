// Weekly · cell-aggregate
//
// Builds the CellMetric MARKET REFERENCE — per (category × city × country)
// signal distributions computed from existing BusinessSnapshot rows. ZERO
// external-API cost (pure Postgres aggregation). Runs AFTER snapshot-write
// (needs fresh `signalsJson`) and BEFORE pillar-score (which grades each
// business against these references). The shared logic lives in
// modules/market/cell-metrics.ts so this cron and the /admin/cells "Recompute
// references" trigger can never diverge.

import { cronHandler } from "@/lib/middleware/no-live-api";
import { runCellAggregation } from "@/modules/market/cell-metrics";

const JOB = "weekly:cell-aggregate";

export const GET = cronHandler(JOB, async ({ runId }) => {
  const summary = await runCellAggregation();
  return {
    itemsProcessed: summary.cellsWritten,
    meta: { runId, ...summary },
  };
});

export const POST = GET;
