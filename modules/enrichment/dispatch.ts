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
//     • per-CELL families (meta/google/serp) collect once per cell (few, cheap,
//       30-day gated) — enqueued to the Boxly worker (/api/internal/enrich-cell)
//       when it's configured, else run inline in the tick as the fallback
//       (WP1-5/WP3-2); fresh cells are served from DB at $0 in both paths;
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

import pLimit from "p-limit";

import prisma, { Prisma } from "@/lib/prisma";
import { parseCellKey } from "@/lib/cell";
import {
  ENRICHMENT_PRICES,
  CREDIT_PRICES,
  enrichmentNeedsWebsite,
  type EnrichmentType,
} from "@/modules/cost/pricing";
import { reconcileRunCredits } from "@/modules/cost/server";
import { entitlementBillingEnabled } from "@/modules/cost/flags";
import { trackProductEvent } from "@/lib/analytics/product-events";
import { markCronWork, GATED_CRON } from "@/lib/cron/idle-gate";
import { loadFreshTimestamps } from "@/modules/discovery/enrich-fresh-db";
import { loadEntitlements } from "@/modules/discovery/entitlements";
import { decideUnit } from "@/modules/enrichment/unit-decision";
import { enrichLighthouseForBusinesses } from "@/modules/discovery/enrich-lighthouse";
import { runDiscovery } from "@/modules/discovery/run-discovery";
import { rawListWhere } from "@/modules/discovery/raw-list";
import { scanBusinessContacts } from "@/modules/contacts/scan";
import { submitReviewJob } from "@/modules/reviews/review-job";
import { runMetaAdsForCell } from "@/modules/cell-intel/meta-ads";
import { runGoogleAdsForBusiness } from "@/modules/cell-intel/google-ads";
import { runSerpForCell } from "@/modules/cell-intel/serp";
import { runAiResearchForBusiness } from "@/modules/ai-research/pipeline";
import {
  extractServicesForBusiness,
  recomputeCellServicePrevalence,
} from "@/modules/services-general/extract";
import { recomputeCellMetric } from "@/modules/cell-intel/recompute-metrics";
import {
  enrichWorkerAvailable,
  enqueueRootJobs,
  enqueueCellJobs,
  type CellJobRef,
} from "@/modules/enrichment/enrich-worker-dispatch";
import { enqueueClosePlaybooks } from "@/modules/enrichment/close-playbooks-dispatch";
import {
  incrRunProgress,
  seedRunProgress,
} from "@/modules/enrichment/run-progress-counter";

// ── Tunables ──────────────────────────────────────────────────────────────
const MAX_JOB_ATTEMPTS = 3;
const JOB_BATCH =
  Number(process.env.ENRICHMENT_JOB_BATCH) > 0
    ? Number(process.env.ENRICHMENT_JOB_BATCH)
    : 25;
// How many jobs run CONCURRENTLY within a batch. Each job is a long, I/O-bound
// external call (a DfS Lighthouse audit is ~10-30s), so running them one-at-a-
// time is the throughput floor (73 × ~10s ≈ 12 min). Concurrency collapses
// that to ~batch/concurrency waves. Kept conservative: even at 8-wide the
// effective request rate is well under DfS's 10 req/s (each call is seconds
// long), and per-family cost ceilings still bound spend.
const JOB_CONCURRENCY =
  Number(process.env.ENRICHMENT_JOB_CONCURRENCY) > 0
    ? Number(process.env.ENRICHMENT_JOB_CONCURRENCY)
    : 6;
const STUCK_JOB_MINUTES = 10;
const STUCK_DISCOVERY_MINUTES = 30;
// WP1-4 · a RUNNING run with no jobs (crashed mid-fanOut, before createMany)
// older than this is reset to PENDING by reconcileStuck so it re-fans-out
// instead of closing as a phantom OK with 0 units.
const STUCK_RUN_FANOUT_MINUTES = 15;
const RUNNING_RUN_CLOSE_LIMIT = 50;
// WP1-8 · a single walled Lighthouse job is bounded to ~240s so it stays under
// the dispatch tick budget (Vercel cron 300s) and can't loop forever paying the
// $0.06 actor when it outlives one attempt.
const WALLED_LIGHTHOUSE_MAX_WAIT_MS = 240_000;
const MS_PER_DAY = 86_400_000;

// WP3-6 · exponential retry backoff. On requeue we stamp
// nextAttemptAt = now + 2^attempts minutes, capped, and the pool-claim query
// only admits jobs whose nextAttemptAt is null OR already due. This replaces the
// old "2-min cron cadence IS the backoff" (which burned 3 attempts in ~6 min on
// a vendor blip) with a real backoff, WITHOUT adding a second timer: a due job is
// still picked up by the very next tick, so the cron cadence only bounds the
// LOWER edge of the delay.
const RETRY_BACKOFF_CAP_MIN = 60;
function backoffUntil(attempts: number, now: Date): Date {
  const minutes = Math.min(2 ** Math.max(0, attempts), RETRY_BACKOFF_CAP_MIN);
  return new Date(now.getTime() + minutes * 60_000);
}

// 2026-07-10 · SOFT-FAILURE TAXONOMY. A worker soft failure (ok=false OR
// billable=false, e.g. a contacts fetch that FAILED, a google_ads vendor error)
// used to go terminal FAILED on attempt 1 — the backoff ladder above only ever
// covered THROWN errors, so a recoverable miss (WAF blip, DfS 5xx) never got a
// second try. These reasons are the ones a retry can NEVER fix (structurally
// impossible) OR is not worth the vendor cost of re-running, so they stay
// terminal; every OTHER soft failure now flows through the same bounded backoff
// ladder as a throw. This same set seeds P3's "permanent" lifecycle (a job whose
// terminal reason is non-retryable is rendered "Not available", not "retry").
//   - contacts_skipped_no_source  · no website/handle to scan — nothing to retry
//   - reviews_submit_failed        · no CID / task_post exhausted — no async land
//   - lighthouse_0_audited         · open+walled already tried; retry risks the
//                                    $0.06 walled actor for ~no recall gain
//   - google_ads_no-website        · no host to target the ads_search on
//
// INC-58 · `google_ads_skipped` was REMOVED from this set. 49 LEGACY FAILED
// rows carry that reason for what were TRANSIENT DfS throws (the pre-fix
// collector swallowed them as outcome "skipped"; 11/13 hand-retries succeeded)
// — keeping it here poisoned the permanent-failure ledger: those 49
// (business, google_ads) pairs read "permanently unavailable" for 30 days, got
// EXCLUDED from quotes and SKIPPED at fan-out (the rerun quoted google_ads at a
// fraction of its true billable count · held 30 vs the shown ~52). The NEW
// collector writes `google_ads_error` for transient vendor errors and
// "skipped" only for an unknown-business edge — rare enough that the cross-run
// 3-attempt cap covers it without a reason-level sentence.
// INC-59 · authoritative website-gone verdicts (named at the FIRST failed
// fetch): the domain doesn't resolve, nothing listens, or the domain serves a
// registrar parking page — retrying can never help; the 30-day recovery window
// re-probes monthly in case the site comes back.
const NON_RETRYABLE_FAILURE_REASONS: ReadonlySet<string> = new Set([
  "contacts_skipped_no_source",
  "contacts_site_gone_dns",
  "contacts_site_gone_conn",
  "contacts_domain_parked",
  "reviews_submit_failed",
  "lighthouse_0_audited",
  "google_ads_no-website",
]);
/** True when a soft-failure reason cannot (or should not) be auto-retried. */
export function isNonRetryableFailure(reason: string | undefined): boolean {
  if (!reason) return false;
  return (
    NON_RETRYABLE_FAILURE_REASONS.has(reason) ||
    /_no[-_](source|website|cid)$/.test(reason)
  );
}

// 2026-07-10 · P3 · PERMANENT-FAILURE LIFECYCLE (cross-run cap). Within a run the
// backoff ladder already bounds retries at MAX_JOB_ATTEMPTS. But a dead site / a
// business with no scrapeable source fails EVERY run — and today the workbench
// showed "Failed · Enrich 45 · ~55 cr" forever, so the user could re-pay to
// re-run a job that can NEVER succeed (money leak + eroded trust). A (business,
// family) is "Not available" once it has FAILED this many times ACROSS runs OR
// its latest failure was structurally non-retryable. Such pairs are skipped at
// fan-out (no job, no vendor $, no charge) and must be excluded from the enrich
// sheet's to-get count + quote (the paired UX surface).
const PERMANENT_FAILURE_ATTEMPT_CAP = 3;
// RECOVERY WINDOW (code-review Medium-2): only FAILED rows within this window
// count toward the cap, so a transiently-down site (or a vendor flaky for a
// stretch) isn't skipped FOREVER. Once its old failures age out the pair is
// retried; a genuinely-dead one just re-fails and re-marks (≈ monthly retry),
// and a business that later ADDS a website gets a fresh chance. This is what
// gives "Not available" a recovery path instead of a life sentence.
const PERMANENT_FAILURE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Key a (business, family) pair for the permanent-failure set. */
function pairKey(businessId: string, family: JobFamily): string {
  return `${businessId}:${family}`;
}

/**
 * The set of (business, family) pairs that are PERMANENTLY UNAVAILABLE — they've
 * exhausted the cross-run attempt cap or hit a structurally non-retryable reason
 * WITHIN the recovery window, so re-running them now can't help. Keyed
 * `${businessId}:${family}`. Computed from recent EnrichmentJob FAILED history in
 * ONE indexed read; empty input → empty set.
 */
export async function permanentlyUnavailablePairs(
  businessIds: readonly string[],
  families: readonly JobFamily[],
  now: Date = new Date(),
): Promise<Set<string>> {
  if (businessIds.length === 0 || families.length === 0) return new Set();
  const failed = await prisma.enrichmentJob.findMany({
    where: {
      businessId: { in: [...businessIds] },
      family: { in: [...families] },
      status: "FAILED",
      // Recovery window — old failures age out so a recovered business is retried.
      finishedAt: {
        gte: new Date(now.getTime() - PERMANENT_FAILURE_WINDOW_MS),
      },
    },
    select: {
      id: true,
      runId: true,
      businessId: true,
      family: true,
      errorMessage: true,
      finishedAt: true,
    },
  });
  // INC-58 · the cap counts DISTINCT RUNS that failed, not FAILED rows. The
  // in-run backoff ladder writes one terminal row per run, but historic rows +
  // reruns stack fast — counting rows let a single afternoon of retries hang a
  // 30-day "Not available" sentence (the stuck 1-lead run: 3 rows from 3 runs
  // over 4.5h). Distinct-runs is the honest "we tried on N separate occasions".
  const runsPerPair = new Map<string, Set<string>>();
  const latest = new Map<string, { at: number; reason: string | null }>();
  for (const j of failed) {
    const k = pairKey(j.businessId, j.family as JobFamily);
    const runsSet = runsPerPair.get(k) ?? new Set<string>();
    runsSet.add(j.runId ?? j.id); // run-less legacy rows count individually
    runsPerPair.set(k, runsSet);
    const at = j.finishedAt ? j.finishedAt.getTime() : 0;
    const prev = latest.get(k);
    if (!prev || at >= prev.at) latest.set(k, { at, reason: j.errorMessage });
  }
  const dead = new Set<string>();
  for (const [k, runs] of runsPerPair) {
    const reason = latest.get(k)?.reason ?? undefined;
    if (
      runs.size >= PERMANENT_FAILURE_ATTEMPT_CAP ||
      isNonRetryableFailure(reason)
    ) {
      dead.add(k);
    }
  }
  return dead;
}

// WP3-7 · tick budget. A dispatch tick recovers stuck work, drains discoveries,
// fans out runs, works a job batch, and closes runs — all under Vercel's 300s
// cap. Discovery processing is the heaviest (a full DfS market pull), so we cap
// it to a couple per tick AND stop draining once the tick has burned this much
// wall-clock, guaranteeing a job batch always gets to run.
const MAX_DISCOVERIES_PER_TICK = 2;
const DISCOVERY_DRAIN_BUDGET_MS = 120_000;
const TICK_HARD_BUDGET_MS = 240_000; // leave ~60s headroom under the 300s cap

// WP3-10 · multi-tenant fairness. The QUEUED-job claim is round-robined across
// agencies with pending work (N jobs per agency per tick) so one 500-lead run
// can't monopolise the batch and freeze other tenants. A per-agency cap on
// concurrently-RUNNING runs (Agency.maxConcurrentRuns, default below) bounds how
// many of one tenant's runs fan out at once.
const PER_AGENCY_JOBS_PER_TICK =
  Number(process.env.ENRICHMENT_PER_AGENCY_JOBS) > 0
    ? Number(process.env.ENRICHMENT_PER_AGENCY_JOBS)
    : Math.max(1, Math.ceil(JOB_BATCH / 2));
const DEFAULT_MAX_CONCURRENT_RUNS = 3;

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
  /** True when work remains AND this tick made progress — the caller should
   *  immediately re-kick the dispatch (self-chain) so batches run back-to-back
   *  instead of waiting for the next 2-min cron tick. */
  hasMoreWork: boolean;
  /** True when this tick observed a FULLY-DRAINED system: no pending discoveries,
   *  no pending/running runs, and no runnable QUEUED jobs (and the tick actually
   *  looked at the pool — i.e. was not cut short by the time budget). Drives the
   *  Neon idle gate: the route clears the wake flag on `idle` so the next tick
   *  can skip. Conservative — future-dated backoff jobs make it false only while
   *  their run is RUNNING; a run whose only remaining work is a future retry is
   *  still picked up by the gate's safety scan. */
  idle: boolean;
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

