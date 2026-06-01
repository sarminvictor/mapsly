/**
 * Audit · per-keyword breakdown of how the "Customers you miss"
 * State Bar cell is computed. Shows volume + rank + the contribution
 * each row makes to the total, plus two reference upper-bounds:
 *
 *   - "current" · what we render today = vol × 0.2233 × 0.02
 *     where 0.2233 is the avg CTR across top-3 positions (rank 1: 39%,
 *     2: 18%, 3: 10%, mean ≈ 22.33%) and 0.02 is the visit→customer
 *     conversion baseline for local services
 *   - "max top-1" · if she were #1 = vol × 0.39 × 0.02
 *     (rank-1 CTR × conversion · what she'd get if she dominated)
 *   - "max convert-all" · vol × 0.02
 *     (100% click-through · the absolute ceiling)
 *
 * Read-only · run via:
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/audit-missed-customers.ts
 */

import prisma from "@/lib/prisma";

const TOP_3_AVG_CTR = (0.39 + 0.18 + 0.1) / 3; // 0.2233
const TOP_1_CTR = 0.39;
const CONVERSION = 0.02;

const bestRank = (m: number | null, o: number | null): number | null => {
  if (m == null) return o ?? null;
  if (o == null) return m;
  return Math.min(m, o);
};
const fmt = (n: number) => n.toLocaleString("en-US");

async function main() {
  const biz = await prisma.business.findFirst({
    where: { name: { contains: "Injectionist", mode: "insensitive" } },
    select: { id: true, name: true, city: true },
  });
  if (!biz) throw new Error("Injectionist not found");

  console.log(`AUDIT · ${biz.name}  (${biz.city})\n`);

  const rows = await prisma.businessKeyword.findMany({
    where: { businessId: biz.id },
    select: {
      latestOrganicRank: true,
      latestMapsRank: true,
      templateOrigin: true,
      keyword: { select: { keyword: true, searchVolume: true } },
    },
  });

  // Categorise each row.
  type Row = {
    keyword: string;
    volume: number;
    organicRank: number | null;
    mapsRank: number | null;
    bestRank: number | null;
    inTop3: boolean;
    missedNow: number;
    maxTop1: number;
    maxCovertAll: number;
    isTemplated: boolean;
  };
  const computed: Row[] = rows.map((r) => {
    const v = r.keyword?.searchVolume ?? 0;
    const best = bestRank(r.latestMapsRank, r.latestOrganicRank);
    const inTop3 = best != null && best <= 3;
    return {
      keyword: r.keyword?.keyword ?? "—",
      volume: v,
      organicRank: r.latestOrganicRank,
      mapsRank: r.latestMapsRank,
      bestRank: best,
      inTop3,
      missedNow: inTop3 ? 0 : Math.round(v * TOP_3_AVG_CTR * CONVERSION),
      maxTop1: Math.round(v * TOP_1_CTR * CONVERSION),
      maxCovertAll: Math.round(v * CONVERSION),
      isTemplated: r.templateOrigin != null,
    };
  });

  // Sort by missedNow desc so the biggest contributors surface first.
  computed.sort((a, b) => b.missedNow - a.missedNow);

  // Per-row dump · top 30 by missed contribution + summary.
  console.log("TOP 30 ROWS BY MISSED-CUSTOMERS CONTRIBUTION");
  console.log(
    `  ${"keyword".padEnd(36)}  ${"vol".padStart(6)}  ${"maps".padStart(4)}  ${"org".padStart(4)}  ${"best".padStart(4)}  top3  ${"missed".padStart(6)}  ${"top1".padStart(6)}  ${"cap".padStart(6)}  tmpl`,
  );
  for (const r of computed.slice(0, 30)) {
    console.log(
      `  ${r.keyword.padEnd(36).slice(0, 36)}  ${r.volume.toString().padStart(6)}  ${(r.mapsRank?.toString() ?? "—").padStart(4)}  ${(r.organicRank?.toString() ?? "—").padStart(4)}  ${(r.bestRank?.toString() ?? "—").padStart(4)}  ${r.inTop3 ? " ✓" : " ✗"}    ${r.missedNow.toString().padStart(6)}  ${r.maxTop1.toString().padStart(6)}  ${r.maxCovertAll.toString().padStart(6)}  ${r.isTemplated ? "✓" : " "}`,
    );
  }

  // Aggregates.
  const sumVolAll = computed.reduce((s, r) => s + r.volume, 0);
  const sumVolNonTop3 = computed
    .filter((r) => !r.inTop3)
    .reduce((s, r) => s + r.volume, 0);
  const sumMissedNow = computed.reduce((s, r) => s + r.missedNow, 0);
  const sumMaxTop1 = computed.reduce((s, r) => s + r.maxTop1, 0);
  const sumMaxCovertAll = computed.reduce((s, r) => s + r.maxCovertAll, 0);
  const countAll = computed.length;
  const countInTop3 = computed.filter((r) => r.inTop3).length;
  const countNonTop3 = countAll - countInTop3;
  const countTemplated = computed.filter((r) => r.isTemplated).length;

  console.log(`\nSUMMARY`);
  console.log(`  Total keywords (all sources)      : ${countAll}`);
  console.log(`     · templated subset (Maps-scan) : ${countTemplated}`);
  console.log(`     · in top 3 (best of maps+org)  : ${countInTop3}`);
  console.log(`     · NOT in top 3                 : ${countNonTop3}`);
  console.log(``);
  console.log(`  Volume sums`);
  console.log(`     · all keywords                 : ${fmt(sumVolAll)}/mo`);
  console.log(`     · non-top-3 only               : ${fmt(sumVolNonTop3)}/mo`);
  console.log(``);
  console.log(`  Missed-customers formulas (sum over NON-TOP-3 rows)`);
  console.log(
    `     · CURRENT (vol × 0.2233 × 0.02)  : ${fmt(sumMissedNow)}  ← page shows this`,
  );
  console.log(
    `       check: ${fmt(sumVolNonTop3)} × 0.2233 × 0.02 = ${fmt(Math.round(sumVolNonTop3 * TOP_3_AVG_CTR * CONVERSION))}`,
  );
  console.log(``);
  console.log(`  Upper bounds (sum over ALL keywords, even top-3 ones)`);
  console.log(
    `     · if she were #1   (vol × 0.39 × 0.02) : ${fmt(sumMaxTop1)}`,
  );
  console.log(
    `     · convert-100%     (vol × 0.02)        : ${fmt(sumMaxCovertAll)}`,
  );
  console.log(``);
  console.log(`  Constants used`);
  console.log(`     · TOP_3_AVG_CTR = (0.39 + 0.18 + 0.10) / 3 = 0.2233`);
  console.log(
    `     · CONVERSION    = 0.02 (industry baseline · local services)`,
  );
  console.log(``);
  console.log(`  Reading: "if Maria reached top 3 for all the keywords she's`);
  console.log(
    `  not in top 3 for today, she'd capture ~${fmt(sumMissedNow)} more`,
  );
  console.log(
    `  customers/month at the top-3 average CTR (22%) × 2% conversion."`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
