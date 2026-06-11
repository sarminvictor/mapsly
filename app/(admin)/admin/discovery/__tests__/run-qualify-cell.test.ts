/**
 * runQualifyCell · the enqueue contract, pinned after the
 * "Qualify (4) sent 380+ jobs" incident (2026-06-11):
 *
 *  1. **Pending only** — the Business query filters to
 *     NOT_QUALIFIED + FAILED, so the enqueue matches the button label
 *     (which shows businessCount − settled). Settled rows must never
 *     be re-enqueued by the bulk path.
 *  2. **Chunked enqueue** — the worker hard-rejects batches > 500
 *     ("Batch too large", zero jobs queued). Cells past 500 pending
 *     must split and accumulate tallies.
 */

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "admin_1", role: "ADMIN" } }),
}));

const prismaMock = vi.hoisted(() => ({
  trackedLocation: { findUnique: vi.fn() },
  business: { findMany: vi.fn() },
  user: { findUnique: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ default: prismaMock, Prisma: {} }));

const enqueueMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/boxly-worker/client", () => ({
  enqueueCallbackWebhooks: enqueueMock,
  BoxlyWorkerError: class BoxlyWorkerError extends Error {
    httpStatus?: number;
  },
}));

vi.mock("@/lib/url/mapsly-public-url", () => ({
  getMapslyPublicUrl: () => "https://www.mapsly.ai",
}));

// The discovery module's heavy members (DfS adapters) are irrelevant
// here — only the pure membership helper is needed, re-exported real.
vi.mock("@/modules/business-discovery", async () => {
  const membership = await vi.importActual<
    typeof import("@/modules/business-discovery/cell-membership")
  >("@/modules/business-discovery/cell-membership");
  return {
    cellMembershipWhere: membership.cellMembershipWhere,
    geocodeLocation: vi.fn(),
    getKnownCategory: vi.fn(),
    pingValidateLocation: vi.fn(),
    runDiscoveryForLocation: vi.fn(),
  };
});

import { runQualifyCell } from "../actions";

const CELL = {
  id: "cell_1",
  city: "Miami",
  country: "US",
  lat: 25.7617,
  lng: -80.1918,
  radiusKm: 10,
  category: { dataforseoId: "medical_spa" },
};

function form(): FormData {
  const f = new FormData();
  f.set("trackedLocationId", "cell_1");
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.trackedLocation.findUnique.mockResolvedValue(CELL);
  enqueueMock.mockImplementation(async (jobs: unknown[]) => ({
    taskIds: [],
    queued: jobs.length,
    failed: 0,
  }));
});

describe("runQualifyCell", () => {
  test("queries ONLY pending rows (NOT_QUALIFIED + FAILED)", async () => {
    prismaMock.business.findMany.mockResolvedValue([{ id: "b1" }]);

    await runQualifyCell(null, form());

    const where = prismaMock.business.findMany.mock.calls[0]![0].where;
    expect(where.qualificationStatus).toEqual({
      in: ["NOT_QUALIFIED", "FAILED"],
    });
    // Geo membership still applied alongside the status filter.
    expect(where.categoryIds).toEqual({ has: "medical_spa" });
    expect(where.OR).toHaveLength(2);
  });

  test("1200 pending rows → three enqueue chunks (500/500/200), tallies summed", async () => {
    prismaMock.business.findMany.mockResolvedValue(
      Array.from({ length: 1200 }, (_, i) => ({ id: `b${i}` })),
    );

    const result = await runQualifyCell(null, form());

    expect(enqueueMock).toHaveBeenCalledTimes(3);
    expect(
      enqueueMock.mock.calls.map((c) => (c[0] as unknown[]).length),
    ).toEqual([500, 500, 200]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.queued).toBe(1200);
      expect(result.data.failed).toBe(0);
    }
  });

  test("zero pending → friendly no-op, no enqueue", async () => {
    prismaMock.business.findMany.mockResolvedValue([]);

    const result = await runQualifyCell(null, form());

    expect(enqueueMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.queued).toBe(0);
  });
});
