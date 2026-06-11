/**
 * runDiscoveryForLocation · multi-page loop invariants.
 *
 * Pins the behavior that lifted the old 200-row truncation:
 *
 *  1. **Pagination** — a limit > 1000 issues multiple mapsSearch calls
 *     with correct (limit, offset) pairs, capped by DfS total_count.
 *  2. **Cost** — DiscoveryRun.costUsd is the SUM of per-page rawCostUsd.
 *  3. **Saturation** — DfS total_count lands on DiscoveryRun.totalAvailable
 *     and TrackedLocation.lastTotalAvailable.
 *  4. **Batch dedup** — known CIDs are counted as duplicates WITHOUT
 *     entering persistBusinessRow's per-row query path.
 *  5. **Short page stops the loop** — a page returning fewer rows than
 *     requested ends pagination even when the limit isn't reached.
 *
 * External boundaries (prisma, dataforseo, cost-counter, next/cache)
 * are mocked — this tests OUR loop, not the vendors.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidateTag: vi.fn(),
}));

const prismaMock = vi.hoisted(() => ({
  trackedLocation: {
    findUnique: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  discoveryRun: {
    create: vi.fn().mockResolvedValue({ id: "run_1", startedAt: new Date(0) }),
    update: vi.fn().mockResolvedValue({}),
  },
  business: {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(null),
    findUnique: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({}),
  },
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as never[])),
}));
vi.mock("@/lib/prisma", () => ({ default: prismaMock, Prisma: {} }));

// withCronRun just runs the fn — cost-counter context is out of scope.
vi.mock("@/lib/cost/cost-counter", () => ({
  withCronRun: vi.fn(async (_job: string, fn: () => Promise<unknown>) => fn()),
}));

const mapsSearchMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/dataforseo", () => ({ mapsSearch: mapsSearchMock }));

import { runDiscoveryForLocation } from "../run";

const CELL = {
  id: "cell_1",
  categoryId: "cat_1",
  lat: 25.774,
  lng: -80.193,
  radiusKm: 10,
  city: "Miami",
  province: "FL",
  country: "US",
  category: { dataforseoId: "medical_spa" },
};

function bizRow(i: number) {
  return { cid: `cid_${i}`, place_id: `pid_${i}`, title: `Spa ${i}` };
}

function page(opts: {
  count: number;
  startAt: number;
  totalCount: number;
  cost: number;
}) {
  return {
    items: Array.from({ length: opts.count }, (_, i) =>
      bizRow(opts.startAt + i),
    ),
    totalCount: opts.totalCount,
    operation: "dataforseo.maps.search",
    rawCostUsd: opts.cost,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.trackedLocation.findUnique.mockResolvedValue(CELL);
  prismaMock.discoveryRun.create.mockResolvedValue({
    id: "run_1",
    startedAt: new Date(0),
  });
  prismaMock.business.findMany.mockResolvedValue([]);
  prismaMock.business.findFirst.mockResolvedValue(null);
  prismaMock.business.findUnique.mockResolvedValue(null);
});

describe("runDiscoveryForLocation · pagination", () => {
  test("limit 2500 vs cell of 1800 → two pages (1000 + 800), summed cost, totalAvailable recorded", async () => {
    mapsSearchMock
      .mockResolvedValueOnce(
        page({ count: 1000, startAt: 0, totalCount: 1800, cost: 0.31 }),
      )
      .mockResolvedValueOnce(
        page({ count: 800, startAt: 1000, totalCount: 1800, cost: 0.25 }),
      );

    const summary = await runDiscoveryForLocation({
      trackedLocationId: "cell_1",
      triggeredByUserId: "admin_1",
      limit: 2500,
    });

    expect(mapsSearchMock).toHaveBeenCalledTimes(2);
    expect(mapsSearchMock.mock.calls[0]![0]).toMatchObject({
      limit: 1000,
      offset: 0,
    });
    // Second page asks for exactly what's left in the cell, from where
    // page one stopped.
    expect(mapsSearchMock.mock.calls[1]![0]).toMatchObject({
      limit: 800,
      offset: 1000,
    });

    expect(summary.status).toBe("OK");
    expect(summary.totalReturned).toBe(1800);
    expect(summary.totalAvailable).toBe(1800);
    expect(summary.newBusinesses).toBe(1800);
    expect(summary.costUsd).toBeCloseTo(0.56, 6);

    // Audit row + cell denormalization carry the saturation numbers.
    expect(prismaMock.discoveryRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          totalReturned: 1800,
          totalAvailable: 1800,
          costUsd: expect.closeTo(0.56, 6),
        }),
      }),
    );
    expect(prismaMock.trackedLocation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastTotalAvailable: 1800 }),
      }),
    );
  });

  test("limit ≤ 1000 stays a single call (no behavior change vs old runner)", async () => {
    mapsSearchMock.mockResolvedValueOnce(
      page({ count: 312, startAt: 0, totalCount: 312, cost: 0.104 }),
    );

    const summary = await runDiscoveryForLocation({
      trackedLocationId: "cell_1",
      triggeredByUserId: "admin_1",
      limit: 1000,
    });

    expect(mapsSearchMock).toHaveBeenCalledTimes(1);
    expect(summary.totalReturned).toBe(312);
    expect(summary.totalAvailable).toBe(312);
  });

  test("short page stops the loop even when totalCount overstates", async () => {
    // DfS claims 3000 but page 2 comes back short — no third call.
    mapsSearchMock
      .mockResolvedValueOnce(
        page({ count: 1000, startAt: 0, totalCount: 3000, cost: 0.31 }),
      )
      .mockResolvedValueOnce(
        page({ count: 400, startAt: 1000, totalCount: 3000, cost: 0.13 }),
      );

    const summary = await runDiscoveryForLocation({
      trackedLocationId: "cell_1",
      triggeredByUserId: "admin_1",
      limit: 5000,
    });

    expect(mapsSearchMock).toHaveBeenCalledTimes(2);
    expect(summary.totalReturned).toBe(1400);
  });

  test("batch dedup counts known CIDs as duplicates without per-row queries", async () => {
    mapsSearchMock.mockResolvedValueOnce(
      page({ count: 10, startAt: 0, totalCount: 10, cost: 0.013 }),
    );
    // 4 of the 10 already indexed.
    prismaMock.business.findMany.mockResolvedValue([
      { googleCid: "cid_0", googlePlaceId: "pid_0" },
      { googleCid: "cid_1", googlePlaceId: "pid_1" },
      { googleCid: "cid_2", googlePlaceId: "pid_2" },
      { googleCid: "cid_3", googlePlaceId: "pid_3" },
    ]);

    const summary = await runDiscoveryForLocation({
      trackedLocationId: "cell_1",
      triggeredByUserId: "admin_1",
      limit: 100,
    });

    expect(summary.duplicates).toBe(4);
    expect(summary.newBusinesses).toBe(6);
    // Dupes never reach persistBusinessRow's per-row dedup query: only
    // the 6 new rows did (findFirst once each).
    expect(prismaMock.business.findFirst).toHaveBeenCalledTimes(6);
  });

  test("checkpoints after every page — counts + cell increments persist before the run closes", async () => {
    mapsSearchMock
      .mockResolvedValueOnce(
        page({ count: 1000, startAt: 0, totalCount: 1800, cost: 0.31 }),
      )
      .mockResolvedValueOnce(
        page({ count: 800, startAt: 1000, totalCount: 1800, cost: 0.25 }),
      );

    await runDiscoveryForLocation({
      trackedLocationId: "cell_1",
      triggeredByUserId: "admin_1",
      limit: 2500,
    });

    // 2 page checkpoints + 1 final close on the run row.
    expect(prismaMock.discoveryRun.update).toHaveBeenCalledTimes(3);
    // Page-1 checkpoint carries page-1 progress (run would survive a
    // timeout right here).
    expect(prismaMock.discoveryRun.update.mock.calls[0]![0]).toMatchObject({
      data: { totalReturned: 1000, newBusinesses: 1000 },
    });
    // Cell aggregates increment per page — and the final close must NOT
    // re-add them (no businessCount in its data).
    expect(prismaMock.trackedLocation.update).toHaveBeenCalledTimes(3);
    expect(prismaMock.trackedLocation.update.mock.calls[0]![0]).toMatchObject({
      data: { businessCount: { increment: 1000 } },
    });
    expect(prismaMock.trackedLocation.update.mock.calls[1]![0]).toMatchObject({
      data: { businessCount: { increment: 800 } },
    });
    const closeData = prismaMock.trackedLocation.update.mock.calls[2]![0].data;
    expect(closeData.businessCount).toBeUndefined();
    expect(closeData.totalRuns).toEqual({ increment: 1 });
  });

  test("DfS failure mid-run → FAILED with pages-so-far cost preserved", async () => {
    mapsSearchMock
      .mockResolvedValueOnce(
        page({ count: 1000, startAt: 0, totalCount: 2000, cost: 0.31 }),
      )
      .mockRejectedValueOnce(new Error("DataForSEO 503"));

    const summary = await runDiscoveryForLocation({
      trackedLocationId: "cell_1",
      triggeredByUserId: "admin_1",
      limit: 2000,
    });

    expect(summary.status).toBe("FAILED");
    expect(summary.errorMessage).toContain("503");
    // Page 1's businesses persisted + its cost retained on the audit row.
    expect(summary.newBusinesses).toBe(1000);
    expect(summary.costUsd).toBeCloseTo(0.31, 6);
  });
});
