// modules/reviews/review-job.ts
//
// Durable REVIEWS ingestion runtime (Phase 5). This is the orchestration layer
// that sits ON TOP of:
//
//   - the pure recency core  (modules/reviews/recency)
//   - the review upsert       (modules/reviews/upsert)
//   - the DfS task adapter    (services/dataforseo/reviews-task)
//
// It closes the four known gaps in the older trigger-pull / harvest-pending
// flow:
//
//   1. NO RETRY ON SUBMIT  — task_post failures (429 / 5xx) used to fall
//      through to a single console.warn + a "task_post_failed" skip. Now
//      submitReviewJob retries with jittered exponential backoff (max 3
//      attempts) and, only after the budget is exhausted, records a FAILED
//      ReviewJob with lastError. Failure is NEVER silently swallowed.
//
//   2. 429 IGNORED          — rate-limit responses are now explicitly classified
//      as retryable (via DataForSeoError.retryable / httpStatus) and backed off.
//
//   3. NO RECONCILIATION    — tasks whose pingback never arrived used to sit
//      AWAITING_PINGBACK forever. reconcileStuckReviewJobs sweeps stale jobs,
//      pulls task_get once, finishes them when ready, and FAILS LOUDLY (FAILED +
//      RECONCILED note + console.error) past a hard ceiling so the loss is
//      observable, never silent.
//
//   4. NO RECENCY-BOUNDED DEPTH — depth is governed by RECENCY, not lifetime
//      review count. fetchReviewJob trims to the 365-day window, and escalates
//      to a deeper page ONLY when shouldEscalate() says the window prefix isn't
//      exhausted. A 5,000-lifetime business whose page tail is already older
//      than 365d STOPS — it is never escalated up the depth ladder.
//
// ALL of these functions MUST run inside an open CronRun (the downstream
// reviewsTaskPost / reviewsTaskGet → assertCronContext chain enforces it). The
// caller — a cron route — wraps with withCronRun / cronHandler.

import prisma, { type Prisma } from "@/lib/prisma";
import {
  reviewsTaskPost,
  reviewsTaskGet,
  DataForSeoError,
  type ReviewItem,
  type ReviewsTaskGetResult,
} from "@/services/dataforseo";
import {
  upsertReviewBatch,
  recomputeReviewAggregates,
} from "@/modules/reviews/upsert";
import { reviewItemToPersist, locationCodeForCountry } from "./persist-helpers";
import {
  planReviewFetch,
  nextDepth,
  shouldEscalate,
  trimToWindow,
  REVIEW_WINDOW_DAYS,
} from "./recency";

/**
 * The full ReviewJob row type. Derived via Prisma payload helper from the
 * re-exported `Prisma` namespace (per .claude/rules/conventions.md · never a
 * bare `@/lib/generated/prisma` import). A no-arg findUnique returns this exact
 * shape, so it matches every prisma.reviewJob.* return below.
 */
export type ReviewJob = Prisma.ReviewJobGetPayload<Record<string, never>>;

// ---- Tuning constants ----------------------------------------------------

/** Max submit attempts (1 initial + 2 retries) before recording FAILED. */
const MAX_SUBMIT_ATTEMPTS = 3;
/** Base backoff for the submit retry loop (doubles each attempt). */
const SUBMIT_BACKOFF_BASE_MS = 500;
/** Cap on a single submit backoff window. */
const SUBMIT_BACKOFF_MAX_MS = 8_000;

/** Default reconciliation sweep window: jobs older than this are candidates. */
const DEFAULT_RECONCILE_AFTER_MINUTES = 120;
/** Hard ceiling: a job older than this that's still not ready is given up on
 *  (FAILED + RECONCILED note + console.error). 24h is comfortably past the
 *  DfS Standard-queue 45-minute compute window — anything this old is lost. */
const RECONCILE_HARD_CEILING_MS = 24 * 60 * 60 * 1000;

/** Statuses from which a job can still progress (used for idempotency). */
const NON_TERMINAL_STATUSES = [
  "QUEUED",
  "SUBMITTED",
  "AWAITING_PINGBACK",
  "FETCHING",
] as const;

