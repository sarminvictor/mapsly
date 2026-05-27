/**
 * Tests for the search-visibility bulk-scan dispatcher (S.1).
 *
 * Critical invariant Viktor asked for · bulk on N businesses spread
 * across M unique cells emits N + M jobs, NOT N + (N×M). The cell
 * aggregate fires ONCE per unique cell.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { enqueueMock, filterMock } = vi.hoisted(() => ({
  enqueueMock: vi.fn(),
  filterMock: vi.fn(),
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

vi.mock("@/lib/reviews/should-collect", () => ({
  filterEligibleBusinesses: filterMock,
}));

const { findManyMock } = vi.hoisted(() => ({ findManyMock: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  default: { business: { findMany: findManyMock } },
}));

import { dispatchSearchScan } from "../dispatch-bulk-scan";

beforeEach(() => {
  enqueueMock.mockReset();
  filterMock.mockReset();
  findManyMock.mockReset();
  process.env.BOXLY_WORKER_BASE_URL = "https://worker.example";
  process.env.BOXLY_WORKER_AUTH_TOKEN = "tok";
  process.env.MAPSLY_PUBLIC_URL = "https://www.mapsly.ai";
});

afterEach(() => {
  delete process.env.BOXLY_WORKER_BASE_URL;
  delete process.env.BOXLY_WORKER_AUTH_TOKEN;
  delete process.env.MAPSLY_PUBLIC_URL;
});

describe("dispatchSearchScan · cell-deduplication invariant", () => {
  test("empty input · zero work", async () => {
    const r = await dispatchSearchScan({ businessIds: [], mode: "manual" });
    expect(r.requested).toBe(0);
    expect(r.eligibleBusinesses).toBe(0);
    expect(r.cellsAggregated).toBe(0);
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(filterMock).not.toHaveBeenCalled();
  });

  test("all businesses filtered out by paid-cell gate · no jobs enqueued", async () => {
    filterMock.mockResolvedValueOnce([]);
    const r = await dispatchSearchScan({
      businessIds: ["b-1", "b-2", "b-3"],
      mode: "bulk",
    });
    expect(r.requested).toBe(3);
    expect(r.eligibleBusinesses).toBe(0);
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  test("3 businesses · all in SAME cell · enqueues 3 biz + 1 cell job", async () => {
    filterMock.mockResolvedValueOnce(["b-1", "b-2", "b-3"]);
    findManyMock.mockResolvedValueOnce([
      { id: "b-1", city: "Calgary", country: "CA", lat: 51.04, lng: -114.07 },
      { id: "b-2", city: "Calgary", country: "CA", lat: 51.05, lng: -114.06 },
      { id: "b-3", city: "Calgary", country: "CA", lat: 51.03, lng: -114.08 },
    ]);
    enqueueMock.mockResolvedValueOnce({
      taskIds: ["t-1", "t-2", "t-3", "t-cell"],
      queued: 4,
      failed: 0,
    });

    const r = await dispatchSearchScan({
      businessIds: ["b-1", "b-2", "b-3"],
      mode: "bulk",
    });

    expect(r.eligibleBusinesses).toBe(3);
    expect(r.cellsAggregated).toBe(1); // ← KEY · one cell job, not three
    expect(r.queuedOrTriggered).toBe(4);

    expect(enqueueMock).toHaveBeenCalledOnce();
    const [jobs] = enqueueMock.mock.calls[0]!;
    // 3 biz + 1 cell = 4 jobs total
    expect(jobs).toHaveLength(4);

    const bizJobs = jobs.filter(
      (j: { payload: { mode: string } }) => j.payload.mode === "biz",
    );
    const cellJobs = jobs.filter(
      (j: { payload: { mode: string } }) => j.payload.mode === "cell",
    );
    expect(bizJobs).toHaveLength(3);
    expect(cellJobs).toHaveLength(1); // ← ONE cell aggregate for Calgary

    // Cell centroid should be the mean of the 3 input GPS points.
    expect(cellJobs[0].payload.city).toBe("Calgary");
    expect(cellJobs[0].payload.country).toBe("CA");
    expect(cellJobs[0].payload.centroidLat).toBeCloseTo(51.04, 2);
    expect(cellJobs[0].payload.centroidLng).toBeCloseTo(-114.07, 2);
  });

  test("4 businesses · 2 cells · enqueues 4 biz + 2 cell jobs", async () => {
    filterMock.mockResolvedValueOnce(["b-1", "b-2", "b-3", "b-4"]);
    findManyMock.mockResolvedValueOnce([
      { id: "b-1", city: "Calgary", country: "CA", lat: 51.04, lng: -114.07 },
      { id: "b-2", city: "Calgary", country: "CA", lat: 51.05, lng: -114.06 },
      { id: "b-3", city: "Edmonton", country: "CA", lat: 53.55, lng: -113.5 },
      { id: "b-4", city: "Edmonton", country: "CA", lat: 53.56, lng: -113.51 },
    ]);
    enqueueMock.mockResolvedValueOnce({
      taskIds: ["t-1", "t-2", "t-3", "t-4", "t-c1", "t-c2"],
      queued: 6,
      failed: 0,
    });

    const r = await dispatchSearchScan({
      businessIds: ["b-1", "b-2", "b-3", "b-4"],
      mode: "bulk",
    });

    expect(r.cellsAggregated).toBe(2);
    const [jobs] = enqueueMock.mock.calls[0]!;
    const cellJobs = jobs.filter(
      (j: { payload: { mode: string } }) => j.payload.mode === "cell",
    );
    expect(cellJobs).toHaveLength(2);
    const cities = cellJobs.map(
      (j: { payload: { city: string } }) => j.payload.city,
    );
    expect(cities).toContain("Calgary");
    expect(cities).toContain("Edmonton");
  });

  test("cell with NO businesses having lat/lng · skips cell aggregate", async () => {
    filterMock.mockResolvedValueOnce(["b-1"]);
    findManyMock.mockResolvedValueOnce([
      { id: "b-1", city: "Calgary", country: "CA", lat: null, lng: null },
    ]);
    enqueueMock.mockResolvedValueOnce({
      taskIds: ["t-1"],
      queued: 1,
      failed: 0,
    });

    const r = await dispatchSearchScan({
      businessIds: ["b-1"],
      mode: "manual",
    });

    expect(r.cellsAggregated).toBe(0); // no centroid → no Maps query possible
    const [jobs] = enqueueMock.mock.calls[0]!;
    expect(jobs).toHaveLength(1); // only the biz job
    expect(jobs[0].payload.mode).toBe("biz");
  });

  test("forwards mode to callerLabel for log correlation", async () => {
    filterMock.mockResolvedValueOnce(["b-1"]);
    findManyMock.mockResolvedValueOnce([
      { id: "b-1", city: "Calgary", country: "CA", lat: 51.04, lng: -114.07 },
    ]);
    enqueueMock.mockResolvedValueOnce({
      taskIds: ["t-1", "t-c1"],
      queued: 2,
      failed: 0,
    });

    await dispatchSearchScan({ businessIds: ["b-1"], mode: "cron" });

    const [jobs] = enqueueMock.mock.calls[0]!;
    expect(jobs[0].callerLabel).toContain("cron");
  });
});
