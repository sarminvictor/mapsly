// modules/playbooks/hydrate.ts · DB → EvidenceBundle hydration (Phase 7)
//
// The playbook detectors are PURE rules over an inert {@link EvidenceBundle}
// (see ./types.ts). This module is the single chokepoint that turns Prisma rows
// into that bundle. It is the ONLY place in the expert layer that imports
// Prisma — detectors never see the DB.
//
// Enrichment-null semantics (load-bearing · drives the "not checked" promise):
//   - `tech: null`              when NO BusinessTech row has been scanned yet.
//                               An empty array would (wrongly) mean "scanned,
//                               found nothing" and let detectors run.
//   - `lighthouseAudits: null`  when there is NO LighthouseAudit row.
//   - `reviews: []`             reviews are always "present" (the array may be
//                               empty); the driver treats reviews as never-null.
//
// The audits map is built from the latest LighthouseAudit's `opportunities`
// JSON (the normalized failing-audit list — see
// services/lighthouse/extract-opportunities.ts) plus the dedicated DOM/CWV
// columns, keyed by Lighthouse auditKey so detectors can look up e.g.
// "color-contrast" → { score, failingNodes }.
//
// See:
//   - modules/playbooks/types.ts            — EvidenceBundle contract
//   - modules/playbooks/driver.ts           — hasEnrichment / runPlaybook
//   - services/lighthouse/extract-opportunities.ts — Opportunity shape

import prisma from "@/lib/prisma";

import type { EvidenceBundle } from "./types";

/** How many recent reviews to load into the bundle. */
const REVIEW_DEPTH = 50;

/**
 * One normalized Lighthouse opportunity as persisted on
 * `LighthouseAudit.opportunities` (Json). Mirrors `Opportunity` from
 * services/lighthouse/extract-opportunities.ts; kept local so this module does
 * not depend on the services layer.
 */
interface PersistedOpportunity {
  auditKey?: unknown;
  score?: unknown;
  itemCount?: unknown;
}

/** A Lighthouse audit reading the detectors consume. */
type AuditReading = { score: number | null; failingNodes?: number };

/**
 * Build the auditKey → reading map from a LighthouseAudit row.
 *
 * Source of truth is the normalized `opportunities` JSON array (each entry is a
 * failing/under-par audit with an `auditKey`, `score`, and `itemCount` =
 * affected node count). We additionally synthesize a couple of readings from
 * the dedicated boolean/score columns so detectors keep working even on rows
 * predating the opportunities extraction.
 */
function buildAuditsMap(row: {
  opportunities: unknown;
  accessibility: number | null;
}): Record<string, AuditReading> | null {
  const map: Record<string, AuditReading> = {};

  const opps = row.opportunities;
  if (Array.isArray(opps)) {
    for (const raw of opps as PersistedOpportunity[]) {
      if (!raw || typeof raw !== "object") continue;
      const auditKey = typeof raw.auditKey === "string" ? raw.auditKey : null;
      if (!auditKey) continue;
      const score =
        typeof raw.score === "number"
          ? raw.score
          : raw.score === null
            ? null
            : null;
      const failingNodes =
        typeof raw.itemCount === "number" && raw.itemCount > 0
          ? raw.itemCount
          : undefined;
      map[auditKey] = { score, ...(failingNodes ? { failingNodes } : {}) };
    }
  }

  // A LighthouseAudit row exists but the opportunities blob was never extracted
  // AND no per-audit columns help → still return an (empty) map, NOT null. The
  // row's existence means "Lighthouse ran"; detectors then find no failures and
  // return null ("no finding"), which is correct — distinct from "not checked".
  return map;
}

/**
 * Load all the DB rows for one business and assemble them into the inert
 * {@link EvidenceBundle} the pure detectors consume.
 *
 * Returns a bundle even when most enrichments are absent — absent enrichments
 * are represented by `null` (tech / lighthouseAudits) so the driver can mark
 * the corresponding signals "not checked" rather than "clean".
 *
 * @throws if the business id does not resolve (caller decides how to handle).
 */
export async function hydrateEvidenceBundle(
  businessId: string,
): Promise<EvidenceBundle> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      slug: true,
      category: true,
      categories: true,
      categoryIds: true,
      website: true,
      services: {
        where: { isActive: true },
        select: { name: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });

  if (!business) {
    throw new Error(`[hydrate] business not found: ${businessId}`);
  }

  // Category slugs: primary `category` + additional `categories` + the DfS
  // `categoryIds` slugs, all lowercased + de-duped. Detectors match these
  // against their own lowercased category sets.
  const categorySlugs = Array.from(
    new Set(
      [business.category, ...business.categories, ...business.categoryIds]
        .filter((c): c is string => typeof c === "string" && c.length > 0)
        .map((c) => c.toLowerCase().trim()),
    ),
  );

  // Tech fingerprint. null = never scanned (so the privacy/HIPAA detector marks
  // "not checked"); an empty array means scanned-but-empty.
  const techRows = await prisma.businessTech.findMany({
    where: { businessId },
    select: { name: true, category: true },
  });
  const tech: { name: string; category: string }[] | null =
    techRows.length === 0
      ? null
      : techRows.map((t) => ({
          name: t.name,
          // BusinessTechCategory is an enum (e.g. BOOKING, PIXEL); detectors
          // match lowercased substrings ("booking"), so lowercase it here.
          category: String(t.category).toLowerCase(),
        }));

  // Latest Lighthouse audit → audits map (null when no audit row exists).
  const lhRow = await prisma.lighthouseAudit.findFirst({
    where: { businessId },
    orderBy: { auditedAt: "desc" },
    select: { opportunities: true, accessibility: true },
  });
  const lighthouseAudits = lhRow ? buildAuditsMap(lhRow) : null;

  // Recent reviews — always an array (may be empty).
  const reviewRows = await prisma.review.findMany({
    where: { businessId },
    orderBy: { postedAt: "desc" },
    take: REVIEW_DEPTH,
    select: { text: true, stars: true, postedAt: true },
  });
  const reviews = reviewRows.map((r) => ({
    text: r.text ?? "",
    stars: r.stars,
    postedAt: r.postedAt,
  }));

  return {
    business: {
      id: business.id,
      slug: business.slug,
      categorySlugs,
      website: business.website,
      services: business.services.map((s) => ({ name: s.name })),
    },
    tech,
    lighthouseAudits,
    reviews,
  };
}