const TWELVE_MONTHS_MS = REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;

// ---- Public types --------------------------------------------------------

export type SubmitReviewMode = "initial" | "delta" | "manual";

/** Sleep seam so tests don't wait real backoff windows. */
let _sleep: (ms: number) => Promise<void> = (ms) =>
  new Promise((r) => setTimeout(r, ms));
/** Override the inter-retry sleep (tests only). Pass `null` to restore. */
export function __setSleepForTesting(
  fn: ((ms: number) => Promise<void>) | null,
): void {
  _sleep = fn ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
}

// ---- Helpers -------------------------------------------------------------

/** ReviewJob.mode is "full" | "delta". Map the public submit mode onto it. */
function dbMode(mode: SubmitReviewMode): "full" | "delta" {
  return mode === "delta" ? "delta" : "full";
}

/** planReviewFetch only knows "initial" | "delta"; manual plans like initial. */
function planMode(mode: SubmitReviewMode): "initial" | "delta" {
  return mode === "delta" ? "delta" : "initial";
}

/**
 * Is this error worth retrying? 429 + 5xx (transport, timeout, server) are
 * retryable; 4xx client errors (bad CID, auth) are not — retrying just burns
 * the budget. DataForSeoError carries `retryable` + `httpStatus` so we trust
 * those; non-DfS errors (rare) are treated as non-retryable to fail fast.
 */
function isRetryableSubmitError(err: unknown): boolean {
  if (err instanceof DataForSeoError) {
    if (err.retryable) return true;
    if (err.httpStatus === 429 || err.httpStatus === 408) return true;
    if (err.httpStatus != null && err.httpStatus >= 500) return true;
    return false;
  }
  return false;
}

/** Jittered exponential backoff for the submit retry loop. */
function submitBackoffMs(attempt: number): number {
  const exp = SUBMIT_BACKOFF_BASE_MS * Math.pow(2, attempt - 1);
  const capped = Math.min(exp, SUBMIT_BACKOFF_MAX_MS);
  // Full jitter so concurrent workers don't synchronize retries.
  return Math.floor(Math.random() * capped) + 1;
}

/** Map DfS review items to objects carrying a parsed `postedAt` for the pure
 *  recency core. Items that can't be normalized (missing review_id/rating/
 *  timestamp) are dropped — they can't participate in window logic anyway. */
function itemsWithPostedAt(
  items: ReviewItem[],
  businessId: string,
): Array<{ item: ReviewItem; postedAt: Date }> {
  const out: Array<{ item: ReviewItem; postedAt: Date }> = [];
  for (const item of items) {
    const persist = reviewItemToPersist(item, businessId);
    if (persist) out.push({ item, postedAt: persist.postedAt });
  }
  return out;
}

/** The oldest postedAt across a (newest-first) batch, or null if empty. */
function oldestPostedAt(rows: Array<{ postedAt: Date }>): Date | null {
  let oldest: Date | null = null;
  for (const r of rows) {
    if (oldest === null || r.postedAt.getTime() < oldest.getTime()) {
      oldest = r.postedAt;
    }
  }
  return oldest;
}

// ---- submitReviewJob -----------------------------------------------------

/**
 * Submit a durable review-pull job for one business. MUST run inside a CronRun.
 *
 * Flow:
 *   1. Idempotency — skip if a non-terminal ReviewJob already exists for the
 *      business (returns that job; does NOT double-post / double-bill).
 *   2. Resolve the business + its googleCid. No CID → FAILED job (we can't
 *      query DfS; recording FAILED keeps the loss observable, never silent).
 *   3. Compute depth via planReviewFetch(reviewCount, mode).
 *   4. reviewsTaskPost with RETRY on 429 / 5xx — jittered exponential backoff,
 *      max 3 attempts. (dataforSeoPost has its own inner retry; this is the
 *      job-layer guard the task spec requires so a flaky submit still lands a
 *      durable job row.)
 *   5. On success → create ReviewJob (status AWAITING_PINGBACK) with the
 *      task_id + depth, and set Business.pendingReviewsTaskId so the pingback
 *      (or the reconcile sweep) can resolve the result.
 *   6. On submit failure after retries → record a FAILED ReviewJob with
 *      lastError. NEVER silently swallow.
 *
 * Returns the ReviewJob row (either the pre-existing non-terminal one, the
 * newly-created AWAITING_PINGBACK one, or the FAILED one).
 */
