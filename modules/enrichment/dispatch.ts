// modules/enrichment/dispatch.ts · the enrichment dispatcher (Phase 3 · job rail).
//
// The user-facing actions only ENQUEUE work (a PENDING Discovery or a PENDING
// EnrichmentRun) — never call an external API in the request path
// (`.claude/rules/cost-discipline.md`). This module is the air-gapped consumer:
// the internal cron route (`/api/cron/internal/dispatch`) calls dispatchPending
// inside a withCronRun.
//
// Run lifecycle (per-business families fan out into EnrichmentJob rows so each
// unit has its own progress / retry / freshness / cost):
//
//   PENDING run → fanOutRun:
//     • per-CELL families (meta/google/serp) run inline once per cell (few,
//       cheap, 30-day gated) — fresh cells served from DB at $0;
//     • per-BUSINESS families fan out into EnrichmentJob rows (QUEUED, or
//       SKIPPED_FRESH when the unit is already fresh → never re-fetched/re-billed);
//     • run flips RUNNING, actualUsd seeded with the cell cost.
//   each tick → claim a batch of QUEUED jobs → processJob (worker + retry);
//   when a run has no non-terminal jobs left → closeRunIfDone settles credits
//   against the ACTUAL completed cost (refunds the quote-vs-actual diff).
//
// Failure isolation (`.claude/rules/scalability.md`): one unit that throws never
// aborts the batch — it's retried up to MAX_JOB_ATTEMPTS, then marked FAILED and
// the run closes PARTIAL. A crashed tick is recovered by reconcileStuck.

import prisma from "@/lib/prisma";
import { parseCellKey } from "@/lib/cell";
import { ENRICHMENT_PRICES, type EnrichmentType } from "@/modules/cost/pricing";
import { reconcileRunCredits } from "@/modules/cost/server";
import { usdToCredits } from "@/modules/cost/estimate";
import { loadFreshTimestamps } from "@/modules/discovery/enrich-fresh-db";
import { runDiscovery } from "@/modules/discovery/run-discovery";
import { scanBusinessContacts } from "@/modules/contacts/scan";
import { submitReviewJob } from "@/modules/reviews/review-job";
import { runMetaAdsForCell } from "@/modules/cell-intel/meta-ads";
import { runGoogleAdsForCell } from "@/modules/cell-intel/google-ads";
import { runSerpForCell } from "@/modules/cell-intel/serp";
import { runPlaybooksForBusiness } from "@/modules/playbooks/run";
import { runAiResearchForBusiness } from "@/modules/ai-research/pipeline";
import { extractServicesForBusiness } from "@/modules/services-general/extract";

// ── Tunables ──────────────────────────────────────────────────────────────
const MAX_JOB_ATTEMPTS = 3;
const JOB_BATCH =
  Number(process.env.ENRICHMENT_JOB_BATCH) > 0
    ? Number(process.env.ENRICHMENT_JOB_BATCH)
    : 25;
const STUCK_JOB_MINUTES = 10;
const STUCK_DISCOVERY_MINUTES = 30;
const RUNNING_RUN_CLOSE_LIMIT = 50;
const MS_PER_DAY = 86_400_000;

export interface DispatchResult {
  discoveriesRun: number;
  discoveriesFailed: number;
  /** Runs fanned out (PENDING → RUNNING) this tick. */
  enrichmentRunsProcessed: number;
  /** Jobs that completed (DONE) this tick. */
  unitsDone: number;
  /** Jobs that failed terminally this tick. */
  unitsFailed: number;
  /** Jobs requeued for retry this tick. */
  jobsRequeued: number;
  /** Runs closed (OK/PARTIAL) + settled this tick. */
  runsClosed: number;
}

interface ScopeRefs {
  businessIds?: string[];
  cellKeys?: string[];
}

