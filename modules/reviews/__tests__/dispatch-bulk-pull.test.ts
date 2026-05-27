/**
 * Tests for the bulk-pull dispatcher (Task #81).
 *
 * Two paths to verify:
 *   1. Worker available · BOXLY_WORKER_BASE_URL + AUTH_TOKEN set → enqueue
 *   2. Worker not configured → sequential fallback
 *
 * Plus the auto-fallback when the worker call throws BoxlyWorkerError.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// vi.hoisted lets us define mock vars BEFORE the vi.mock factory runs.
// Without it, factories that reference top-level `const`s crash with
// "Cannot access 'X' before initialization" because vi.mock is hoisted.
const { enqueueMock, triggerMock } = vi.hoisted(() => ({
  enqueueMock: vi.fn(),
  triggerMock: vi.fn(),
}));

vi.mock("@/lib/boxly-worker/client", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/boxly-worker/client")
  >("@/lib/boxly-worker/client");
  return {
    ...actual,
    enqueueCallbackWebhooks: enqueueMock,
  };
});

vi.mock("@/modules/reviews/trigger-pull", () => ({
  triggerReviewPullForBusiness: triggerMock,
}));

import { dispatchBulkReviewPull } from "../dispatch-bulk-pull";
import { BoxlyWorkerError } from "@/lib/boxly-worker/client";

beforeEach(() => {
  enqueueMock.mockReset();
  triggerMock.mockReset();
  process.env.MAPSLY_PUBLIC_URL = "https://www.mapsly.ai";
});

afterEach(() => {
  delete process.env.BOXLY_WORKER_BASE_URL;
  delete process.env.BOXLY_WORKER_AUTH_TOKEN;
  delete process.env.MAPSLY_PUBLIC_URL;
});

describe("dispatchBulkReviewPull", () => {
  test("empty list · returns zeros without calling worker or trigger", async () => {
    process.env.BOXLY_WORKER_BASE_URL = "https://worker.example";
    process.env.BOXLY_WORKER_AUTH_TOKEN = "tok";

    const result = await dispatchBulkReviewPull({
      businessIds: [],
      mode: "manual",
    });

    expect(result).toEqual({
      strategy: "worker-enqueue",
      requested: 0,
      queuedOrTriggered: 0,
      failedOrSkipped: 0,
    });
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(triggerMock).not.toHaveBeenCalled();
  });

  test("worker path · enqueues jobs and returns immediately", async () => {
    process.env.BOXLY_WORKER_BASE_URL = "https://worker.example";
    process.env.BOXLY_WORKER_AUTH_TOKEN = "tok";

    enqueueMock.mockResolvedValueOnce({
      taskIds: ["t-1", "t-2", "t-3"],
      queued: 3,
      failed: 0,
    });

    const result = await dispatchBulkReviewPull({
      businessIds: ["b-1", "b-2", "b-3"],
      mode: "manual",
    });

    expect(result.strategy).toBe("worker-enqueue");
    expect(result.queuedOrTriggered).toBe(3);
    expect(result.failedOrSkipped).toBe(0);
    expect(result.taskIdSample).toEqual(["t-1", "t-2", "t-3"]);

    expect(enqueueMock).toHaveBeenCalledOnce();
    const [jobs] = enqueueMock.mock.calls[0]!;
    expect(jobs).toHaveLength(3);
    expect(jobs[0]).toMatchObject({
      url: "https://www.mapsly.ai/api/internal/trigger-review-pull",
      payload: { businessId: "b-1", mode: "manual" },
      callerLabel: "mapsly:reviews-manual",
    });
    // Trigger should NOT have been called · worker handles it asynchronously.
    expect(triggerMock).not.toHaveBeenCalled();
  });

  test("worker path · forwards optional depth to payload", async () => {
    process.env.BOXLY_WORKER_BASE_URL = "https://worker.example";
    process.env.BOXLY_WORKER_AUTH_TOKEN = "tok";

    enqueueMock.mockResolvedValueOnce({
      taskIds: ["t-1"],
      queued: 1,
      failed: 0,
    });

    await dispatchBulkReviewPull({
      businessIds: ["b-1"],
      mode: "initial",
      depth: 1500,
    });

    const [jobs] = enqueueMock.mock.calls[0]!;
    expect(jobs[0].payload).toEqual({
      businessId: "b-1",
      mode: "initial",
      depth: 1500,
    });
  });

  test("sequential fallback · runs when worker env missing", async () => {
    // No BOXLY_WORKER_BASE_URL → sequential
    triggerMock
      .mockResolvedValueOnce({ triggered: true, taskId: "t-1", mode: "delta" })
      .mockResolvedValueOnce({ triggered: false, reason: "in_flight" })
      .mockResolvedValueOnce({ triggered: false, reason: "no_cid" });

    const result = await dispatchBulkReviewPull({
      businessIds: ["b-1", "b-2", "b-3"],
      mode: "delta",
    });

    expect(result.strategy).toBe("sequential-fallback");
    expect(result.queuedOrTriggered).toBe(1);
    expect(result.failedOrSkipped).toBe(2);
    expect(result.skipReasons).toEqual({ in_flight: 1, no_cid: 1 });
    expect(triggerMock).toHaveBeenCalledTimes(3);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  test("sequential fallback · per-row throw counts as skipped with reason 'threw'", async () => {
    triggerMock
      .mockResolvedValueOnce({ triggered: true, taskId: "t-1", mode: "manual" })
      .mockRejectedValueOnce(new Error("Neon down"))
      .mockResolvedValueOnce({
        triggered: true,
        taskId: "t-3",
        mode: "manual",
      });

    const result = await dispatchBulkReviewPull({
      businessIds: ["b-1", "b-2", "b-3"],
      mode: "manual",
    });

    expect(result.queuedOrTriggered).toBe(2);
    expect(result.failedOrSkipped).toBe(1);
    expect(result.skipReasons).toEqual({ threw: 1 });
  });

  test("worker enqueue throws · auto-falls-back to sequential", async () => {
    process.env.BOXLY_WORKER_BASE_URL = "https://worker.example";
    process.env.BOXLY_WORKER_AUTH_TOKEN = "tok";

    enqueueMock.mockRejectedValueOnce(new BoxlyWorkerError("worker 503"));
    triggerMock
      .mockResolvedValueOnce({ triggered: true, taskId: "t-1", mode: "manual" })
      .mockResolvedValueOnce({
        triggered: true,
        taskId: "t-2",
        mode: "manual",
      });

    const result = await dispatchBulkReviewPull({
      businessIds: ["b-1", "b-2"],
      mode: "manual",
    });

    expect(result.strategy).toBe("sequential-fallback");
    expect(result.queuedOrTriggered).toBe(2);
    expect(result.failedOrSkipped).toBe(0);
  });
});
