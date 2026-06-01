/**
 * Local dev helper · runs the /ads collection pipeline against one business
 * so we can verify the SMB /ads page before merging.
 *
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/run-ads-intel.ts [businessId] [--meta]
 *
 * Defaults to The Injectionist & Aesthetics. `--meta` also runs the (slow,
 * ~2-3 min) Apify Meta Ad Library pass. Real DfS + Apify calls are made;
 * cost ≈ $0.07–0.34 (DfS) + a few cents Apify (with --meta).
 */

import prisma from "@/lib/prisma";
import { withCronRun } from "@/lib/cost/cost-counter";
import { collectAdsForBatch } from "@/modules/ads-intel/collect-ads-intel";
import {
  adsServiceKeywords,
  locationCodeForCountry,
} from "@/modules/ads-intel/keyword-set";

const DEFAULT_BIZ = "cmpm8wa7i000b04jxgqbho511"; // The Injectionist & Aesthetics

async function main() {
  const argBizId =
    process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) ?? DEFAULT_BIZ;
  const doMeta = process.argv.includes("--meta");

  const biz = await prisma.business.findUnique({
    where: { id: argBizId },
    select: {
      id: true,
      name: true,
      city: true,
      country: true,
      category: true,
      categories: true,
      domain: true,
      fbPageId: true,
    },
  });
  if (!biz) throw new Error(`Business ${argBizId} not found.`);

  console.log(
    "TARGET:",
    biz.name,
    "·",
    biz.city,
    biz.country,
    "·",
    biz.category,
  );
  console.log("  domain:", biz.domain, "· fbPageId:", biz.fbPageId);
  const kwSet = adsServiceKeywords({
    category: biz.category,
    city: biz.city,
    serviceNames: biz.categories,
  });
  console.log(
    "  service keyword set (" + kwSet.length + "):",
    kwSet.join(", "),
  );

  console.log("\n[dfs] keyword costs + Google Transparency ads...");
  const dfs = await withCronRun("manual:ads-intel-dfs", () =>
    collectAdsForBatch([biz.id], { dfs: true, meta: false }),
  );
  console.log("  result:", JSON.stringify(dfs));

  if (doMeta) {
    console.log("\n[meta] batched Apify actor run (slow ~2-3 min)...");
    const meta = await withCronRun("manual:ads-intel-meta", () =>
      collectAdsForBatch([biz.id], { dfs: false, meta: true }),
    );
    console.log("  result:", JSON.stringify(meta));
  }

  // ---- verify ----
  const loc = locationCodeForCountry(biz.country);
  const costRows = await prisma.keyword.findMany({
    where: { keyword: { in: kwSet }, locationCode: loc },
    select: {
      keyword: true,
      searchVolume: true,
      cpc: true,
      competition: true,
      lowTopOfPageBid: true,
      highTopOfPageBid: true,
    },
    orderBy: { searchVolume: "desc" },
    take: 10,
  });
  console.log("\nKEYWORD COSTS landed (" + costRows.length + "):");
  for (const r of costRows) {
    console.log(
      `  • ${r.keyword} | vol=${r.searchVolume} | cpc=$${r.cpc} | ${r.competition} | bid $${r.lowTopOfPageBid}-${r.highTopOfPageBid}`,
    );
  }
  const ownGoogle = await prisma.adLibraryEntry.count({
    where: { businessId: biz.id, platform: "GOOGLE" },
  });
  const compGoogle = await prisma.adLibraryEntry.count({
    where: { platform: "GOOGLE", businessId: { not: biz.id } },
  });
  const metaCount = await prisma.adLibraryEntry.count({
    where: { platform: "META" },
  });
  console.log(
    `\nADS: GOOGLE own=${ownGoogle} competitors=${compGoogle} · META total=${metaCount}`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
