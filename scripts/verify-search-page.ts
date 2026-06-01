/**
 * Post-deploy verification · reads The Injectionist's actual DB state
 * and confirms every State Bar number against the page screenshot.
 * Also dumps the Lucent YYC rows to explain why they appear in the
 * competitor leaderboard despite only seeding 1 business.
 *
 * Read-only · run via:
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/verify-search-page.ts
 *
 * Delete after verification is complete.
 */

import prisma from "@/lib/prisma";

const CTR = (rank: number | null): number => {
  if (rank == null) return 0;
  if (rank === 1) return 0.39;
  if (rank === 2) return 0.18;
  if (rank === 3) return 0.1;
  if (rank === 4) return 0.07;
  if (rank === 5) return 0.05;
  if (rank <= 10) return 0.025;
  if (rank <= 20) return 0.008;
  if (rank <= 50) return 0.002;
  return 0.0005;
};
const bestRank = (m: number | null, o: number | null): number | null => {
  if (m == null) return o ?? null;
  if (o == null) return m;
  return Math.min(m, o);
};
const fmt = (n: number) => n.toLocaleString("en-US");
const fmtUsd = (n: number) =>
  n < 10
    ? `$${n.toFixed(2)}`
    : n < 1000
      ? `$${Math.round(n)}`
      : `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;

async function main() {
  const biz = await prisma.business.findFirst({
    where: { name: { contains: "Injectionist", mode: "insensitive" } },
    select: {
      id: true,
      name: true,
      city: true,
      country: true,
      category: true,
      googleCid: true,
    },
  });
  if (!biz) throw new Error("Injectionist not found");

  console.log(
    `BUSINESS  ${biz.name}  ·  ${biz.city}, ${biz.country}  ·  ${biz.category}`,
  );
  console.log(`  CID = ${biz.googleCid}\n`);

  // === 1) Maria's template-row population
  const rows = await prisma.businessKeyword.findMany({
    where: { businessId: biz.id, source: "template" },
    select: {
      latestOrganicRank: true,
      latestMapsRank: true,
      latestEstTrafficUsd: true,
      latestEstMonthlyVisits: true,
      templateOrigin: true,
      keyword: { select: { keyword: true, searchVolume: true, cpc: true } },
    },
    orderBy: { keyword: { searchVolume: "desc" } },
  });

  console.log(
    `MARIA'S TEMPLATE-ROW SET  (source="template", N=${rows.length})`,
  );
  console.log(
    `  ${"keyword".padEnd(30)}  ${"vol".padStart(6)}  ${"cpc".padStart(5)}  ${"maps".padStart(4)}  ${"org".padStart(4)}  ${"etv".padStart(6)}  ${"etc$".padStart(6)}  origin`,
  );
  let sumVol = 0,
    sumEtv = 0,
    sumEtc = 0;
  for (const r of rows) {
    const vol = r.keyword?.searchVolume ?? 0;
    sumVol += vol;
    sumEtv += r.latestEstMonthlyVisits ?? 0;
    sumEtc += r.latestEstTrafficUsd ?? 0;
    console.log(
      `  ${(r.keyword?.keyword ?? "—").padEnd(30).slice(0, 30)}  ${vol.toString().padStart(6)}  ${(r.keyword?.cpc?.toFixed(2) ?? "—").padStart(5)}  ${(r.latestMapsRank?.toString() ?? "—").padStart(4)}  ${(r.latestOrganicRank?.toString() ?? "—").padStart(4)}  ${(r.latestEstMonthlyVisits?.toFixed(0) ?? "—").padStart(6)}  ${(r.latestEstTrafficUsd?.toFixed(2) ?? "—").padStart(6)}  ${r.templateOrigin ?? "—"}`,
    );
  }

  // === 2) Page formula re-computation
  console.log(`\nSTATE BAR · COMPUTED FROM ABOVE`);

  // Total searches/mo
  console.log(`  Total searches/mo       = Σ searchVolume`);
  console.log(`                          = ${fmt(sumVol)}  ← page shows 9,890`);

  // Visits you likely get · sum of estVisits (DfS etv with CTR fallback)
  let visits = 0;
  for (const r of rows) {
    if (r.latestEstMonthlyVisits != null) {
      visits += Math.round(r.latestEstMonthlyVisits);
    } else {
      visits += Math.round(
        (r.keyword?.searchVolume ?? 0) *
          CTR(bestRank(r.latestMapsRank, r.latestOrganicRank)),
      );
    }
  }
  console.log(
    `  Visits you likely get   = Σ estVisits (DfS etv ?? sv × CTR(bestRank))`,
  );
  console.log(`                          = ${fmt(visits)}  ← page shows 471`);
  console.log(
    `     % of demand          = round(visits/sumVol × 100) = ${sumVol > 0 ? Math.round((visits / sumVol) * 100) : 0}%  ← page shows 5%`,
  );

  // Free traffic value · sum of latestEstTrafficUsd (DfS estimated_paid_traffic_cost)
  console.log(
    `  Free traffic value      = Σ latestEstTrafficUsd (DfS estimated_paid_traffic_cost)`,
  );
  console.log(
    `                          = ${fmtUsd(sumEtc)} (raw ${sumEtc.toFixed(2)})  ← page shows $459`,
  );

  // Top 3 keywords · bestRank ≤ 3
  let top3 = 0,
    top10 = 0,
    below10 = 0;
  let top3Vol = 0,
    top10Vol = 0,
    below10Vol = 0;
  let top3Visits = 0,
    top10Visits = 0,
    below10Visits = 0;
  for (const r of rows) {
    const rk = bestRank(r.latestMapsRank, r.latestOrganicRank);
    const v = r.keyword?.searchVolume ?? 0;
    const vis =
      r.latestEstMonthlyVisits != null
        ? Math.round(r.latestEstMonthlyVisits)
        : Math.round(v * CTR(rk));
    if (rk != null && rk <= 3) {
      top3 += 1;
      top3Vol += v;
      top3Visits += vis;
    } else if (rk != null && rk <= 10) {
      top10 += 1;
      top10Vol += v;
      top10Visits += vis;
    } else {
      below10 += 1;
      below10Vol += v;
      below10Visits += vis;
    }
  }
  console.log(
    `  Top 3 keywords          = count(bestRank ≤ 3) = ${top3}  ← page shows 4`,
  );
  console.log(`     of {tracked}         = ${rows.length}  ← page shows 12`);

  // Customers you miss · sum of estPatientsLost
  // estPatientsLost = sv × (0.30 - 0.05) × 0.02 when bestRank > 3 OR unranked
  let missed = 0;
  for (const r of rows) {
    const rk = bestRank(r.latestMapsRank, r.latestOrganicRank);
    if (rk != null && rk <= 3) continue;
    const v = r.keyword?.searchVolume ?? 0;
    if (v <= 0) continue;
    missed += Math.round(v * 0.25 * 0.02);
  }
  console.log(
    `  Customers you miss      = Σ (sv × 0.25 × 0.02) where bestRank > 3 OR null`,
  );
  console.log(`                          = ${missed}  ← page shows 35`);

  // Best spot in Maps · min(latestMapsRank)
  const bestMaps = rows
    .filter((r) => r.latestMapsRank != null)
    .sort((a, b) => (a.latestMapsRank ?? 99) - (b.latestMapsRank ?? 99))[0];
  console.log(`  Best spot in Maps       = min(latestMapsRank) where not null`);
  console.log(
    `                          = #${bestMaps?.latestMapsRank ?? "—"} for "${bestMaps?.keyword?.keyword ?? "—"}"  ← page shows #1 for "botox calgary"`,
  );

  // === 3) Rank-breakdown bars
  console.log(
    `\nWHERE YOU SHOW UP · RANK BUCKETS  (bestRank = min(maps, organic))`,
  );
  console.log(
    `  Top 3 spots             ${top3} kw · ${fmt(top3Vol)} vol · ~${fmt(top3Visits)} vis  ← page shows 4 · 2,990 · 325`,
  );
  console.log(
    `  Spots 4 – 10            ${top10} kw · ${fmt(top10Vol)} vol · ~${fmt(top10Visits)} vis  ← page shows 4 · 2,270 · 138`,
  );
  console.log(
    `  Spot 11 or lower        ${below10} kw · ${fmt(below10Vol)} vol  ← page shows 4 · 4,630`,
  );

  // === 4) Competitor leaderboard · why Lucent YYC?
  console.log(
    `\nCOMPETITOR LEADERBOARD · who has BusinessKeyword data in this cell?`,
  );
  const cellBusinesses = await prisma.business.findMany({
    where: {
      city: biz.city,
      country: biz.country,
      isActive: true,
      businessKeywords: { some: { source: "template" } },
    },
    select: {
      id: true,
      name: true,
      _count: {
        select: { businessKeywords: { where: { source: "template" } } },
      },
    },
  });
  for (const b of cellBusinesses) {
    const hits = await prisma.businessKeyword.count({
      where: {
        businessId: b.id,
        source: "template",
        latestMapsRank: { lte: 3 },
      },
    });
    console.log(
      `  ${b.name.padEnd(40)}  rows=${b._count.businessKeywords.toString().padStart(3)}  maps-top-3=${hits.toString().padStart(2)}  ${b.id === biz.id ? "← you" : ""}`,
    );
  }

  console.log(
    `\n→ Lucent YYC got template rows because cell-aggregate-maps matched their`,
  );
  console.log(
    `  Google CID in the DfS Maps SERP results. When that happens, the upsert`,
  );
  console.log(
    `  path in aggregate-cell-maps.ts creates a BusinessKeyword row for them`,
  );
  console.log(
    `  too (source="template", templateOrigin="core"). This is intentional —`,
  );
  console.log(
    `  one cell-aggregate Maps query benefits EVERY business in the cell with`,
  );
  console.log(
    `  a matching CID, not just the seeded one. Cost saver per S.5 plan.`,
  );

  // === 5) Confirm the two DfS endpoints that ran
  console.log(`\nRECENT CRON RUNS · S.6 pipeline endpoints`);
  const runs = await prisma.cronRun.findMany({
    where: {
      OR: [
        { job: "manual:run-local-intent-discover" },
        { job: "manual:run-local-intent-cell" },
        { job: "worker:search-discover-local-intent" },
        { job: "worker:search-aggregate-cell" },
      ],
    },
    orderBy: { startedAt: "desc" },
    take: 10,
    select: {
      job: true,
      status: true,
      costUsd: true,
      itemsProcessed: true,
      meta: true,
      startedAt: true,
    },
  });
  for (const r of runs) {
    console.log(
      `  ${r.startedAt.toISOString()}  ${r.job.padEnd(38)}  ${r.status}  cost=$${r.costUsd?.toFixed(4) ?? "—"}  items=${r.itemsProcessed}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
