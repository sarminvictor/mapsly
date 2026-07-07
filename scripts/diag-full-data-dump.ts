/**
 * Diagnostic · EVERYTHING the DB holds for one fully-researched business —
 * field-level, every table — to compare against what the workbench UI can
 * actually show (owner audit 2026-07-06, "Meridian Family Acupuncture").
 *
 * Read-only. Run: npx tsx scripts/diag-full-data-dump.ts "Meridian Family"
 */

import prisma from "@/lib/prisma";

async function main() {
  const name = process.argv[2] ?? "Meridian Family Acupuncture";
  const biz = await prisma.business.findFirst({
    where: { name: { contains: name, mode: "insensitive" } },
  });
  if (!biz) {
    console.log("NOT FOUND:", name);
    return;
  }
  const businessId = biz.id;
  const [
    contacts,
    reviewCount,
    reviewSample,
    techs,
    services,
    enrichment,
    audits,
    metaAds,
    googleAds,
    serps,
    keywords,
    findings,
    snapshots,
    jobs,
  ] = await Promise.all([
    prisma.contact.findMany({ where: { businessId } }),
    prisma.review.count({ where: { businessId } }),
    prisma.review.findMany({
      where: { businessId },
      orderBy: { postedAt: "desc" },
      take: 3,
    }),
    prisma.businessTech.findMany({ where: { businessId } }),
    prisma.businessService.findMany({ where: { businessId } }),
    prisma.businessEnrichment.findFirst({ where: { businessId } }),
    prisma.lighthouseAudit.findMany({
      where: { businessId },
      orderBy: { auditedAt: "desc" },
      take: 1,
    }),
    prisma.adLibraryEntry.findMany({
      where: { businessId, platform: "META" },
      take: 5,
    }),
    prisma.adLibraryEntry.findMany({
      where: { businessId, platform: "GOOGLE" },
      take: 5,
    }),
    prisma.serpResult.findMany({
      where: { businessId },
      orderBy: { scannedAt: "desc" },
      take: 5,
    }),
    prisma.businessKeyword.findMany({ where: { businessId }, take: 10 }),
    prisma.playbookFinding.findMany({ where: { businessId }, take: 10 }),
    prisma.businessSnapshot.findMany({
      where: { businessId },
      orderBy: { snapshotDate: "desc" },
      take: 1,
    }),
    prisma.enrichmentJob.findMany({
      where: { businessId },
      select: { family: true, status: true },
    }),
  ]);

  const dump = {
    business: biz,
    contacts,
    reviews: { count: reviewCount, sample: reviewSample },
    techs,
    services,
    aiEnrichment: enrichment,
    lighthouse: audits[0] ?? null,
    metaAds,
    googleAds,
    serps,
    keywords,
    playbookFindings: findings,
    snapshot: snapshots[0] ?? null,
    jobs,
  };
  console.log(JSON.stringify(dump, null, 1));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
