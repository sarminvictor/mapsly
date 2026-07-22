// scripts/agency-proof-packs.ts
//
// Phase-1 Stage C · mint PUBLIC Proof Pack share links (/s/[token]) for the
// cold-outreach proof businesses, under an internal "Mapsly Research" agency.
//
// Why: the outreach email must SHOW product value, not promise a "report".
// The /s/ page is the exact agency-branded audit an agency would send its own
// prospects — live, no-login, view-tracked. We mint 2 per market and put the
// links in touch 2.
//
// What it does (idempotent):
//   1. Upsert internal User + Agency "Mapsly Research" (comped: stripeStatus
//      'active', plan GROWTH — unlocks nothing publicly; scope only).
//   2. Upsert one Discovery holding ALL seeded market cellKeys (scope gate for
//      getLeadDetail).
//   3. Grant cell-level AgencyEntitlements for every EnrichmentFamily on those
//      cells (un-gates data VALUES on the public pack — data we already own).
//   4. createShareLink() per proof business → prints www URLs.
//
// Usage: pnpm tsx scripts/agency-proof-packs.ts

import { config } from "dotenv";
config({ path: ".env.local" });

import prisma from "@/lib/prisma";
import { createShareLink } from "@/modules/reports/share";

const INTERNAL_EMAIL = "research@mapsly.xyz";
const AGENCY_NAME = "Mapsly Research";
const AGENCY_SLUG = "mapsly-research";

/** slug → market label (for operator eyes only). Picks require RICH data —
 *  review rows + lighthouse (or 20+ review rows) + a visible weakness — so the
 *  public pack renders full sections, not empty states. */
const PROOF_SLUGS: Record<string, string> = {
  // Scottsdale med spa
  "craftmd-aesthetics-wellness": "Scottsdale", // 274 rev · 5% reply · 15.3s LCP
  "beautify-spa": "Scottsdale", // 377 rev · 30% reply · 7.8s LCP
  // Boise med spa
  "spa-35-med-spa": "Boise", // 729 rev · 40% reply · 21.2s LCP · perf 29
  "dermatology-clinic-of-idaho-boise": "Boise", // 1667 rev · 11.8s LCP
  // Miami med spa
  "dermaclinic-miami-llc": "Miami", // 1054 rev · 30.5s LCP
  "spectrum-aesthetics": "Miami", // 3494 rev · 5.5s LCP · perf 38
  // Austin dental
  "austin-emergency-dental": "Austin", // 756 rev (500 rows) · 18.7s LCP
  "tru-dentistry-austin": "Austin", // 494 rev · 18.0s LCP
  // Frisco dental
  "celina-family-dentistry": "Frisco", // 650 rev (109 rows) · 11% reply
  "frisco-smiles-dentistry": "Frisco", // 387 rev · 0% reply
};

/** Signals the internal discovery carries — makes the pack's "why this lead
 *  qualifies" section show real fired verdicts instead of the raw fallback. */
const PROOF_SIGNALS = {
  goalName: "Reputation + web + search + ads openings",
  signals: [
    { key: "low_reply_rate" },
    { key: "unanswered_1star" },
    { key: "reviews_slowing" },
    { key: "reputation_slipping" },
    { key: "stale_reviews" },
    { key: "slow_site" },
    { key: "no_booking" },
    { key: "not_in_local_pack" },
    { key: "not_advertising" },
    { key: "no_tracking_pixel" },
    { key: "flying_blind" },
  ],
};

const FAMILIES = [
  "CONTACTS",
  "SERVICES",
  "TECH",
  "REVIEWS",
  "META_ADS",
  "GOOGLE_ADS",
  "SERP",
  "LIGHTHOUSE",
  "AI_RESEARCH",
  "PLAYBOOK",
] as const;

