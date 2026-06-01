/**
 * Read-only · inspect META AdLibraryEntry attribution for one business's market
 * — shows which advertiserName/pageId each attributed ad actually carries, so
 * we can spot over-attribution (generic industry tokens matching unrelated
 * pages). No writes.
 *
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/diag-meta.ts
 */

import prisma from "@/lib/prisma";

const BIZ = "cmpm8wa7i000b04jxgqbho511"; // The Injectionist & Aesthetics

async function main() {
  const own = await prisma.business.findUnique({
    where: { id: BIZ },
    select: { id: true, name: true, category: true, city: true },
  });
  if (!own) throw new Error("not found");

  const competitors = await prisma.business.findMany({
    where: {
      category: own.category,
      city: own.city,
      isActive: true,
      id: { not: own.id },
    },
    select: { id: true, name: true },
    orderBy: { reviewCount: "desc" },
    take: 8,
  });
  const nameOf = new Map<string, string>(
    competitors.map((c) => [c.id, c.name]),
  );
  nameOf.set(own.id, `${own.name} (OWN)`);

  const ids = [own.id, ...competitors.map((c) => c.id)];
  const meta = await prisma.adLibraryEntry.findMany({
    where: { platform: "META", isActive: true, businessId: { in: ids } },
    select: {
      businessId: true,
      advertiserName: true,
      pageId: true,
      platforms: true,
    },
  });

  console.log(`META active attributed to this market: ${meta.length}\n`);

  // Per attributed business: how many ads, and which distinct page names.
  const byBiz = new Map<string, typeof meta>();
  for (const m of meta) {
    const k = m.businessId ?? "?";
    (byBiz.get(k) ?? byBiz.set(k, []).get(k)!).push(m);
  }
  for (const [bid, rows] of [...byBiz.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    console.log(`■ ${nameOf.get(bid) ?? bid} — ${rows.length} ads`);
    const pages = new Map<string, number>();
    for (const r of rows) {
      const key = `${r.advertiserName ?? "?"} (page ${r.pageId ?? "?"})`;
      pages.set(key, (pages.get(key) ?? 0) + 1);
    }
    for (const [p, n] of [...pages.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${n}× ${p}`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
