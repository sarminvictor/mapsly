/**
 * Diagnostic · enrichment-state ground truth for ONE business, compared against
 * every UI surface's derivation (popup / cov strip / drawer).
 *
 * Read-only · session 2026-07-06 (Center for Lifetime Health, Boise mismatch:
 * popup "already done" everywhere vs Enriched field 3/7 vs drawer 3 domains).
 *
 * Run: npx tsx scripts/diag-enrichment-state.ts "Center for Lifetime Health"
 */

import prisma from "@/lib/prisma";
import {
  DATA_GROUPS,
  deriveGroupStates,
  deriveTypeStates,
  rollUpGroupState,
  type TypeRunInputs,
} from "@/modules/agency-portal/discover/family-coverage";

async function main() {
  const name = process.argv[2] ?? "Center for Lifetime Health";
  const biz = await prisma.business.findFirst({
    where: { id: "cmr8m9xib007404l7sv9o3j7w" },
    select: {
      id: true,
      name: true,
      city: true,
      cellKey: true,
      contactsExtractedAt: true,
      techScanLastAt: true,
      reviewsLastDeltaAt: true,
      servicesLastAt: true,
      aiResearchLastAt: true,
      googleAdsLastAt: true,
    },
  });
  if (!biz) {
    console.log("NOT FOUND:", name);
    return;
  }
  console.log("=== BUSINESS ===");
  console.log(biz);

  const [
    jobs,
    adRuns,
    contacts,
    reviews,
    techs,
    services,
    aiRes,
    audits,
    metaAds,
    googleAds,
    serps,
    activeRuns,
  ] = await Promise.all([
    prisma.enrichmentJob.findMany({
      where: { businessId: biz.id },
      select: { family: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    biz.cellKey
      ? prisma.adMarketRun.findMany({
          where: { cellKey: biz.cellKey },
          select: { platform: true, status: true, ranAt: true },
          orderBy: { ranAt: "desc" },
          take: 20,
        })
      : Promise.resolve([]),
    prisma.contact.count({ where: { businessId: biz.id } }),
    prisma.review.count({ where: { businessId: biz.id } }),
    prisma.businessTech.count({ where: { businessId: biz.id } }),
    prisma.businessService.count({ where: { businessId: biz.id } }),
    prisma.businessEnrichment.count({ where: { businessId: biz.id } }),
    prisma.lighthouseAudit.count({ where: { businessId: biz.id } }),
    prisma.adLibraryEntry.count({
      where: { businessId: biz.id, platform: "META" },
    }),
    prisma.adLibraryEntry.count({
      where: { businessId: biz.id, platform: "GOOGLE" },
    }),
    prisma.serpResult.count({ where: { businessId: biz.id } }),
    prisma.enrichmentRun.findMany({
      where: { status: { in: ["PENDING", "RUNNING"] } },
      select: { id: true, status: true, enrichmentsJson: true },
      take: 10,
    }),
  ]);

  console.log("\n=== ENRICHMENT JOBS (run records, newest first) ===");
  for (const j of jobs)
    console.log(
      `  ${j.family.padEnd(12)} ${j.status.padEnd(14)} ${j.createdAt.toISOString()}`,
    );
  console.log("\n=== AD MARKET RUNS for cell", biz.cellKey, "===");
  for (const r of adRuns)
    console.log(
      `  ${r.platform.padEnd(8)} ${r.status.padEnd(8)} ${r.ranAt.toISOString()}`,
    );
  console.log("\n=== PRESENCE (real rows) ===");
  console.log({
    contacts,
    reviews,
    techs,
    services,
    aiResearch: aiRes,
    lighthouseAudits: audits,
    metaAdEntries: metaAds,
    googleAdEntries: googleAds,
    serpResults: serps,
  });
  console.log("\n=== ACTIVE RUNS (agency-wide) ===", activeRuns.length);

  // ── Re-derive exactly as coverage-matrix.ts does ──
  const done = new Set(
    jobs
      .filter((j) => j.status === "DONE" || j.status === "SKIPPED_FRESH")
      .map((j) => j.family),
  );
  const failed = new Set(
    jobs.filter((j) => j.status === "FAILED").map((j) => j.family),
  );
  const running = new Set(
    jobs
      .filter((j) => j.status === "QUEUED" || j.status === "RUNNING")
      .map((j) => j.family),
  );
  const okRun = (p: string) =>
    adRuns.some(
      (r) => r.platform === p && (r.status === "OK" || r.status === "PARTIAL"),
    );
  const failRun = (p: string) =>
    adRuns.some((r) => r.platform === p && r.status === "FAILED") && !okRun(p);

  const inputs: TypeRunInputs = {
    presence: {
      contacts: contacts > 0,
      services: services > 0,
      tech: techs > 0,
      reviews: reviews > 0,
      metaAds: metaAds > 0,
      googleAds: googleAds > 0,
      serp: serps > 0,
      lighthouse: audits > 0,
      aiResearch: aiRes > 0,
    },
    doneJobFamilies: done,
    failedJobFamilies: failed,
    runningJobFamilies: running,
    cellRan: {
      metaAds: okRun("META"),
      serp: okRun("SERP"),
    },
    cellFailed: {
      metaAds: failRun("META"),
      serp: failRun("SERP"),
    },
  };
  const typeStates = deriveTypeStates(inputs);
  const groupStates = deriveGroupStates(typeStates);

  console.log("\n=== TYPE STATES (9, the atom) ===");
  console.log(typeStates);
  console.log("\n=== GROUP STATES (7, display) ===");
  console.log(groupStates);

  // ── What each surface shows ──
  console.log("\n=== SURFACE COMPARISON ===");
  // 1. Popup: per group, done = state ∉ {not_run, failed}
  for (const g of DATA_GROUPS) {
    const s = rollUpGroupState(typeStates, g);
    const popup =
      s === "not_run" || s === "failed"
        ? `TO GET (${s})`
        : `already done (${s})`;
    console.log(`  popup   ${g.key.padEnd(14)} → ${popup}`);
  }
  // 2. Cov strip: enrichedN = groups with state === "enriched"
  const enrichedN = DATA_GROUPS.filter(
    (g) => groupStates[g.key] === "enriched",
  ).length;
  const ranN = DATA_GROUPS.filter(
    (g) => groupStates[g.key] !== "not_run",
  ).length;
  console.log(
    `  covstrip → shows "${enrichedN}/7" (counts state===enriched); ran-count would be ${ranN}/7`,
  );
  console.log(
    "\nDIAGNOSIS: popup counts RAN (incl. verified-empty) as done; the Enriched field counts only groups WITH DATA. Drawer domain flags are presence-based (its own third derivation).",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
