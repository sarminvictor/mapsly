// scripts/enrich-cohort.ts
//
// Staged, idempotent in-process enrichment of the 99-business cohort in
// scripts/.cohort-99.json. Runs the SAME service functions the crons /
// admin actions use — synchronously, in-process. No Boxly worker is
// configured, so every dispatch takes its sequential/sync fallback path.
//
// IMPORTANT — paid-cell gate bypass. The reviews + search gates
// (lib/reviews/should-collect.ts) drop businesses in cells with no paid
// relationship. The cohort has none yet, so we set
// MAPSLY_COLLECT_REVIEWS_ALLOW_ALL=1 at the very top — BEFORE any import
// that reads it — so the gate returns all 99. (Review pulls additionally
// use mode:"manual", which bypasses the gate independently and never
// skips a never-pulled row.)
//
// Usage:
//   pnpm tsx scripts/enrich-cohort.ts <stage>
//
//   stage ∈ qualify | reviews | search | lighthouse | ads
//         | recompute | landings | verify | dry-run | all
//   default = dry-run (no API calls, no writes)
//
//   "all" runs: reviews → search → lighthouse → ads → recompute → landings
//   (collection stages, then the free recompute, then landings). It does NOT
//   run "qualify" — run that explicitly first.
//
// Idempotent: every stage is safe to re-run. Per-business try/catch so one
// failure never aborts the batch.

// ── Gate bypass · MUST precede every import below ────────────────────────
process.env.MAPSLY_COLLECT_REVIEWS_ALLOW_ALL = "1";

import { config } from "dotenv";
config({ path: ".env.local" });

import fs from "node:fs";
import path from "node:path";

import prisma from "@/lib/prisma";
import { withCronRun } from "@/lib/cost/cost-counter";

import { triggerReviewPullForBusiness } from "@/modules/reviews/trigger-pull";
import { harvestPendingReviewsForBusiness } from "@/modules/reviews/harvest-pending";
import { dispatchSearchScan } from "@/modules/search-visibility/dispatch-bulk-scan";
import { collectWebsiteForBatch } from "@/modules/website-intel/collect-website-intel";
import { collectAdsForBatch } from "@/modules/ads-intel/collect-ads-intel";
import { writeSnapshotsForBusinessIds } from "@/app/api/cron/weekly/snapshot-write/route";
import { runCellAggregation } from "@/modules/market/cell-metrics";
import { runPillarScoring } from "@/modules/market/pillar-scoring";
import { ensureLandingForBusiness } from "@/modules/smb-landing/mint";
import { DATAFORSEO_UNIT_COST_USD } from "@/services/dataforseo/pricing";

// ── Constants ────────────────────────────────────────────────────────────
// Resolved from the repo root (scripts are run via `pnpm tsx scripts/...`).
const COHORT_FILE = path.join(process.cwd(), "scripts", ".cohort-99.json");
const REVIEW_CONCURRENCY = 5;
const LIGHTHOUSE_CONCURRENCY = 4;
const LANDING_CONCURRENCY = 5;
const HARVEST_POLL_ATTEMPTS = 24; // 24 × 15s ≈ 6 min max wait per business
const HARVEST_POLL_INTERVAL_MS = 15_000;

type Stage =
  | "qualify"
  | "reviews"
  | "search"
  | "lighthouse"
  | "ads"
  | "recompute"
  | "landings"
  | "verify"
  | "dry-run"
  | "all";

const VALID_STAGES: readonly Stage[] = [
  "qualify",
  "reviews",
  "search",
  "lighthouse",
  "ads",
  "recompute",
  "landings",
  "verify",
  "dry-run",
  "all",
];

// ── Small utilities ────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Bounded-concurrency map · preserves index order, never N+1-fans. */
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

function loadCohortIds(): string[] {
  const raw = fs.readFileSync(COHORT_FILE, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === "string")) {
    throw new Error(`${COHORT_FILE} must be a JSON array of string ids`);
  }
  return parsed as string[];
}

const usd = (n: number) => `$${n.toFixed(4)}`;
const startOfUtcDay = (d: Date) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/** Sum costUsd across the CronRuns this run just opened, by job-prefix. */
async function cohortCronCost(
  jobPrefix: string,
  sinceMs: number,
): Promise<{ totalUsd: number; runs: number }> {
  const runs = await prisma.cronRun.findMany({
    where: {
      job: { startsWith: jobPrefix },
      startedAt: { gte: new Date(sinceMs) },
    },
    select: { costUsd: true },
  });
  const totalUsd = runs.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  return { totalUsd, runs: runs.length };
}

