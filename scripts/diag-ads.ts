/**
 * Read-only diagnostic · prints the current /ads data state for one business
 * (default: The Injectionist & Aesthetics) so we can score the page against
 * what's actually in the DB. No external calls, no writes.
 *
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/diag-ads.ts [businessId]
 */

import prisma from "@/lib/prisma";
import {
  adsServiceKeywords,
  locationCodeForCountry,
} from "@/modules/ads-intel/keyword-set";

const DEFAULT_BIZ = "cmpm8wa7i000b04jxgqbho511"; // The Injectionist & Aesthetics

async function main() {
  const id =
    process.argv.find((a, i) => i >= 2 && !a.startsWith("--")) ?? DEFAULT_BIZ;

  const biz = await prisma.business.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      category: true,
      categories: true,
      city: true,
      country: true,
      ownerUserId: true,
      fbPageId: true,
      adsScanLastAt: true,
    },
  });
  if (!biz) {
    console.log("business not found:", id);
    return;
  }
  console.log("=== BUSINESS ===");
  console.log(JSON.stringify(biz, null, 2));

  const locationCode = locationCodeForCountry(biz.country);
  const keywordSet = adsServiceKeywords({
    category: biz.category,
    city: biz.city,
    serviceNames: biz.categories,
  });
  const keywordRows = await prisma.keyword.findMany({
    where: { keyword: { in: keywordSet }, locationCode },
    select: { keyword: true, searchVolume: true, cpc: true, competition: true },
    orderBy: { searchVolume: "desc" },
  });
  console.log(`\n=== KEYWORDS (loc ${locationCode}) ===`);
  console.log(
    `set size ${keywordSet.length} · matched rows ${keywordRows.length}`,
  );
  for (const k of keywordRows.slice(0, 12)) {
    console.log(
      `  ${k.keyword} · vol ${k.searchVolume ?? "—"} · cpc $${k.cpc ?? "—"} · ${k.competition ?? "—"}`,
    );
  }

  const competitors =
    biz.category && biz.city
      ? await prisma.business.findMany({
          where: {
            category: biz.category,
            city: biz.city,
            isActive: true,
            id: { not: biz.id },
          },
          select: { id: true, name: true },
          orderBy: { reviewCount: "desc" },
        })
      : [];
  console.log(`\n=== COMPETITORS (same ${biz.category} / ${biz.city}) ===`);
  console.log(`count ${competitors.length}`);

  const compIds = competitors.map((c) => c.id);
  const nameOf = new Map(competitors.map((c) => [c.id, c.name]));
  nameOf.set(biz.id, `${biz.name} (OWN)`);

  const ads = await prisma.adLibraryEntry.findMany({
    where: {
      isActive: true,
      OR: [{ businessId: biz.id }, { businessId: { in: compIds } }],
    },
    select: {
      businessId: true,
      platform: true,
      advertiserName: true,
      platforms: true,
      startedAt: true,
    },
  });
  console.log(`\n=== ACTIVE ADS (own + competitors) ===`);
  console.log(`total active ${ads.length}`);

  const byNet = (net: string) => ads.filter((a) => a.platform === net);
  for (const net of ["GOOGLE", "META", "TIKTOK"]) {
    const rows = byNet(net);
    const own = rows.filter((a) => a.businessId === biz.id).length;
    const advByBiz = new Map<string, number>();
    for (const a of rows) {
      const k = a.businessId ?? "?";
      advByBiz.set(k, (advByBiz.get(k) ?? 0) + 1);
    }
    console.log(
      `\n  [${net}] ${rows.length} ads · own ${own} · ${advByBiz.size} advertisers`,
    );
    for (const [bid, n] of [...advByBiz.entries()].sort(
      (a, b) => b[1] - a[1],
    )) {
      const r = rows.find((x) => x.businessId === bid);
      const surfaces =
        net === "META" && r?.platforms?.length
          ? ` [${r.platforms.join(",")}]`
          : "";
      console.log(
        `    ${nameOf.get(bid ?? "") ?? r?.advertiserName ?? "(unmatched)"} · ${n} ads${surfaces}`,
      );
    }
  }

  // Total across whole table (sanity)
  const totalMeta = await prisma.adLibraryEntry.count({
    where: { platform: "META", isActive: true },
  });
  const totalGoogle = await prisma.adLibraryEntry.count({
    where: { platform: "GOOGLE", isActive: true },
  });
  console.log(
    `\n=== WHOLE TABLE (active) === GOOGLE ${totalGoogle} · META ${totalMeta}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
