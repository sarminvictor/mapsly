/**
 * Destructive cleanup · wipes ALL SERP-related data so the new
 * S.6.2 ranked_keywords-primary pipeline can repopulate from scratch.
 *
 * What gets deleted:
 *   - All SerpResult rows (organic + maps time-series history)
 *   - All BusinessKeyword rows (per-biz/per-kw ranks + traffic cache)
 *   - Business.searchScanLastAt reset to null (so weekly cron picks
 *     every active biz up immediately)
 *
 * What stays:
 *   - Keyword table (lookup data · re-used by new pipeline)
 *   - Business rows (only timestamp wiped)
 *   - CronRun history (audit trail intact)
 *
 * Authorized by Viktor 2026-05-28 · clean slate before re-running
 * the new pipeline.
 *
 * Run via:
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/clean-serp-data.ts
 */

import prisma from "@/lib/prisma";

async function main() {
  console.log("BEFORE");
  const bkBefore = await prisma.businessKeyword.count();
  const srBefore = await prisma.serpResult.count();
  const stampedBefore = await prisma.business.count({
    where: { searchScanLastAt: { not: null } },
  });
  console.log(
    `  BusinessKeyword rows         : ${bkBefore.toString().padStart(6)}`,
  );
  console.log(
    `  SerpResult rows              : ${srBefore.toString().padStart(6)}`,
  );
  console.log(
    `  Businesses with last-scan-at : ${stampedBefore.toString().padStart(6)}`,
  );

  // Transaction so a partial failure rolls back · prevents inconsistent state.
  console.log("\nDELETING...");
  const result = await prisma.$transaction(async (tx) => {
    const srDel = await tx.serpResult.deleteMany({});
    const bkDel = await tx.businessKeyword.deleteMany({});
    const updated = await tx.business.updateMany({
      data: { searchScanLastAt: null },
    });
    return {
      srDel: srDel.count,
      bkDel: bkDel.count,
      businessesReset: updated.count,
    };
  });

  console.log("\nAFTER");
  const bkAfter = await prisma.businessKeyword.count();
  const srAfter = await prisma.serpResult.count();
  console.log(
    `  BusinessKeyword rows         : ${bkAfter.toString().padStart(6)}  (deleted ${result.bkDel})`,
  );
  console.log(
    `  SerpResult rows              : ${srAfter.toString().padStart(6)}  (deleted ${result.srDel})`,
  );
  console.log(
    `  Businesses reset             : ${result.businessesReset.toString().padStart(6)}`,
  );

  console.log(`\n✓ Clean. Next:`);
  console.log(`  1. Run the new pipeline against The Injectionist:`);
  console.log(
    `     pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/run-local-intent.ts`,
  );
  console.log(
    `  2. Reload www.mapsly.ai/search to verify the new 6-cell State Bar.`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
