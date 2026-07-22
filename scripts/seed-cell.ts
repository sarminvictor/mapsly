// scripts/seed-cell.ts
//
// Phase-1 Stage A · Seed one metro × vertical cell end-to-end, in-process,
// through the OFFICIAL research paths (no UI): discovery → qualify
// (contacts + tech ride-along) → reviews → search (deep Maps rank) →
// lighthouse → google_ads → recompute (snapshots + cell medians + pillar
// scores, $0) → tier-1 gate verify + cost audit.
//
// Modeled on scripts/enrich-cohort.ts (the golden template) — same service
// functions the admin UI and crons call, sequential fallback paths, one
// CronRun per stage so all vendor cost is attributable.
//
// Usage:
//   pnpm tsx scripts/seed-cell.ts --category=medical_spa --city=Scottsdale \
//     --province=AZ --country=US [--radius=12] [--limit=100] [--stage=all]
//
//   stage ∈ discover | qualify | reviews | search | lighthouse | ads
//         | recompute | verify | all   (default all)
//
// Idempotent: every stage is safe to re-run (discovery dedups by CID;
// review pulls skip in-flight; snapshots upsert by day).

// Paid-cell gate bypass — MUST precede every import that reads it.
process.env.MAPSLY_COLLECT_REVIEWS_ALLOW_ALL = "1";
// Post review tasks WITHOUT a pingback so task_get retrieval (poll-harvest)
// works from a standalone script — see services/dataforseo/reviews-task.ts.
process.env.MAPSLY_REVIEWS_NO_PINGBACK = "1";

import { config } from "dotenv";
config({ path: ".env.local" });

import prisma from "@/lib/prisma";
import { withCronRun } from "@/lib/cost/cost-counter";

import { getKnownCategory } from "@/modules/business-discovery/known-categories";
import { geocodeLocation } from "@/modules/business-discovery/geocode";
import { pingValidateLocation } from "@/modules/business-discovery/ping-validate";
import { runDiscoveryForLocation } from "@/modules/business-discovery/run";
import { cellMembershipWhere } from "@/modules/business-discovery/cell-membership";
import { qualifyCell } from "@/modules/business-qualification/qualify";
import { scanBusinessContacts } from "@/modules/contacts/scan";
import { triggerReviewPullForBusiness } from "@/modules/reviews/trigger-pull";
import { harvestPendingReviewsForBusiness } from "@/modules/reviews/harvest-pending";
import { dispatchSearchScan } from "@/modules/search-visibility/dispatch-bulk-scan";
import { collectWebsiteForBatch } from "@/modules/website-intel/collect-website-intel";
import { collectAdsForBatch } from "@/modules/ads-intel/collect-ads-intel";
import { writeSnapshotsForBusinessIds } from "@/app/api/cron/weekly/snapshot-write/route";
import { runCellAggregation } from "@/modules/market/cell-metrics";
import { runPillarScoring } from "@/modules/market/pillar-scoring";
import { passesBizIndexGate } from "@/modules/biz-profile/seo-gate";

const REVIEW_CONCURRENCY = 5;
const LIGHTHOUSE_CONCURRENCY = 4;
const HARVEST_POLL_ATTEMPTS = 24; // 24 × 15s ≈ 6 min max per business
const HARVEST_POLL_INTERVAL_MS = 15_000;
const CELL_BUDGET_USD = 5; // hard-stop audit threshold per plan

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usd = (n: number) => `$${n.toFixed(4)}`;

