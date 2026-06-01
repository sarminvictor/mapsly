/**
 * Validate the P1 cell architecture end-to-end: run collectAdsForBatch in
 * meta-only mode for The Injectionist (→ groups to the Calgary med-spa cell →
 * ONE service+city Meta market search → AdMarketAdvertiser upserts), then dump
 * what landed. Real Apify run (~$1, ~3 min).
 *
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/validate-cell-meta.ts
 */

import prisma from "@/lib/prisma";
import { withCronRun } from "@/lib/cost/cost-counter";
import { collectAdsForBatch } from "@/modules/ads-intel/collect-ads-intel";

const BIZ = "cmpm8wa7i000b04jxgqbho511"; // The Injectionist & Aesthetics (Calgary)

async function main() {
  const t0 = Date.now();
  const out = await withCronRun("manual:validate-cell-meta", () =>
    collectAdsForBatch([BIZ], { dfs: false, meta: true }),
  );
  console.log(`\nDONE ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log("result:", JSON.stringify(out, null, 2));

  const advs = await prisma.adMarketAdvertiser.findMany({
    where: { category: "Medical spa", city: "Calgary", isActive: true },
    orderBy: { activeAdCount: "desc" },
    select: {
      pageName: true,
      pageId: true,
      handle: true,
      activeAdCount: true,
      platforms: true,
      matchedServices: true,
      matchedBusinessId: true,
    },
  });
  console.log(
    `\n=== AdMarketAdvertiser · Medical spa / Calgary: ${advs.length} ===`,
  );
  for (const a of advs.slice(0, 25)) {
    const mine = a.matchedBusinessId ? " [MATCHED→our biz]" : "";
    console.log(
      `  ${a.pageName} · ${a.activeAdCount} ads · [${a.platforms.join(",")}]${a.handle ? " @" + a.handle : ""}${mine}`,
    );
  }

  // Platform distribution across the cell (the actionable signal).
  const plat = new Map<string, number>();
  for (const a of advs)
    for (const p of a.platforms) plat.set(p, (plat.get(p) ?? 0) + 1);
  console.log("\nplatform spread (advertisers using each):");
  for (const [p, n] of [...plat.entries()].sort((x, y) => y[1] - x[1]))
    console.log(`  ${p}: ${n}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
