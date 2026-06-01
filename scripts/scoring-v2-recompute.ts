/**
 * Ops · run the Scoring v2 passes against the live DB:
 *   cell-aggregate (build CellMetric references) → pillar-score (grade the 5
 *   pillars + revive MSI). Mirrors the weekly:cell-aggregate / weekly:pillar-score
 *   crons and the admin "Recompute references" / "Recompute scores" buttons.
 *
 * Run with DB env loaded:
 *   DATABASE_URL=… DIRECT_URL=… pnpm tsx scripts/scoring-v2-recompute.ts
 */

import { GET as snapshotWrite } from "@/app/api/cron/weekly/snapshot-write/route";
import { runCellAggregation } from "@/modules/market/cell-metrics";
import { runPillarScoring } from "@/modules/market/pillar-scoring";

async function main(): Promise<void> {
  // 1 · snapshot-write — gathers every signal → writes BusinessSnapshot.signalsJson
  // (the pillar inputs) + the legacy scores. Set MAPSLY_COLLECT_REVIEWS_ALLOW_ALL=1
  // to bypass the paid-cell gate. revalidateTag may warn outside a request — the
  // snapshot rows are written before it, so we proceed regardless.
  try {
    const req = new Request("http://localhost/api/cron/weekly/snapshot-write", {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
    });
    const res = await snapshotWrite(req);
    console.log(
      "snapshot-write:",
      res.status,
      (await res.text()).slice(0, 200),
    );
  } catch (e) {
    console.warn(
      "snapshot-write threw (signalsJson may still be written):",
      (e as Error).message,
    );
  }

  // 2 · cell-aggregate — build CellMetric market references.
  const cells = await runCellAggregation();
  console.log("cell-aggregate:", JSON.stringify(cells));

  // 3 · pillar-score — grade the 5 pillars + revive MSI.
  const scored = await runPillarScoring();
  console.log("pillar-score:", JSON.stringify(scored));
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