async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (t: T, i: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Math.min(Math.max(1, limit), items.length);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

function arg(name: string, fallback?: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing --${name}=`);
}

async function scriptCronCost(sinceMs: number) {
  const runs = await prisma.cronRun.findMany({
    where: {
      job: { startsWith: "script:seed-" },
      startedAt: { gte: new Date(sinceMs) },
    },
    select: { costUsd: true, job: true },
  });
  const byJob: Record<string, number> = {};
  let total = 0;
  for (const r of runs) {
    total += r.costUsd ?? 0;
    byJob[r.job] = (byJob[r.job] ?? 0) + (r.costUsd ?? 0);
  }
  return { total, byJob, runs: runs.length };
}

async function main() {
  const categoryId = arg("category");
  const city = arg("city");
  const province = arg("province", "") || null;
  const country = arg("country", "US");
  const radiusKm = Number(arg("radius", "12"));
  const limit = Number(arg("limit", "100"));
  const stage = arg("stage", "all");
  const t0 = Date.now();

  console.log(
    `[seed-cell] ${categoryId} × ${city}${province ? `, ${province}` : ""} (${country}) · radius=${radiusKm}km limit=${limit} stage=${stage}`,
  );

  // ── Ensure category ────────────────────────────────────────────────────
  const known = getKnownCategory(categoryId); // throws on unknown id
  let category = await prisma.businessCategory.findFirst({
    where: { dataforseoId: categoryId },
    select: { id: true, dataforseoId: true },
  });
  if (!category) {
    const admin = await prisma.user.findFirst({
      where: { role: "ADMIN" },
      select: { id: true },
    });
    category = await prisma.businessCategory.create({
      data: {
        dataforseoId: known.dataforseoId,
        label: known.label,
        groupKey: known.groupKey,
        verifiedAt: new Date(),
        createdByUserId: admin?.id ?? null,
      },
      select: { id: true, dataforseoId: true },
    });
    console.log(`[seed-cell] created category ${known.label}`);
  }

  // ── Ensure TrackedLocation (geocode + $0.001 ping only on create) ──────
  let loc = await prisma.trackedLocation.findFirst({
    where: { categoryId: category.id, city, province, country },
    select: { id: true, lat: true, lng: true, radiusKm: true },
  });
  if (!loc) {
    const geo = await geocodeLocation({ city, province, country });
    if (!geo) throw new Error(`geocode failed for ${city}, ${country}`);
    const ping = await withCronRun("script:seed-ping", () =>
      pingValidateLocation({
        dataforseoCategoryId: category!.dataforseoId,
        lat: geo.lat,
        lng: geo.lng,
        radiusKm,
      }),
    );
    if (!ping.ok) throw new Error(`ping-validate failed: ${ping.message}`);
    const admin = await prisma.user.findFirst({
      where: { role: "ADMIN" },
      select: { id: true },
    });
    loc = await prisma.trackedLocation.create({
      data: {
        categoryId: category.id,
        city,
        province,
        country,
        lat: geo.lat,
        lng: geo.lng,
        radiusKm,
        verifiedAt: new Date(),
        createdByUserId: admin?.id ?? null,
      },
      select: { id: true, lat: true, lng: true, radiusKm: true },
    });
    console.log(
      `[seed-cell] created location ${loc.id} (sample: "${ping.sampleName}")`,
    );
  } else {
    console.log(`[seed-cell] location exists: ${loc.id}`);
  }

  const run = (s: string) => stage === "all" || stage === s;

  // ── discover ───────────────────────────────────────────────────────────
  if (run("discover")) {
    const admin = await prisma.user.findFirst({
      where: { role: "ADMIN" },
      select: { id: true },
    });
    const summary = await runDiscoveryForLocation({
      trackedLocationId: loc.id,
      triggeredByUserId: admin?.id ?? null,
      limit,
    });
    console.log(
      `[discover] status=${summary.status} returned=${summary.totalReturned} new=${summary.newBusinesses} cost=${usd(summary.costUsd ?? 0)}`,
    );
  }

  // ── cohort = geometric cell membership ─────────────────────────────────
  const memberWhere = cellMembershipWhere({
    dataforseoCategoryId: category.dataforseoId,
    lat: loc.lat,
    lng: loc.lng,
    radiusKm: loc.radiusKm,
    city,
    country,
  });
  const members = await prisma.business.findMany({
    where: { ...memberWhere, isActive: true },
    select: { id: true, website: true },
    take: 500,
  });
  const ids = members.map((m) => m.id);
  console.log(`[cohort] ${ids.length} businesses in cell`);
  if (ids.length === 0) throw new Error("empty cohort after discovery");

  // ── qualify (contacts + tech + qualificationStatus) ────────────────────
  if (run("qualify")) {
    const q = await withCronRun("script:seed-qualify", () =>
      qualifyCell(loc!.id),
    );
    console.log(
      `[qualify] qualified=${q.qualified} disqualified=${q.disqualified} unreachable=${q.unreachable} emails=${q.totalEmailsFound ?? "?"}`,
    );
  }

  // ── contacts (OFFICIAL agency-facing scan · writes Contact rows +
  //    reachableChannelCount, which Search-everywhere delivery REQUIRES;
  //    qualify's emailDiscovered feeds only the SMB cold rail) ────────────
  if (run("contacts")) {
    let ok = 0,
      unreachable = 0,
      errs = 0;
    await withCronRun("script:seed-contacts", async () => {
      await mapLimit(ids, 4, async (id, i) => {
        try {
          const r = await scanBusinessContacts(id);
          if ((r as { reachableChannelCount?: number }).reachableChannelCount)
            ok += 1;
          else unreachable += 1;
        } catch {
          errs += 1;
        }
        if ((i + 1) % 20 === 0 || i + 1 === ids.length) {
          console.log(
            `[contacts] ${i + 1}/${ids.length} reachable=${ok} unreachable=${unreachable} errors=${errs}`,
          );
        }
      });
    });
    console.log(
      `[contacts] DONE reachable=${ok} unreachable=${unreachable} errors=${errs}`,
    );
  }

  // ── reviews (Standard queue post + poll harvest) ───────────────────────
  if (run("reviews")) {
    let posted = 0,
      harvested = 0,
      inserted = 0,
      errors = 0;
    const skipReasons: Record<string, number> = {};
    await mapLimit(ids, REVIEW_CONCURRENCY, async (id, i) => {
      try {
        const post = await withCronRun("script:seed-reviews-post", () =>
          triggerReviewPullForBusiness(id, { mode: "manual" }),
        );
        if (post.triggered) posted += 1;
        else {
          skipReasons[post.reason] = (skipReasons[post.reason] ?? 0) + 1;
          if (post.reason !== "in_flight") return;
        }
        for (let attempt = 0; attempt < HARVEST_POLL_ATTEMPTS; attempt++) {
          const h = await withCronRun("script:seed-reviews-harvest", () =>
            harvestPendingReviewsForBusiness(id),
          );
          if (h.harvested) {
            harvested += 1;
            inserted += h.inserted;
            break;
          }
          if (h.reason !== "not_ready") break;
          await sleep(HARVEST_POLL_INTERVAL_MS);
        }
      } catch {
        errors += 1;
      }
      if ((i + 1) % 20 === 0 || i + 1 === ids.length) {
        console.log(
          `[reviews] ${i + 1}/${ids.length} posted=${posted} harvested=${harvested} inserted=${inserted} errors=${errors}`,
        );
      }
    });
    console.log(
      `[reviews] DONE posted=${posted} harvested=${harvested} inserted=${inserted} errors=${errors} skips=${JSON.stringify(skipReasons)}`,
    );
  }

  // ── search (ranked keywords + deep cell Maps rank) ─────────────────────
  if (run("search")) {
    const r = await withCronRun("script:seed-search", () =>
      dispatchSearchScan({ businessIds: ids, mode: "bulk" }),
    );
    console.log(
      `[search] strategy=${r.strategy} ran=${r.queuedOrTriggered} failed=${r.failedOrSkipped} cells=${r.cellsAggregated}`,
    );
  }

  // ── lighthouse ─────────────────────────────────────────────────────────
  if (run("lighthouse")) {
    const withSite = members.filter((m) => !!m.website).map((m) => m.id);
    let audited = 0,
      skipped = 0,
      errs = 0;
    await withCronRun("script:seed-lighthouse", async () => {
      await mapLimit(withSite, LIGHTHOUSE_CONCURRENCY, async (id, i) => {
        try {
          const r = await collectWebsiteForBatch([id]);
          audited += r.audited;
          skipped += r.skippedNoWebsite;
          errs += r.errors.length;
        } catch {
          errs += 1;
        }
        if ((i + 1) % 20 === 0 || i + 1 === withSite.length) {
          console.log(
            `[lighthouse] ${i + 1}/${withSite.length} audited=${audited} errors=${errs}`,
          );
        }
      });
    });
    console.log(`[lighthouse] DONE audited=${audited} errors=${errs}`);
  }

  // ── google_ads only (meta excluded per plan) ───────────────────────────
  if (run("ads")) {
    const r = await withCronRun("script:seed-ads", () =>
      collectAdsForBatch(ids, { dfs: true, meta: false }),
    );
    console.log(
      `[ads] businesses=${r.businesses} keywordsUpserted=${r.keywordsUpserted} errors=${r.errors.length}`,
    );
  }

  // ── recompute ($0): snapshots → cell medians → pillar scores ───────────
  if (run("recompute")) {
    const snap = await writeSnapshotsForBusinessIds(ids, { skipGate: true });
    console.log(`[recompute] snapshots ${snap.written}/${snap.attempted}`);
    const cells = await runCellAggregation();
    console.log(`[recompute] cells written ${cells.cellsWritten}`);
    const pillars = await runPillarScoring();
    console.log(
      `[recompute] scored=${pillars.businessesScored} cellsUsed=${pillars.cellsUsed}`,
    );
  }

  // ── verify: tier-1 gate + cost audit ───────────────────────────────────
  if (run("verify") || stage === "all") {
    const rows = await prisma.business.findMany({
      where: { id: { in: ids } },
      select: {
        slug: true,
        website: true,
        reviewCount: true,
        isHidden: true,
        permanentlyClosed: true,
        suppressedAt: true,
        email: true,
        emailDiscovered: true,
        snapshots: {
          take: 1,
          orderBy: { snapshotDate: "desc" },
          select: { mapslyScore: true, pillarScore: true },
        },
      },
    });
    const tier1 = rows.filter((r) => {
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
    const withEmail = rows.filter(
      (r) => !!r.emailDiscovered || !!r.email,
    ).length;
    const cost = await scriptCronCost(t0);
    const cellTotals = await prisma.trackedLocation.findUnique({
      where: { id: loc.id },
      select: { totalCostUsd: true, totalQualifyCostUsd: true },
    });
    const result = {
      cell: `${categoryId}|${city}|${country}`,
      businesses: ids.length,
      tier1: tier1.length,
      withEmail,
      scriptCostUsd: Number(cost.total.toFixed(4)),
      costByJob: Object.fromEntries(
        Object.entries(cost.byJob).map(([k, v]) => [k, Number(v.toFixed(4))]),
      ),
      cellLifetimeCostUsd: cellTotals?.totalCostUsd ?? null,
      sampleTier1Slugs: tier1.slice(0, 5).map((r) => r.slug),
      budgetOk: cost.total <= CELL_BUDGET_USD,
    };
    console.log(`[verify] ${JSON.stringify(result)}`);
    if (!result.budgetOk) {
      console.error(
        `[verify] BUDGET EXCEEDED: ${usd(cost.total)} > $${CELL_BUDGET_USD} — investigate before seeding more cells`,
      );
      process.exitCode = 2;
    }
  }
}

main()
  .then(() => {
    // Always exit — Prisma's connection pool keeps the event loop alive, so a
    // plain return hangs the process. Preserve the budget-exceeded code (2)
    // for the caller while still terminating.
    process.exit(process.exitCode === 2 ? 2 : 0);
  })
  .catch((e) => {
    console.error(`[seed-cell] FATAL: ${String(e).slice(0, 600)}`);
    process.exit(1);
  });