export async function submitReviewJob(
  businessId: string,
  mode: SubmitReviewMode,
): Promise<ReviewJob> {
  // 1. Idempotency · a non-terminal job already in flight wins.
  const existing = await prisma.reviewJob.findFirst({
    where: {
      businessId,
      status: { in: [...NON_TERMINAL_STATUSES] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;

  // 2. Resolve business + CID.
  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, googleCid: true, country: true, reviewCount: true },
  });
  if (!biz) {
    throw new Error(
      `[reviews:submitReviewJob] business not found: ${businessId}`,
    );
  }

  const planned = planReviewFetch({
    reviewCount: biz.reviewCount,
    mode: planMode(mode),
  });
  const depth = planned.depth;

  if (!biz.googleCid) {
    // Record FAILED so the gap is observable — never a silent no-op.
    const failed = await prisma.reviewJob.create({
      data: {
        businessId,
        mode: dbMode(mode),
        status: "FAILED",
        depth,
        attempts: 0,
        lastError: "no_google_cid · cannot query DataForSEO",
      },
    });
    console.error(
      JSON.stringify({
        level: "error",
        event: "reviews.submit.no_cid",
        businessId,
        jobId: failed.id,
      }),
    );
    return failed;
  }

  // 4. Submit with retry on 429 / 5xx.
  let lastErr: unknown = null;
  let taskId: string | null = null;
  let attempts = 0;
  for (let attempt = 1; attempt <= MAX_SUBMIT_ATTEMPTS; attempt++) {
    attempts = attempt;
    if (attempt > 1) await _sleep(submitBackoffMs(attempt - 1));
    try {
      const posted = await reviewsTaskPost({
        cid: biz.googleCid,
        location_code: locationCodeForCountry(biz.country),
        language_code: "en",
        depth,
        sort_by: "newest",
        tag: `mapsly:${mode}:biz_${businessId}`,
        priority: 1,
      });
      taskId = posted.taskId;
      break;
    } catch (err) {
      lastErr = err;
      if (isRetryableSubmitError(err) && attempt < MAX_SUBMIT_ATTEMPTS) {
        continue; // backoff + retry
      }
      break; // non-retryable, or budget exhausted
    }
  }

  if (!taskId) {
    // 6. Submit failed after retries · record FAILED · NEVER swallow.
    const message =
      lastErr instanceof Error ? lastErr.message : String(lastErr ?? "unknown");
    const failed = await prisma.reviewJob.create({
      data: {
        businessId,
        mode: dbMode(mode),
        status: "FAILED",
        depth,
        attempts,
        lastError: `task_post failed after ${attempts} attempt(s): ${message}`,
      },
    });
    console.error(
      JSON.stringify({
        level: "error",
        event: "reviews.submit.failed",
        businessId,
        jobId: failed.id,
        attempts,
        message,
      }),
    );
    return failed;
  }

  // 5. Submit succeeded · create the durable AWAITING_PINGBACK job + set the
  //    in-flight cursor so the pingback / reconcile sweep can resolve it.
  const job = await prisma.reviewJob.create({
    data: {
      businessId,
      mode: dbMode(mode),
      status: "AWAITING_PINGBACK",
      taskId,
      depth,
      attempts,
    },
  });

  await prisma.business.update({
    where: { id: businessId },
    data: { pendingReviewsTaskId: taskId },
  });

  return job;
}

// ---- fetchReviewJob ------------------------------------------------------

export interface FetchReviewJobResult {
  job: ReviewJob;
  /** What the fetch did: persisted + finished, escalated to a deeper task, or
   *  short-circuited (job already terminal / not found). */
  outcome: "done" | "escalated" | "noop";
  /** Items returned by task_get (pre-trim). */
  itemsReturned: number;
  /** Items kept after trimToWindow (in-scope). */
  itemsInWindow: number;
  /** New depth when outcome === "escalated". */
  escalatedToDepth?: number;
}

/**
 * Fetch + persist the result of a previously-submitted job. MUST run inside a
 * CronRun. Called from the pingback webhook OR the reconcile sweep.
 *
 * Flow:
 *   1. Load the job. If missing / already terminal → noop (idempotent).
 *   2. Set status FETCHING.
 *   3. reviewsTaskGet(taskId).
 *   4. trimToWindow(items, now, 365d) — recency-bounded.
 *   5. Persist via upsertReviewBatch (existing duplicate-safe upsert).
 *   6. Recompute Business aggregates + advance the review cursor.
 *   7. ESCALATION GATE — if shouldEscalate({pageSize, depthRequested,
 *      oldestPostedAt, now}) → bump depth via nextDepth and RE-SUBMIT a new
 *      task (do NOT truncate). The current job is marked DONE; a fresh
 *      AWAITING_PINGBACK job carries the deeper pull.
 *   8. Else → status DONE.
 */
export async function fetchReviewJob(
  jobId: string,
  now: Date = new Date(),
): Promise<FetchReviewJobResult> {
  const job = await prisma.reviewJob.findUnique({ where: { id: jobId } });
  if (!job) {
    throw new Error(`[reviews:fetchReviewJob] job not found: ${jobId}`);
  }
  if (job.status === "DONE" || job.status === "FAILED") {
    return { job, outcome: "noop", itemsReturned: 0, itemsInWindow: 0 };
  }
  if (!job.taskId) {
    const failed = await prisma.reviewJob.update({
      where: { id: jobId },
      data: { status: "FAILED", lastError: "no taskId on job" },
    });
    console.error(
      JSON.stringify({
        level: "error",
        event: "reviews.fetch.no_task_id",
        jobId,
        businessId: job.businessId,
      }),
    );
    return { job: failed, outcome: "noop", itemsReturned: 0, itemsInWindow: 0 };
  }

  await prisma.reviewJob.update({
    where: { id: jobId },
    data: { status: "FETCHING" },
  });

  const result: ReviewsTaskGetResult = await reviewsTaskGet(job.taskId);

  return persistFetchResult(job, result, now);
}

/**
 * Shared persist + escalate path used by both fetchReviewJob and the reconcile
 * sweep (so a reconciled-ready task finishes identically to a pingback one).
 */
async function persistFetchResult(
  job: ReviewJob,
  result: ReviewsTaskGetResult,
  now: Date,
): Promise<FetchReviewJobResult> {
  const businessId = job.businessId;

  // 4. Recency-bound: keep only items within the 365-day window.
  const decorated = itemsWithPostedAt(result.items, businessId);
  const inWindow = trimToWindow(decorated, now, REVIEW_WINDOW_DAYS);
  const inWindowItems = inWindow.map((r) => r.item);

  // 5. Persist via the existing duplicate-safe upsert. Pass the same 12-month
  //    cutoff the upsert walker uses + the known cursor for delta walking.
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      latestReviewExternalId: true,
      reviewsFirstPulledAt: true,
    },
  });

  const cutoffDate = new Date(now.getTime() - TWELVE_MONTHS_MS);
  const upsertResult = await upsertReviewBatch(businessId, inWindowItems, {
    cutoffDate,
    knownLatestExternalId: business?.latestReviewExternalId ?? null,
  });

  // 6. Advance the cursor + clear the in-flight pointer (mirrors pingback).
  await prisma.business.update({
    where: { id: businessId },
    data: {
      pendingReviewsTaskId: null,
      reviewsFirstPulledAt: business?.reviewsFirstPulledAt ?? now,
      reviewsLastDeltaAt: now,
      latestReviewExternalId:
        upsertResult.topExternalId ??
        business?.latestReviewExternalId ??
        undefined,
      latestReviewPostedAt: upsertResult.topPostedAt ?? undefined,
      lastRefreshedAt: now,
    },
  });

  await recomputeReviewAggregates(
    businessId,
    result.totalReviewsCount,
    result.aggregateRating,
  );

  // 7. ESCALATION GATE — recency-bounded depth, the anti-regression. We look at
  //    the FULL returned page (not the trimmed one) so the oldest-review check
  //    reflects whether the window prefix is exhausted.
  const pageSize = decorated.length;
  const oldest = oldestPostedAt(decorated);
  const climb =
    shouldEscalate({
      pageSize,
      depthRequested: job.depth,
      oldestPostedAt: oldest,
      now,
      windowDays: REVIEW_WINDOW_DAYS,
    }) && nextDepth(job.depth) !== null;

  if (climb) {
    const deeper = nextDepth(job.depth)!;
    // Mark the current job DONE — its page is fully persisted.
    const doneJob = await prisma.reviewJob.update({
      where: { id: job.id },
      data: { status: "DONE" },
    });
    // Re-submit a NEW, deeper task rather than truncating. This bypasses the
    // submitReviewJob idempotency guard intentionally — the prior job is now
    // terminal (DONE), so no non-terminal job exists to block it; but to be
    // explicit and avoid re-querying the business count, we post directly.
    await escalateToDeeperTask(job, deeper, now);
    return {
      job: doneJob,
      outcome: "escalated",
      itemsReturned: result.items.length,
      itemsInWindow: inWindowItems.length,
      escalatedToDepth: deeper,
    };
  }

  // 8. No escalation · done.
  const doneJob = await prisma.reviewJob.update({
    where: { id: job.id },
    data: { status: "DONE" },
  });
  return {
    job: doneJob,
    outcome: "done",
    itemsReturned: result.items.length,
    itemsInWindow: inWindowItems.length,
  };
}

