// WP9-2 · The ONLY sanctioned way to delete Business rows.
//
// Six child models (Contact, EnrichmentJob, BusinessTech, PlaybookFinding,
// LighthouseOpportunity, BusinessLicense) plus the AI-research store
// (BusinessEnrichment, EnrichmentStageRun) are PLAIN-FK by design — `businessId
// String` with no `@relation`, so they carry NO `onDelete: Cascade` (see the
// schema design note). A bare `business.deleteMany` therefore ORPHANS those rows
// (the pre-WP9-2 bug in scripts/cleanup-non-calgary.ts). This helper deletes the
// plain-FK children first, in one transaction per chunk, then the businesses
// (whose DECLARED-relation children — Review/BusinessSnapshot/BusinessService/
// Lead/LighthouseAudit/SerpResult/AdLibraryEntry — cascade via their FK).
//
// Accepts the client so both the app singleton (`@/lib/prisma`) and the
// direct-URL script client can call it.

import type { PrismaClient } from "@/lib/generated/prisma/client";

/** Chunk size for the `id IN (...)` deletes — avoids an oversized statement. */
const CHUNK = 1000;

export interface DeleteBusinessDeepResult {
  businesses: number;
  contacts: number;
  enrichmentJobs: number;
  businessTech: number;
  playbookFindings: number;
  lighthouseOpportunities: number;
  businessLicenses: number;
  businessEnrichments: number;
  enrichmentStageRuns: number;
}

function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Transactionally delete businesses + every plain-FK child. Idempotent and
 * safe to re-run (a missing row deletes zero). Returns per-table counts.
 */
export async function deleteBusinessDeep(
  prisma: PrismaClient,
  businessIds: readonly string[],
): Promise<DeleteBusinessDeepResult> {
  const total: DeleteBusinessDeepResult = {
    businesses: 0,
    contacts: 0,
    enrichmentJobs: 0,
    businessTech: 0,
    playbookFindings: 0,
    lighthouseOpportunities: 0,
    businessLicenses: 0,
    businessEnrichments: 0,
    enrichmentStageRuns: 0,
  };
  if (businessIds.length === 0) return total;

  for (const ids of chunk(businessIds, CHUNK)) {
    const where = { businessId: { in: ids } };
    // One transaction per chunk: children before parents. The plain-FK children
    // MUST be deleted here (no DB cascade); declared-relation children drop with
    // the Business.deleteMany at the end.
    const [
      contacts,
      enrichmentJobs,
      businessTech,
      playbookFindings,
      lighthouseOpportunities,
      businessLicenses,
      businessEnrichments,
      enrichmentStageRuns,
      businesses,
    ] = await prisma.$transaction([
      prisma.contact.deleteMany({ where }),
      prisma.enrichmentJob.deleteMany({ where }),
      prisma.businessTech.deleteMany({ where }),
      prisma.playbookFinding.deleteMany({ where }),
      prisma.lighthouseOpportunity.deleteMany({ where }),
      prisma.businessLicense.deleteMany({ where }),
      prisma.businessEnrichment.deleteMany({ where }),
      prisma.enrichmentStageRun.deleteMany({ where }),
      prisma.business.deleteMany({ where: { id: { in: ids } } }),
    ]);
    total.contacts += contacts.count;
    total.enrichmentJobs += enrichmentJobs.count;
    total.businessTech += businessTech.count;
    total.playbookFindings += playbookFindings.count;
    total.lighthouseOpportunities += lighthouseOpportunities.count;
    total.businessLicenses += businessLicenses.count;
    total.businessEnrichments += businessEnrichments.count;
    total.enrichmentStageRuns += enrichmentStageRuns.count;
    total.businesses += businesses.count;
  }
  return total;
}
