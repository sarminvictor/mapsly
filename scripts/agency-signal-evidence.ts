// scripts/agency-signal-evidence.ts
//
// SIGNAL-BASED evidence for the agency outreach (Viktor 2026-07-22: "use our
// computed Signals, not just pulled raw — trends, unanswered, SEO points,
// booking tools"). Evaluates the PRODUCT'S OWN signal engine
// (hydrateBusinessForSignals + resolveMatches over SIG_META defaults) on each
// market's tier-1 set, so every emailed claim is the same verdict the
// recipient will see in the linked Proof Pack / workbench.
//
// CLI: pnpm tsx scripts/agency-signal-evidence.ts   (prints per-market table)
// Import: computeMarketSignalEvidence(category, city) → counts + proof rows.

import { config } from "dotenv";
config({ path: ".env.local" });

import prisma from "@/lib/prisma";
import { cellMembershipWhere } from "@/modules/business-discovery/cell-membership";
import { passesBizIndexGate } from "@/modules/biz-profile/seo-gate";
import {
  hydrateBusinessForSignals,
  resolveMatches,
} from "@/modules/agency-portal/discover/signal-eval";
import { toActiveSignals } from "@/modules/agency-portal/discover/discovery-signals";

/** The signal set evidence draws from — targeted, computable, agency-legible. */
export const EVIDENCE_SIGNAL_KEYS = [
  // reputation
  "low_reply_rate",
  "unanswered_1star",
  "reviews_slowing",
  "stale_reviews",
  "reputation_slipping",
  // website / speed / seo
  "slow_site",
  "weak_seo",
  "overdue_redesign",
  "no_booking",
  // search
  "not_in_local_pack",
  "invisible_locally",
  // ads / tracking
  "not_advertising",
  "competitors_advertising",
  "no_analytics",
  "no_tracking_pixel",
  "flying_blind",
] as const;

export interface MarketSignalEvidence {
  category: string;
  city: string;
  total: number;
  /** signal key → businesses where it FIRED (within tier-1 scored set). */
  fired: Record<string, number>;
  /** signal key → businesses where it was computable (non-null verdict). */
  applicable: Record<string, number>;
}

export async function computeMarketSignalEvidence(
  category: string,
  city: string,
): Promise<MarketSignalEvidence | null> {
  const loc = await prisma.trackedLocation.findFirst({
    where: { city, country: "US", category: { dataforseoId: category } },
    select: { lat: true, lng: true, radiusKm: true },
  });
  if (!loc) return null;
  const where = cellMembershipWhere({
    dataforseoCategoryId: category,
    lat: loc.lat,
    lng: loc.lng,
    radiusKm: loc.radiusKm,
    city,
    country: "US",
  });
  const rows = await prisma.business.findMany({
    where: { ...where, isActive: true },
    select: {
      id: true,
      website: true,
      reviewCount: true,
      isHidden: true,
      permanentlyClosed: true,
      suppressedAt: true,
      snapshots: {
        take: 1,
        orderBy: { snapshotDate: "desc" },
        select: { mapslyScore: true, pillarScore: true },
      },
    },
    take: 500,
  });
  const tier1Ids = rows
    .filter((r) =>
      passesBizIndexGate({
        website: r.website,
        reviewCount: r.reviewCount,
        isHidden: r.isHidden,
        permanentlyClosed: r.permanentlyClosed,
        suppressedAt: r.suppressedAt,
        mapslyScore: r.snapshots[0]?.mapslyScore ?? null,
        pillarScore: r.snapshots[0]?.pillarScore ?? null,
      }),
    )
    .map((r) => r.id);
  if (tier1Ids.length === 0) return null;

  const active = toActiveSignals(EVIDENCE_SIGNAL_KEYS.map((key) => ({ key })));
  const hydrated = await hydrateBusinessForSignals(tier1Ids);
  const fired: Record<string, number> = {};
  const applicable: Record<string, number> = {};
  const now = new Date();
  for (const id of tier1Ids) {
    const biz = hydrated.get(id);
    if (!biz) continue;
    const res = resolveMatches(active, biz, now);
    for (const [key, verdict] of Object.entries(res.perSignal)) {
      if (verdict === null) continue;
      applicable[key] = (applicable[key] ?? 0) + 1;
      if (verdict) fired[key] = (fired[key] ?? 0) + 1;
    }
  }
  return { category, city, total: tier1Ids.length, fired, applicable };
}

/** Per-business fired-signal verdicts (for proof lines). */
export async function firedSignalsForBusinesses(
  ids: string[],
): Promise<Map<string, string[]>> {
  const active = toActiveSignals(EVIDENCE_SIGNAL_KEYS.map((key) => ({ key })));
  const hydrated = await hydrateBusinessForSignals(ids);
  const out = new Map<string, string[]>();
  const now = new Date();
  for (const id of ids) {
    const biz = hydrated.get(id);
    if (!biz) continue;
    const res = resolveMatches(active, biz, now);
    out.set(
      id,
      Object.entries(res.perSignal)
        .filter(([, v]) => v === true)
        .map(([k]) => k),
    );
  }
  return out;
}

const MARKETS: [string, string][] = [
  ["medical_spa", "Scottsdale"],
  ["medical_spa", "Boise"],
  ["medical_spa", "Miami"],
  ["dentist", "Austin"],
  ["dentist", "Frisco"],
];

async function cli() {
  for (const [cat, city] of MARKETS) {
    const ev = await computeMarketSignalEvidence(cat, city);
    if (!ev) {
      console.log(`\n## ${city}/${cat}: not ready`);
      continue;
    }
    console.log(`\n## ${city}/${cat} · tier-1 n=${ev.total}`);
    const keys = Object.keys(ev.applicable).sort(
      (a, b) => (ev.fired[b] ?? 0) - (ev.fired[a] ?? 0),
    );
    for (const k of keys) {
      console.log(
        `  ${k.padEnd(24)} fired ${String(ev.fired[k] ?? 0).padStart(3)} / ${String(ev.applicable[k]).padStart(3)} computable`,
      );
    }
  }
  // proof businesses
  const slugs = [
    "craftmd-aesthetics-wellness",
    "beautify-spa",
    "spa-35-med-spa",
    "dermatology-clinic-of-idaho-boise",
    "dermaclinic-miami-llc",
    "spectrum-aesthetics",
    "austin-emergency-dental",
    "tru-dentistry-austin",
    "celina-family-dentistry",
    "frisco-smiles-dentistry",
  ];
  const biz = await prisma.business.findMany({
    where: { slug: { in: slugs } },
    select: { id: true, slug: true },
  });
  const firedMap = await firedSignalsForBusinesses(biz.map((b) => b.id));
  console.log("\n## proof businesses · fired signals");
  for (const b of biz) {
    console.log(`  ${b.slug}: ${(firedMap.get(b.id) ?? []).join(", ") || "—"}`);
  }
}

if (process.argv[1]?.endsWith("agency-signal-evidence.ts")) {
  cli()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(`FATAL: ${String(e).slice(0, 500)}`);
      process.exit(1);
    });
}
