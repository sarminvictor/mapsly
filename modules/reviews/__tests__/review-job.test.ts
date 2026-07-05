/**
 * Durable REVIEWS ingestion runtime (Phase 5) · invariants.
 *
 * These pin the four gaps the runtime closes:
 *
 *   1. submitReviewJob RETRIES on 429 then succeeds (no silent first-try fail).
 *   2. submitReviewJob FAILS LOUDLY (FAILED job + lastError, never silent) after
 *      the retry budget is exhausted.
 *   3. fetchReviewJob ESCALATES depth when the window prefix is NOT exhausted
 *      (full page + oldest review still within 365d).
 *   4. fetchReviewJob STOPS (no escalation) for a 5,000-lifetime business whose
 *      page tail is already older than 365d — the recency anti-regression.
 *   5. reconcileStuckReviewJobs FAILS LOUDLY past the 24h hard ceiling.
 *
 * The pure recency core (modules/reviews/recency) and the persist normalizer
 * (reviewItemToPersist) are NOT mocked — we want the real window/escalation
 * logic to run. Only @/lib/prisma + the DfS adapter + the upsert are mocked.
 */

import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";

// --- Mocks ---------------------------------------------------------------

const prismaMock = vi.hoisted(() => ({
  reviewJob: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  business: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ default: prismaMock, Prisma: {} }));

// DataForSeoError needs to be a real class so `instanceof` checks in the
// runtime's retry classifier work. Re-export the real one, mock the calls.
const dfsMock = vi.hoisted(() => ({
  reviewsTaskPost: vi.fn(),
  reviewsTaskGet: vi.fn(),
}));
vi.mock("@/services/dataforseo", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/dataforseo")>();
  return {
    ...actual,
    reviewsTaskPost: dfsMock.reviewsTaskPost,
    reviewsTaskGet: dfsMock.reviewsTaskGet,
  };
});

const upsertMock = vi.hoisted(() => ({
  upsertReviewBatch: vi.fn(),
  recomputeReviewAggregates: vi.fn(),
}));
vi.mock("@/modules/reviews/upsert", () => upsertMock);

import { DataForSeoError } from "@/services/dataforseo";
import {
  submitReviewJob,
  fetchReviewJob,
  reconcileStuckReviewJobs,
  __setSleepForTesting,
} from "../review-job";

// --- Fixtures ------------------------------------------------------------