async function main() {
  // 1 · internal user + agency
  const user = await prisma.user.upsert({
    where: { email: INTERNAL_EMAIL },
    update: {},
    create: { email: INTERNAL_EMAIL, name: "Mapsly Research" },
    select: { id: true },
  });
  let agency = await prisma.agency.findFirst({
    where: { slug: AGENCY_SLUG },
    select: { id: true },
  });
  if (!agency) {
    agency = await prisma.agency.create({
      data: {
        name: AGENCY_NAME,
        slug: AGENCY_SLUG,
        plan: "GROWTH",
        stripeStatus: "active",
        members: { create: { userId: user.id, role: "OWNER" } },
      },
      select: { id: true },
    });
    await prisma.agencyWallet.create({
      data: {
        agencyId: agency.id,
        planCredits: 0,
        purchasedCredits: 0,
        cycleResetAt: new Date(),
      },
    });
  }
  console.log(`[proof] agency ${AGENCY_NAME} = ${agency.id}`);

  // 2 · resolve proof businesses + their cellKeys
  const businesses = await prisma.business.findMany({
    where: { slug: { in: Object.keys(PROOF_SLUGS) } },
    select: { id: true, slug: true, name: true, cellKey: true },
  });
  const missing = Object.keys(PROOF_SLUGS).filter(
    (s) => !businesses.some((b) => b.slug === s),
  );
  if (missing.length)
    console.warn(`[proof] MISSING slugs: ${missing.join(", ")}`);
  const cellKeys = Array.from(
    new Set(businesses.map((b) => b.cellKey).filter((k): k is string => !!k)),
  );

  // 3 · scope Discovery (one, covering all proof cells)
  const idem = "internal-proof-packs-v1";
  let disco = await prisma.discovery.findUnique({
    where: { idempotencyKey: idem },
    select: { id: true, cellKeys: true },
  });
  if (!disco) {
    disco = await prisma.discovery.create({
      data: {
        agencyId: agency.id,
        requestedByUserId: user.id,
        name: "Proof pack source (internal)",
        idempotencyKey: idem,
        status: "READY",
        cellKeys,
        cellCount: cellKeys.length,
        signalsJson: PROOF_SIGNALS,
      },
      select: { id: true, cellKeys: true },
    });
  } else {
    const merged = Array.from(new Set([...disco.cellKeys, ...cellKeys]));
    await prisma.discovery.update({
      where: { id: disco.id },
      data: {
        cellKeys: merged,
        cellCount: merged.length,
        signalsJson: PROOF_SIGNALS,
      },
    });
  }
  console.log(`[proof] discovery ${disco.id} · cells ${cellKeys.length}`);

  // 4 · entitlements for every family — BOTH scopes. Cell-level covers the
  // cell-scoped families (meta_ads/serp); business-scoped families (reviews,
  // lighthouse, tech, contacts…) are checked at BUSINESS level by
  // loadEntitlements, so cell rows alone leave pack values gated when
  // ENTITLEMENT_BILLING=1. (skipDuplicates = idempotent.)
  await prisma.agencyEntitlement.createMany({
    data: cellKeys.flatMap((cellKey) =>
      FAMILIES.map((family) => ({ agencyId: agency!.id, cellKey, family })),
    ),
    skipDuplicates: true,
  });
  await prisma.agencyEntitlement.createMany({
    data: businesses.flatMap((b) =>
      FAMILIES.map((family) => ({
        agencyId: agency!.id,
        businessId: b.id,
        family,
      })),
    ),
    skipDuplicates: true,
  });

  // 5 · honest EnrichmentJob bookkeeping: the seed pipeline DID run these
  // researches (reviews/lighthouse/tech/serp/contacts…) but wrote data via
  // direct collectors, so no job rows exist and the coverage roll-up reads
  // not_run → the pack renders empty. Record a SKIPPED_FRESH job per
  // (business, family) ONLY where real data rows exist — same presence
  // semantics as scanTypePresence (coverage-matrix.ts).
  const bizIds = businesses.map((b) => b.id);
  const [reviews, audits, techs, contacts, services, ai, serps] =
    await Promise.all([
      prisma.review.findMany({
        where: { businessId: { in: bizIds } },
        select: { businessId: true },
        distinct: ["businessId"],
      }),
      prisma.lighthouseAudit.findMany({
        where: { businessId: { in: bizIds } },
        select: { businessId: true },
        distinct: ["businessId"],
      }),
      prisma.businessTech.findMany({
        where: { businessId: { in: bizIds } },
        select: { businessId: true },
        distinct: ["businessId"],
      }),
      prisma.contact.findMany({
        where: { businessId: { in: bizIds } },
        select: { businessId: true },
        distinct: ["businessId"],
      }),
      prisma.businessService.findMany({
        where: { businessId: { in: bizIds } },
        select: { businessId: true },
        distinct: ["businessId"],
      }),
      prisma.businessEnrichment.findMany({
        where: { businessId: { in: bizIds } },
        select: { businessId: true },
        distinct: ["businessId"],
      }),
      prisma.serpResult.findMany({
        where: { businessId: { in: bizIds } },
        select: { businessId: true },
        distinct: ["businessId"],
      }),
    ]);
  const presence: Array<[Set<string>, (typeof FAMILIES)[number]]> = [
    [new Set(reviews.map((r) => r.businessId)), "REVIEWS"],
    [new Set(audits.map((r) => r.businessId)), "LIGHTHOUSE"],
    [new Set(techs.map((r) => r.businessId)), "TECH"],
    [new Set(contacts.map((r) => r.businessId)), "CONTACTS"],
    [new Set(services.map((r) => r.businessId)), "SERVICES"],
    [new Set(ai.map((r) => r.businessId)), "AI_RESEARCH"],
    [
      new Set(
        serps.map((r) => r.businessId).filter((id): id is string => id != null),
      ),
      "SERP",
    ],
  ];
  const jobRows: {
    businessId: string;
    family: (typeof FAMILIES)[number];
  }[] = [];
  for (const [set, family] of presence) {
    for (const id of bizIds)
      if (set.has(id)) jobRows.push({ businessId: id, family });
  }
  const existingJobs = await prisma.enrichmentJob.findMany({
    where: {
      businessId: { in: bizIds },
      status: {
        in: ["DONE", "SKIPPED_FRESH", "CHARGED_FROM_DB", "SKIPPED_ENTITLED"],
      },
    },
    select: { businessId: true, family: true },
  });
  const have = new Set(existingJobs.map((j) => `${j.businessId}:${j.family}`));
  const toCreate = jobRows.filter(
    (j) => !have.has(`${j.businessId}:${j.family}`),
  );
  if (toCreate.length) {
    await prisma.enrichmentJob.createMany({
      data: toCreate.map((j) => ({
        businessId: j.businessId,
        family: j.family,
        status: "SKIPPED_FRESH" as const,
        costUsd: 0,
        finishedAt: new Date(),
      })),
    });
  }
  console.log(
    `[proof] job bookkeeping: +${toCreate.length} SKIPPED_FRESH rows`,
  );

  // 6 · mint share links
  const out: Record<string, string> = {};
  for (const b of businesses) {
    const link = await createShareLink(agency.id, b.id, disco.id);
    out[b.slug] = `https://www.mapsly.ai${link.path}`;
    console.log(
      `[proof] ${PROOF_SLUGS[b.slug]} · ${b.name} → https://www.mapsly.ai${link.path}`,
    );
  }
  console.log(`\nPROOF_URLS ${JSON.stringify(out)}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
