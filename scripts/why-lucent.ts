/**
 * Investigation · why does Lucent YYC have BusinessKeyword rows when
 * Viktor only ran the seed for The Injectionist? Dumps the source +
 * scan timing + which step in the pipeline created each row.
 *
 * Read-only. Run via:
 *   pnpm exec dotenv -e .env.local -- pnpm exec tsx scripts/why-lucent.ts
 */

import prisma from "@/lib/prisma";

async function main() {
  const lucent = await prisma.business.findFirst({
    where: { name: { contains: "Lucent", mode: "insensitive" } },
    select: { id: true, name: true, googleCid: true, website: true },
  });
  if (!lucent) throw new Error("Lucent not found");

  console.log(`BUSINESS  ${lucent.name}`);
  console.log(`  id     = ${lucent.id}`);
  console.log(`  cid    = ${lucent.googleCid}`);
  console.log(`  website= ${lucent.website ?? "(none)"}\n`);

  const rows = await prisma.businessKeyword.findMany({
    where: { businessId: lucent.id },
    select: {
      source: true,
      templateOrigin: true,
      latestMapsRank: true,
      latestOrganicRank: true,
      latestEstTrafficUsd: true,
      latestEstMonthlyVisits: true,
      latestScanAt: true,
      isNew: true,
      keyword: { select: { keyword: true, searchVolume: true } },
    },
    orderBy: { latestScanAt: "desc" },
  });

  console.log(`BUSINESSKEYWORD ROWS  (N=${rows.length})`);
  console.log(
    `  ${"keyword".padEnd(28)}  ${"src".padEnd(9)}  ${"tmpl".padEnd(7)}  ${"maps".padStart(4)}  ${"org".padStart(4)}  ${"vol".padStart(5)}  scanAt`,
  );
  for (const r of rows) {
    console.log(
      `  ${(r.keyword?.keyword ?? "—").padEnd(28).slice(0, 28)}  ${(r.source ?? "—").padEnd(9)}  ${(r.templateOrigin ?? "—").padEnd(7)}  ${(r.latestMapsRank?.toString() ?? "—").padStart(4)}  ${(r.latestOrganicRank?.toString() ?? "—").padStart(4)}  ${(r.keyword?.searchVolume?.toString() ?? "—").padStart(5)}  ${r.latestScanAt?.toISOString() ?? "—"}`,
    );
  }

  console.log(`\nSERP RESULTS for Lucent`);
  const serps = await prisma.serpResult.findMany({
    where: { businessId: lucent.id },
    select: {
      kind: true,
      localPackRank: true,
      organicRank: true,
      scannedAt: true,
      keyword: { select: { keyword: true } },
    },
    orderBy: { scannedAt: "desc" },
    take: 20,
  });
  for (const s of serps) {
    console.log(
      `  ${s.scannedAt.toISOString()}  ${s.kind.padEnd(8)}  ${(s.localPackRank?.toString() ?? "—").padStart(4)}  ${(s.organicRank?.toString() ?? "—").padStart(4)}  "${s.keyword?.keyword ?? ""}"`,
    );
  }

  console.log(`\nRECENT CRON RUNS that could touch Lucent`);
  const runs = await prisma.cronRun.findMany({
    where: {
      job: {
        in: [
          "manual:run-local-intent-discover",
          "manual:run-local-intent-cell",
          "worker:search-aggregate-cell",
          "worker:search-discover-local-intent",
        ],
      },
    },
    orderBy: { startedAt: "desc" },
    take: 10,
    select: {
      job: true,
      status: true,
      itemsProcessed: true,
      meta: true,
      startedAt: true,
      costUsd: true,
    },
  });
  for (const r of runs) {
    console.log(
      `  ${r.startedAt.toISOString()}  ${r.job.padEnd(38)}  ${r.status}  items=${r.itemsProcessed}  cost=$${r.costUsd?.toFixed(4) ?? "—"}`,
    );
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