/**
 * Submit a deeper follow-up task for an escalating job. Posts a new DfS task at
 * `depth` and records a fresh AWAITING_PINGBACK ReviewJob + in-flight cursor.
 * On submit failure (after the adapter's own retry), records a FAILED job so the
 * escalation gap is observable.
 */
async function escalateToDeeperTask(
  parent: ReviewJob,
  depth: number,
  _now: Date,
): Promise<ReviewJob> {
  const biz = await prisma.business.findUnique({
    where: { id: parent.businessId },
    select: { id: true, googleCid: true, country: true },
  });
  if (!biz?.googleCid) {
    const failed = await prisma.reviewJob.create({
      data: {
        businessId: parent.businessId,
        mode: parent.mode,
        status: "FAILED",
        depth,
        lastError: "escalation aborted · no_google_cid",
      },
    });
    console.error(
      JSON.stringify({
        level: "error",
        event: "reviews.escalate.no_cid",
        businessId: parent.businessId,
        jobId: failed.id,
      }),
    );
    return failed;
  }

  try {
    const posted = await reviewsTaskPost({
      cid: biz.googleCid,
      location_code: locationCodeForCountry(biz.country),
      language_code: "en",
      depth,
      sort_by: "newest",
      tag: `mapsly:escalate:biz_${parent.businessId}`,
      priority: 1,
    });
    const job = await prisma.reviewJob.create({
      data: {
        businessId: parent.businessId,
        mode: parent.mode,
        status: "AWAITING_PINGBACK",
        taskId: posted.taskId,
        depth,
      },
    });
    await prisma.business.update({
      where: { id: parent.businessId },
      data: { pendingReviewsTaskId: posted.taskId },
    });
    return job;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = await prisma.reviewJob.create({
      data: {
        businessId: parent.businessId,
        mode: parent.mode,
        status: "FAILED",
        depth,
        lastError: `escalation task_post failed: ${message}`,
      },
    });
    console.error(
      JSON.stringify({
        level: "error",
        event: "reviews.escalate.failed",
        businessId: parent.businessId,
        jobId: failed.id,
        message,
      }),
    );
    return failed;
  }
}

