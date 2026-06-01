/**
 * Local dev helper · runs ONLY the Meta Ad Library pass (one batched Apify
 * actor run across the target + its top competitors) — for when DataForSEO
 * keyword/Google data is already fresh and we just need the Facebook/Instagram
 * layer. Real Apify call (~2-3 min, a few cents).
 *
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/run-meta-only.ts [businessId]
 */

import prisma from "@/lib/prisma";
import { withCronRun } from "@/lib/cost/cost-counter";
import { collectAdsForBatch } from "@/modules/ads-intel/collect-ads-intel";

const DEFAULT_BIZ = "cmpm8wa7i000b04jxgqbho511"; // The Injectionist & Aesthetics

async function main() {
  const id =
    process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) ?? DEFAULT_BIZ;
  const biz = await prisma.business.findUnique({
    where: { id },
    select: { id: true, name: true, city: true, country: true },
  });
  if (!biz) throw new Error(`Business ${id} not found.`);
  console.log(`META-ONLY for: ${biz.name} · ${biz.city} ${biz.country}`);
  console.log("Running batched Apify actor (own + top-5 competitors)...\n");

  const t0 = Date.now();
  const out = await withCronRun("manual:ads-intel-meta", () =>
    collectAdsForBatch([biz.id], { dfs: false, meta: true }),
  );
  console.log(`\nDONE in ${Math.round((Date.now() - t0) / 1000)}s`);
  console.log("result:", JSON.stringify(out, null, 2));

  // Show what landed across this market.
  const rows = await prisma.adLibraryEntry.findMany({
    where: { platform: "META", isActive: true },
    select: {
      businessId: true,
      advertiserName: true,
      platforms: true,
      adCreativeBody: true,
    },
    take: 40,
  });
  console.log(`\nMETA ads now in table (active): ${rows.length}`);
  const byBiz = new Map<string, number>();
  for (const r of rows)
    byBiz.set(r.businessId ?? "?", (byBiz.get(r.businessId ?? "?") ?? 0) + 1);
  for (const [bid, n] of byBiz.entries()) {
    const b = await prisma.business.findUnique({
      where: { id: bid },
      select: { name: true },
    });
    const sample = rows.find((r) => r.businessId === bid);
    console.log(
      `  ${b?.name ?? sample?.advertiserName ?? bid} · ${n} ads · [${sample?.platforms?.join(",") ?? ""}]`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