/**
 * Refresh a cell's standards (CellMetric distributions → CellStandardsPanel /
 * VsCellBar) and, when services ran, its service prevalence ("X% of the cell
 * offers this"). Best-effort: a recompute hiccup must never fail the run /
 * discovery close. Without this the standards panels render empty for every
 * freshly discovered/enriched demand cell.
 */
async function recomputeCells(
  cellKeys: readonly string[],
  opts: { withPrevalence: boolean } = { withPrevalence: false },
): Promise<void> {
  for (const k of cellKeys) {
    try {
      await recomputeCellMetric(k);
    } catch (err) {
      logErr("recompute-metric", k, err);
    }
    if (opts.withPrevalence) {
      try {
        await recomputeCellServicePrevalence(k);
      } catch (err) {
        logErr("recompute-prevalence", k, err);
      }
    }
  }
}

// ── Per-business job plan ────────────────────────────────────────────────────

type JobFamily =
  | "CONTACTS"
  | "SERVICES"
  | "REVIEWS"
  | "AI_RESEARCH"
  | "LIGHTHOUSE"
  | "GOOGLE_ADS";
type FreshCursor =
  | "contacts"
  | "reviews"
  | "lighthouse"
  | "services"
  | "ai_research"
  | "google_ads"
  | null;

/** Per-business JobFamily → billable EnrichmentType, for the entitlement lookup.
 *  (TECH rides the CONTACTS job, so a contacts entitlement covers it — the mint
 *  side materializes both; here we only key on the job's own family.) */
const JOB_FAMILY_TO_TYPE: Record<JobFamily, EnrichmentType> = {
  CONTACTS: "contacts",
  SERVICES: "services",
  REVIEWS: "reviews",
  AI_RESEARCH: "ai_research",
  LIGHTHOUSE: "lighthouse",
  GOOGLE_ADS: "google_ads",
};

/** P3 · business-basis EnrichmentType → its JobFamily (tech rides CONTACTS;
 *  cell families have no job family → null). Exported so the preflight quote
 *  can exclude permanently-unavailable pairs with the SAME keying as fan-out. */
export function jobFamilyForType(t: EnrichmentType): JobFamily | null {
  switch (t) {
    case "contacts":
    case "tech":
      return "CONTACTS";
    case "services":
      return "SERVICES";
    case "reviews":
      return "REVIEWS";
    case "ai_research":
      return "AI_RESEARCH";
    case "lighthouse":
      return "LIGHTHOUSE";
    case "google_ads":
      return "GOOGLE_ADS";
    default:
      return null; // meta_ads / serp — cell-basis, no per-business job
  }
}

interface JobPlanEntry {
  family: JobFamily;
  plannedUsd: number;
  cursor: FreshCursor;
  freshDays: number;
}

/**
 * WP1-2 · Worker-outcome contract. Every family worker reports whether it did
 * BILLABLE work, decoupled from whether it threw:
 *   - ok=false          → the worker threw (retryable — processJob requeues/fails).
 *   - ok=true, billable=false → the worker ran but produced nothing chargeable
 *                          (contacts fetch FAILED, lighthouse 0 audits, reviews
 *                          submitted-not-landed). The job is NOT billed
 *                          (costUsd=0) and its terminal state is chosen so the
 *                          settle refunds the unused hold (WP1-9 keeps REVIEWS
 *                          non-terminal until the ReviewJob lands).
 *   - ok=true, billable=true  → real work landed; the job bills its plannedUsd.
 *
 * `terminal` lets a worker say "don't mark me DONE, I'm waiting on an async
 * follow-up" (REVIEWS after submit): the job is parked AWAITING and closeRunIfDone
 * treats it as non-terminal until the ReviewJob reaches a terminal state.
 */
interface WorkerResult {
  ok: boolean;
  billable: boolean;
  /** Default true. false → the family completed submission but the real result
   *  lands asynchronously; the EnrichmentJob must stay non-terminal (WP1-9). */
  terminal?: boolean;
  reason?: string;
}

/** The per-business worker for each job family. CONTACTS also fingerprints tech
 *  off the same fetch, so a contacts OR tech selection maps to one scan job.
 *  Each returns a WorkerResult so processJob can bill outcome-based, never
 *  no-throw-based (WP1-2). A THROW still propagates for the retry ladder. */
const WORKER: Record<JobFamily, (businessId: string) => Promise<WorkerResult>> =
  {
    CONTACTS: async (id) => {
      const r = await scanBusinessContacts(id);
      // WP1-2 · a FAILED fetch (transient site-down) or a SKIPPED no-op is not
      // billable — cost 0, mark FAILED (retryable) so the 3-attempt ladder + the
      // stuck-reset re-try it and the settle refunds it. Only OK bills.
      // INC-59 · a NAMED permanent verdict (site_gone_dns / site_gone_conn /
      // domain_parked) rides through as `contacts_<verdict>` — non-retryable on
      // the FIRST strike, so a domain that doesn't exist never burns the ladder.
      if (r.status === "FAILED") {
        return {
          ok: false,
          billable: false,
          reason: r.failureReason
            ? `contacts_${r.failureReason}`
            : "contacts_fetch_failed",
        };
      }
      if (r.status === "SKIPPED") {
        return {
          ok: true,
          billable: false,
          reason: "contacts_skipped_no_source",
        };
      }
      return { ok: true, billable: true };
    },
    SERVICES: async (id) => {
      await extractServicesForBusiness(id);
      return { ok: true, billable: true };
    },
    // WP1-9 · REVIEWS is billed/DONE on DATA LANDING, not task submission. The
    // worker only SUBMITS the DfS task here (a durable ReviewJob → AWAITING_PINGBACK).
    // It returns billable=false + terminal=false so the EnrichmentJob is parked in
    // a non-terminal state; closeRunIfDone reconciles it against the ReviewJob's
    // state machine (DONE → bill, FAILED → no-bill) so the run never closes OK with
    // empty reviews. A submit that itself FAILED (no CID / task_post exhausted) is
    // terminal-non-billable — no async landing will ever come.
    REVIEWS: async (id) => {
      const job = await submitReviewJob(id, "manual");
      if (job.status === "FAILED") {
        return { ok: true, billable: false, reason: "reviews_submit_failed" };
      }
      return { ok: true, billable: false, terminal: false };
    },
    AI_RESEARCH: async (id) => {
      await runAiResearchForBusiness(id);
      return { ok: true, billable: true };
    },
    // One business per job. enrichLighthouseForBusinesses does open-first (cheap
    // DfS, ~$0.004) and only runs the $0.06 walled actor on a Cloudflare-challenge
    // result — walledLimit:1 + maxUsageUsd:0.1 hard-cap a single business so it
    // can't run away (the dispatch cron supplies the required open CronRun).
    // WP1-2 · billable only when an audit actually persisted (open OR walled);
    // 0-audited (all skipped / failed) is not charged. WP1-8 · maxWaitMs bounds
    // the walled actor so a single job stays under the tick budget (~240s).
    LIGHTHOUSE: async (id) => {
      const r = await enrichLighthouseForBusinesses([id], {
        walledLimit: 1,
        maxUsageUsd: 0.1,
        maxWaitMs: WALLED_LIGHTHOUSE_MAX_WAIT_MS,
      });
      const audited = r.openAudited + r.walledAudited;
      if (audited > 0) return { ok: true, billable: true };
      return { ok: true, billable: false, reason: "lighthouse_0_audited" };
    },
    // B1 · per-business Google ads via target-host ads_search. Reliable
    // attribution: every returned creative belongs to the business's domain by
    // construction. Billable when the collection actually RAN (outcome
    // "collected") — even with 0 creatives, that's a real, verified-empty result
    // the customer paid one ads_search for (parity with a reviews/contacts pull
    // that lands 0 rows but did the work). A website-less business can't run
    // (no host to target) → non-billable no-op; the dispatch never queues one
    // (google_ads is WEBSITE_DEPENDENT), but guard it here too.
    GOOGLE_ADS: async (id) => {
      const r = await runGoogleAdsForBusiness(id);
      if (r.outcome === "collected") return { ok: true, billable: true };
      return { ok: true, billable: false, reason: `google_ads_${r.outcome}` };
    },
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
      // A4 · 90-day freshness cursor (Business.servicesLastAt) so a repeat run
      // within the window is SKIPPED_FRESH at $0 instead of re-billing.
      cursor: "services",
      freshDays: 90,
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
  if (has("lighthouse")) {
    plan.push({
      family: "LIGHTHOUSE",
      plannedUsd: ENRICHMENT_PRICES.lighthouse.usdPerUnit,
      cursor: "lighthouse",
      freshDays: ENRICHMENT_PRICES.lighthouse.freshnessDays,
    });
  }
  if (has("ai_research")) {
    plan.push({
      family: "AI_RESEARCH",
      plannedUsd: ENRICHMENT_PRICES.ai_research.usdPerUnit,
      // A4 · 90-day freshness cursor (Business.aiResearchLastAt) so a repeat run
      // within the window is SKIPPED_FRESH at $0 instead of re-billing.
      cursor: "ai_research",
      freshDays: 90,
    });
  }
  if (has("google_ads")) {
    plan.push({
      family: "GOOGLE_ADS",
      plannedUsd: ENRICHMENT_PRICES.google_ads.usdPerUnit,
      // B1 · 30-day freshness cursor (Business.googleAdsLastAt) so a repeat run
      // within the window is SKIPPED_FRESH at $0 instead of re-billing.
      cursor: "google_ads",
      freshDays: ENRICHMENT_PRICES.google_ads.freshnessDays,
    });
  }
  return plan;
}

// ── Credit billing (CREDIT_PRICES) — settle side ─────────────────────────────
// Settle bills WHOLE CREDITS from CREDIT_PRICES (the customer price), mirroring
// the quote (modules/cost/estimate.ts), NOT usdToCredits(vendorUSD). This is
// what gives us margin instead of cost pass-through.

// B1 · google_ads moved OUT to a per-business job (GOOGLE_ADS, reliable
// target-host attribution). Only meta_ads + serp remain per-cell.
const CELL_FAMILIES: readonly EnrichmentType[] = ["meta_ads", "serp"];

/** Credits one completed per-business job bills, given the run's selected
 *  families. The CONTACTS scan job covers contacts+tech (one DOM fetch), so it
 *  sums whichever of those the run selected — exactly matching the quote's
 *  per-line credit sum. */
function creditsForBusinessJob(
  family: JobFamily,
  has: (f: EnrichmentType) => boolean,
): number {
  switch (family) {
    case "CONTACTS":
      return (
        (has("contacts") ? CREDIT_PRICES.contacts : 0) +
        (has("tech") ? CREDIT_PRICES.tech : 0)
      );
    case "SERVICES":
      return CREDIT_PRICES.services;
    case "REVIEWS":
      return CREDIT_PRICES.reviews;
    case "LIGHTHOUSE":
      return CREDIT_PRICES.lighthouse;
    case "AI_RESEARCH":
      return CREDIT_PRICES.ai_research;
    case "GOOGLE_ADS":
      return CREDIT_PRICES.google_ads;
  }
}

/** A cell family → the AdMarketRun platform its collector writes on run/fail. */
const CELL_PLATFORM: Partial<Record<EnrichmentType, string>> = {
  meta_ads: "META",
  serp: "SERP",
};

// 2026-07-10 · S3 fix · a run's per-cell families (meta_ads/serp) create NO
// EnrichmentJob rows — when the Boxly worker collects them they land via an async
// /api/internal/enrich-cell callback. closeRunIfDone counted ONLY EnrichmentJobs,
// so it closed the run while a cell was still in flight (dental rerun closed
// 00:33:23, META landed 00:35:11 → 11 advertisers unbilled + invisible until
// reload). We hold the run open until every requested cell has either COMPLETED
// an attempt this run OR is being served fresh from a prior run. A hard ceiling
// caps the wait so a genuinely-lost cell attempt (worker died) can't stall the
// run forever (the reverse-stall).
const CELL_PENDING_CEILING_MS = 15 * 60_000;

/**
 * How many requested cells are still in flight for a run — i.e. NOT yet
 * collected this run and NOT served fresh from a prior one. A cell counts as
 * settled when EITHER (a) any terminal AdMarketRun (OK/PARTIAL/FAILED) exists
 * with `ranAt >= startedAt` — the attempt finished this run, success or fail —
 * OR (b) a non-FAILED AdMarketRun sits within the family's freshness window (it
 * was served from DB, so no new run was needed). Past the ceiling we stop
 * waiting (return 0) so a dead worker can't hold the run open indefinitely.
 */
