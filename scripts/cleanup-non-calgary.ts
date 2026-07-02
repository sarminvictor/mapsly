#!/usr/bin/env tsx
/**
 * One-off cleanup · delete every Business that ISN'T Calgary, CA.
 *
 * Background: through Phase C-D we accumulated seed data from
 * `scripts/seed-dev.ts` (~500 dev-seed-* rows across 5 metros) and
 * `scripts/seed-smb-solea.ts` (Solea Brickell Spa in Miami). The only
 * REAL businesses in the index are the Calgary med-spas we discovered
 * + qualified through the /admin/discovery + Boxly Worker pipeline.
 *
 * This script collapses the index back to "Calgary only" so the
 * production cleanup is unambiguous: ~50 Calgary rows remain · every
 * other Business is wiped along with its cascade-linked rows.
 *
 * Safety:
 *   1. Dry-run by default · just counts what WOULD be deleted
 *   2. Requires `--confirm` to actually delete
 *   3. Cascade deletes via Prisma onDelete: Cascade · Review,
 *      BusinessSnapshot, BusinessService, Lead, LighthouseAudit,
 *      AdLibraryEntry, SerpResult all drop with their parent Business
 *   4. Reports per-status + per-city breakdown both before + after
 *
 * Invoke:
 *   pnpm dotenv -e .env.local -- tsx scripts/cleanup-non-calgary.ts            # dry-run
 *   pnpm dotenv -e .env.local -- tsx scripts/cleanup-non-calgary.ts --confirm  # execute
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaNeon } from "@prisma/adapter-neon";

import { PrismaClient } from "../lib/generated/prisma/client";
import { deleteBusinessDeep } from "../lib/db/delete-business";

const adapter = new PrismaNeon({
  connectionString: process.env.DATABASE_URL!,
});
const prisma = new PrismaClient({ adapter });

const KEEP_FILTER = { city: "Calgary", country: "CA" } as const;

async function main(): Promise<void> {
  const confirm = process.argv.includes("--confirm");
  console.log(`[cleanup-non-calgary] mode=${confirm ? "EXECUTE" : "DRY-RUN"}`);

  // ---- 1. Pre-state audit -----------------------------------------------
  console.log("\n=== BEFORE ===");
  await reportTotals();

  // What we'll keep
  const keepCount = await prisma.business.count({ where: KEEP_FILTER });
  // What we'll drop
  const dropCount = await prisma.business.count({
    where: { NOT: KEEP_FILTER },
  });
  console.log(
    `\n[cleanup-non-calgary] target · keep ${keepCount} Calgary/CA · drop ${dropCount} others`,
  );

  if (dropCount === 0) {
    console.log("[cleanup-non-calgary] nothing to delete · already clean");
    return;
  }

  // Cascading counts
  const [reviewsDrop, snapshotsDrop, servicesDrop, leadsDrop, lighthouseDrop] =
    await Promise.all([
      prisma.review.count({
        where: { business: { NOT: KEEP_FILTER } },
      }),
      prisma.businessSnapshot.count({
        where: { business: { NOT: KEEP_FILTER } },
      }),
      prisma.businessService.count({
        where: { business: { NOT: KEEP_FILTER } },
      }),
      prisma.lead.count({
        where: { business: { NOT: KEEP_FILTER } },
      }),
      prisma.lighthouseAudit.count({
        where: { business: { NOT: KEEP_FILTER } },
      }),
    ]);

  console.log("\n=== CASCADE PREVIEW ===");
  console.log(`  reviews        : ${reviewsDrop}`);
  console.log(`  snapshots      : ${snapshotsDrop}`);
  console.log(`  services       : ${servicesDrop}`);
  console.log(`  leads          : ${leadsDrop}`);
  console.log(`  lighthouseAudit: ${lighthouseDrop}`);

  if (!confirm) {
    console.log(
      "\n[cleanup-non-calgary] DRY-RUN complete · re-run with --confirm to execute",
    );
    return;
  }

  // ---- 2. Execute -------------------------------------------------------
  console.log("\n[cleanup-non-calgary] DELETING…");

  // WP9-2 · deleteBusinessDeep is the ONLY sanctioned delete path: it drops the
  // plain-FK children (Contact/EnrichmentJob/BusinessTech/PlaybookFinding/
  // LighthouseOpportunity/BusinessLicense/BusinessEnrichment/EnrichmentStageRun)
  // that carry NO onDelete cascade, then the businesses (whose declared-relation
  // children — Review/BusinessSnapshot/BusinessService/Lead/LighthouseAudit/
  // SerpResult/AdLibraryEntry — cascade via their FK). A bare business.deleteMany
  // would orphan the plain-FK rows.
  const doomed = await prisma.business.findMany({
    where: { NOT: KEEP_FILTER },
    select: { id: true },
  });
  const result = await deleteBusinessDeep(
    prisma,
    doomed.map((b) => b.id),
  );
  console.log(
    `[cleanup-non-calgary] deleted ${result.businesses} Business rows + children ` +
      `(contacts ${result.contacts}, jobs ${result.enrichmentJobs}, tech ${result.businessTech}, ` +
      `findings ${result.playbookFindings}, lhOpps ${result.lighthouseOpportunities}, ` +
      `licenses ${result.businessLicenses}, enrichments ${result.businessEnrichments}, ` +
      `stageRuns ${result.enrichmentStageRuns})`,
  );

  // ---- 3. Post-state audit ---------------------------------------------
  console.log("\n=== AFTER ===");
  await reportTotals();

  console.log("\n[cleanup-non-calgary] done");
}

async function reportTotals(): Promise<void> {
  const [total, byCountryCity, bySource, bizCounts] = await Promise.all([
    prisma.business.count(),
    prisma.business.groupBy({
      by: ["country", "city"],
      _count: { id: true },
      orderBy: [{ country: "asc" }, { city: "asc" }],
    }),
    prisma.business.groupBy({
      by: ["source"],
      _count: { id: true },
    }),
    Promise.all([
      prisma.review.count(),
      prisma.businessSnapshot.count(),
      prisma.businessService.count(),
      prisma.lead.count(),
      prisma.lighthouseAudit.count(),
    ]),
  ]);

  const [reviews, snapshots, services, leads, lighthouse] = bizCounts;

  console.log(`Business rows: ${total}`);
  console.log("  by source:");
  for (const row of bySource) {
    console.log(`    ${row.source.padEnd(16)} ${row._count.id}`);
  }
  console.log("  by (country, city):");
  for (const row of byCountryCity) {
    console.log(
      `    ${(row.country ?? "—").padEnd(4)} ${(row.city ?? "—").padEnd(20)} ${row._count.id}`,
    );
  }
  console.log(`Linked rows:`);
  console.log(`  reviews        : ${reviews}`);
  console.log(`  snapshots      : ${snapshots}`);
  console.log(`  services       : ${services}`);
  console.log(`  leads          : ${leads}`);
  console.log(`  lighthouseAudit: ${lighthouse}`);
}

main()
  .catch((err) => {
    console.error("[cleanup-non-calgary] failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