function logErr(ctx: string, key: string, err: unknown): void {
  console.error(
    JSON.stringify({
      level: "error",
      event: "dispatch.unit.error",
      ctx,
      key,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}

function isFresh(
  at: Date | null | undefined,
  days: number,
  now: Date,
): boolean {
  if (!at || days <= 0) return false;
  return (now.getTime() - at.getTime()) / MS_PER_DAY < days;
}

// ── Per-business job plan ────────────────────────────────────────────────────

type JobFamily = "CONTACTS" | "SERVICES" | "REVIEWS" | "AI_RESEARCH";
type FreshCursor = "contacts" | "reviews" | null;

interface JobPlanEntry {
  family: JobFamily;
  plannedUsd: number;
  cursor: FreshCursor;
  freshDays: number;
}

/** The per-business worker for each job family. CONTACTS also fingerprints tech
 *  off the same fetch, so a contacts OR tech selection maps to one scan job. */
const WORKER: Record<JobFamily, (businessId: string) => Promise<unknown>> = {
  CONTACTS: (id) => scanBusinessContacts(id),
  SERVICES: (id) => extractServicesForBusiness(id),
  REVIEWS: (id) => submitReviewJob(id, "manual"),
  AI_RESEARCH: (id) => runAiResearchForBusiness(id),
};

/** Build the per-business job plan from the run's selected families. Contacts +
 *  tech collapse to one CONTACTS job priced at the sum of the selected lines
 *  (one fetch does both), so settle matches the quote and never double-bills. */
function buildJobPlan(has: (f: EnrichmentType) => boolean): JobPlanEntry[] {
  const plan: JobPlanEntry[] = [];
  if (has("contacts") || has("tech")) {
    plan.push({
      family: "CONTACTS",
      plannedUsd:
        (has("contacts") ? ENRICHMENT_PRICES.contacts.usdPerUnit : 0) +
        (has("tech") ? ENRICHMENT_PRICES.tech.usdPerUnit : 0),
      cursor: "contacts",
      freshDays: ENRICHMENT_PRICES.contacts.freshnessDays,
    });
  }
  if (has("services")) {
    plan.push({
      family: "SERVICES",
      plannedUsd: ENRICHMENT_PRICES.services.usdPerUnit,
      cursor: null,
      freshDays: 0,
    });
  }
  if (has("reviews")) {
    plan.push({
      family: "REVIEWS",
      plannedUsd: ENRICHMENT_PRICES.reviews.usdPerUnit,
      cursor: "reviews",
      freshDays: ENRICHMENT_PRICES.reviews.freshnessDays,
    });
  }
  if (has("ai_research")) {
    plan.push({
      family: "AI_RESEARCH",
      plannedUsd: ENRICHMENT_PRICES.ai_research.usdPerUnit,
      cursor: null,
      freshDays: 0,
    });
  }
  return plan;
}

/**
 * Fan out one PENDING EnrichmentRun: run the per-cell families inline, create
 * per-business EnrichmentJob rows (SKIPPED_FRESH for already-fresh units), and
 * flip the run RUNNING with actualUsd seeded by the cell cost. Idempotent: a run
 * already RUNNING (re-entered) is skipped. Exported for unit testing.
 */
export async function fanOutRun(
  runId: string,
  now: Date = new Date(),
): Promise<{ jobsCreated: number; cellCostUsd: number }> {
  const run = await prisma.enrichmentRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      enrichmentsJson: true,
      scopeRefsJson: true,
    },
  });
  if (!run || run.status !== "PENDING")
    return { jobsCreated: 0, cellCostUsd: 0 };

  const families = (
    Array.isArray(run.enrichmentsJson) ? run.enrichmentsJson : []
  ) as EnrichmentType[];
  const has = (f: EnrichmentType) => families.includes(f);
  const scope = (run.scopeRefsJson ?? {}) as ScopeRefs;
  const businessIds = scope.businessIds ?? [];
  const cellKeys = scope.cellKeys ?? [];

  const fresh = await loadFreshTimestamps(businessIds, cellKeys);

  // Flip RUNNING first so a concurrent tick won't re-fan-out this run.
  await prisma.enrichmentRun.update({
    where: { id: runId },
    data: { status: "RUNNING" },
  });

  // ── Per-cell families (inline, isolated, 30-day gated) ──
  let cellCostUsd = 0;
  const cellFamilies: {
    type: EnrichmentType;
    run: (k: string) => Promise<unknown>;
  }[] = [];
  if (has("meta_ads"))
    cellFamilies.push({ type: "meta_ads", run: runMetaAdsForCell });
  if (has("google_ads"))
    cellFamilies.push({ type: "google_ads", run: runGoogleAdsForCell });
  if (has("serp")) cellFamilies.push({ type: "serp", run: runSerpForCell });

  for (const k of cellKeys) {
    const perCell = fresh.perCell.get(k) ?? {};
    for (const cf of cellFamilies) {
      const cursor = perCell[cf.type];
      if (isFresh(cursor, ENRICHMENT_PRICES[cf.type].freshnessDays, now)) {
        continue; // served from DB at $0
      }
      try {
        await cf.run(k);
        cellCostUsd += ENRICHMENT_PRICES[cf.type].usdPerUnit;
      } catch (err) {
        logErr(cf.type, k, err);
      }
    }
  }

  // ── Reachability gate (Phase 4) ──
  // Server-enforced: hidden/unreachable businesses are silently skipped here —
  // never enriched, never billed — and counted on the run. isHidden already
  // encodes both the explicit hide and the OK-scan-zero-reach case
  // (computeHidden), so a single indexed filter covers the gate.
  let enrichableIds = businessIds;
  let skippedHidden = 0;
  if (businessIds.length > 0) {
    const hidden = await prisma.business.findMany({
      where: { id: { in: businessIds }, isHidden: true },
      select: { id: true },
    });
    if (hidden.length > 0) {
      const hiddenSet = new Set(hidden.map((b) => b.id));
      enrichableIds = businessIds.filter((id) => !hiddenSet.has(id));
      skippedHidden = hidden.length;
    }
  }

  // ── Per-business families → EnrichmentJob rows ──
  const plan = buildJobPlan(has);
  const jobRows: {
    businessId: string;
    family: JobFamily;
    status: "QUEUED" | "SKIPPED_FRESH";
    costUsd: number;
    runId: string;
  }[] = [];
  for (const id of enrichableIds) {
    const pb = fresh.perBusiness.get(id) ?? {};
    for (const entry of plan) {
      const cursorVal = entry.cursor ? pb[entry.cursor] : null;
      const alreadyFresh = isFresh(cursorVal, entry.freshDays, now);
      jobRows.push({
        businessId: id,
        family: entry.family,
        status: alreadyFresh ? "SKIPPED_FRESH" : "QUEUED",
        costUsd: alreadyFresh ? 0 : entry.plannedUsd,
        runId,
      });
    }
  }
  // Chunked createMany (avoid a single oversized INSERT on big cohorts).
  for (let i = 0; i < jobRows.length; i += 1000) {
    await prisma.enrichmentJob.createMany({ data: jobRows.slice(i, i + 1000) });
  }

  // Seed actualUsd with the cell cost (job costs are added at close) + record
  // the hidden businesses skipped by the gate.
  await prisma.enrichmentRun.update({
    where: { id: runId },
    data: { actualUsd: cellCostUsd, unitsSkippedHidden: skippedHidden },
  });

  return { jobsCreated: jobRows.length, cellCostUsd };
}