async function pendingCellCount(
  scopeRefsJson: unknown,
  families: readonly EnrichmentType[],
  startedAt: Date | null,
  now: Date,
): Promise<number> {
  const cellFamilies = families.filter((f) => CELL_FAMILIES.includes(f));
  const cellKeys =
    ((scopeRefsJson ?? {}) as { cellKeys?: string[] }).cellKeys ?? [];
  if (cellFamilies.length === 0 || cellKeys.length === 0) return 0;
  // Ceiling: never hold a run open indefinitely on a lost cell attempt.
  if (
    startedAt &&
    now.getTime() - startedAt.getTime() > CELL_PENDING_CEILING_MS
  ) {
    return 0;
  }

  const platforms = cellFamilies
    .map((f) => CELL_PLATFORM[f])
    .filter((p): p is string => Boolean(p));
  if (platforms.length === 0) return 0;
  const maxFreshMs =
    Math.max(...cellFamilies.map((f) => ENRICHMENT_PRICES[f].freshnessDays)) *
    86_400_000;
  const rows = await prisma.adMarketRun.findMany({
    where: {
      cellKey: { in: [...cellKeys] },
      platform: { in: platforms },
      ranAt: { gte: new Date(now.getTime() - maxFreshMs) },
    },
    select: { cellKey: true, platform: true, status: true, ranAt: true },
  });

  let pending = 0;
  for (const f of cellFamilies) {
    const platform = CELL_PLATFORM[f];
    if (!platform) continue;
    const freshMs = ENRICHMENT_PRICES[f].freshnessDays * 86_400_000;
    for (const k of cellKeys) {
      const rowsFor = rows.filter(
        (r) => r.cellKey === k && r.platform === platform,
      );
      const attemptedThisRun =
        !!startedAt && rowsFor.some((r) => r.ranAt >= startedAt);
      const servedFresh = rowsFor.some(
        (r) =>
          r.status !== "FAILED" && now.getTime() - r.ranAt.getTime() <= freshMs,
      );
      if (!attemptedThisRun && !servedFresh) pending += 1;
    }
  }
  return pending;
}

/**
 * Cell-family credits for a run — OUTCOME-GATED (BUG1). A cell family bills ONLY
 * for cells that actually COLLECTED this run: a cell with an OK/PARTIAL
 * `AdMarketRun` whose `ranAt >= runStartedAt`. This makes meta_ads/serp actually
 * pay for delivered cells — previously the run's `scopeRefsJson` carried no
 * quote lines, so this returned 0 and the cell portion of the hold was silently
 * refunded (a revenue leak; we ate the Apify COGS). Now:
 *   - collected cell (OK/PARTIAL, ranAt≥start)      → billed its family credits
 *   - blocked/timeout/error cell (AdMarketRun FAILED) → 0 (refunded, the bug fix)
 *   - deferred / breaker-open cell (no row)          → 0
 *   - fresh-served cell (row predates this run)       → 0 (already paid before)
 * Billed count is capped by the quote's billable count (when lines are present)
 * so we never charge above what was authorized; settle also clamps to the hold.
 */
