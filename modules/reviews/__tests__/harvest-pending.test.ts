/**
 * harvestPendingReviewsForBusiness · invariants.
 *
 * The poll-harvest path fetches a business's in-flight DataForSEO review task
 * DIRECTLY via task_get (no pingback) and writes it. Pinned here:
 *
 *  1. **nothing_pending** — no Business.pendingReviewsTaskId → never calls
 *     task_get, never writes. (Don't bill DfS for a business with no task.)
 *  2. **not_ready leaves the cursor** — a 40602 / "not ready" from task_get
 *     returns reason "not_ready" and MUST NOT clear pendingReviewsTaskId, so a
 *     later harvest (or a late pingback) can still resolve it.
 *  3. **success clears the cursor + writes** — clears pendingReviewsTaskId,
 *     upserts the batch, recomputes aggregates, returns the counts.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));

const prismaMock = vi.hoisted(() => ({
  business: { findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

const dfsMock = vi.hoisted(() => ({ reviewsTaskGet: vi.fn() }));
vi.mock("@/services/dataforseo", () => dfsMock);

const upsertMock = vi.hoisted(() => ({
  upsertReviewBatch: vi.fn(),
  recomputeReviewAggregates: vi.fn(),
}));
vi.mock("@/modules/reviews/upsert", () => upsertMock);

const extractMock = vi.hoisted(() => ({ extractEntitiesForBusiness: vi.fn() }));
vi.mock("@/modules/reviews/extract-entities-for-business", () => extractMock);

import { harvestPendingReviewsForBusiness } from "../harvest-pending";

const BIZ = {
  id: "biz_1",
  slug: "test-spa",
  ownerUserId: null,
  latestReviewExternalId: null,
  reviewsFirstPulledAt: null,
  pendingReviewsTaskId: "task-abc-123",
};

beforeEach(() => {
  vi.clearAllMocks();
});

test("nothing_pending · no task_get, no write", async () => {
  prismaMock.business.findUnique.mockResolvedValue({
    ...BIZ,
    pendingReviewsTaskId: null,
  });

  const res = await harvestPendingReviewsForBusiness("biz_1");

  expect(res).toEqual({ harvested: false, reason: "nothing_pending" });
  expect(dfsMock.reviewsTaskGet).not.toHaveBeenCalled();
  expect(prismaMock.business.update).not.toHaveBeenCalled();
});

test("not_ready · keeps pendingReviewsTaskId (no cursor clear)", async () => {
  prismaMock.business.findUnique.mockResolvedValue({ ...BIZ });
  dfsMock.reviewsTaskGet.mockRejectedValue(
    new Error("task status_code 40602: Task In Queue"),
  );

  const res = await harvestPendingReviewsForBusiness("biz_1");

  expect(res).toEqual({ harvested: false, reason: "not_ready" });
  // The cursor must survive so the task can be harvested later.
  expect(prismaMock.business.update).not.toHaveBeenCalled();
});

test("success · clears cursor, upserts, returns counts", async () => {
  prismaMock.business.findUnique.mockResolvedValue({ ...BIZ });
  dfsMock.reviewsTaskGet.mockResolvedValue({
    items: [{}, {}, {}],
    totalReviewsCount: 120,
    aggregateRating: 4.7,
  });
  upsertMock.upsertReviewBatch.mockResolvedValue({
    insertedIds: ["r1", "r2"],
    topExternalId: "ext-9",
    topPostedAt: new Date("2026-06-01"),
  });

  const res = await harvestPendingReviewsForBusiness("biz_1");

  expect(res).toEqual({
    harvested: true,
    taskId: "task-abc-123",
    items: 3,
    inserted: 2,
  });
  // Cursor cleared so a duplicate pingback becomes a no-op.
  const updateArg = prismaMock.business.update.mock.calls[0]?.[0];
  expect(updateArg.data.pendingReviewsTaskId).toBeNull();
  expect(upsertMock.recomputeReviewAggregates).toHaveBeenCalledWith(
    "biz_1",
    120,
    4.7,
  );
  // Entity extraction fires only because there were inserted ids.
  expect(extractMock.extractEntitiesForBusiness).toHaveBeenCalledWith("biz_1", [
    "r1",
    "r2",
  ]);
});