// ---- reconcileStuckReviewJobs --------------------------------------------

export interface ReconcileSummary {
  /** Candidate jobs inspected this sweep. */
  inspected: number;
  /** Jobs that turned out ready → finished (DONE or escalated). */
  finished: number;
  /** Jobs given up on past the hard ceiling → FAILED + RECONCILED note. */
  failedPastCeiling: number;
  /** Jobs still pending (under the ceiling, not ready yet) → left in place. */
  stillPending: number;
}

/**
 * Sweep jobs that have been AWAITING_PINGBACK / SUBMITTED past the threshold
 * (the pingback never arrived) and try to resolve them. MUST run inside a
 * CronRun.
 *
 * For each candidate:
 *   - Try reviewsTaskGet ONCE.
 *   - If ready → finish it exactly like fetchReviewJob (persist + escalate gate).
 *   - If not ready AND older than the hard ceiling (24h) → FAILED + RECONCILED
 *     note + console.error so the loss is NEVER silent.
 *   - If not ready AND under the ceiling → leave it; a later sweep retries.
 */
export async function reconcileStuckReviewJobs(
  olderThanMinutes: number = DEFAULT_RECONCILE_AFTER_MINUTES,
  now: Date = new Date(),
): Promise<ReconcileSummary> {
  const staleBefore = new Date(now.getTime() - olderThanMinutes * 60 * 1000);
  const ceilingBefore = new Date(now.getTime() - RECONCILE_HARD_CEILING_MS);

  const candidates = await prisma.reviewJob.findMany({
    where: {
      status: { in: ["AWAITING_PINGBACK", "SUBMITTED"] },
      updatedAt: { lt: staleBefore },
    },
    orderBy: { updatedAt: "asc" },
    take: 200,
  });

  let finished = 0;
  let failedPastCeiling = 0;
  let stillPending = 0;

  for (const job of candidates) {
    if (!job.taskId) {
      // No task to poll · this job can never resolve. Fail it loudly.
      await failJobPastCeiling(
        job,
        "reconcile · job has no taskId, cannot resolve",
        now,
      );
      failedPastCeiling += 1;
      continue;
    }

    let result: ReviewsTaskGetResult | null = null;
    let getErr: unknown = null;
    try {
      result = await reviewsTaskGet(job.taskId);
    } catch (err) {
      getErr = err;
    }

    if (result) {
      // Ready · finish exactly like the pingback path (persist + escalate gate).
      await persistFetchResult(job, result, now);
      finished += 1;
      continue;
    }

    // Not ready. Past the hard ceiling → give up loudly. Else leave for later.
    const isPastCeiling = job.createdAt.getTime() < ceilingBefore.getTime();
    if (isPastCeiling) {
      const message =
        getErr instanceof Error
          ? getErr.message
          : String(getErr ?? "not ready");
      await failJobPastCeiling(
        job,
        `reconcile · task not ready past 24h ceiling: ${message}`,
        now,
      );
      failedPastCeiling += 1;
    } else {
      stillPending += 1;
    }
  }

  return {
    inspected: candidates.length,
    finished,
    failedPastCeiling,
    stillPending,
  };
}

/**
 * Give up on a job past the hard ceiling: set FAILED + a RECONCILED-tagged
 * lastError, clear the business in-flight cursor so future pulls aren't blocked,
 * and console.error so the loss is observable (Sentry-style structured log).
 */
async function failJobPastCeiling(
  job: ReviewJob,
  reason: string,
  _now: Date,
): Promise<void> {
  await prisma.reviewJob.update({
    where: { id: job.id },
    data: { status: "FAILED", lastError: `RECONCILED · ${reason}` },
  });
  // Clear the in-flight cursor so the business isn't stuck "in flight" forever.
  if (job.taskId) {
    await prisma.business
      .updateMany({
        where: { id: job.businessId, pendingReviewsTaskId: job.taskId },
        data: { pendingReviewsTaskId: null },
      })
      .catch(() => {
        /* best-effort cursor clear */
      });
  }
  console.error(
    JSON.stringify({
      level: "error",
      event: "reviews.reconcile.failed",
      jobId: job.id,
      businessId: job.businessId,
      taskId: job.taskId,
      ageMinutes: Math.round(
        (_now.getTime() - job.createdAt.getTime()) / 60000,
      ),
      reason,
    }),
  );
}