async function cellCreditsForRun(
  scopeRefsJson: unknown,
  families: readonly EnrichmentType[],
  cellKeys: readonly string[],
  runStartedAt: Date,
  agencyId: string | null = null,
): Promise<number> {
  const cellFamilies = families.filter((f) => CELL_FAMILIES.includes(f));
  if (cellFamilies.length === 0 || cellKeys.length === 0) return 0;

  const scope = (scopeRefsJson ?? {}) as {
    cellCount?: number;
    lines?: { enrichment?: EnrichmentType; total?: number; fresh?: number }[];
  };
  const lines = Array.isArray(scope.lines) ? scope.lines : [];
  // Quote-derived billable cell COUNT per family (fresh already netted out in
  // line.fresh). No persisted lines → cap at the run's cell count; the collected
  // set gates it down to what actually delivered.
  const quotedBillable = new Map<EnrichmentType, number>();
  for (const f of cellFamilies) {
    const line = lines.find((l) => l.enrichment === f);
    quotedBillable.set(
      f,
      line
        ? Math.max(0, (line.total ?? 0) - (line.fresh ?? 0))
        : (scope.cellCount ?? cellKeys.length),
    );
  }

  // Cells that actually COLLECTED this run, per platform — ONE indexed read
  // (AdMarketRun @@index([cellKey, platform, ranAt desc])).
  const platforms = cellFamilies
    .map((f) => CELL_PLATFORM[f])
    .filter((p): p is string => Boolean(p));
  const rows =
    platforms.length > 0
      ? await prisma.adMarketRun.findMany({
          where: {
            cellKey: { in: [...cellKeys] },
            platform: { in: platforms },
            status: { in: ["OK", "PARTIAL"] },
            ranAt: { gte: runStartedAt },
          },
          select: { cellKey: true, platform: true },
        })
      : [];
  const collectedByPlatform = new Map<string, Set<string>>();
  for (const r of rows) {
    const set = collectedByPlatform.get(r.platform) ?? new Set<string>();
    set.add(r.cellKey);
    collectedByPlatform.set(r.platform, set);
  }

  // ── Legacy path (flag off): bill only cells collected THIS run. ──
  if (agencyId == null) {
    let credits = 0;
    for (const f of cellFamilies) {
      const platform = CELL_PLATFORM[f];
      const collected = platform
        ? (collectedByPlatform.get(platform)?.size ?? 0)
        : 0;
      const billable = Math.min(quotedBillable.get(f) ?? 0, collected);
      credits += billable * CREDIT_PRICES[f];
    }
    return credits;
  }

  // ── Entitlement path (G2): a non-owner served a FRESH cell from our DB pays
  // full at zero Apify/DfS COGS (the S14 metro-leak fix). Bill a (cell × family)
  // unless it is owned∧fresh-and-not-collected (SKIPPED_ENTITLED). Mint what we
  // bill. `delivered = collected this run OR fresh in DB`. ──
  const now = new Date();
  const [cellEnt, freshTs] = await Promise.all([
    loadEntitlements(agencyId, [], cellKeys),
    loadFreshTimestamps([], cellKeys),
  ]);
  const CELL_FAMILY_ENUM: Record<string, "META_ADS" | "SERP"> = {
    meta_ads: "META_ADS",
    serp: "SERP",
  };
  let credits = 0;
  const grants: {
    agencyId: string;
    cellKey: string;
    family: "META_ADS" | "SERP";
    creditsCharged: number;
  }[] = [];
  for (const f of cellFamilies) {
    const platform = CELL_PLATFORM[f];
    const famEnum = CELL_FAMILY_ENUM[f];
    if (!platform || !famEnum) continue;
    const collectedSet = collectedByPlatform.get(platform) ?? new Set<string>();
    const window = ENRICHMENT_PRICES[f].freshnessDays;
    let billed = 0;
    const cap = quotedBillable.get(f) ?? 0;
    for (const k of cellKeys) {
      if (billed >= cap) break; // never charge above the authorized count
      const owned = cellEnt.perCell.get(k)?.has(f) ?? false;
      const collected = collectedSet.has(k);
      const fresh = isFresh(freshTs.perCell.get(k)?.[f] ?? null, window, now);
      const delivered = collected || fresh;
      // owned∧fresh∧!collected = SKIPPED_ENTITLED (free no-op); everything else
      // delivered charges (new buy, served-from-DB, or owner refresh of stale).
      if (!delivered || (owned && !collected)) continue;
      billed += 1;
      credits += CREDIT_PRICES[f];
      grants.push({
        agencyId,
        cellKey: k,
        family: famEnum,
        creditsCharged: CREDIT_PRICES[f],
      });
    }
  }
  if (grants.length > 0) {
    try {
      await prisma.agencyEntitlement.createMany({
        data: grants,
        skipDuplicates: true,
      });
    } catch (err) {
      console.warn(
        `[entitlement-mint:cell] mint failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return credits;
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
      agencyId: true,
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
  // Entitlement model (Phase 2): who does THIS agency already own? Loaded only
  // when the flag is on; legacy path never reads it. Empty set = own nothing.
  const entMode = entitlementBillingEnabled();
  const entitlements = entMode
    ? await loadEntitlements(run.agencyId, businessIds, cellKeys)
    : null;

  // Flip RUNNING first so a concurrent tick won't re-fan-out this run (the
  // findUnique+guard above + this flip together gate re-entry). RE-STAMP
  // startedAt to FAN-OUT time (it was defaulted at ENQUEUE): the pendingCellCount
  // ceiling + the cell-billing `ranAt >= startedAt` anchor both key off it, and a
  // run held PENDING past the ceiling (per-agency concurrency cap, or a
  // reconcileStuck re-fan-out which is ≥15 min old by construction) would
  // otherwise fan out with the ceiling ALREADY expired → a cell-only run closes
  // on the same tick with its cell still collecting (the original S3 symptom
  // reopened · verifier hole). Fan-out time is also the correct/tighter billing
  // anchor since cells are only ever collected at/after fan-out.
  await prisma.enrichmentRun.update({
    where: { id: runId },
    data: { status: "RUNNING", startedAt: now },
  });

  // ── Reachability gate (Phase 4) + scope-existence validation (WP9-5) ──
  // Server-enforced: hidden/unreachable businesses are silently skipped here —
  // never enriched, never billed — and counted on the run. isHidden already
  // encodes both the explicit hide and the OK-scan-zero-reach case
  // (computeHidden), so a single indexed filter covers the gate.
  //
  // WP9-5 · scopeRefsJson stays the AUDIT snapshot, but the operational scope is
  // validated against live rows here: a scoped id that no longer resolves to a
  // Business (stale/deleted between quote and fan-out) is dropped, so it never
  // mints an orphan EnrichmentJob that would only fail at worker time. ONE
  // findMany fetches both the existence set and the isHidden flag (the gate and
  // the validation share the query — no extra round-trip). Ids are then
  // intersected with the returned set (existence) minus the hidden ones, while
  // preserving the caller's ordering.
  let enrichableIds = businessIds;
  let skippedHidden = 0;
  if (businessIds.length > 0) {
    const rows = await prisma.business.findMany({
      where: { id: { in: businessIds } },
      select: { id: true, isHidden: true, suppressedAt: true },
    });
    // WP7-2 · a business suppressed (do-not-sell) BETWEEN preflight and fan-out
    // must not mint enrichment jobs. Treat it exactly like a missing/stale id —
    // excluded from `visible`, so no job row is created for it.
    const visible = new Set(
      rows
        .filter((b) => b.isHidden !== true && b.suppressedAt === null)
        .map((b) => b.id),
    );
    // Missing (stale/deleted) ids are absent from `rows` → excluded by the
    // intersection; hidden ids are present but not in `visible` → excluded too.
    // skippedHidden counts ONLY the hidden gate (not the missing ids) so the
    // run's unitsSkippedHidden stays a true "skipped by the reachability gate"
    // tally, not a "scope was stale" tally.
    enrichableIds = businessIds.filter((id) => visible.has(id));
    skippedHidden = rows.filter((b) => b.isHidden === true).length;
  } else if (cellKeys.length > 0) {
    // "Enrich the market" — no explicit business ids, so resolve the cells'
    // enrichable businesses here (defensive: preflightEnrichAction already
    // resolves these into scopeRefs.businessIds, but a cellKeys-only run from
    // any other path must still work). Use rawListWhere so the set matches the
    // visible raw market — excludes hidden/unreachable AND permanently-closed.
    // Mirror preflight's WHOLESALE website scoping (visible==enrichable): a
    // family that needs a live site can't run on a website-less listing, so
    // never queue those jobs.
    const needsWebsite = enrichmentNeedsWebsite(families);
    const inCell = await prisma.business.findMany({
      where: rawListWhere({
        cellKeys: [...cellKeys],
        filters: needsWebsite ? { hasWebsite: true } : undefined,
      }),
      select: { id: true },
      take: 5000,
    });
    enrichableIds = inCell.map((b) => b.id);
  }

  // ── Per-business families → EnrichmentJob rows ──
  // WP1-4 · create the job rows BEFORE the slow inline cell calls. A crash
  // between the RUNNING flip and here leaves a zero-job RUNNING run, which
  // reconcileStuck resets to PENDING to re-fan-out (never a phantom OK). Creating
  // the jobs first also means the crash window with jobs-already-committed is the
  // safe one (closeRunIfDone can drain them; the cell cost just isn't seeded).
  const plan = buildJobPlan(has);

  // WP3-4 · FIRST-SCREEN-FIRST ordering. The workbench opens sorted by the
  // default sort — reviewCount DESC (most-valuable first). createdAt is the
  // pool-claim tiebreak (WP3-12), so if we insert the jobs in that value order,
  // the first pool page — hence the first businesses to enrich — are exactly the
  // ones the user sees on the first screen. Fetch reviewCount for the enrichable
  // set and order ids by it (nulls last, id asc as the stable tiebreak).
  let orderedIds = enrichableIds;
  if (enrichableIds.length > 1) {
    const rc = await prisma.business.findMany({
      where: { id: { in: enrichableIds } },
      select: { id: true, reviewCount: true },
    });
    const rcMap = new Map(rc.map((b) => [b.id, b.reviewCount ?? -1]));
    orderedIds = [...enrichableIds].sort((a, b) => {
      const d = (rcMap.get(b) ?? -1) - (rcMap.get(a) ?? -1); // reviewCount DESC
      return d !== 0 ? d : a < b ? -1 : a > b ? 1 : 0; // id ASC tiebreak
    });
  }

  // P3 · don't re-queue (business, family) pairs that are permanently
  // unavailable (dead site / no source / exhausted cross-run attempts) — a job
  // that can never succeed just burns credits + vendor $ and shows "Failed"
  // forever. One indexed read over the fan-out cohort.
  const deadPairs = await permanentlyUnavailablePairs(
    orderedIds,
    plan.map((e) => e.family),
    now,
  );

  const jobRows: {
    businessId: string;
    family: JobFamily;
    status: "QUEUED" | "SKIPPED_FRESH" | "CHARGED_FROM_DB" | "SKIPPED_ENTITLED";
    costUsd: number;
    runId: string;
    // INC-58 · terminal-at-creation rows (fresh/entitled/db-served) get
    // finishedAt stamped so per-business terminal-time queries don't read NULL
    // for businesses whose every family was already satisfied.
    finishedAt: Date | null;
  }[] = [];
  let skippedUnavailable = 0;
  for (const id of orderedIds) {
    const pb = fresh.perBusiness.get(id) ?? {};
    for (const entry of plan) {
      if (deadPairs.has(pairKey(id, entry.family))) {
        skippedUnavailable += 1;
        continue; // permanently unavailable — no job, no vendor $, no charge
      }
      const cursorVal = entry.cursor ? pb[entry.cursor] : null;
      const alreadyFresh = isFresh(cursorVal, entry.freshDays, now);
      if (entMode && entitlements) {
        // Four-quadrant decouple: owned∧fresh → SKIPPED_ENTITLED ($0 no-op);
        // !owned∧fresh → CHARGED_FROM_DB (charge, no vendor); stale → QUEUED
        // (run). costUsd is VENDOR COGS → 0 unless we actually run the vendor.
        const owned =
          entitlements.perBusiness
            .get(id)
            ?.has(JOB_FAMILY_TO_TYPE[entry.family]) ?? false;
        const decision = decideUnit(owned, alreadyFresh);
        jobRows.push({
          businessId: id,
          family: entry.family,
          status: decision.status,
          costUsd: decision.run ? entry.plannedUsd : 0,
          runId,
          finishedAt: decision.status === "QUEUED" ? null : now,
        });
      } else {
        jobRows.push({
          businessId: id,
          family: entry.family,
          status: alreadyFresh ? "SKIPPED_FRESH" : "QUEUED",
          costUsd: alreadyFresh ? 0 : entry.plannedUsd,
          runId,
          finishedAt: alreadyFresh ? now : null,
        });
      }
    }
  }
  // Chunked createMany (avoid a single oversized INSERT on big cohorts). One
  // chunk at a time preserves the value-ordered createdAt (they're inserted in
  // array order), so the first-screen jobs get the earliest createdAt.
  for (let i = 0; i < jobRows.length; i += 1000) {
    await prisma.enrichmentJob.createMany({ data: jobRows.slice(i, i + 1000) });
  }
  // P3 · never silently drop coverage — surface how many (business, family)
  // pairs the permanent-failure cap skipped this run (they're "Not available").
  if (skippedUnavailable > 0) {
    console.log(
      JSON.stringify({
        level: "info",
        event: "enrich.fanout.skipped_unavailable",
        feature: "enrichment",
        runId,
        pairs: skippedUnavailable,
      }),
    );
  }

  // INC-58 · ZERO-JOB FAN-OUT MUST BE CLOSEABLE. When the plan expects
  // per-business jobs but every pair was skipped (all dead pairs, or an empty/
  // all-hidden scope), the run has 0 job rows — indistinguishable, to
  // closeRunIfDone's phantom-guard, from a fan-out that crashed before
  // createMany. The guard refused to close it, reconcileStuck reset it to
  // PENDING every 15 min, and fan-out skipped everything again: an INFINITE
  // "Enriching · 0 of 1 · updating live" loop (Viktor's stuck 1-lead retry).
  // Stamp the run so the guard knows fan-out COMPLETED with legitimately zero
  // jobs — closeRunIfDone then closes it honestly (0 done, hold refunded).
  if (plan.length > 0 && jobRows.length === 0) {
    await prisma.enrichmentRun.update({
      where: { id: runId },
      data: {
        scopeRefsJson: {
          ...(scope as Record<string, unknown>),
          fanOutEmptyJobs: true,
        } as Prisma.InputJsonValue,
      },
    });
    console.log(
      JSON.stringify({
        level: "warn",
        event: "enrich.fanout.zero_jobs",
        feature: "enrichment",
        runId,
        skippedUnavailable,
        scopeSize: orderedIds.length,
      }),
    );
  }

  // ── WP3-2 · route QUEUED root-family jobs through the Boxly worker ──
  // The worker runs each /api/internal/enrich-job callback on its own 300s
  // budget with concurrency + retry, so a big run doesn't wait on 2-min cron
  // ticks. taskId=job.id makes a double-delivery a no-op (WP1 atomic claim). The
  // tick-side drain in dispatchPending stays as the FULL fallback: when the
  // worker is unset (local/preview) or the enqueue throws, the jobs are just
  // QUEUED rows the cron drains — identical correctness, slower. We re-read the
  // just-created QUEUED rows (in value order) so taskIds are the real job ids.
  if (enrichWorkerAvailable() && jobRows.some((r) => r.status === "QUEUED")) {
    try {
      const queued = await prisma.enrichmentJob.findMany({
        where: { runId, status: "QUEUED" },
        select: { id: true, businessId: true, family: true, createdAt: true },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const res = await enqueueRootJobs(queued);
      if (!res.enqueued) {
        console.warn(
          `[enrichment:fanout] root-job worker enqueue declined for run ${runId} · tick-drain fallback`,
        );
      }
    } catch (err) {
      logErr("enrich-root-enqueue", runId, err);
    }
  }

  // ── Per-cell families (meta/google/serp · 30-day gated) ──
  // WP1-5/WP3-2 · when the worker is configured, the slow Apify/DfS cell
  // collection is enqueued to /api/internal/enrich-cell so NO inline vendor call
  // runs inside this 300s fanOutRun tick. The cell COST is still billed run-side
  // (outcome-based, WP1-6) by the callback which increments actualUsd. When the
  // worker is unset we run the cells INLINE here exactly as before (the fallback
  // path), billing outcome-based on the spot.
  const cellFamilies: {
    type: EnrichmentType;
    run: (k: string) => Promise<{ outcome: string }>;
  }[] = [];
  if (has("meta_ads"))
    cellFamilies.push({ type: "meta_ads", run: runMetaAdsForCell });
  if (has("serp")) cellFamilies.push({ type: "serp", run: runSerpForCell });

  // Which (cell, family) pairs actually need collecting (not already fresh)?
  const staleCells: CellJobRef[] = [];
  for (const k of cellKeys) {
    const perCell = fresh.perCell.get(k) ?? {};
    for (const cf of cellFamilies) {
      const cursor = perCell[cf.type];
      if (isFresh(cursor, ENRICHMENT_PRICES[cf.type].freshnessDays, now)) {
        continue; // served from DB at $0 — nothing to collect
      }
      staleCells.push({
        runId,
        cellKey: k,
        family: cf.type as CellJobRef["family"],
      });
    }
  }

  let cellCostUsd = 0;
  let cellsEnqueued = false;
  if (staleCells.length > 0 && enrichWorkerAvailable()) {
    try {
      const res = await enqueueCellJobs(staleCells);
      cellsEnqueued = res.enqueued;
    } catch (err) {
      logErr("enrich-cell-enqueue", runId, err);
      cellsEnqueued = false;
    }
  }

  if (!cellsEnqueued) {
    // Inline fallback: run each stale cell here, billing OUTCOME-based (WP1-6).
    const runByFamily = new Map(cellFamilies.map((cf) => [cf.type, cf.run]));
    for (const c of staleCells) {
      const run = runByFamily.get(c.family);
      if (!run) continue;
      try {
        cellCostUsd += await collectCellFamily(c.cellKey, c.family, run);
      } catch (err) {
        logErr(c.family, c.cellKey, err);
      }
    }
  }

  // Seed actualUsd with the (inline) cell cost + record the hidden businesses
  // skipped by the gate. When cells were enqueued to the worker, actualUsd starts
  // at 0 and each enrich-cell callback increments it on a real collection.
  await prisma.enrichmentRun.update({
    where: { id: runId },
    data: { actualUsd: cellCostUsd, unitsSkippedHidden: skippedHidden },
  });

  return { jobsCreated: jobRows.length, cellCostUsd };
}

/**
 * Collect ONE cell family, billing OUTCOME-based (WP1-6): returns the cell's
 * unit cost only when the collector actually collected. Shared by fanOutRun's
 * inline fallback AND the /api/internal/enrich-cell worker callback so both
 * paths bill identically. MUST run inside an open CronRun.
 */
export async function collectCellFamily(
  cellKey: string,
  family: "meta_ads" | "serp",
  run?: (k: string) => Promise<{ outcome: string }>,
): Promise<number> {
  const runner =
    run ?? (family === "meta_ads" ? runMetaAdsForCell : runSerpForCell);
  const out = await runner(cellKey);
  // Only a real collection bills. A failed cell run (swallows internally, writes
  // a FAILED AdMarketRun, returns non-"collected") does NOT bill and — because
  // latestAdMarketRun ignores FAILED rows — does NOT gate the retry for 30 days.
  return out?.outcome === "collected"
    ? ENRICHMENT_PRICES[family].usdPerUnit
    : 0;
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
  if (family === "LIGHTHOUSE") {
    // The latest LighthouseAudit is the freshness cursor (enrichLighthouse-
    // ForBusinesses re-checks this too, but gating here keeps the no-op cheap:
    // a now-fresh unit is SKIPPED_FRESH at $0, never a DONE job billed $0.00425).
    const last = await prisma.lighthouseAudit.findFirst({
      where: { businessId },
      orderBy: { auditedAt: "desc" },
      select: { auditedAt: true },
    });
    return isFresh(
      last?.auditedAt,
      ENRICHMENT_PRICES.lighthouse.freshnessDays,
      now,
    );
  }
  // A4 · re-check the services / ai_research cursors at process time too (a unit
  // may have gone fresh since fan-out via a concurrent run), so a quoted-billable
  // job that's now fresh is SKIPPED_FRESH at $0 instead of re-running the model.
  // Gated at the 90-day window buildJobPlan holds these families to.
  if (family === "SERVICES") {
    const b = await prisma.business.findUnique({
      where: { id: businessId },
      select: { servicesLastAt: true },
    });
    return isFresh(b?.servicesLastAt, 90, now);
  }
  if (family === "AI_RESEARCH") {
    const b = await prisma.business.findUnique({
      where: { id: businessId },
      select: { aiResearchLastAt: true },
    });
    return isFresh(b?.aiResearchLastAt, 90, now);
  }
  // B1 · re-check the per-business google_ads cursor at process time (a unit may
  // have gone fresh since fan-out via a concurrent run) so a quoted-billable job
  // that's now fresh is SKIPPED_FRESH at $0 instead of re-running the ads_search.
  if (family === "GOOGLE_ADS") {
    const b = await prisma.business.findUnique({
      where: { id: businessId },
      select: { googleAdsLastAt: true },
    });
    return isFresh(
      b?.googleAdsLastAt,
      ENRICHMENT_PRICES.google_ads.freshnessDays,
      now,
    );
  }
  return false;
}

type ProcessOutcome = "done" | "failed" | "requeued" | "skipped" | "awaiting";

/**
 * Process one CLAIMED EnrichmentJob (already flipped to RUNNING atomically by
 * dispatchPending — WP1-1): re-check freshness, run the family worker, and
 * record the outcome per the WorkerResult contract (WP1-2):
 *
 *   - fresh at process time      → SKIPPED_FRESH, cost 0 ("skipped")
 *   - worker threw               → requeue (retry) or FAILED at max ("requeued"/"failed")
 *   - ok, terminal, billable     → DONE at plannedUsd ("done")
 *   - ok, terminal, non-billable → FAILED at cost 0 (retry ladder + refund) OR
 *                                  DONE-at-$0 for a genuinely-empty-but-complete
 *                                  result. We use FAILED so the retry ladder can
 *                                  re-attempt a transient miss, and the settle
 *                                  refunds it either way. ("failed")
 *   - ok, non-terminal (REVIEWS) → parked AWAITING_PINGBACK at cost 0; the run
 *                                  stays open until the ReviewJob lands (WP1-9).
 *                                  ("awaiting")
 *
 * NOTE: this function no longer flips the job to RUNNING — the claim happens in
 * dispatchPending via a conditional updateMany so two overlapping ticks can never
 * both run the same job (WP1-1). Exported for unit testing (tests pass an
 * already-RUNNING job).
 */
export async function processJob(
  job: {
    id: string;
    businessId: string;
    family: string;
    attempts: number;
    costUsd: unknown;
    runId?: string | null;
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
    await bumpRunProgress(job.runId, job.businessId);
    return "failed";
  }

  // Worker-side freshness re-check — don't re-fetch a now-fresh unit (a
  // concurrent run made our DB copy fresh, S6). Legacy: SKIPPED_FRESH at $0.
  // Entitlement model: we still DELIVER the now-fresh data, so a non-owner is
  // CHARGED_FROM_DB (served, billable) and only an owner is SKIPPED_ENTITLED
  // ($0) — otherwise the non-owner would get the concurrent scrape free.
  if (await unitFreshAtProcess(job.businessId, family, now)) {
    let flip: "SKIPPED_FRESH" | "SKIPPED_ENTITLED" | "CHARGED_FROM_DB" =
      "SKIPPED_FRESH";
    if (entitlementBillingEnabled() && job.runId) {
      const r = await prisma.enrichmentRun.findUnique({
        where: { id: job.runId },
        select: { agencyId: true },
      });
      if (r) {
        const owned = await prisma.agencyEntitlement.findFirst({
          where: { agencyId: r.agencyId, businessId: job.businessId, family },
          select: { id: true },
        });
        flip = owned ? "SKIPPED_ENTITLED" : "CHARGED_FROM_DB";
      }
    }
    await prisma.enrichmentJob.update({
      where: { id: job.id },
      data: { status: flip, costUsd: 0, finishedAt: now },
    });
    await bumpRunProgress(job.runId, job.businessId);
    return "skipped";
  }

  // The job was already claimed to RUNNING atomically (WP1-1). Preserve its
  // planned cost so a billable outcome charges the quote amount; a non-billable
  // outcome overwrites it with 0 below.
  const plannedUsd = Number(job.costUsd ?? 0);

  try {
    const outcome = await worker(job.businessId);

    // WP1-2 · a non-billable unit is not charged. This covers both a soft failure
    // (ok=false, e.g. contacts fetch FAILED) and a completed-but-empty result
    // (ok=true, billable=false, e.g. lighthouse 0 audits / reviews-submit failed).
    // A TRANSIENT soft failure now re-queues through the bounded backoff ladder
    // (2026-07-10); a NON-RETRYABLE reason is recorded FAILED at cost 0 and the
    // run settle refunds it. The one exception is the async-landing case
    // (terminal===false), handled next.
    if (
      (outcome.ok === false || outcome.billable === false) &&
      outcome.terminal !== false
    ) {
      const reason = (outcome.reason ?? "non_billable").slice(0, 500);
      // A TRANSIENT soft failure (vendor blip, temporarily-unreachable site) now
      // takes the SAME bounded backoff ladder as a thrown error, instead of dying
      // terminal on attempt 1. A NON-RETRYABLE reason (no source/website/CID, an
      // already-exhausted submit) can't be helped by a retry → terminal FAILED
      // now (P3 renders it "Not available"). Bounded by MAX_JOB_ATTEMPTS so the
      // shared attempt budget still stops the treadmill.
      const nextAttempts = job.attempts + 1;
      if (
        !isNonRetryableFailure(outcome.reason) &&
        nextAttempts < MAX_JOB_ATTEMPTS
      ) {
        await prisma.enrichmentJob.update({
          where: { id: job.id },
          data: {
            status: "QUEUED",
            attempts: nextAttempts,
            errorMessage: reason,
            startedAt: null,
            nextAttemptAt: backoffUntil(nextAttempts, now),
          },
        });
        return "requeued";
      }
      await prisma.enrichmentJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          costUsd: 0,
          attempts: nextAttempts,
          errorMessage: reason,
          finishedAt: new Date(),
        },
      });
      await bumpRunProgress(job.runId, job.businessId);
      return "failed";
    }

    // WP1-9 · REVIEWS submitted but data lands asynchronously. There is no
    // AWAITING EnrichmentJobStatus (no schema change in this wave), so we PARK
    // the job in RUNNING — closeRunIfDone counts RUNNING as open, so the run
    // stays open until the reviews land. reconcileReviewJobs (called each tick +
    // inside closeRunIfDone) then flips it terminal by JOINING the business's
    // ReviewJob: ReviewJob DONE → this DONE + billed; ReviewJob FAILED → this
    // FAILED + unbilled. reconcileStuck deliberately never resets a RUNNING
    // REVIEWS job whose ReviewJob is still in flight (see reconcileStuck).
    // Stamp startedAt=now so a genuinely-stuck submit (no ReviewJob ever created)
    // is still eventually swept by the stuck-job path.
    if (outcome.terminal === false) {
      await prisma.enrichmentJob.update({
        where: { id: job.id },
        data: { status: "RUNNING", costUsd: 0, startedAt: now },
      });
      return "awaiting";
    }

    // Billable success → DONE at the planned cost.
    await prisma.enrichmentJob.update({
      where: { id: job.id },
      data: {
        status: "DONE",
        costUsd: plannedUsd,
        finishedAt: new Date(),
        // A retry that SUCCEEDED must not keep attempt-1's failure message —
        // a DONE row with "contacts_fetch_failed" reads as a contradiction.
        errorMessage: null,
      },
    });
    await bumpRunProgress(job.runId, job.businessId);
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
      await bumpRunProgress(job.runId, job.businessId);
      return "failed";
    }
    // WP3-6 · Requeue with EXPONENTIAL BACKOFF. Stamp nextAttemptAt = now +
    // 2^attempts min (capped): the pool claim only admits due jobs, so a vendor
    // blip no longer burns all 3 attempts in ~6 min. Not a second timer — the
    // cron cadence still bounds the LOWER edge (a due job runs on the next tick).
    await prisma.enrichmentJob.update({
      where: { id: job.id },
      data: {
        status: "QUEUED",
        attempts: nextAttempts,
        errorMessage: msg.slice(0, 500),
        startedAt: null,
        nextAttemptAt: backoffUntil(nextAttempts, now),
      },
    });
    return "requeued";
  }
}

/**
 * WP3-3 · Bump a run's Redis progress counter when a BUSINESS finishes.
 *
 * BUSINESS-UNIT (2026-07-10, the "46→89→31" sawtooth fix): the counters must
 * march in the SAME unit as `total` (= unitsRequested businesses) and the tick
 * re-seed (updateRunProgress), or `done` overshoots in family-sized jumps and
 * each re-seed snaps it back down. So a terminal FAMILY job only bumps the
 * counter when it was the business's LAST open family — and we classify by the
 * business's OWN verdict (any terminal-success family → "done", else "failed"),
 * never this one job's outcome. The tick re-seed stays authoritative and self-
 * heals any drift from the rare concurrent double-count. Best-effort · degrades
 * open. A parked REVIEWS job bumps here too once it lands (reconcileReviewJobs).
 */
async function bumpRunProgress(
  runId: string | null | undefined,
  businessId: string,
): Promise<void> {
  if (!runId) return;
  const open = await prisma.enrichmentJob.count({
    where: { runId, businessId, status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (open > 0) return; // business still has families in flight — not done yet
  const success = await prisma.enrichmentJob.count({
    where: {
      runId,
      businessId,
      status: {
        in: ["DONE", "SKIPPED_FRESH", "CHARGED_FROM_DB", "SKIPPED_ENTITLED"],
      },
    },
  });
  await incrRunProgress(runId, success > 0 ? "done" : "failed");
}

/**
 * WP3-2 · Claim ONE QUEUED job by id and process it — the Boxly worker callback
 * path (/api/internal/enrich-job). ATOMIC + IDEMPOTENT: the conditional
 * updateMany (`WHERE id AND status='QUEUED'` → RUNNING) means a double delivery
 * (worker retry OR a racing dispatch tick) can only be won ONCE — the second
 * caller sees count!==1 and returns "skipped-not-claimable" without re-running
 * the worker. Must run inside an open CronRun (processJob's family workers
 * assert it). Returns the outcome for logging.
 */
export async function claimAndProcessJob(
  jobId: string,
  now: Date = new Date(),
): Promise<ProcessOutcome | "not-claimable"> {
  const claim = await prisma.enrichmentJob.updateMany({
    where: { id: jobId, status: "QUEUED" },
    data: { status: "RUNNING", startedAt: now, nextAttemptAt: null },
  });
  if (claim.count !== 1) return "not-claimable"; // already claimed/terminal — no-op
  const job = await prisma.enrichmentJob.findUnique({
    where: { id: jobId },
    select: {
      id: true,
      businessId: true,
      family: true,
      attempts: true,
      costUsd: true,
      runId: true,
    },
  });
  if (!job) return "not-claimable";
  return processJob(job, now);
}

/**
 * WP3-2/WP1-5 · Collect ONE cell family (worker callback path
 * /api/internal/enrich-cell) and accrue its outcome-based cost onto the run's
 * actualUsd. Mirrors the run-side accrual that fanOutRun's inline path does, so
 * the cell cost is billed identically whether it ran on the tick or the worker.
 * Uses a raw `{ increment }` (the run's actualUsd is non-null @default(0), safe
 * per INC-32). Must run inside an open CronRun. Returns the USD accrued.
 */
export async function runEnrichCellForRun(
  runId: string,
  cellKey: string,
  family: "meta_ads" | "serp",
): Promise<number> {
  const usd = await collectCellFamily(cellKey, family);
  if (usd > 0) {
    await prisma.enrichmentRun.update({
      where: { id: runId },
      data: { actualUsd: { increment: usd } },
    });
  }
  return usd;
}

/** ReviewJob statuses that mean the async reviews pull has finished (either way). */
const REVIEW_JOB_TERMINAL = ["DONE", "FAILED", "RECONCILED"] as const;

// P5 (2026-07-10) · REVERSE-STALL CEILING for parked REVIEWS jobs. A parked
// EnrichmentJob (RUNNING, waiting for its ReviewJob to land) holds the whole
// run open — closeRunIfDone counts RUNNING as open. Reviews normally land in
// 1–10 min; when the DfS pingback is lost the hourly reviews-reconcile sweep
// has its own 2h/24h ladder for the DATA, but the user's RUN must not hang on
// it. Past this ceiling the unit flips FAILED ("reviews_landing_timeout",
// unbilled — reviews were only ever billed on landing) so the run can close;
// if the data lands later anyway, it persists for free via the ReviewJob path.
const REVIEWS_PARK_CEILING_MS = 30 * 60_000;

/**
 * WP1-9 · Reconcile a run's parked REVIEWS EnrichmentJobs against the async
 * ReviewJob state machine. A REVIEWS EnrichmentJob sits in RUNNING (parked by
 * processJob) until the reviews actually LAND. For each such job we look at the
 * business's most-recent ReviewJob created at/after the parked job's startedAt:
 *
 *   - ReviewJob DONE          → EnrichmentJob DONE + billed (the reviews landed).
 *   - ReviewJob FAILED/RECON  → EnrichmentJob FAILED + unbilled (never billed
 *                               for reviews that never landed).
 *   - still in flight / none  → leave RUNNING (the run stays open).
 *
 * Returns the number of jobs it flipped terminal. Best-effort per job.
 */
async function reconcileReviewJobs(
  runId: string,
  now: Date = new Date(),
): Promise<number> {
  const parked = await prisma.enrichmentJob.findMany({
    where: { runId, family: "REVIEWS", status: "RUNNING" },
    select: { id: true, businessId: true, costUsd: true, startedAt: true },
  });
  if (parked.length === 0) return 0;

  let flipped = 0;
  for (const job of parked) {
    // P5 · reverse-stall ceiling: a unit parked past the ceiling flips FAILED
    // (unbilled, transient reason) so the RUN can close — whether the ReviewJob
    // is missing (submit crashed mid-park) or simply never landing.
    const parkedTooLong =
      !!job.startedAt &&
      now.getTime() - job.startedAt.getTime() > REVIEWS_PARK_CEILING_MS;
    const failParked = async (): Promise<void> => {
      // Guard on status='RUNNING' so a concurrent reconcile that flips this same
      // parked job DONE (its ReviewJob landed microseconds after our read) isn't
      // clobbered with a FAILED — last-writer-wins TOCTOU otherwise (verifier
      // nit). Only the tick that still sees it RUNNING counts it.
      const res = await prisma.enrichmentJob.updateMany({
        where: { id: job.id, status: "RUNNING" },
        data: {
          status: "FAILED",
          costUsd: 0,
          errorMessage: "reviews_landing_timeout",
          finishedAt: now,
        },
      });
      if (res.count === 0) return; // lost the race — a DONE flip already won
      await bumpRunProgress(runId, job.businessId);
      flipped += 1;
    };

    const rj = await prisma.reviewJob.findFirst({
      where: {
        businessId: job.businessId,
        ...(job.startedAt ? { createdAt: { gte: job.startedAt } } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    });
    if (!rj) {
      // submit hasn't created a ReviewJob yet — wait (or fail past the ceiling).
      if (parkedTooLong) await failParked();
      continue;
    }
    const terminal = (REVIEW_JOB_TERMINAL as readonly string[]).includes(
      rj.status,
    );
    if (!terminal) {
      // still QUEUED/SUBMITTED/AWAITING/FETCHING — wait (or fail past ceiling).
      if (parkedTooLong) await failParked();
      continue;
    }

    if (rj.status === "DONE") {
      await prisma.enrichmentJob.update({
        where: { id: job.id },
        // Bill the reviews unit only now that data has landed. Restore the
        // planned reviews cost (parked at 0) from the price list.
        data: {
          status: "DONE",
          costUsd: ENRICHMENT_PRICES.reviews.usdPerUnit,
          finishedAt: now,
        },
      });
      await bumpRunProgress(runId, job.businessId); // WP3-3
    } else {
      await prisma.enrichmentJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          costUsd: 0,
          errorMessage: `reviews_${rj.status.toLowerCase()}`,
          finishedAt: now,
        },
      });
      await bumpRunProgress(runId, job.businessId); // WP3-3
    }
    flipped += 1;
  }
  return flipped;
}

/**
 * Close a RUNNING run once it has no non-terminal jobs: run the expert layer for
 * touched businesses, compute the actual completed cost, set OK/PARTIAL, and
 * settle the credit hold (refunding the quote-vs-actual diff). Returns true when
 * it closed the run. Exported for unit testing.
 *
 * WP1-3 · The status flip + settle are guarded by a compare-and-set on
 * `finishedAt`: only the tick that first stamps finishedAt (via a conditional
 * updateMany `WHERE status='RUNNING' AND finishedAt IS NULL`) proceeds to settle,
 * so two overlapping close attempts settle EXACTLY once — no double-charge race.
 */
export async function closeRunIfDone(
  runId: string,
  now: Date = new Date(),
): Promise<boolean> {
  // WP1-9 · flip any landed REVIEWS jobs terminal FIRST so the open-count below
  // sees the true state (a parked-RUNNING reviews job whose data has landed must
  // not keep the run open, and one still in flight must).
  await reconcileReviewJobs(runId, now);

  const open = await prisma.enrichmentJob.count({
    where: { runId, status: { in: ["QUEUED", "RUNNING"] } },
  });
  if (open > 0) return false;

  const run = await prisma.enrichmentRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      agencyId: true,
      status: true,
      actualUsd: true,
      scopeRefsJson: true,
      enrichmentsJson: true,
      unitsRequested: true,
      // BUG1 · load-bearing: the per-cell billing gate counts only AdMarketRuns
      // with ranAt >= this run's start. Without it, `ranAt: { gte: undefined }`
      // would drop the lower bound and count PRIOR runs' collected cells as
      // "collected this run" — re-billing a fresh-served cell.
      startedAt: true,
    },
  });
  if (!run || run.status !== "RUNNING") return false;

  const families = (
    Array.isArray(run.enrichmentsJson) ? run.enrichmentsJson : []
  ) as EnrichmentType[];

  // S3 · don't close while a requested cell family is still in flight. Cell
  // collection creates no EnrichmentJob rows (it lands via an async enrich-cell
  // worker callback), so the open-jobs count above can be 0 with a meta/serp cell
  // still collecting. Hold the run open until every cell has settled (or the
  // ceiling trips). Cheap: one indexed AdMarketRun read, only when the run
  // actually requested a cell family.
  const pendingCells = await pendingCellCount(
    run.scopeRefsJson,
    families,
    run.startedAt ?? null,
    now,
  );
  if (pendingCells > 0) return false;

  const entMode = entitlementBillingEnabled();

  const jobs = await prisma.enrichmentJob.findMany({
    where: { runId },
    select: { status: true, businessId: true, costUsd: true, family: true },
  });

  // WP1-4 · crash-safe fan-out. A RUNNING run with ZERO jobs is EITHER a run
  // whose fan-out died before createMany (phantom — must NOT close as OK with 0
  // units; reconcileStuck resets it to PENDING to re-fan-out), OR a genuinely
  // cell-only run (meta/google/serp inline, no per-business jobs — legitimately
  // has no job rows), OR (INC-58) a fan-out that COMPLETED with zero jobs
  // because every (business, family) pair was skipped (dead pairs / empty
  // scope) — fanOutRun stamps `fanOutEmptyJobs` for that case. Without the
  // stamp, the phantom-guard + reconcileStuck looped such runs PENDING↔RUNNING
  // forever ("Enriching · 0 of 1" never finishing).
  const fanOutEmptyJobs =
    ((run.scopeRefsJson ?? {}) as { fanOutEmptyJobs?: boolean })
      .fanOutEmptyJobs === true;
  if (jobs.length === 0) {
    const has = (f: EnrichmentType) => families.includes(f);
    const cellOnly = buildJobPlan(has).length === 0;
    if (!cellOnly && !fanOutEmptyJobs) {
      // Phantom half-fanned run — leave it RUNNING; reconcileStuck recovers it.
      return false;
    }
  }

  const done = jobs.filter((j) => j.status === "DONE");
  const fresh = jobs.filter((j) => j.status === "SKIPPED_FRESH");
  // Entitlement model: CHARGED_FROM_DB = served from our DB copy, zero vendor
  // COGS but BILLABLE (the high-margin path). SKIPPED_ENTITLED = already owned,
  // $0. Both are terminal-SUCCESS for progress (D3 · UI-invisible).
  const chargedFromDb = jobs.filter((j) => j.status === "CHARGED_FROM_DB");

  const jobUsd = done.reduce((s, j) => s + Number(j.costUsd ?? 0), 0);
  const cellUsd = Number(run.actualUsd ?? 0);
  const totalUsd = cellUsd + jobUsd;

  // WP4-3 · roll the per-family job rows down to ONE verdict per business so
  // unitsCompleted + the terminal Redis seed are in the same BUSINESS unit as
  // unitsRequested. A business is "done" if it has a success (DONE/SKIPPED_FRESH)
  // and no FAILED-only outcome; "failed" only when every family failed.
  const bizVerdict = new Map<string, { success: boolean; failed: boolean }>();
  for (const j of jobs) {
    const v = bizVerdict.get(j.businessId) ?? { success: false, failed: false };
    if (
      j.status === "DONE" ||
      j.status === "SKIPPED_FRESH" ||
      j.status === "CHARGED_FROM_DB" ||
      j.status === "SKIPPED_ENTITLED"
    )
      v.success = true;
    else if (j.status === "FAILED") v.failed = true;
    bizVerdict.set(j.businessId, v);
  }
  let bizDone = 0;
  let bizFailed = 0;
  for (const v of bizVerdict.values()) {
    if (v.success) bizDone += 1;
    else if (v.failed) bizFailed += 1;
  }
  // total is the requested business count (fall back to the observed business
  // set for a legacy job-unit run, or 1 for a cell-only run with no jobs).
  const requested = run.unitsRequested ?? 0;
  const bizTotal =
    requested > 0 ? requested : bizVerdict.size > 0 ? bizVerdict.size : 1;

  // WP1-3 · compare-and-set close claim. Only the tick that FIRST stamps
  // finishedAt (conditional on still-RUNNING + not-yet-finished) proceeds to the
  // status flip + settle — a concurrent close loses the race (count===0) and
  // bails, so credits settle EXACTLY once. finishedAt is the CAS token because
  // there's no CLOSING status without a migration.
  const claim = await prisma.enrichmentRun.updateMany({
    where: { id: runId, status: "RUNNING", finishedAt: null },
    data: { finishedAt: now },
  });
  if (claim.count === 0) return false;

  // WP3-12 · SETTLE FIRST, playbooks OFF THE CRITICAL TICK. Flip the status +
  // settle the credit hold BEFORE the (potentially large) playbook loop, so
  // settlement is immediate on big runs and never delayed behind the expert
  // layer. Then hand playbook execution to the Boxly worker (inline fallback).
  // WP4-3 · unitsCompleted is now the BUSINESS-level done count.
  // INC-58 · an empty-fan-out close (every pair skipped) is PARTIAL, not OK —
  // the user asked for units and got none; "OK · 0 of 1" would be a lie.
  const emptyClose = fanOutEmptyJobs && jobs.length === 0 && bizDone === 0;
  await prisma.enrichmentRun.update({
    where: { id: runId },
    data: {
      status: bizFailed > 0 || emptyClose ? "PARTIAL" : "OK",
      unitsCompleted: bizDone,
      actualUsd: totalUsd,
    },
  });

  // Arm the run-finished-emails idle gate — this run just went terminal, so its
  // next tick should run (not skip) and email the outcome. Best-effort.
  await markCronWork(GATED_CRON.runFinishedEmails);

  const hadProgress = done.length + fresh.length > 0 || totalUsd > 0;
  // WP4-6 · capture the settle result (charged/refunded) so the run carries a
  // truthful close receipt (held / charged / refunded) for the workbench header
  // + Enriching done-state. reconcileRunCredits now returns the SettleResult;
  // `?? {}` keeps close-out safe if it degrades to void on a settle hiccup.
  // Bill WHOLE CREDITS from CREDIT_PRICES (customer price), NOT usdToCredits of
  // the vendor USD. Per-business: each DONE job bills its family's credit
  // (job-precise, actual). Per-cell: bill the as-held cell credits. Settle is
  // still clamped to the hold, so this never charges above what was authorized.
  const hasFam = (f: EnrichmentType) => families.includes(f);
  // Entitlement model: CHARGED_FROM_DB units bill their family credit at zero
  // vendor COGS (served from our DB). Legacy path (flag off) has no such jobs.
  const billableBusinessJobs = entMode ? [...done, ...chargedFromDb] : done;
  const businessCredits = billableBusinessJobs.reduce(
    (s, j) => s + creditsForBusinessJob(j.family as JobFamily, hasFam),
    0,
  );
  const cellScope = (run.scopeRefsJson ?? {}) as { cellKeys?: string[] };
  const cellCredits = await cellCreditsForRun(
    run.scopeRefsJson,
    families,
    cellScope.cellKeys ?? [],
    run.startedAt ?? now,
    entMode ? run.agencyId : null,
  );
  const actualCredits = businessCredits + cellCredits;
  const settle = (await reconcileRunCredits(runId, {
    actualCredits,
    hadProgress,
  })) ?? { charged: 0, refunded: 0 };
  await prisma.enrichmentRun.update({
    where: { id: runId },
    data: { creditsCharged: settle.charged },
  });

  // Phase 4 · margin telemetry — CHARGED_FROM_DB units are full-price revenue at
  // ~$0 vendor COGS (served from our shared index). One line per run so the
  // dashboard can trend "COGS avoided" (the economic point of the shared index).
  if (entMode && chargedFromDb.length > 0) {
    const cogsAvoidedCredits = chargedFromDb.reduce(
      (s, j) => s + creditsForBusinessJob(j.family as JobFamily, hasFam),
      0,
    );
    console.log(
      JSON.stringify({
        level: "info",
        event: "entitlement.cogs_avoided",
        runId,
        agencyId: run.agencyId,
        units: chargedFromDb.length,
        credits: cogsAvoidedCredits,
      }),
    );
  }

  // Entitlement model: mint what was paid for. Every billable per-business
  // success (DONE from a run OR CHARGED_FROM_DB served from our DB) grants the
  // agency the (business × family) entitlement. TECH rides CONTACTS → grant both
  // when tech was requested. Idempotent via skipDuplicates on the unique key
  // (a repeat/concurrent mint is a no-op — never aborts the charge · G5).
  if (entMode && billableBusinessJobs.length > 0) {
    const wantsTech = families.includes("tech");
    const grants: {
      agencyId: string;
      businessId: string;
      family: JobFamily | "TECH";
      sourceRunId: string;
      creditsCharged: number;
    }[] = [];
    for (const j of billableBusinessJobs) {
      const fam = j.family as JobFamily;
      grants.push({
        agencyId: run.agencyId,
        businessId: j.businessId,
        family: fam,
        sourceRunId: runId,
        creditsCharged: creditsForBusinessJob(fam, hasFam),
      });
      if (fam === "CONTACTS" && wantsTech) {
        grants.push({
          agencyId: run.agencyId,
          businessId: j.businessId,
          family: "TECH",
          sourceRunId: runId,
          creditsCharged: 0,
        });
      }
    }
    try {
      await prisma.agencyEntitlement.createMany({
        data: grants,
        skipDuplicates: true,
      });
    } catch (err) {
      logErr("entitlement-mint", runId, err);
    }
  }

  // WP6-4 · enrich_completed — fired exactly once per run (the finishedAt CAS
  // above admits only one closer). The terminal end of the activation funnel:
  // records the business-level done/failed split + charged/refunded credits so
  // the time-to-aha + per-template conversion query can pair it with the
  // enrich_started event on the same run. Fire-and-forget, ids/counts only.
  void trackProductEvent({
    type: "enrich_completed",
    agencyId: run.agencyId,
    props: {
      runId,
      status: bizFailed > 0 ? "PARTIAL" : "OK",
      done: bizDone,
      failed: bizFailed,
      charged: settle.charged,
      refunded: settle.refunded,
      families: families.length,
    },
  });

  // Expert layer auto-runs once per touched business ($0, deterministic) —
  // enqueued to the worker (or inline-run when unset). Best-effort; the run is
  // already closed + settled, so a playbook hiccup never affects money/state.
  const touched = [...new Set(done.map((j) => j.businessId))];
  if (touched.length > 0) {
    try {
      await enqueueClosePlaybooks(runId, touched);
    } catch (err) {
      logErr("close-playbooks", runId, err);
    }
  }

  // WP3-3/WP4-3 · final counter seed so the progress endpoint reads a terminal
  // state (100%) immediately at close (the next updateRunProgress tick would
  // too, but the run drops out of the RUNNING loop after close). Business unit:
  // done+failed sum to the requested total, so the bar lands exactly at N of N.
  await seedRunProgress(runId, {
    done: bizDone,
    failed: bizFailed,
    total: bizTotal,
    status: bizFailed > 0 ? "PARTIAL" : "OK",
    // Terminal: nothing is backing off anymore — clear any stale retry hint so
    // the done-state never shows "N retrying".
    retrying: 0,
  });

  // Refresh the cell standards (+ service prevalence when services ran) so the
  // comparative UI reflects the freshly enriched data.
  const scope = (run.scopeRefsJson ?? {}) as ScopeRefs;
  await recomputeCells(scope.cellKeys ?? [], {
    withPrevalence: families.includes("services"),
  });
  return true;
}

/**
 * Execute one PENDING Discovery: reconstruct the cell requests from cellKeys
 * (resolving categoryId from BusinessCategory.dataforseoId) and hand off to
 * runDiscovery, which upserts the SAME row by idempotency key. Settles the
 * discovery credit hold against the actual fetch cost. Exported for testing.
 *
 * WP3-5 · ATOMIC CLAIM. Unlike the (removed) plain findUnique, the discovery is
 * claimed with a conditional updateMany (`WHERE status='PENDING'` → RUNNING +
 * startedAt=now). Two overlapping ticks can never both process the same
 * discovery — exactly one wins the claim (count===1); the loser returns false
 * and drops it. Stamping startedAt here (and in run-discovery's own RUNNING
 * flip) means the stuck-discovery sweep anchors on real run-start, not enqueue.
 */
export async function processDiscovery(
  discoveryId: string,
  now: Date = new Date(),
): Promise<boolean> {
  // WP3-5 · atomic claim: only a PENDING row flips to RUNNING here.
  const claim = await prisma.discovery.updateMany({
    where: { id: discoveryId, status: "PENDING" },
    data: { status: "RUNNING", startedAt: now },
  });
  if (claim.count !== 1) return false; // lost the claim / not PENDING — skip.

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

    // Discovery is ALWAYS free to the agency (DISCOVERY_PRICE = $0/0 credits) —
    // the DfS fetch cost (Discovery.totalCostUsd) is our absorbed COGS, never
    // billed to the wallet. So settle at 0 credits; reconcile still releases the
    // (zero) hold and closes the run cleanly.
    await reconcileRunCredits(d.id, {
      actualCredits: 0,
      hadProgress: true,
    });

    // Seed/refresh the cell standards for the freshly discovered cells so the
    // CellStandardsPanel / VsCellBar render data (not empty) on first open.
    await recomputeCells(d.cellKeys);
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
 * Recover crashed work before draining. Idempotent. Recovers three failure
 * modes:
 *
 *   1. Jobs stuck in RUNNING (a tick that died mid-process). WP1-8: each reset
 *      COUNTS AN ATTEMPT — a stuck job that has already burned its attempts is
 *      marked FAILED (not requeued) so a job that outlives the tick budget can't
 *      loop forever paying the actor. Parked-RUNNING REVIEWS jobs whose ReviewJob
 *      is still in flight are NOT reset (WP1-9 — they're waiting, not stuck).
 *   2. Discoveries stuck in RUNNING → PENDING (re-dispatch next tick).
 *   3. WP1-4: runs stuck RUNNING with ZERO jobs (fan-out crashed before
 *      createMany) and NOT cell-only → reset to PENDING to re-fan-out, so they
 *      never close as a phantom OK with 0 units.
 */
export async function reconcileStuck(now: Date = new Date()): Promise<void> {
  const jobCutoff = new Date(now.getTime() - STUCK_JOB_MINUTES * 60_000);
  const stuckJobs = await prisma.enrichmentJob.findMany({
    where: { status: "RUNNING", startedAt: { lt: jobCutoff } },
    select: { id: true, family: true, attempts: true, businessId: true },
    take: 500,
  });
  for (const job of stuckJobs) {
    // WP1-9 · a parked REVIEWS job is legitimately RUNNING while its ReviewJob is
    // still in flight — do NOT reset it. Only reset it (as a genuine stuck) once
    // no in-flight ReviewJob backs it (submit never created one / it terminated
    // but reconcileReviewJobs hasn't caught up — a rare edge the reset re-runs).
    if (job.family === "REVIEWS") {
      const inFlight = await prisma.reviewJob.findFirst({
        where: {
          businessId: job.businessId,
          status: {
            in: ["QUEUED", "SUBMITTED", "AWAITING_PINGBACK", "FETCHING"],
          },
        },
        select: { id: true },
      });
      if (inFlight) continue; // waiting on the async pull — not stuck.
    }

    const nextAttempts = job.attempts + 1;
    if (nextAttempts >= MAX_JOB_ATTEMPTS) {
      // WP1-8 · exhausted its attempts — fail terminally instead of requeue.
      await prisma.enrichmentJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          costUsd: 0,
          attempts: nextAttempts,
          errorMessage: "stuck_reset_max_attempts",
          finishedAt: now,
          startedAt: null,
        },
      });
    } else {
      // WP3-6 · a stuck-reset job has already been RUNNING ≥10 min, so it's due
      // now — clear nextAttemptAt so the next pool claim admits it immediately
      // (don't stack a fresh backoff on top of the 10-min stall).
      await prisma.enrichmentJob.update({
        where: { id: job.id },
        data: {
          status: "QUEUED",
          attempts: nextAttempts,
          startedAt: null,
          nextAttemptAt: null,
        },
      });
    }
  }

  // WP3-5 · anchor stuck-discovery recovery on startedAt (real run-start,
  // stamped by processDiscovery's claim + run-discovery's RUNNING flip), NOT
  // createdAt. A long-QUEUED discovery that only just started RUNNING is no
  // longer reset out from under a legitimately-running fetch. A RUNNING row with
  // a NULL startedAt (a pre-WP3-5 row, or a claim that raced the crash) falls
  // back to the createdAt cutoff so it's still recoverable.
  const discCutoff = new Date(now.getTime() - STUCK_DISCOVERY_MINUTES * 60_000);
  await prisma.discovery.updateMany({
    where: {
      status: "RUNNING",
      finishedAt: null,
      OR: [
        { startedAt: { lt: discCutoff } },
        { startedAt: null, createdAt: { lt: discCutoff } },
      ],
    },
    data: { status: "PENDING", startedAt: null },
  });

  // WP1-4 · recover runs whose fan-out crashed after the RUNNING flip but before
  // createMany — RUNNING, older than the fan-out cutoff, with ZERO jobs, and NOT
  // a cell-only plan. Reset to PENDING so the next tick re-fans-out (idempotent:
  // fanOutRun guards on status==='PENDING'). A cell-only run legitimately has no
  // jobs and is left for closeRunIfDone.
  const runCutoff = new Date(now.getTime() - STUCK_RUN_FANOUT_MINUTES * 60_000);
  const stuckRuns = await prisma.enrichmentRun.findMany({
    where: {
      status: "RUNNING",
      finishedAt: null,
      startedAt: { lt: runCutoff },
    },
    select: { id: true, enrichmentsJson: true },
    take: 200,
  });
  for (const r of stuckRuns) {
    const jobCount = await prisma.enrichmentJob.count({
      where: { runId: r.id },
    });
    if (jobCount > 0) continue; // has jobs — not a half-fanned run.
    const families = (
      Array.isArray(r.enrichmentsJson) ? r.enrichmentsJson : []
    ) as EnrichmentType[];
    const cellOnly = buildJobPlan((f) => families.includes(f)).length === 0;
    if (cellOnly) continue; // legitimately job-less — closeRunIfDone handles it.
    await prisma.enrichmentRun.update({
      where: { id: r.id },
      // Re-fan-out: clear actualUsd (cell cost re-accrues on the re-run) + reset
      // the RUNNING flip so fanOutRun's status==='PENDING' guard admits it again.
      data: { status: "PENDING", actualUsd: 0 },
    });
  }
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
    hasMoreWork: false,
    idle: false,
  };
  const now = new Date();
  // WP3-7 · monotonic tick-start marker to budget wall-clock (performance.now is
  // immune to clock skew, unlike Date subtraction).
  const tickStart = performance.now();
  const elapsed = () => performance.now() - tickStart;

  await reconcileStuck(now);

  // WP3-7 · BUDGET THE DISCOVERY DRAIN. Discoveries are the heaviest tick work (a
  // full DfS market pull). Cap them to a couple per tick AND stop once the
  // discovery budget is spent, so a job batch always gets to run under the 300s
  // cap. `pendingLeft` still signals hasMoreWork so the self-chain re-kicks.
  const discoveryCap = Math.min(limit, MAX_DISCOVERIES_PER_TICK);
  const pendingDiscoveries = await prisma.discovery.findMany({
    where: { status: "PENDING" },
    select: { id: true },
    take: discoveryCap + 1, // +1 to detect "more remain" cheaply
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const moreDiscoveriesQueued = pendingDiscoveries.length > discoveryCap;
  for (const d of pendingDiscoveries.slice(0, discoveryCap)) {
    if (elapsed() > DISCOVERY_DRAIN_BUDGET_MS) break; // WP3-7 · leave room for jobs
    if (await processDiscovery(d.id, now)) res.discoveriesRun++;
    else res.discoveriesFailed++;
  }

  // Fan out PENDING enrichment runs into jobs (+ enqueue root/cell worker jobs),
  // WP3-10 · subject to the per-agency concurrent-RUNNING-run cap: a tenant with
  // maxConcurrentRuns already RUNNING waits, so one tenant can't fan out an
  // unbounded number of runs at once. Ordered oldest-first for fairness.
  const pendingRuns = await prisma.enrichmentRun.findMany({
    where: { status: "PENDING" },
    select: { id: true, agencyId: true },
    take: limit,
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
  });
  if (pendingRuns.length > 0) {
    const runningByAgency = await countRunningRunsByAgency(
      pendingRuns.map((r) => r.agencyId),
    );
    const caps = await loadAgencyRunCaps(pendingRuns.map((r) => r.agencyId));
    for (const r of pendingRuns) {
      const cap = caps.get(r.agencyId) ?? DEFAULT_MAX_CONCURRENT_RUNS;
      const running = runningByAgency.get(r.agencyId) ?? 0;
      if (running >= cap) continue; // WP3-10 · tenant at its concurrent-run cap
      await fanOutRun(r.id, now);
      runningByAgency.set(r.agencyId, running + 1); // this run is now RUNNING
      res.enrichmentRunsProcessed++;
    }
  }

  // WP3-7 · if the tick has already burned its hard budget (a slow reconcile +
  // discovery drain), skip the job batch this tick — a follow-up tick (cron or
  // self-chain) works the jobs. Guarantees we never blow the 300s cap.
  let candidates: PoolJob[] = [];
  const overBudget = elapsed() > TICK_HARD_BUDGET_MS;
  if (!overBudget) {
    candidates = await selectJobBatch(now);

    // WP1-1 · ATOMIC CLAIM. Before running anything, claim each candidate with a
    // conditional updateMany (`WHERE id AND status='QUEUED'` → RUNNING). The claim
    // is atomic per row, so two overlapping ticks that both selected the same
    // QUEUED job can NEVER both run it — exactly one gets count===1 (the winner),
    // the loser gets count===0 and drops the job this tick. processJob no longer
    // flips RUNNING itself — the claim IS the flip. Claiming also CLEARS
    // nextAttemptAt so a re-run doesn't re-read a stale backoff marker.
    const claimedAt = new Date();
    const claimed: PoolJob[] = [];
    for (const job of candidates) {
      const res2 = await prisma.enrichmentJob.updateMany({
        where: { id: job.id, status: "QUEUED" },
        data: { status: "RUNNING", startedAt: claimedAt, nextAttemptAt: null },
      });
      if (res2.count === 1) claimed.push(job);
    }

    // Process the CLAIMED batch CONCURRENTLY (bounded by JOB_CONCURRENCY). Each
    // job is a long external call; sequential processing was the 12-min-for-73
    // floor. Safe: dependents were excluded (a DOM-dependent job never shares a
    // batch with its not-yet-terminal CONTACTS root), each was atomically
    // claimed (no double-run), and each processJob touches only its own job +
    // business rows, so concurrency introduces no race.
    const jobLimit = pLimit(JOB_CONCURRENCY);
    const outcomes = await Promise.all(
      claimed.map((job) => jobLimit(() => processJob(job, new Date()))),
    );
    for (const outcome of outcomes) {
      if (outcome === "done") res.unitsDone++;
      else if (outcome === "failed") res.unitsFailed++;
      else if (outcome === "requeued") res.jobsRequeued++;
      // "skipped" (fresh) and "awaiting" (reviews parked) are progress below but
      // aren't a terminal done/failed for the DispatchResult tally.
    }
  }

  // Advance each RUNNING run's progress counter (so the header + Enriching page
  // climb honestly this tick, not just at close), then close any run whose jobs
  // are all terminal (also recovers a run whose last-job-close crashed).
  const runningRuns = await prisma.enrichmentRun.findMany({
    where: { status: "RUNNING" },
    select: { id: true },
    take: RUNNING_RUN_CLOSE_LIMIT,
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
  });
  for (const r of runningRuns) {
    await updateRunProgress(r.id);
    if (await closeRunIfDone(r.id, new Date())) res.runsClosed++;
  }

  // Self-chain signal: work remains AND we made progress this tick. Progress
  // EXCLUDES pure-retry ticks (WP3-6): if a tick only requeued jobs (all workers
  // failed), it did NOT make forward progress — fall back to the cron cadence
  // rather than tight-looping a failing queue. "More work" is any of: jobs left
  // in the pool beyond this batch, discoveries capped this tick, or a job batch
  // skipped for the tick budget.
  const forwardProgress =
    res.unitsDone > 0 ||
    res.discoveriesRun > 0 ||
    res.enrichmentRunsProcessed > 0 ||
    res.runsClosed > 0;
  const workRemains =
    poolHadOverflow ||
    moreDiscoveriesQueued ||
    (overBudget && candidates.length === 0);
  res.hasMoreWork = forwardProgress && workRemains;

  // Neon idle gate · this tick observed a fully-drained system iff there were
  // no pending discoveries, no pending or RUNNING runs, no runnable QUEUED jobs
  // this tick, no overflow beyond the batch, and the job pool was actually
  // inspected (not skipped for the tick budget). When true the route clears the
  // wake flag so the next scheduled tick can skip and let Neon suspend. Anything
  // still in flight (a RUNNING run, queued/overflow work, an untested pool)
  // keeps it false → the */2 cadence continues until the queue truly empties.
  // (A run whose only remaining work is a future-dated backoff retry is not
  // "RUNNING" here once its jobs park, so it relies on the gate's safety scan —
  // an acceptable ≤13-min pickup for already-minutes-delayed retry work.)
  res.idle =
    pendingDiscoveries.length === 0 &&
    !moreDiscoveriesQueued &&
    pendingRuns.length === 0 &&
    runningRuns.length === 0 &&
    !overBudget &&
    candidates.length === 0 &&
    !poolHadOverflow;

  return res;
}

/** A QUEUED job as selected by the pool query (the fields processJob needs). */
interface PoolJob {
  id: string;
  businessId: string;
  family: string;
  attempts: number;
  costUsd: unknown;
  runId: string | null;
}

// Set by selectJobBatch so dispatchPending's hasMoreWork can tell whether more
// runnable QUEUED work exists beyond this batch (module-scope is safe: the
// dispatch tick is single-threaded per invocation).
let poolHadOverflow = false;

const FAMILY_PRIORITY: Record<string, number> = {
  CONTACTS: 0,
  REVIEWS: 0,
  LIGHTHOUSE: 1,
  // B1 · GOOGLE_ADS is its own fetch (target-host ads_search), not DOM-dependent
  // — same priority tier as LIGHTHOUSE (a secondary, non-root external call).
  GOOGLE_ADS: 1,
  SERVICES: 2,
  AI_RESEARCH: 2,
};
const DOM_DEPENDENT = new Set(["SERVICES", "AI_RESEARCH"]);

/**
 * Select the QUEUED job batch to work this tick. Applies, in order:
 *   - WP3-6 · backoff gate — only jobs whose nextAttemptAt is null OR already due;
 *   - WP3-12 · deterministic ordering — orderBy [{createdAt},{id}];
 *   - the DOM DAG — DOM-dependent families (SERVICES/AI_RESEARCH) are skipped
 *     while that business's CONTACTS root is still non-terminal;
 *   - WP3-10 · multi-tenant fairness — round-robin the claim across agencies
 *     (join EnrichmentJob→EnrichmentRun.agencyId), ≤ PER_AGENCY_JOBS_PER_TICK
 *     per agency, so one big run can't monopolise the batch;
 *   - WP3-11 · head-of-line backfill — if fairness/DAG gating left the batch
 *     under JOB_BATCH, fetch a second pool page (skip the first) to backfill
 *     runnable jobs so blocked dependents never stall newer runs' ready work.
 */
async function selectJobBatch(now: Date): Promise<PoolJob[]> {
  poolHadOverflow = false;
  const dueFilter = {
    status: "QUEUED" as const,
    OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
  };

  const first = await fetchRunnablePool(dueFilter, JOB_BATCH * 3, 0);
  const runnable = first.runnable;
  poolHadOverflow = first.poolSize >= JOB_BATCH * 3;

  // WP3-11 · backfill: if the first page's runnable set (after DAG gating) is
  // under JOB_BATCH but the page was FULL (more QUEUED beyond it), fetch a
  // second page skipping the first so blocked dependents don't starve newer
  // runnable work at the head of the line.
  if (runnable.length < JOB_BATCH && first.poolSize >= JOB_BATCH * 3) {
    const seen = new Set(runnable.map((j) => j.id));
    const second = await fetchRunnablePool(
      dueFilter,
      JOB_BATCH * 3,
      first.poolSize,
    );
    for (const j of second.runnable) {
      if (!seen.has(j.id)) runnable.push(j);
    }
    poolHadOverflow = poolHadOverflow || second.poolSize > 0;
  }

  // WP3-10 · round-robin across agencies. Resolve each job's run agencyId, then
  // interleave: take up to PER_AGENCY_JOBS_PER_TICK per agency in round-robin
  // order until JOB_BATCH is filled. Jobs with no runId (legacy/orphan) go in a
  // single "no-agency" bucket so they still drain.
  const runIds = [
    ...new Set(runnable.map((j) => j.runId).filter((x): x is string => !!x)),
  ];
  const agencyByRun = new Map<string, string>();
  if (runIds.length > 0) {
    const runs = await prisma.enrichmentRun.findMany({
      where: { id: { in: runIds } },
      select: { id: true, agencyId: true },
    });
    for (const r of runs) agencyByRun.set(r.id, r.agencyId);
  }
  const buckets = new Map<string, PoolJob[]>();
  for (const j of runnable) {
    const key = (j.runId && agencyByRun.get(j.runId)) || "__none__";
    const arr = buckets.get(key) ?? [];
    arr.push(j);
    buckets.set(key, arr);
  }

  const batch: PoolJob[] = [];
  const cursors = new Map<string, number>();
  const keys = [...buckets.keys()];
  let progressed = true;
  while (batch.length < JOB_BATCH && progressed) {
    progressed = false;
    for (const key of keys) {
      if (batch.length >= JOB_BATCH) break;
      const arr = buckets.get(key)!;
      const c = cursors.get(key) ?? 0;
      // ≤ PER_AGENCY_JOBS_PER_TICK per agency per round-robin sweep set.
      if (c >= arr.length || c >= PER_AGENCY_JOBS_PER_TICK) continue;
      batch.push(arr[c]!);
      cursors.set(key, c + 1);
      progressed = true;
    }
  }
  // If the per-agency cap left the batch short but jobs remain, fill from the
  // remainder (deterministic order) so a single-tenant queue still saturates.
  if (batch.length < JOB_BATCH) {
    const inBatch = new Set(batch.map((j) => j.id));
    for (const j of runnable) {
      if (batch.length >= JOB_BATCH) break;
      if (!inBatch.has(j.id)) batch.push(j);
    }
  }
  if (batch.length < runnable.length) poolHadOverflow = true;
  return batch;
}

/**
 * Fetch one pool page, priority-sort (roots-first), and DAG-gate it. Returns the
 * gated runnable jobs + the raw page size (so the caller can tell whether more
 * QUEUED work exists beyond this page for backfill/hasMoreWork).
 */
async function fetchRunnablePool(
  dueFilter: {
    status: "QUEUED";
    OR: ({ nextAttemptAt: null } | { nextAttemptAt: { lte: Date } })[];
  },
  take: number,
  skip: number,
): Promise<{ runnable: PoolJob[]; poolSize: number }> {
  const pool = (await prisma.enrichmentJob.findMany({
    where: dueFilter,
    select: {
      id: true,
      businessId: true,
      family: true,
      attempts: true,
      costUsd: true,
      runId: true,
    },
    take,
    skip,
    // WP3-12 · deterministic ordering (createdAt then id) so batch composition
    // is stable across ties and re-runs.
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  })) as PoolJob[];

  // Stable roots-first sort (preserves the createdAt/id order within a priority).
  pool.sort(
    (a, b) =>
      (FAMILY_PRIORITY[a.family] ?? 1) - (FAMILY_PRIORITY[b.family] ?? 1),
  );

  const depBizIds = [
    ...new Set(
      pool.filter((j) => DOM_DEPENDENT.has(j.family)).map((j) => j.businessId),
    ),
  ];
  const blocked = new Set<string>();
  if (depBizIds.length > 0) {
    const pendingContacts = await prisma.enrichmentJob.findMany({
      where: {
        businessId: { in: depBizIds },
        family: "CONTACTS",
        status: { in: ["QUEUED", "RUNNING"] },
      },
      select: { businessId: true },
    });
    for (const c of pendingContacts) blocked.add(c.businessId);
  }

  const runnable = pool.filter(
    (j) => !DOM_DEPENDENT.has(j.family) || !blocked.has(j.businessId),
  );
  return { runnable, poolSize: pool.length };
}

/**
 * WP3-10 · Count currently-RUNNING runs per agency (the concurrent-run cap
 * numerator). Grouped so one query covers all pending agencies.
 */
async function countRunningRunsByAgency(
  agencyIds: string[],
): Promise<Map<string, number>> {
  const uniq = [...new Set(agencyIds)];
  const out = new Map<string, number>();
  if (uniq.length === 0) return out;
  const grouped = await prisma.enrichmentRun.groupBy({
    by: ["agencyId"],
    where: { agencyId: { in: uniq }, status: "RUNNING" },
    _count: { _all: true },
  });
  for (const g of grouped) out.set(g.agencyId, g._count._all);
  return out;
}

/**
 * WP3-10 · Load each agency's maxConcurrentRuns (nullable → DEFAULT). One query.
 */
async function loadAgencyRunCaps(
  agencyIds: string[],
): Promise<Map<string, number>> {
  const uniq = [...new Set(agencyIds)];
  const out = new Map<string, number>();
  if (uniq.length === 0) return out;
  const rows = await prisma.agency.findMany({
    where: { id: { in: uniq } },
    select: { id: true, maxConcurrentRuns: true },
  });
  for (const r of rows) {
    out.set(r.id, r.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS);
  }
  return out;
}

/**
 * Advance one RUNNING run's `unitsCompleted` to real progress: the number of
 * requested businesses that have NO outstanding (QUEUED/RUNNING) job left.
 * Monotonic, reaches `unitsRequested` when every job is terminal. Display-only
 * (the header + Enriching page read it) — credit settlement uses `actualUsd`,
 * never this — so updating it mid-run is safe. Replaces the old behaviour where
 * `unitsCompleted` was written only at close, so the bar sat at 0 then jumped.
 * Exported for unit testing.
 */
export async function updateRunProgress(runId: string): Promise<void> {
  const run = await prisma.enrichmentRun.findUnique({
    where: { id: runId },
    select: { unitsRequested: true, status: true },
  });
  if (!run) return;

  // WP9-9 · ONE groupBy for the whole function. Progress is measured in
  // BUSINESSES (the one unit — matches unitsRequested). The per-family job rows
  // are folded down to one verdict per business: a business is "outstanding"
  // while ANY of its family jobs is still QUEUED/RUNNING; "success" once it has
  // ≥1 terminal-success job; "failed" only when every family failed (≥1 FAILED,
  // no success). This groupBy(['businessId','status']) with a COUNT replaces the
  // former SEPARATE distinct findMany (2 queries → 1): `unitsCompleted`
  // (requested − distinct-outstanding-businesses) and the Redis done/failed
  // counts are BOTH derived from `perBiz` below, so per-tick DB load is bounded
  // and does not grow with the number of family rows in the run.
  const jobs =
    (await prisma.enrichmentJob.groupBy({
      by: ["businessId", "status"],
      where: { runId },
      _count: { _all: true },
    })) ?? [];
  const perBiz = new Map<
    string,
    { outstanding: boolean; success: boolean; failed: boolean }
  >();
  for (const g of jobs) {
    const entry = perBiz.get(g.businessId) ?? {
      outstanding: false,
      success: false,
      failed: false,
    };
    if (g.status === "QUEUED" || g.status === "RUNNING")
      entry.outstanding = true;
    else if (
      g.status === "DONE" ||
      g.status === "SKIPPED_FRESH" ||
      g.status === "CHARGED_FROM_DB" ||
      g.status === "SKIPPED_ENTITLED"
    )
      entry.success = true;
    else if (g.status === "FAILED") entry.failed = true;
    perBiz.set(g.businessId, entry);
  }

  // Distinct businesses that still have an outstanding (QUEUED/RUNNING) job —
  // this is exactly what the removed `distinct findMany` computed. A business is
  // "in progress" while any of its family jobs is non-terminal.
  let outstandingBiz = 0;
  let done = 0;
  let failed = 0;
  for (const v of perBiz.values()) {
    if (v.outstanding) {
      outstandingBiz += 1;
      continue; // still in flight — neither done nor failed yet
    }
    if (v.success) done += 1;
    else if (v.failed) failed += 1;
  }

  // WP4-3 · completed = requested − (distinct businesses with an outstanding
  // job). Monotonic, reaches unitsRequested when every job is terminal.
  const completed = Math.max(0, run.unitsRequested - outstandingBiz);
  await prisma.enrichmentRun.update({
    where: { id: runId },
    data: { unitsCompleted: completed },
  });

  // 2026-07-10 · how many outstanding businesses are merely WAITING OUT their
  // retry backoff (all remaining work is QUEUED with a future nextAttemptAt),
  // vs actively RUNNING. This is the "44 of 45 · 1 retrying" hint that fixes the
  // frozen-looking backoff tail (run-forensics end-lag): a business counts as
  // retrying only when it has a future-scheduled QUEUED job AND no RUNNING job.
  // One extra indexed read per tick, bounded by the run's outstanding set.
  let retrying = 0;
  if (outstandingBiz > 0) {
    const now = new Date();
    const backoffRows = await prisma.enrichmentJob.groupBy({
      by: ["businessId"],
      where: { runId, status: "QUEUED", nextAttemptAt: { gt: now } },
      _count: { _all: true },
    });
    const runningBiz = new Set<string>();
    for (const g of jobs) {
      if (g.status === "RUNNING") runningBiz.add(g.businessId);
    }
    // A business actively RUNNING one family while another backs off reads as
    // "in progress", not "retrying" — only pure-backoff businesses are counted.
    retrying = backoffRows.filter((r) => !runningBiz.has(r.businessId)).length;
    retrying = Math.min(retrying, outstandingBiz);
  }

  // WP3-3/WP4-3 · SEED/CORRECT the Redis progress counters from the same
  // authoritative fold above, in the SAME business unit as unitsRequested so the
  // progress endpoint's done/total/failed and % all read in leads, not job-rows
  // (a multi-family run must never show done>total or march in family-sized
  // jumps). total = unitsRequested. The DB is truth; the counters are a
  // read-cache. Re-seeding each tick self-heals any dropped INCR. Best-effort
  // (degrades open when Redis is unavailable).
  // total is the requested business count; fall back to the observed business
  // set for a legacy run whose unitsRequested predates this unit change.
  const total = run.unitsRequested > 0 ? run.unitsRequested : perBiz.size;
  await seedRunProgress(runId, {
    done,
    failed,
    total,
    status: run.status,
    retrying,
  });
}
