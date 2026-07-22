// scripts/cell-quality-audit.ts
//
// Phase-1 Stage A quality audit · per seeded cell, measure DATA QUALITY —
// not just row counts: signal coverage per research family, score presence,
// evidence-number sanity, and 3 sample rows to eyeball. Read-only.
//
// Usage: pnpm tsx scripts/cell-quality-audit.ts

import { config } from "dotenv";
config({ path: ".env.local" });

import prisma from "@/lib/prisma";
import { cellMembershipWhere } from "@/modules/business-discovery/cell-membership";
import { passesBizIndexGate } from "@/modules/biz-profile/seo-gate";

const CELLS = [
  {
    label: "Scottsdale × med spa",
    category: "medical_spa",
    city: "Scottsdale",
  },
  { label: "Boise × med spa", category: "medical_spa", city: "Boise" },
  { label: "Miami × med spa", category: "medical_spa", city: "Miami" },
  { label: "Austin × dental", category: "dentist", city: "Austin" },
  { label: "Frisco × dental", category: "dentist", city: "Frisco" },
  { label: "Tampa × dental", category: "dentist", city: "Tampa" },
];

const pct = (n: number, d: number) =>
  d === 0 ? "0%" : `${Math.round((100 * n) / d)}%`;

async function auditCell(c: { label: string; category: string; city: string }) {
  const loc = await prisma.trackedLocation.findFirst({
    where: {
      city: c.city,
      country: "US",
      category: { dataforseoId: c.category },
    },
    select: { lat: true, lng: true, radiusKm: true, totalCostUsd: true },
  });
  if (!loc) {
    console.log(`\n■ ${c.label}: NO TrackedLocation — not seeded`);
    return null;
  }
  const where = cellMembershipWhere({
    dataforseoCategoryId: c.category,
    lat: loc.lat,
    lng: loc.lng,
    radiusKm: loc.radiusKm,
    city: c.city,
    country: "US",
  });
  const rows = await prisma.business.findMany({
    where: { ...where, isActive: true },
    select: {
      id: true,
      name: true,
      slug: true,
      website: true,
      email: true,
      emailDiscovered: true,
      phone: true,
      rating: true,
      reviewCount: true,
      qualificationStatus: true,
      isHidden: true,
      permanentlyClosed: true,
      suppressedAt: true,
      snapshots: {
        take: 1,
        orderBy: { snapshotDate: "desc" },
        select: {
          replyRate: true,
          mapslyScore: true,
          pillarScore: true,
          snapshotDate: true,
        },
      },
      lighthouseAudits: {
        take: 1,
        orderBy: { auditedAt: "desc" },
        select: { lcp: true, performance: true },
      },
      _count: { select: { reviews: true, businessKeywords: true } },
    },
    take: 500,
  });
  const n = rows.length;
  // Contact is a soft ref (no back-relation) — count per cell in one query.
  const contactBiz = await prisma.contact.groupBy({
    by: ["businessId"],
    where: { businessId: { in: rows.map((r) => r.id) } },
  });
  const q = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;

  const qualified = q((r) => r.qualificationStatus === "QUALIFIED");
  const withSite = q((r) => !!r.website);
  const withReviewRows = q((r) => r._count.reviews > 0);
  const withReplyRate = q((r) => r.snapshots[0]?.replyRate != null);
  const withLh = q((r) => r.lighthouseAudits[0]?.lcp != null);
  const withKw = q((r) => r._count.businessKeywords > 0);
  const withContacts = q((r) => !!r.emailDiscovered) || contactBiz.length;
  const scored = q((r) => {
    const s = r.snapshots[0];
    return !!s && (s.mapslyScore != null || s.pillarScore != null);
  });
  const tier1 = q((r) => {
    const s = r.snapshots[0];
    return passesBizIndexGate({
      website: r.website,
      reviewCount: r.reviewCount,
      isHidden: r.isHidden,
      permanentlyClosed: r.permanentlyClosed,
      suppressedAt: r.suppressedAt,
      mapslyScore: s?.mapslyScore ?? null,
      pillarScore: s?.pillarScore ?? null,
    });
  });
  const lowReply = rows.filter((r) => {
    const s = r.snapshots[0];
    return (
      s &&
      (s.mapslyScore != null || s.pillarScore != null) &&
      s.replyRate != null &&
      s.replyRate <= 0.1 &&
      (r.reviewCount ?? 0) >= 5
    );
  }).length;
  const slow = rows.filter(
    (r) => (r.lighthouseAudits[0]?.lcp ?? 0) >= 4,
  ).length; // lcp stored in SECONDS (schema)

  console.log(
    `\n■ ${c.label} · ${n} businesses · lifetime cost $${(loc.totalCostUsd ?? 0).toFixed(2)}`,
  );
  console.log(
    `  qualified ${qualified} (${pct(qualified, n)}) · scored ${scored} (${pct(scored, n)}) · tier-1 ${tier1}`,
  );
  console.log(
    `  coverage: website ${pct(withSite, n)} · reviews-pulled ${pct(withReviewRows, n)} · replyRate ${pct(withReplyRate, n)} · lighthouse ${pct(withLh, n)} · keywords ${pct(withKw, n)} · contacts ${pct(withContacts, n)}`,
  );
  console.log(
    `  evidence: "Of ${scored} scored: ${lowReply} barely answer reviews, ${slow} slow sites"`,
  );
  const samples = rows
    .filter(
      (r) =>
        r.snapshots[0]?.mapslyScore != null ||
        r.snapshots[0]?.pillarScore != null,
    )
    .slice(0, 3);
  for (const s of samples) {
    const sn = s.snapshots[0]!;
    console.log(
      `  · ${s.name} — score ${(sn.mapslyScore ?? sn.pillarScore)?.toFixed(1)} · ${s.reviewCount ?? 0} reviews · replyRate ${sn.replyRate == null ? "—" : (sn.replyRate * 100).toFixed(0) + "%"} · lcp ${s.lighthouseAudits[0]?.lcp ?? "—"}s · /biz/${s.slug}`,
    );
  }
  return { label: c.label, n, qualified, scored, tier1, lowReply, slow };
}

async function main() {
  const out = [];
  for (const c of CELLS) {
    const r = await auditCell(c);
    if (r) out.push(r);
  }
  console.log(`\nSUMMARY ${JSON.stringify(out)}`);
  const dentalReady = out.filter(
    (o) => o.label.includes("dental") && o.scored >= 12,
  );
  const medspaReady = out.filter(
    (o) => o.label.includes("med spa") && o.scored >= 20,
  );
  console.log(
    `demo-ready: medspa ${medspaReady.length}/3 · dental ${dentalReady.length}/3 (dental bar 12 scored, medspa 20)`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(String(e).slice(0, 500));
    process.exit(1);
  });
