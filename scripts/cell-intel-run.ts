// scripts/cell-intel-run.ts
//
// Phase-1 · run the PER-CELL researches (Meta ads · Google ads · SERP) on the
// seeded outreach cells so evidence/proof lines can use ad + rank SIGNALS,
// not just reviews/speed. Viktor 2026-07-22: "run Meta ads and other per-cell
// researches — per cell is cheap now."
//
// Uses the official cell-intel runners (freshness-gated, cost-tracked,
// breaker-aware). ~$0.2/cell Meta actor + DfS pennies for the rest.
//
// Usage: pnpm tsx scripts/cell-intel-run.ts [--cells=key1,key2] [--skip=meta]

import { config } from "dotenv";
config({ path: ".env.local" });

import { withCronRun } from "@/lib/cost/cost-counter";
import { runMetaAdsForCell } from "@/modules/cell-intel/meta-ads";
import { runGoogleAdsForCell } from "@/modules/cell-intel/google-ads";
import { runSerpForCell } from "@/modules/cell-intel/serp";

const DEFAULT_CELLS = [
  "medical_spa|phoenix|US",
  "medical_spa|tempe-junction|US",
  "medical_spa|boise|US",
  "medical_spa|miami|US",
  "dentist|austin|US",
  "dentist|dallas|US",
];

async function main() {
  const cellsArg = process.argv.find((a) => a.startsWith("--cells="));
  const skipArg = process.argv.find((a) => a.startsWith("--skip="));
  const cells = cellsArg ? cellsArg.slice(8).split(",") : DEFAULT_CELLS;
  const skip = new Set(skipArg ? skipArg.slice(7).split(",") : []);

  await withCronRun("script:cell-intel", async () => {
    for (const cellKey of cells) {
      console.log(`\n[cell-intel] ── ${cellKey} ──`);
      if (!skip.has("google")) {
        try {
          const g = await runGoogleAdsForCell(cellKey);
          console.log(
            `[cell-intel] google · ${JSON.stringify(g).slice(0, 200)}`,
          );
        } catch (e) {
          console.error(
            `[cell-intel] google FAILED: ${String(e).slice(0, 200)}`,
          );
        }
      }
      if (!skip.has("serp")) {
        try {
          const s = await runSerpForCell(cellKey);
          console.log(`[cell-intel] serp · ${JSON.stringify(s).slice(0, 200)}`);
        } catch (e) {
          console.error(`[cell-intel] serp FAILED: ${String(e).slice(0, 200)}`);
        }
      }
      if (!skip.has("meta")) {
        try {
          const m = await runMetaAdsForCell(cellKey);
          console.log(
            `[cell-intel] meta · outcome=${m.outcome} advertisers=${m.advertiserCount} ads=${m.adCount} upserted=${m.entriesUpserted} cost=$${m.costUsd.toFixed(2)} errors=${m.errors.length}`,
          );
        } catch (e) {
          console.error(`[cell-intel] meta FAILED: ${String(e).slice(0, 200)}`);
        }
      }
    }
  });
  console.log("\nCELL-INTEL-DONE");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`FATAL: ${String(e).slice(0, 400)}`);
    process.exit(1);
  });
