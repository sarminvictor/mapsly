// scripts/recompute-miami.ts — FREE (no DfS) re-score after the gap-fill.
// Rebuilds signalsJson for the Miami qualified set (picks up new reviews +
// Lighthouse), then recomputes cell medians + pillar scores globally.
// Run: pnpm tsx scripts/recompute-miami.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import prisma from "@/lib/prisma";
import { withCronRun } from "@/lib/cost/cost-counter";
import { writeSnapshotsForBusinessIds } from "@/app/api/cron/weekly/snapshot-write/route";
import { runCellAggregation } from "@/modules/market/cell-metrics";
import { runPillarScoring } from "@/modules/market/pillar-scoring";

const MIAMI_CELL = "Medical Spa|Miami|US";

async function main() {
  const ids = (
    await prisma.business.findMany({
      where: {
        qualificationStatus: "QUALIFIED",
        isActive: true,
        OR: [
          { province: "FL" },
          { snapshots: { some: { cellKey: MIAMI_CELL } } },
        ],
      },
      select: { id: true },
    })
  ).map((b) => b.id);
  console.log(`[recompute] miami ids: ${ids.length}`);

  const result = await withCronRun("script:recompute-miami", async () => {
    const snap = await writeSnapshotsForBusinessIds(ids, { skipGate: true });
    console.log(
      `[recompute] snapshots rebuilt: ${snap.written}/${snap.attempted}`,
    );
    const cells = await runCellAggregation();
    console.log(`[recompute] cells: ${cells.cellsWritten} written`);
    const pillars = await runPillarScoring();
    console.log(`[recompute] scored: ${pillars.businessesScored}`);
    return {
      snap: snap.written,
      cells: cells.cellsWritten,
      scored: pillars.businessesScored,
    };
  });

  console.log("==== DONE ====", JSON.stringify(result));
  await prisma.$disconnect?.();
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