// ════════════════════════════════════════════════════════════════════════
// STAGE · qualify
// ════════════════════════════════════════════════════════════════════════
async function stageQualify(ids: string[]): Promise<void> {
  console.log(`[qualify] cohort size: ${ids.length}`);

  const before = await prisma.business.groupBy({
    by: ["qualificationStatus"],
    where: { id: { in: ids } },
    _count: { _all: true },
  });
  console.log("[qualify] BEFORE status counts:");
  for (const r of before) {
    console.log(`  ${r.qualificationStatus}: ${r._count._all}`);
  }

  // Idempotent: only flip rows not already QUALIFIED. qualifiedByUserId is
  // left null (nullable in schema · system qualification).
  const res = await prisma.business.updateMany({
    where: { id: { in: ids }, qualificationStatus: { not: "QUALIFIED" } },
    data: { qualificationStatus: "QUALIFIED", qualifiedAt: new Date() },
  });
  console.log(`[qualify] updated ${res.count} row(s) → QUALIFIED`);

  const after = await prisma.business.groupBy({
    by: ["qualificationStatus"],
    where: { id: { in: ids } },
    _count: { _all: true },
  });
  console.log("[qualify] AFTER status counts:");
  for (const r of after) {
    console.log(`  ${r.qualificationStatus}: ${r._count._all}`);
  }
}

