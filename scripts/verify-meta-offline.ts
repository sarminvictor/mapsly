/**
 * Read-only · re-process an EXISTING Apify dataset (a prior Meta run) through
 * the CURRENT attribution logic — verifies the matching fix against real data
 * without spending a new Apify run. No DB writes.
 *
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/verify-meta-offline.ts <datasetId>
 */

import prisma from "@/lib/prisma";
import { MetaAdRowSchema } from "@/services/apify/meta-ad-library";
import { assignMetaAdsToBusinesses } from "@/modules/ads-intel/collect-ads-intel";

const BIZ = "cmpm8wa7i000b04jxgqbho511"; // The Injectionist & Aesthetics
const MAX_META_NAMES = 5;
const MAX_COMPETITORS = 8;

async function main() {
  const datasetId = process.argv[2];
  if (!datasetId) throw new Error("usage: verify-meta-offline.ts <datasetId>");

  const token = process.env.APIFY_TOKEN;
  const res = await fetch(
    `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&format=json`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const raw = (await res.json()) as unknown[];
  const rows = raw.flatMap((it) => {
    const p = MetaAdRowSchema.safeParse(it);
    return p.success ? [p.data] : [];
  });
  console.log(
    `dataset ${datasetId}: ${raw.length} raw · ${rows.length} parsed\n`,
  );

  // Show the distinct page names the actor actually returned (the search noise).
  const pageNames = new Map<string, number>();
  for (const r of rows)
    pageNames.set(
      r.pageName ?? "?",
      (pageNames.get(r.pageName ?? "?") ?? 0) + 1,
    );
  console.log("=== distinct pages in the raw dataset (search noise) ===");
  for (const [n, c] of [...pageNames.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20))
    console.log(`  ${c}× ${n}`);

  const own = await prisma.business.findUnique({
    where: { id: BIZ },
    select: {
      id: true,
      name: true,
      category: true,
      city: true,
      fbPageId: true,
    },
  });
  if (!own) throw new Error("not found");
  const competitors = await prisma.business.findMany({
    where: {
      category: own.category,
      city: own.city,
      isActive: true,
      id: { not: own.id },
    },
    select: { id: true, name: true, fbPageId: true },
    orderBy: { reviewCount: "desc" },
    take: MAX_COMPETITORS,
  });
  const everyBiz = [own, ...competitors];
  const named = everyBiz.slice(0, MAX_META_NAMES);
  const nameOf = new Map(named.map((b) => [b.id, b.name]));

  console.log(`\n=== named businesses (own + top-4 competitors) ===`);
  for (const b of named) console.log(`  ${b.name}`);

  const perBiz = assignMetaAdsToBusinesses(
    rows,
    named.map((b) => ({ id: b.id, name: b.name, fbPageId: b.fbPageId })),
  );

  console.log(`\n=== ATTRIBUTION under CURRENT (stopword-strict) matching ===`);
  let total = 0;
  for (const b of named) {
    const mine = perBiz.get(b.id) ?? [];
    total += mine.length;
    const pages = new Map<string, number>();
    for (const r of mine)
      pages.set(r.pageName ?? "?", (pages.get(r.pageName ?? "?") ?? 0) + 1);
    console.log(`\n■ ${nameOf.get(b.id)} — ${mine.length} ads`);
    for (const [n, c] of [...pages.entries()].sort((a, b) => b[1] - a[1]))
      console.log(`    ${c}× ${n}`);
  }
  console.log(
    `\nTOTAL attributed: ${total} of ${rows.length} (dropped ${rows.length - total} as noise)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
