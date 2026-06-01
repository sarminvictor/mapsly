// Weekly · pillar-score
//
// The third scoring pass: grades the 5 market-relative pillars (Reputation /
// Visibility / Profile / Website / Advertising) against each business's
// CellMetric, revives MSI (finally writes msiRank / msiTotal / msiPercentile),
// and writes the consolidated v2 master onto the latest BusinessSnapshot.
// Runs AFTER cell-aggregate. Shared logic lives in
// modules/market/pillar-scoring.ts so this cron and the /admin/businesses
// "Recompute scores" trigger can never diverge.

import { cronHandler } from "@/lib/middleware/no-live-api";
import { runPillarScoring } from "@/modules/market/pillar-scoring";

const JOB = "weekly:pillar-score";

export const GET = cronHandler(JOB, async ({ runId }) => {
  const summary = await runPillarScoring();
  return {
    itemsProcessed: summary.businessesScored,
    meta: { runId, ...summary },
  };
});

export const POST = GET;