/** Re-check freshness at processing time (a unit may have gone fresh since
 *  fan-out via another run) so quoted-fresh units are never re-fetched. */
async function unitFreshAtProcess(
  businessId: string,
  family: JobFamily,
  now: Date,
): Promise<boolean> {
  if (family === "CONTACTS") {
    const b = await prisma.business.findUnique({
      where: { id: businessId },
      select: { contactsExtractedAt: true },
    });
    return isFresh(
      b?.contactsExtractedAt,
      ENRICHMENT_PRICES.contacts.freshnessDays,
      now,
    );
  }
  if (family === "REVIEWS") {
    const b = await prisma.business.findUnique({
      where: { id: businessId },
      select: { reviewsLastDeltaAt: true },
    });
    return isFresh(
      b?.reviewsLastDeltaAt,
      ENRICHMENT_PRICES.reviews.freshnessDays,
      now,
    );
  }
  return false;
}

type ProcessOutcome = "done" | "failed" | "requeued" | "skipped";

/**
 * Process one claimed EnrichmentJob: re-check freshness, run the family worker,
 * and record DONE / SKIPPED_FRESH / FAILED — or requeue with an incremented
 * attempt count when retries remain. Exported for unit testing.
 */
export async function processJob(
  job: {
    id: string;
    businessId: string;
    family: string;
    attempts: number;
    costUsd: unknown;
  },
  now: Date = new Date(),
): Promise<ProcessOutcome> {
  const family = job.family as JobFamily;
  const worker = WORKER[family];
  if (!worker) {
    await prisma.enrichmentJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        costUsd: 0,
        errorMessage: "no worker",
        finishedAt: now,
      },
    });
    return "failed";
  }

  // Worker-side freshness re-check — don't re-fetch / re-bill a now-fresh unit.
  if (await unitFreshAtProcess(job.businessId, family, now)) {
    await prisma.enrichmentJob.update({
      where: { id: job.id },
      data: { status: "SKIPPED_FRESH", costUsd: 0, finishedAt: now },
    });
    return "skipped";
  }

  await prisma.enrichmentJob.update({
    where: { id: job.id },
    data: { status: "RUNNING", startedAt: now },
  });

  try {
    await worker(job.businessId);
    await prisma.enrichmentJob.update({
      where: { id: job.id },
      data: { status: "DONE", finishedAt: new Date() },
    });
    return "done";
  } catch (err) {
    logErr(family, job.businessId, err);
    const nextAttempts = job.attempts + 1;
    const msg = err instanceof Error ? err.message : String(err);
    if (nextAttempts >= MAX_JOB_ATTEMPTS) {
      await prisma.enrichmentJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          costUsd: 0,
          attempts: nextAttempts,
          errorMessage: msg.slice(0, 500),
          finishedAt: new Date(),
        },
      });
      return "failed";
    }
    // Requeue: next tick retries (the 2-min cron cadence is the backoff).
    await prisma.enrichmentJob.update({
      where: { id: job.id },
      data: {
        status: "QUEUED",
        attempts: nextAttempts,
        errorMessage: msg.slice(0, 500),
        startedAt: null,
      },
    });
    return "requeued";
  }
}