const NOW = new Date("2026-06-22T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

/** A minimal valid DfS review item (passes reviewItemToPersist). */
function reviewItem(id: string, postedAt: Date) {
  return {
    review_id: id,
    rating: { value: 5 },
    timestamp: postedAt.toISOString(),
    profile_name: "Jane Doe",
    review_text: "Great",
  };
}

const BIZ = {
  id: "biz_1",
  googleCid: "cid-123",
  country: "US",
  reviewCount: 30,
};

beforeEach(() => {
  vi.clearAllMocks();
  __setSleepForTesting(async () => {}); // no real backoff waits
  // Sensible passthrough defaults for the writes most tests don't assert on.
  prismaMock.reviewJob.create.mockImplementation(async ({ data }) => ({
    id: "job_new",
    taskId: null,
    depth: 200,
    mode: "full",
    status: "AWAITING_PINGBACK",
    attempts: 0,
    businessId: BIZ.id,
    createdAt: NOW,
    updatedAt: NOW,
    ...data,
  }));
  prismaMock.reviewJob.update.mockImplementation(async ({ data }) => ({
    id: "job_x",
    businessId: BIZ.id,
    taskId: "task-1",
    depth: 200,
    mode: "full",
    createdAt: NOW,
    updatedAt: NOW,
    ...data,
  }));
  prismaMock.business.update.mockResolvedValue({});
  prismaMock.business.updateMany.mockResolvedValue({ count: 1 });
  upsertMock.upsertReviewBatch.mockResolvedValue({
    inserted: 0,
    insertedIds: [],
    updated: 0,
    skipped: 0,
    cutoffStop: false,
    cursorStop: false,
    topExternalId: null,
    topPostedAt: null,
    firstStaleExternalId: null,
  });
  upsertMock.recomputeReviewAggregates.mockResolvedValue(undefined);
});

afterEach(() => {
  __setSleepForTesting(null);
});

// --- 1. submit retries on 429 then succeeds ------------------------------

describe("submitReviewJob · retry", () => {
  test("retries on 429 then succeeds · creates AWAITING_PINGBACK job", async () => {
    prismaMock.reviewJob.findFirst.mockResolvedValue(null); // no in-flight job
    prismaMock.business.findUnique.mockResolvedValue(BIZ);

    dfsMock.reviewsTaskPost
      .mockRejectedValueOnce(
        new DataForSeoError({
          operation: "dataforseo.reviews.task_post",
          message: "HTTP 429 Too Many Requests",
          httpStatus: 429,
          retryable: true,
        }),
      )
      .mockResolvedValueOnce({ taskId: "task-ok", postedCostUsd: 0 });

    const job = await submitReviewJob("biz_1", "initial");

    // Submitted twice (1 fail + 1 success).
    expect(dfsMock.reviewsTaskPost).toHaveBeenCalledTimes(2);
    expect(job.status).toBe("AWAITING_PINGBACK");
    expect(job.taskId).toBe("task-ok");
    // In-flight cursor set so the pingback / reconcile can resolve it.
    expect(prismaMock.business.update).toHaveBeenCalledWith({
      where: { id: "biz_1" },
      data: { pendingReviewsTaskId: "task-ok" },
    });
  });

  test("idempotency · existing non-terminal job short-circuits (no submit)", async () => {
    prismaMock.reviewJob.findFirst.mockResolvedValue({
      id: "job_existing",
      status: "AWAITING_PINGBACK",
      taskId: "task-existing",
      businessId: "biz_1",
    });

    const job = await submitReviewJob("biz_1", "initial");

    expect(job.id).toBe("job_existing");
    expect(dfsMock.reviewsTaskPost).not.toHaveBeenCalled();
    expect(prismaMock.reviewJob.create).not.toHaveBeenCalled();
  });
});

// --- 2. submit fails loudly after retries --------------------------------

describe("submitReviewJob · loud failure", () => {
  test("FAILS (not silent) after retry budget exhausted on 429", async () => {
    prismaMock.reviewJob.findFirst.mockResolvedValue(null);
    prismaMock.business.findUnique.mockResolvedValue(BIZ);

    const rateLimited = new DataForSeoError({
      operation: "dataforseo.reviews.task_post",
      message: "HTTP 429 Too Many Requests",
      httpStatus: 429,
      retryable: true,
    });
    dfsMock.reviewsTaskPost.mockRejectedValue(rateLimited);

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const job = await submitReviewJob("biz_1", "initial");
    errSpy.mockRestore();

    // 3 attempts (1 + 2 retries), all fail.
    expect(dfsMock.reviewsTaskPost).toHaveBeenCalledTimes(3);
    // A FAILED job row was recorded — the loss is durable + observable.
    expect(job.status).toBe("FAILED");
    expect(job.lastError).toMatch(/task_post failed after 3 attempt/);
    // Cursor NOT set on failure.
    expect(prismaMock.business.update).not.toHaveBeenCalled();
  });

  test("non-retryable error (4xx) fails fast · no extra retries", async () => {
    prismaMock.reviewJob.findFirst.mockResolvedValue(null);
    prismaMock.business.findUnique.mockResolvedValue(BIZ);

    dfsMock.reviewsTaskPost.mockRejectedValue(
      new DataForSeoError({
        operation: "dataforseo.reviews.task_post",
        message: "HTTP 400 Bad Request",
        httpStatus: 400,
        retryable: false,
      }),
    );

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const job = await submitReviewJob("biz_1", "initial");
    errSpy.mockRestore();

    expect(dfsMock.reviewsTaskPost).toHaveBeenCalledTimes(1); // no retries
    expect(job.status).toBe("FAILED");
  });
});

// --- 3 + 4. fetch escalation gate (recency-bounded depth) ----------------

describe("fetchReviewJob · recency-bounded escalation", () => {
  test("ESCALATES when window prefix NOT exhausted (full page, oldest within 365d)", async () => {
    // depth 200 requested · 200 items returned (full) · oldest 120d ago (in window).
    prismaMock.reviewJob.findUnique.mockResolvedValue({
      id: "job_esc",
      businessId: "biz_1",
      taskId: "task-esc",
      depth: 200,
      mode: "full",
      status: "AWAITING_PINGBACK",
      createdAt: NOW,
      updatedAt: NOW,
    });
    prismaMock.business.findUnique.mockResolvedValue({
      id: "biz_1",
      googleCid: "cid-123",
      country: "US",
      latestReviewExternalId: null,
      reviewsFirstPulledAt: null,
    });

    // 200 items, all within window; oldest at 120d.
    const items = [];
    for (let i = 0; i < 199; i++) items.push(reviewItem(`r${i}`, daysAgo(10)));
    items.push(reviewItem("r199", daysAgo(120))); // oldest still in window
    dfsMock.reviewsTaskGet.mockResolvedValue({
      items,
      aggregateRating: 4.8,
      totalReviewsCount: 1000,
      itemsCount: items.length,
      taskStatusCode: 20000,
    });
    dfsMock.reviewsTaskPost.mockResolvedValue({
      taskId: "task-deeper",
      postedCostUsd: 0,
    });

    const res = await fetchReviewJob("job_esc", NOW);

    expect(res.outcome).toBe("escalated");
    expect(res.escalatedToDepth).toBe(700); // nextDepth(200)
    // A deeper follow-up task was actually posted at depth 700.
    expect(dfsMock.reviewsTaskPost).toHaveBeenCalledWith(
      expect.objectContaining({ depth: 700 }),
    );
  });

  test("STOPS for 5000-lifetime biz whose page tail is OLDER than 365d (anti-regression)", async () => {
    prismaMock.reviewJob.findUnique.mockResolvedValue({
      id: "job_big",
      businessId: "biz_1",
      taskId: "task-big",
      depth: 200,
      mode: "full",
      status: "AWAITING_PINGBACK",
      createdAt: NOW,
      updatedAt: NOW,
    });
    prismaMock.business.findUnique.mockResolvedValue({
      id: "biz_1",
      googleCid: "cid-123",
      country: "US",
      latestReviewExternalId: null,
      reviewsFirstPulledAt: null,
    });

    // 200 items (full page) but the OLDEST is 400d ago — past the window. The
    // cutoff lies inside this page, so deeper pages hold nothing in scope.
    const items = [];
    for (let i = 0; i < 199; i++) items.push(reviewItem(`r${i}`, daysAgo(10)));
    items.push(reviewItem("r199", daysAgo(400))); // tail older than 365d
    dfsMock.reviewsTaskGet.mockResolvedValue({
      items,
      aggregateRating: 4.9,
      totalReviewsCount: 5000, // huge lifetime count
      itemsCount: items.length,
      taskStatusCode: 20000,
    });

    const res = await fetchReviewJob("job_big", NOW);

    expect(res.outcome).toBe("done");
    expect(res.escalatedToDepth).toBeUndefined();
    // Crucially: NO deeper task posted despite 5000 lifetime reviews.
    expect(dfsMock.reviewsTaskPost).not.toHaveBeenCalled();
  });

  test("already-terminal job is a noop (idempotent)", async () => {
    prismaMock.reviewJob.findUnique.mockResolvedValue({
      id: "job_done",
      businessId: "biz_1",
      taskId: "task-done",
      depth: 200,
      mode: "full",
      status: "DONE",
      createdAt: NOW,
      updatedAt: NOW,
    });

    const res = await fetchReviewJob("job_done", NOW);

    expect(res.outcome).toBe("noop");
    expect(dfsMock.reviewsTaskGet).not.toHaveBeenCalled();
  });
});

// --- A5. verified-empty stamps the freshness cursor; transient failure does not

/**
 * BILLING INVARIANT A5 · "never re-charge credits for a no-data retry".
 *
 * The freshness/billing layer (modules/cost/estimate.ts ←
 * modules/discovery/enrich-fresh-db.ts) reads Business.reviewsLastDeltaAt to
 * decide whether a reviews unit is "fresh" (→ $0 on a retry). For that to hold
 * on a business that genuinely has ZERO reviews, a VERIFIED-EMPTY reviews pull
 * (reviewsTaskGet succeeded, task status 20000, but 0 items) MUST stamp the
 * cursor — exactly as an empty CONTACTS scan stamps contactsExtractedAt.
 *
 * The opposite must also hold: a TRANSIENT FAILURE (reviewsTaskGet throws —
 * 40602 not-ready / 5xx) must NOT stamp, so the retry re-charges and the pull
 * is genuinely re-attempted. persistFetchResult is never reached on a throw.
 *
 * State-model safety (see modules/agency-portal/discover/family-coverage.ts):
 * stamping this cursor does NOT flip the reviews family to "enriched" — the
 * displayed state is derived from REAL Review rows, never from
 * reviewsLastDeltaAt. So a verified-empty run correctly shows "empty".
 */
describe("persistFetchResult · A5 no-data-retry billing cursor", () => {
  test("VERIFIED-EMPTY (0 reviews, task OK) STAMPS reviewsLastDeltaAt → retry is free", async () => {
    prismaMock.reviewJob.findUnique.mockResolvedValue({
      id: "job_empty",
      businessId: "biz_1",
      taskId: "task-empty",
      depth: 200,
      mode: "delta",
      status: "AWAITING_PINGBACK",
      createdAt: NOW,
      updatedAt: NOW,
    });
    prismaMock.business.findUnique.mockResolvedValue({
      id: "biz_1",
      googleCid: "cid-123",
      country: "US",
      latestReviewExternalId: null,
      reviewsFirstPulledAt: null,
    });
    // DfS task RAN successfully (status 20000) and genuinely returned 0 reviews.
    dfsMock.reviewsTaskGet.mockResolvedValue({
      items: [],
      aggregateRating: null,
      totalReviewsCount: 0,
      itemsCount: 0,
      taskStatusCode: 20000,
    });

    const res = await fetchReviewJob("job_empty", NOW);

    // Terminal + no escalation on an empty page.
    expect(res.outcome).toBe("done");
    expect(res.itemsReturned).toBe(0);
    expect(res.insertedIds).toEqual([]);

    // THE INVARIANT: the freshness cursor was stamped to `now` even with 0
    // reviews, so a retry within the window is priced as fresh/$0.
    const cursorWrite = prismaMock.business.update.mock.calls.find(
      (c) => c[0]?.where?.id === "biz_1" && "reviewsLastDeltaAt" in c[0].data,
    )?.[0];
    expect(cursorWrite).toBeDefined();
    expect(cursorWrite?.data?.reviewsLastDeltaAt).toEqual(NOW);
    // And the in-flight pointer is cleared so the business isn't stuck.
    expect(cursorWrite?.data?.pendingReviewsTaskId).toBeNull();
  });

  test("TRANSIENT FAILURE (task_get throws) does NOT stamp reviewsLastDeltaAt → retry re-charges", async () => {
    prismaMock.reviewJob.findUnique.mockResolvedValue({
      id: "job_transient",
      businessId: "biz_1",
      taskId: "task-transient",
      depth: 200,
      mode: "delta",
      status: "AWAITING_PINGBACK",
      createdAt: NOW,
      updatedAt: NOW,
    });
    // task_get raises a not-ready / upstream error — this is NOT verified-empty.
    dfsMock.reviewsTaskGet.mockRejectedValue(
      new Error("task status_code 40602: Task In Queue"),
    );

    // fetchReviewJob lets the throw propagate (status set to FETCHING first, but
    // the persist/stamp never runs).
    await expect(fetchReviewJob("job_transient", NOW)).rejects.toThrow(/40602/);

    // THE INVARIANT: no cursor stamp on a transient failure — the retry must
    // re-fetch AND re-charge, never be treated as fresh.
    const cursorWrite = prismaMock.business.update.mock.calls.find(
      (c) => c[0]?.data && "reviewsLastDeltaAt" in c[0].data,
    );
    expect(cursorWrite).toBeUndefined();
  });
});

// --- 5. reconcile fails loudly past the ceiling --------------------------

describe("reconcileStuckReviewJobs", () => {
  test("FAILS LOUDLY past the 24h ceiling when still not ready", async () => {
    // Job created 25h ago · stale · task_get still not ready.
    const oldJob = {
      id: "job_stuck",
      businessId: "biz_1",
      taskId: "task-stuck",
      depth: 200,
      mode: "full",
      status: "AWAITING_PINGBACK",
      createdAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000),
      updatedAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000),
    };
    prismaMock.reviewJob.findMany.mockResolvedValue([oldJob]);
    dfsMock.reviewsTaskGet.mockRejectedValue(
      new Error("task status_code 40602: Task In Queue"),
    );

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const summary = await reconcileStuckReviewJobs(120, NOW);
    const loggedReconcileFailure = errSpy.mock.calls.some((c) =>
      String(c[0]).includes("reviews.reconcile.failed"),
    );
    errSpy.mockRestore();

    expect(summary.inspected).toBe(1);
    expect(summary.failedPastCeiling).toBe(1);
    expect(summary.finished).toBe(0);
    // FAILED + RECONCILED note written.
    const updateArg = prismaMock.reviewJob.update.mock.calls.find(
      (c) => c[0]?.where?.id === "job_stuck",
    )?.[0];
    expect(updateArg?.data?.status).toBe("FAILED");
    expect(updateArg?.data?.lastError).toMatch(/^RECONCILED ·/);
    // Loud · console.error fired so the loss is observable.
    expect(loggedReconcileFailure).toBe(true);
    // In-flight cursor cleared so the business isn't stuck forever.
    expect(prismaMock.business.updateMany).toHaveBeenCalledWith({
      where: { id: "biz_1", pendingReviewsTaskId: "task-stuck" },
      data: { pendingReviewsTaskId: null },
    });
  });

  test("under the ceiling + not ready → left pending (no fail)", async () => {
    const recentJob = {
      id: "job_recent",
      businessId: "biz_1",
      taskId: "task-recent",
      depth: 200,
      mode: "full",
      status: "AWAITING_PINGBACK",
      // 3h old · stale enough to inspect, but well under the 24h ceiling.
      createdAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
      updatedAt: new Date(NOW.getTime() - 3 * 60 * 60 * 1000),
    };
    prismaMock.reviewJob.findMany.mockResolvedValue([recentJob]);
    dfsMock.reviewsTaskGet.mockRejectedValue(
      new Error("task status_code 40602: Task In Queue"),
    );

    const summary = await reconcileStuckReviewJobs(120, NOW);

    expect(summary.stillPending).toBe(1);
    expect(summary.failedPastCeiling).toBe(0);
    // Not failed · the job row was NOT marked FAILED.
    const failedUpdate = prismaMock.reviewJob.update.mock.calls.find(
      (c) => c[0]?.data?.status === "FAILED",
    );
    expect(failedUpdate).toBeUndefined();
  });

  test("ready task is finished like a pingback (persist + DONE)", async () => {
    const job = {
      id: "job_ready",
      businessId: "biz_1",
      taskId: "task-ready",
      depth: 200,
      mode: "full",
      status: "AWAITING_PINGBACK",
      createdAt: new Date(NOW.getTime() - 5 * 60 * 60 * 1000),
      updatedAt: new Date(NOW.getTime() - 5 * 60 * 60 * 1000),
    };
    prismaMock.reviewJob.findMany.mockResolvedValue([job]);
    prismaMock.business.findUnique.mockResolvedValue({
      id: "biz_1",
      googleCid: "cid-123",
      country: "US",
      latestReviewExternalId: null,
      reviewsFirstPulledAt: null,
    });
    // Small page · not full · no escalation.
    dfsMock.reviewsTaskGet.mockResolvedValue({
      items: [reviewItem("r1", daysAgo(5)), reviewItem("r2", daysAgo(20))],
      aggregateRating: 4.5,
      totalReviewsCount: 40,
      itemsCount: 2,
      taskStatusCode: 20000,
    });

    const summary = await reconcileStuckReviewJobs(120, NOW);

    expect(summary.finished).toBe(1);
    expect(summary.failedPastCeiling).toBe(0);
    expect(upsertMock.upsertReviewBatch).toHaveBeenCalled();
    expect(upsertMock.recomputeReviewAggregates).toHaveBeenCalled();
  });
});
