/**
 * Ops · run the Scoring v2 passes against the live DB:
 *   cell-aggregate (build CellMetric references) → pillar-score (grade the 5
 *   pillars + revive MSI). Mirrors the weekly:cell-aggregate / weekly:pillar-score
 *   crons and the admin "Recompute references" / "Recompute scores" buttons.
 *
 * Run with DB env loaded:
 *   DATABASE_URL=… DIRECT_URL=… pnpm tsx scripts/scoring-v2-recompute.ts
 */

import { runCellAggregation } from "@/modules/market/cell-metrics";
import { runPillarScoring } from "@/modules/market/pillar-scoring";

async function main(): Promise<void> {
  const cells = await runCellAggregation();
  console.log("cell-aggregate:", JSON.stringify(cells));
  const scored = await runPillarScoring();
  console.log("pillar-score:", JSON.stringify(scored));
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