// ════════════════════════════════════════════════════════════════════════
// STAGE · reviews (Standard-queue task_post + in-process poll-harvest)
//
// The crons rely on a pingback webhook to finish the pull. No server runs
// during a script, so we replicate the admin "Harvest" path: post the
// Standard-queue task (mode:"manual" · bypasses paid-gate + never-pulled
// skip), then poll harvestPendingReviewsForBusiness() until the task is
// ready. Mirrors scripts/fix-miami-gaps.ts exactly.
// ════════════════════════════════════════════════════════════════════════
async function stageReviews(ids: string[]): Promise<void> {
  console.log(`[reviews] cohort size: ${ids.length}`);
  const since = Date.now();

  let posted = 0;
  let postSkipped = 0;
  let harvested = 0;
  let harvestEmpty = 0;
  let inserted = 0;
  let errors = 0;
  const skipReasons: Record<string, number> = {};

  await mapLimit(ids, REVIEW_CONCURRENCY, async (id, i) => {
    try {
      // 1. Post the Standard-queue task.
      const post = await withCronRun("script:enrich-reviews-post", () =>
        triggerReviewPullForBusiness(id, { mode: "manual" }),
      );
      if (post.triggered) {
        posted += 1;
      } else {
        postSkipped += 1;
        skipReasons[post.reason] = (skipReasons[post.reason] ?? 0) + 1;
        // Nothing to harvest if the post didn't enqueue a task.
        if (post.reason !== "in_flight") return;
      }

      // 2. Poll-harvest until the task is ready (or attempts exhausted).
      for (let attempt = 0; attempt < HARVEST_POLL_ATTEMPTS; attempt++) {
        const h = await withCronRun("script:enrich-reviews-harvest", () =>
          harvestPendingReviewsForBusiness(id),
        );
        if (h.harvested) {
          harvested += 1;
          inserted += h.inserted;
          if (h.inserted === 0) harvestEmpty += 1;
          break;
        }
        if (h.reason !== "not_ready") {
          // nothing_pending / not_found / task_get_failed · stop polling.
          if (h.reason === "task_get_failed") errors += 1;
          break;
        }
        await sleep(HARVEST_POLL_INTERVAL_MS);
      }
    } catch (err) {
      errors += 1;
      console.warn(
        `[reviews] ${id} threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if ((i + 1) % 10 === 0 || i + 1 === ids.length) {
      console.log(
        `[reviews] ${i + 1}/${ids.length} · posted=${posted} harvested=${harvested} inserted=${inserted} errors=${errors}`,
      );
    }
  });

  const cost = await cohortCronCost("script:enrich-reviews", since);
  console.log(
    `[reviews] DONE · posted=${posted} postSkipped=${postSkipped} harvested=${harvested} harvestEmpty=${harvestEmpty} reviewsInserted=${inserted} errors=${errors}`,
  );
  if (Object.keys(skipReasons).length > 0) {
    console.log(`[reviews] post-skip reasons: ${JSON.stringify(skipReasons)}`);
  }
  console.log(
    `[reviews] cost: ${usd(cost.totalUsd)} across ${cost.runs} CronRuns`,
  );
}

// ════════════════════════════════════════════════════════════════════════
// STAGE · search (ranked_keywords + template overlay + cell Maps)
//
// dispatchSearchScan takes the sequential fallback (no worker). It runs
// discoverLocalIntentForBusiness per business, then aggregateCellMaps per
// cell. Wrapped in one CronRun so all DfS cost lands on a single row.
// ════════════════════════════════════════════════════════════════════════
async function stageSearch(ids: string[]): Promise<void> {
  console.log(`[search] cohort size: ${ids.length}`);
  const since = Date.now();

  const result = await withCronRun("script:enrich-search", () =>
    dispatchSearchScan({ businessIds: ids, mode: "bulk" }),
  );

  console.log(
    `[search] strategy=${result.strategy} requested=${result.requested} eligible=${result.eligibleBusinesses} ran=${result.queuedOrTriggered} skipped/threw=${result.failedOrSkipped} cellsAggregated=${result.cellsAggregated}`,
  );
  if (result.sequentialResults) {
    const byStatus: Record<string, number> = {};
    let kwTotal = 0;
    for (const r of result.sequentialResults) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      kwTotal += r.keywordsTracked;
    }
    console.log(`[search] per-biz status: ${JSON.stringify(byStatus)}`);
    console.log(`[search] keywords tracked (sum): ${kwTotal}`);
  }
  if (result.sequentialCellResults) {
    console.log(
      `[search] cells aggregated: ${result.sequentialCellResults.length}`,
    );
  }

  const cost = await cohortCronCost("script:enrich-search", since);
  console.log(
    `[search] cost: ${usd(cost.totalUsd)} across ${cost.runs} CronRuns`,
  );
}

// ════════════════════════════════════════════════════════════════════════
// STAGE · lighthouse (writes LighthouseAudit)
// ════════════════════════════════════════════════════════════════════════
async function stageLighthouse(ids: string[]): Promise<void> {
  console.log(`[lighthouse] cohort size: ${ids.length}`);
  const since = Date.now();

  const result = await withCronRun("script:enrich-lighthouse", async () => {
    let audited = 0;
    let skippedNoWebsite = 0;
    const errors: string[] = [];
    // collectWebsiteForBatch resolves its own businesses + has internal
    // concurrency; feed it small chunks so progress prints + one failure
    // can't sink the whole 99.
    await mapLimit(ids, LIGHTHOUSE_CONCURRENCY, async (id, i) => {
      try {
        const r = await collectWebsiteForBatch([id]);
        audited += r.audited;
        skippedNoWebsite += r.skippedNoWebsite;
        for (const e of r.errors) {
          errors.push(`${e.businessId}: ${e.error}`);
        }
      } catch (err) {
        errors.push(
          `${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if ((i + 1) % 10 === 0 || i + 1 === ids.length) {
        console.log(
          `[lighthouse] ${i + 1}/${ids.length} · audited=${audited} skippedNoWebsite=${skippedNoWebsite} errors=${errors.length}`,
        );
      }
    });
    return { audited, skippedNoWebsite, errors };
  });

  const cost = await cohortCronCost("script:enrich-lighthouse", since);
  console.log(
    `[lighthouse] DONE · audited=${result.audited} skippedNoWebsite=${result.skippedNoWebsite} errors=${result.errors.length}`,
  );
  if (result.errors.length > 0) {
    console.log(
      `[lighthouse] first errors: ${result.errors.slice(0, 5).join(" | ")}`,
    );
  }
  console.log(
    `[lighthouse] cost: ${usd(cost.totalUsd)} across ${cost.runs} CronRuns`,
  );
}

// ════════════════════════════════════════════════════════════════════════
// STAGE · ads (DfS keyword-cost + Google Ads Transparency; Meta tolerated)
//
// collectAdsForBatch handles its own batching internally. dfs:true always;
// meta:true runs the Apify Meta Ad Library pass (slow, a few cents). Meta
// data may already exist — empty is tolerated.
// ════════════════════════════════════════════════════════════════════════
async function stageAds(ids: string[]): Promise<void> {
  console.log(`[ads] cohort size: ${ids.length}`);
  const since = Date.now();

  const result = await withCronRun("script:enrich-ads", () =>
    collectAdsForBatch(ids, { dfs: true, meta: true }),
  );

  console.log(
    `[ads] DONE · businesses=${result.businesses} keywordsUpserted=${result.keywordsUpserted} metaAds=${result.metaAds} metaRunUsd=${usd(result.metaRunUsd)} errors=${result.errors.length}`,
  );
  if (result.errors.length > 0) {
    console.log(`[ads] first errors: ${result.errors.slice(0, 5).join(" | ")}`);
  }

  const cost = await cohortCronCost("script:enrich-ads", since);
  console.log(`[ads] cost: ${usd(cost.totalUsd)} across ${cost.runs} CronRuns`);
}

// ════════════════════════════════════════════════════════════════════════
// STAGE · recompute (FREE · no DfS) — snapshots → cell medians → pillars
// ════════════════════════════════════════════════════════════════════════
async function stageRecompute(ids: string[]): Promise<void> {
  console.log(`[recompute] cohort size: ${ids.length}`);

  const snap = await writeSnapshotsForBusinessIds(ids, { skipGate: true });
  console.log(
    `[recompute] snapshots written: ${snap.written}/${snap.attempted}`,
  );

  const cells = await runCellAggregation();
  console.log(`[recompute] cells written: ${cells.cellsWritten}`);

  const pillars = await runPillarScoring();
  console.log(
    `[recompute] businessesScored=${pillars.businessesScored} cellsUsed=${pillars.cellsUsed} withCellRef=${pillars.withCellRef}`,
  );
}

// ════════════════════════════════════════════════════════════════════════
// STAGE · landings (idempotent · ensureLandingForBusiness)
// ════════════════════════════════════════════════════════════════════════
async function stageLandings(ids: string[]): Promise<void> {
  console.log(`[landings] cohort size: ${ids.length}`);

  let created = 0;
  let existing = 0;
  let missing = 0;
  const tokens: Array<{ id: string; token: string; created: boolean }> = [];

  await mapLimit(ids, LANDING_CONCURRENCY, async (id) => {
    try {
      const r = await ensureLandingForBusiness(id);
      if (!r) {
        missing += 1;
        return;
      }
      if (r.created) created += 1;
      else existing += 1;
      tokens.push({ id, token: r.token, created: r.created });
    } catch (err) {
      missing += 1;
      console.warn(
        `[landings] ${id} threw: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  });

  console.log(
    `[landings] DONE · created=${created} existing=${existing} missing=${missing}`,
  );
  console.log("[landings] /l/ tokens:");
  for (const t of tokens) {
    console.log(
      `  /l/${t.token} · ${t.id} · ${t.created ? "new" : "existing"}`,
    );
  }
}

// ════════════════════════════════════════════════════════════════════════
// STAGE · verify (read-only coverage table)
// ════════════════════════════════════════════════════════════════════════
async function stageVerify(ids: string[]): Promise<void> {
  console.log(`[verify] cohort size: ${ids.length}`);

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const today = startOfUtcDay(new Date());

  const [revGroups, kwGroups, lhRows, snapRows, landingRows] =
    await Promise.all([
      prisma.review.groupBy({
        by: ["businessId"],
        where: { businessId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.businessKeyword.groupBy({
        by: ["businessId"],
        where: { businessId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.lighthouseAudit.findMany({
        where: { businessId: { in: ids }, auditedAt: { gte: oneDayAgo } },
        select: { businessId: true },
        distinct: ["businessId"],
      }),
      prisma.businessSnapshot.findMany({
        where: {
          businessId: { in: ids },
          snapshotDate: { gte: today },
          pillarScore: { not: null },
        },
        select: { businessId: true },
        distinct: ["businessId"],
      }),
      prisma.landingPage.findMany({
        where: { businessId: { in: ids } },
        select: { businessId: true },
        distinct: ["businessId"],
      }),
    ]);

  const hasReview = new Set(revGroups.map((r) => r.businessId));
  const hasKeyword = new Set(kwGroups.map((r) => r.businessId));
  const hasLh = new Set(lhRows.map((r) => r.businessId));
  const hasSnap = new Set(snapRows.map((r) => r.businessId));
  const hasLanding = new Set(landingRows.map((r) => r.businessId));

  const N = ids.length;
  const pct = (n: number) => `${((n / N) * 100).toFixed(0)}%`;
  const row = (label: string, n: number) =>
    console.log(
      `  ${String(n).padStart(3)}/${N} (${pct(n).padStart(4)})  ${label}`,
    );

  console.log("\n===== COHORT COVERAGE =====");
  row("≥1 Review row", hasReview.size);
  row("≥1 BusinessKeyword row", hasKeyword.size);
  row("LighthouseAudit (last 1d)", hasLh.size);
  row("BusinessSnapshot today w/ pillarScore", hasSnap.size);
  row("LandingPage row", hasLanding.size);
  console.log("===========================\n");
}

// ════════════════════════════════════════════════════════════════════════
// STAGE · dry-run (NO writes · NO API calls)
// ════════════════════════════════════════════════════════════════════════
async function stageDryRun(ids: string[]): Promise<void> {
  console.log(`[dry-run] cohort size: ${ids.length}`);
  console.log(`[dry-run] cohort file: ${COHORT_FILE}`);

  const businesses = await prisma.business.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      qualificationStatus: true,
      website: true,
      googleCid: true,
      reviewCount: true,
      reviewsFirstPulledAt: true,
      pendingReviewsTaskId: true,
    },
  });
  const foundIds = new Set(businesses.map((b) => b.id));
  const missing = ids.filter((id) => !foundIds.has(id));

  // Current-state fan-out (read-only · matches verify dims).
  const [revGroups, kwGroups, lhRows, snapRows, landingRows] =
    await Promise.all([
      prisma.review.groupBy({
        by: ["businessId"],
        where: { businessId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.businessKeyword.groupBy({
        by: ["businessId"],
        where: { businessId: { in: ids } },
        _count: { _all: true },
      }),
      prisma.lighthouseAudit.findMany({
        where: { businessId: { in: ids } },
        select: { businessId: true },
        distinct: ["businessId"],
      }),
      prisma.businessSnapshot.findMany({
        where: { businessId: { in: ids } },
        select: { businessId: true },
        distinct: ["businessId"],
      }),
      prisma.landingPage.findMany({
        where: { businessId: { in: ids } },
        select: { businessId: true },
        distinct: ["businessId"],
      }),
    ]);

  const hasReview = new Set(revGroups.map((r) => r.businessId));
  const hasKeyword = new Set(kwGroups.map((r) => r.businessId));
  const hasLh = new Set(lhRows.map((r) => r.businessId));
  const hasSnap = new Set(snapRows.map((r) => r.businessId));
  const hasLanding = new Set(landingRows.map((r) => r.businessId));

  const withWebsite = businesses.filter((b) => b.website).length;
  const withCid = businesses.filter((b) => b.googleCid).length;
  const neverPulled = businesses.filter(
    (b) => b.reviewsFirstPulledAt === null,
  ).length;
  const inFlight = businesses.filter(
    (b) => b.pendingReviewsTaskId !== null,
  ).length;
  const notQualified = businesses.filter(
    (b) => b.qualificationStatus !== "QUALIFIED",
  ).length;

  console.log("\n===== DRY-RUN · CURRENT STATE =====");
  console.log(`  resolved businesses: ${businesses.length}/${ids.length}`);
  if (missing.length > 0) {
    console.log(
      `  MISSING ids (${missing.length}): ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? " …" : ""}`,
    );
  }
  console.log(`  not yet QUALIFIED:        ${notQualified}`);
  console.log(`  has website:              ${withWebsite}`);
  console.log(`  has googleCid:            ${withCid}`);
  console.log(`  reviews never pulled:     ${neverPulled}`);
  console.log(`  reviews pull in-flight:   ${inFlight}`);
  console.log(`  already has ≥1 Review:    ${hasReview.size}`);
  console.log(`  already has ≥1 Keyword:   ${hasKeyword.size}`);
  console.log(`  already has Lighthouse:   ${hasLh.size}`);
  console.log(`  already has a Snapshot:   ${hasSnap.size}`);
  console.log(`  already has a Landing:    ${hasLanding.size}`);

  console.log("\n===== WHAT EACH STAGE WOULD DO =====");
  console.log(
    `  qualify    → flip ${notQualified} non-QUALIFIED rows → QUALIFIED (no cost)`,
  );
  console.log(
    `  reviews    → post+harvest for ${withCid} CID-bearing rows (mode:manual). Live cost varies by review count.`,
  );
  console.log(
    `  search     → ranked_keywords + template + cell Maps for ${withWebsite} site-bearing rows`,
  );
  console.log(
    `  lighthouse → audit ${withWebsite} site-bearing rows (${ids.length - withWebsite} skipped, no website)`,
  );
  console.log(
    `  ads        → DfS keyword-cost + Google Ads Transparency + Meta for ${businesses.length} rows`,
  );
  console.log(
    `  recompute  → snapshots(${ids.length}) → cell medians → pillar scores (FREE)`,
  );
  console.log(
    `  landings   → mint ${ids.length - hasLanding.size} new landings (${hasLanding.size} already exist)`,
  );

  console.log("\n===== ESTIMATED COST (per pricing.ts · upper bound) =====");
  const P = DATAFORSEO_UNIT_COST_USD;
  // reviews: Standard task bills task_get at $0.00075 per 10 reviews.
  // Assume an average of 50 reviews/biz on a never-pulled cohort → 5 × unit.
  const reviewsEst = withCid * P.reviewsTask * 5;
  // search: 1 ranked_keywords call/biz + 1 keyword_volume batch/biz (cap).
  const searchEst = withWebsite * (P.rankedKeywords + P.keywordVolume);
  // lighthouse: 1 audit per site-bearing biz.
  const lighthouseEst = withWebsite * P.lighthouse;
  // ads: per-biz keyword_volume batch + ads_advertisers + ads_search (rough).
  const adsEst =
    businesses.length * (P.keywordVolume + P.adsAdvertisers + P.adsSearch);
  console.log(
    `  reviews    ≈ ${usd(reviewsEst)} (${withCid} biz × ~50 reviews)`,
  );
  console.log(`  search     ≈ ${usd(searchEst)} (${withWebsite} biz)`);
  console.log(`  lighthouse ≈ ${usd(lighthouseEst)} (${withWebsite} biz)`);
  console.log(
    `  ads        ≈ ${usd(adsEst)} (${businesses.length} biz, +Apify Meta cents)`,
  );
  console.log(`  recompute  ≈ $0.0000 (free)`);
  console.log(`  landings   ≈ $0.0000 (free)`);
  console.log(
    `  TOTAL collection ≈ ${usd(reviewsEst + searchEst + lighthouseEst + adsEst)} (rough · adapters bill ACTUAL task.cost)`,
  );
  console.log("===================================\n");
  console.log("[dry-run] NO writes performed · NO API calls made.");
}

// ════════════════════════════════════════════════════════════════════════
// Entrypoint
// ════════════════════════════════════════════════════════════════════════
async function main() {
  const arg = (process.argv[2] ?? "dry-run") as Stage;
  if (!VALID_STAGES.includes(arg)) {
    console.error(`Unknown stage "${arg}". Valid: ${VALID_STAGES.join(" | ")}`);
    process.exit(2);
  }

  const ids = loadCohortIds();
  console.log(
    `[enrich-cohort] stage=${arg} · cohort=${ids.length} ids · ALLOW_ALL=1\n`,
  );

  switch (arg) {
    case "qualify":
      await stageQualify(ids);
      break;
    case "reviews":
      await stageReviews(ids);
      break;
    case "search":
      await stageSearch(ids);
      break;
    case "lighthouse":
      await stageLighthouse(ids);
      break;
    case "ads":
      await stageAds(ids);
      break;
    case "recompute":
      await stageRecompute(ids);
      break;
    case "landings":
      await stageLandings(ids);
      break;
    case "verify":
      await stageVerify(ids);
      break;
    case "dry-run":
      await stageDryRun(ids);
      break;
    case "all":
      // Collection stages → free recompute → landings. qualify is run
      // separately and intentionally NOT included here.
      await stageReviews(ids);
      await stageSearch(ids);
      await stageLighthouse(ids);
      await stageAds(ids);
      await stageRecompute(ids);
      await stageLandings(ids);
      break;
  }

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
