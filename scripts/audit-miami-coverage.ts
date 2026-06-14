// scripts/audit-miami-coverage.ts — READ-ONLY data-coverage audit of every
// qualified + active Miami business (the Medical Spa Miami discovery). Reports
// which data exists vs missing/failed per dimension, grouped by issue.
//
// Run: pnpm tsx scripts/audit-miami-coverage.ts
import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaClient } from "../lib/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString: process.env.DATABASE_URL! }),
});

const MIAMI_CELL = "Medical Spa|Miami|US";
const TWELVE_MO = new Date(Date.now() - 365 * 24 * 3600 * 1000);

type Row = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  province: string | null;
  website: string | null;
  domain: string | null;
  email: string | null;
  emailVerifiedAt: Date | null;
  reviewCount: number | null;
  flags: string[];
  reviewsFirstPulledAt: Date | null;
  pendingReviewsTaskId: string | null;
  cellKey: string | null;
  signals: boolean;
  pillarScore: number | null;
  visibility: number | null;
  reputation: number | null;
  website_p: number | null;
  profile_p: number | null;
  ads_p: number | null;
  reviewsDb: number;
  reviews12: number;
  kwTotal: number;
  kwRanked: number;
  googleAds: number;
  metaOwn: number;
  lhExists: boolean;
  lhScored: boolean;
  landingActive: boolean;
};