/**
 * Close a RUNNING run once it has no non-terminal jobs: run the expert layer for
 * touched businesses, compute the actual completed cost, set OK/PARTIAL, and
 * settle the credit hold (refunding the quote-vs-actual diff). Returns true when
 * it closed the run. Exported for unit testing.
 */
export async function closeRunIfDone(
  runId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const open = await prisma.enrichmentJob.count({
    where: { runId, status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (open > 0) return false;

  const run = await prisma.enrichmentRun.findUnique({
    where: { id: runId },
    select: { id: true, status: true, actualUsd: true },
  });
  if (!run || run.status !== "RUNNING") return false;

  const jobs = await prisma.enrichmentJob.findMany({
    where: { runId },
    select: { status: true, businessId: true, costUsd: true },
  });
  const done = jobs.filter((j) => j.status === "DONE");
  const fresh = jobs.filter((j) => j.status === "SKIPPED_FRESH");
  const failed = jobs.filter((j) => j.status === "FAILED");

  const jobUsd = done.reduce((s, j) => s + Number(j.costUsd ?? 0), 0);
  const cellUsd = Number(run.actualUsd ?? 0);
  const totalUsd = cellUsd + jobUsd;

  // Expert layer auto-runs once per touched business ($0, deterministic).
  const touched = [...new Set(done.map((j) => j.businessId))];
  for (const id of touched) {
    try {
      await runPlaybooksForBusiness(id);
    } catch (err) {
      logErr("playbooks", id, err);
    }
  }

  await prisma.enrichmentRun.update({
    where: { id: runId },
    data: {
      status: failed.length > 0 ? "PARTIAL" : "OK",
      unitsCompleted: done.length,
      actualUsd: totalUsd,
      finishedAt: now,
    },
  });

  const hadProgress = done.length + fresh.length > 0 || totalUsd > 0;
  await reconcileRunCredits(runId, {
    actualCredits: usdToCredits(totalUsd),
    hadProgress,
  });
  return true;
}

/**
 * Execute one PENDING Discovery: reconstruct the cell requests from cellKeys
 * (resolving categoryId from BusinessCategory.dataforseoId) and hand off to
 * runDiscovery, which upserts the SAME row by idempotency key. Settles the
 * discovery credit hold against the actual fetch cost. Exported for testing.
 */
export async function processDiscovery(discoveryId: string): Promise<boolean> {
  const d = await prisma.discovery.findUnique({
    where: { id: discoveryId },
    select: {
      id: true,
      agencyId: true,
      requestedByUserId: true,
      cellKeys: true,
    },
  });
  if (!d) return false;

  try {
    const cells: {
      categorySlug: string;
      categoryId: string;
      metroSlug: string;
      country: string;
    }[] = [];
    for (const ck of d.cellKeys) {
      const p = parseCellKey(ck);
      if (!p) continue;
      const cat = await prisma.businessCategory.findFirst({
        where: { dataforseoId: p.categorySlug },
        select: { id: true },
      });
      if (!cat) continue;
      cells.push({
        categorySlug: p.categorySlug,
        categoryId: cat.id,
        metroSlug: p.metroSlug,
        country: p.country,
      });
    }

    if (cells.length === 0) {
      await prisma.discovery.update({
        where: { id: d.id },
        data: { status: "FAILED" },
      });
      await reconcileRunCredits(d.id, { hadProgress: false });
      return false;
    }

    await runDiscovery({
      agencyId: d.agencyId,
      userId: d.requestedByUserId,
      cells,
    });

    // Settle against the actual DfS fetch cost — fresh cells served from the DB
    // refund to $0 (the execution-side no-double-spend guard).
    const after = await prisma.discovery.findUnique({
      where: { id: d.id },
      select: { totalCostUsd: true },
    });
    await reconcileRunCredits(d.id, {
      actualCredits: usdToCredits(after?.totalCostUsd ?? 0),
      hadProgress: true,
    });
    return true;
  } catch (err) {
    logErr("discovery", discoveryId, err);
    await prisma.discovery
      .update({ where: { id: d.id }, data: { status: "FAILED" } })
      .catch(() => {});
    await reconcileRunCredits(d.id, { hadProgress: false });
    return false;
  }
}

/**
 * Recover crashed work before draining: reset jobs stuck in RUNNING (a tick that
 * died mid-process) back to QUEUED, and discoveries stuck in RUNNING back to
 * PENDING so the next tick re-dispatches them. Idempotent.
 */
export async function reconcileStuck(now: Date = new Date()): Promise<void> {
  const jobCutoff = new Date(now.getTime() - STUCK_JOB_MINUTES * 60_000);
  await prisma.enrichmentJob.updateMany({
    where: { status: "RUNNING", startedAt: { lt: jobCutoff } },
    data: { status: "QUEUED", startedAt: null },
  });
  const discCutoff = new Date(now.getTime() - STUCK_DISCOVERY_MINUTES * 60_000);
  await prisma.discovery.updateMany({
    where: {
      status: "RUNNING",
      finishedAt: null,
      createdAt: { lt: discCutoff },
    },
    data: { status: "PENDING" },
  });
}

/**
 * One dispatch tick: recover stuck work, drain PENDING discoveries + runs, work
 * a batch of QUEUED jobs, then close any finished runs. Called by the internal
 * dispatch cron inside a withCronRun (so external calls are cost-attributed +
 * never in a user request path).
 */
export async function dispatchPending(limit = 10): Promise<DispatchResult> {
  const res: DispatchResult = {
    discoveriesRun: 0,
    discoveriesFailed: 0,
    enrichmentRunsProcessed: 0,
    unitsDone: 0,
    unitsFailed: 0,
    jobsRequeued: 0,
    runsClosed: 0,
  };
  const now = new Date();

  await reconcileStuck(now);

  // Discoveries first — they produce the businesses enrichments need.
  const pendingDiscoveries = await prisma.discovery.findMany({
    where: { status: "PENDING" },
    select: { id: true },
    take: limit,
    orderBy: { createdAt: "asc" },
  });
  for (const d of pendingDiscoveries) {
    if (await processDiscovery(d.id)) res.discoveriesRun++;
    else res.discoveriesFailed++;
  }

  // Fan out PENDING enrichment runs into jobs (+ run cell families inline).
  const pendingRuns = await prisma.enrichmentRun.findMany({
    where: { status: "PENDING" },
    select: { id: true },
    take: limit,
    orderBy: { startedAt: "asc" },
  });
  for (const r of pendingRuns) {
    await fanOutRun(r.id, now);
    res.enrichmentRunsProcessed++;
  }

  // Work a batch of QUEUED jobs across all RUNNING runs.
  const queued = await prisma.enrichmentJob.findMany({
    where: { status: "QUEUED" },
    select: {
      id: true,
      businessId: true,
      family: true,
      attempts: true,
      costUsd: true,
    },
    take: JOB_BATCH,
    orderBy: { createdAt: "asc" },
  });
  for (const job of queued) {
    const outcome = await processJob(job, new Date());
    if (outcome === "done") res.unitsDone++;
    else if (outcome === "failed") res.unitsFailed++;
    else if (outcome === "requeued") res.jobsRequeued++;
  }

  // Close any RUNNING runs whose jobs are all terminal (also recovers a run
  // whose last-job-close crashed on a prior tick).
  const runningRuns = await prisma.enrichmentRun.findMany({
    where: { status: "RUNNING" },
    select: { id: true },
    take: RUNNING_RUN_CLOSE_LIMIT,
    orderBy: { startedAt: "asc" },
  });
  for (const r of runningRuns) {
    if (await closeRunIfDone(r.id, new Date())) res.runsClosed++;
  }

  return res;
}