async function main() {
  // ── Universe · qualified + active, in the Miami discovery (province FL OR
  //    latest snapshot in the Miami cell). Belt-and-suspenders so snapshot-less
  //    rows are still caught.
  const businesses = await prisma.business.findMany({
    where: {
      qualificationStatus: "QUALIFIED",
      isActive: true,
      OR: [
        { province: "FL" },
        { snapshots: { some: { cellKey: MIAMI_CELL } } },
      ],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      city: true,
      province: true,
      website: true,
      domain: true,
      email: true,
      emailVerifiedAt: true,
      reviewCount: true,
      qualificationFlags: true,
      reviewsFirstPulledAt: true,
      pendingReviewsTaskId: true,
      snapshots: {
        orderBy: { snapshotDate: "desc" },
        take: 1,
        select: {
          cellKey: true,
          signalsJson: true,
          pillarScore: true,
          visibilityPillar: true,
          reputationPillar: true,
          websitePillar: true,
          profilePillar: true,
          adsPillar: true,
        },
      },
    },
  });

  const ids = businesses.map((b) => b.id);
  console.log(`universe: ${ids.length} qualified+active Miami businesses`);

  // ── Bulk dimension fetches (groupBy · no N+1) ────────────────────────────
  const cnt = (
    rows: Array<{ businessId: string | null; _count: { _all: number } }>,
  ) => {
    const m = new Map<string, number>();
    for (const r of rows) if (r.businessId) m.set(r.businessId, r._count._all);
    return m;
  };

  const [revAll, rev12, kwAll, kwRanked, gAds, metaRows, lhRows, landingRows] =
    await Promise.all([
      prisma.review.groupBy({
        by: ["businessId"],
        where: { businessId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.review.groupBy({
        by: ["businessId"],
        where: { businessId: { in: ids }, postedAt: { gte: TWELVE_MO } },
        _count: { _all: true },
      }),
      prisma.businessKeyword.groupBy({
        by: ["businessId"],
        where: { businessId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.businessKeyword.groupBy({
        by: ["businessId"],
        where: {
          businessId: { in: ids },
          OR: [
            { latestOrganicRank: { not: null } },
            { latestMapsRank: { not: null } },
          ],
        },
        _count: { _all: true },
      }),
      prisma.adLibraryEntry.groupBy({
        by: ["businessId"],
        where: { businessId: { in: ids }, platform: "GOOGLE" },
        _count: { _all: true },
      }),
      prisma.adMarketAdvertiser.findMany({
        where: { matchedBusinessId: { in: ids }, isActive: true },
        select: { matchedBusinessId: true },
      }),
      prisma.lighthouseAudit.findMany({
        where: { businessId: { in: ids } },
        select: { businessId: true, performance: true, auditedAt: true },
        orderBy: { auditedAt: "desc" },
      }),
      prisma.landingPage.findMany({
        where: { businessId: { in: ids } },
        select: { businessId: true, isActive: true },
      }),
    ]);

  const mRevAll = cnt(revAll);
  const mRev12 = cnt(rev12);
  const mKwAll = cnt(kwAll);
  const mKwRanked = cnt(kwRanked);
  const mGAds = cnt(gAds);
  const mMeta = new Map<string, number>();
  for (const r of metaRows)
    if (r.matchedBusinessId)
      mMeta.set(r.matchedBusinessId, (mMeta.get(r.matchedBusinessId) ?? 0) + 1);
  // latest LH per business + whether it has a real score
  const lhLatest = new Map<string, boolean>();
  for (const r of lhRows)
    if (!lhLatest.has(r.businessId))
      lhLatest.set(r.businessId, r.performance != null);
  const landing = new Map<string, boolean>();
  for (const r of landingRows) landing.set(r.businessId, r.isActive);

  const rows: Row[] = businesses.map((b) => {
    const s = b.snapshots[0];
    return {
      id: b.id,
      name: b.name,
      slug: b.slug,
      city: b.city,
      province: b.province,
      website: b.website,
      domain: b.domain,
      email: b.email,
      emailVerifiedAt: b.emailVerifiedAt,
      reviewCount: b.reviewCount,
      flags: b.qualificationFlags ?? [],
      reviewsFirstPulledAt: b.reviewsFirstPulledAt,
      pendingReviewsTaskId: b.pendingReviewsTaskId,
      cellKey: s?.cellKey ?? null,
      signals: s?.signalsJson != null,
      pillarScore: s?.pillarScore ?? null,
      visibility: s?.visibilityPillar ?? null,
      reputation: s?.reputationPillar ?? null,
      website_p: s?.websitePillar ?? null,
      profile_p: s?.profilePillar ?? null,
      ads_p: s?.adsPillar ?? null,
      reviewsDb: mRevAll.get(b.id) ?? 0,
      reviews12: mRev12.get(b.id) ?? 0,
      kwTotal: mKwAll.get(b.id) ?? 0,
      kwRanked: mKwRanked.get(b.id) ?? 0,
      googleAds: mGAds.get(b.id) ?? 0,
      metaOwn: mMeta.get(b.id) ?? 0,
      lhExists: lhLatest.has(b.id),
      lhScored: lhLatest.get(b.id) === true,
      landingActive: landing.get(b.id) === true,
    };
  });

  const N = rows.length;
  const has = (p: (r: Row) => boolean) => rows.filter(p);
  const pct = (n: number) => `${((n / N) * 100).toFixed(0)}%`;
  const line = (label: string, n: number) =>
    console.log(`${String(n).padStart(4)} (${pct(n).padStart(4)})  ${label}`);

  console.log(
    "\n================ DATA COVERAGE — Miami qualified ================",
  );
  console.log(`Total universe: ${N}\n`);

  console.log("---- SCORING / SNAPSHOT ----");
  line(
    "no snapshot at all (never scored)",
    has((r) => r.cellKey === null && !r.signals).length,
  );
  line(
    "snapshot but signalsJson NULL",
    has((r) => r.cellKey !== null && !r.signals).length,
  );
  line(
    "not in Miami cell (cellKey != Medical Spa|Miami|US)",
    has((r) => r.cellKey !== null && r.cellKey !== MIAMI_CELL).length,
  );
  line(
    "pillarScore NULL (not scored)",
    has((r) => r.pillarScore === null).length,
  );

  console.log("\n---- REVIEWS ----");
  line(
    "reviewCount>0 on Google but 0 IN DB",
    has((r) => (r.reviewCount ?? 0) > 0 && r.reviewsDb === 0).length,
  );
  line(
    "  ↳ never pulled (reviewsFirstPulledAt null)",
    has(
      (r) =>
        (r.reviewCount ?? 0) > 0 &&
        r.reviewsDb === 0 &&
        r.reviewsFirstPulledAt === null,
    ).length,
  );
  line(
    "  ↳ pulled but 0 stored (all >12mo / empty)",
    has(
      (r) =>
        (r.reviewCount ?? 0) > 0 &&
        r.reviewsDb === 0 &&
        r.reviewsFirstPulledAt !== null,
    ).length,
  );
  line(
    "review pull STUCK in-flight (pendingReviewsTaskId set)",
    has((r) => r.pendingReviewsTaskId !== null).length,
  );
  line(
    "0 reviews in last 12mo (window empty)",
    has((r) => r.reviews12 === 0).length,
  );
  line("some reviews IN DB (>0)", has((r) => r.reviewsDb > 0).length);

  console.log("\n---- WEBSITE / LIGHTHOUSE ----");
  line("no website on record", has((r) => !r.website).length);
  line(
    "flag: website_unreachable",
    has((r) => r.flags.includes("website_unreachable")).length,
  );
  line("no Lighthouse audit row at all", has((r) => !r.lhExists).length);
  line(
    "  ↳ has website but NO audit (failed/never run)",
    has((r) => !!r.website && !r.lhExists).length,
  );
  line(
    "audit row exists but performance NULL (errored)",
    has((r) => r.lhExists && !r.lhScored).length,
  );
  line(
    "Lighthouse scored OK (performance present)",
    has((r) => r.lhScored).length,
  );

  console.log("\n---- SEARCH / SERP ----");
  line("0 tracked keywords at all", has((r) => r.kwTotal === 0).length);
  line(
    "keywords seeded but NONE ranked (no SERP scan landed)",
    has((r) => r.kwTotal > 0 && r.kwRanked === 0).length,
  );
  line(
    "has ranked keywords (SERP data present)",
    has((r) => r.kwRanked > 0).length,
  );

  console.log("\n---- ADS ----");
  line(
    "0 Google ads in DB (AdLibraryEntry GOOGLE)",
    has((r) => r.googleAds === 0).length,
  );
  line(
    "  ↳ no website (can't scan Google ads by domain)",
    has((r) => r.googleAds === 0 && !r.website).length,
  );
  line("has Google ads in DB", has((r) => r.googleAds > 0).length);
  line(
    "matched as an active Meta advertiser (own Meta ads)",
    has((r) => r.metaOwn > 0).length,
  );

  console.log("\n---- CONTACT / FUNNEL ----");
  line("no email", has((r) => !r.email).length);
  line(
    "email present but NOT verified",
    has((r) => !!r.email && r.emailVerifiedAt === null).length,
  );
  line(
    "flag: email_undeliverable",
    has((r) => r.flags.includes("email_undeliverable")).length,
  );
  line("no active landing page", has((r) => !r.landingActive).length);

  // Per-business detail → file for drill-down.
  const fs = await import("node:fs");
  fs.writeFileSync("/tmp/miami-coverage.json", JSON.stringify(rows, null, 2));
  console.log("\nper-business detail → /tmp/miami-coverage.json");

  // Sample lists for the worst gaps (names) so the report can name them.
  const sample = (p: (r: Row) => boolean, n = 12) =>
    has(p)
      .slice(0, n)
      .map((r) => r.name)
      .join(" · ");
  console.log("\n---- SAMPLES ----");
  console.log(
    "reviews 0 in DB:",
    sample((r) => (r.reviewCount ?? 0) > 0 && r.reviewsDb === 0),
  );
  console.log(
    "no lighthouse (has site):",
    sample((r) => !!r.website && !r.lhExists),
  );
  console.log(
    "no ranked kw:",
    sample((r) => r.kwTotal > 0 && r.kwRanked === 0),
  );
  console.log(
    "province breakdown:",
    JSON.stringify(
      Object.fromEntries(
        Object.entries(
          rows.reduce(
            (a, r) => {
              const k = r.province ?? "null";
              a[k] = (a[k] ?? 0) + 1;
              return a;
            },
            {} as Record<string, number>,
          ),
        ),
      ),
    ),
  );
  console.log(
    "cellKey breakdown:",
    JSON.stringify(
      Object.fromEntries(
        Object.entries(
          rows.reduce(
            (a, r) => {
              const k = r.cellKey ?? "null";
              a[k] = (a[k] ?? 0) + 1;
              return a;
            },
            {} as Record<string, number>,
          ),
        ),
      ),
    ),
  );

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
