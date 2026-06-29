// Unit tests for the enrichment dispatcher (Phase 3 · job rail). We mock
// @/lib/prisma + every worker so the tests assert ROUTING + status transitions,
// not the workers themselves (each has its own suite). Invariants:
//   - fanOutRun runs per-cell families inline + creates per-business EnrichmentJob
//     rows + flips the run RUNNING;
//   - processJob runs the worker (DONE), skips now-fresh units, and retries then
//     fails terminally at MAX_JOB_ATTEMPTS;
//   - closeRunIfDone settles credits + runs the expert layer once jobs are done;
//   - a PENDING Discovery reconstructs cells (resolving categoryId) → runDiscovery
//     → settles the hold.

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    enrichmentRun: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    enrichmentJob: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    discovery: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    businessCategory: { findFirst: vi.fn() },
    business: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock("@/modules/discovery/enrich-fresh-db", () => ({
  loadFreshTimestamps: vi.fn(async () => ({
    perBusiness: new Map(),
    perCell: new Map(),
  })),
}));
vi.mock("@/modules/cost/server", () => ({ reconcileRunCredits: vi.fn() }));
vi.mock("@/modules/discovery/run-discovery", () => ({ runDiscovery: vi.fn() }));
vi.mock("@/modules/contacts/scan", () => ({ scanBusinessContacts: vi.fn() }));
vi.mock("@/modules/reviews/review-job", () => ({ submitReviewJob: vi.fn() }));
vi.mock("@/modules/cell-intel/meta-ads", () => ({
  runMetaAdsForCell: vi.fn(),
}));
vi.mock("@/modules/cell-intel/google-ads", () => ({
  runGoogleAdsForCell: vi.fn(),
}));
vi.mock("@/modules/cell-intel/serp", () => ({ runSerpForCell: vi.fn() }));
vi.mock("@/modules/playbooks/run", () => ({
  runPlaybooksForBusiness: vi.fn(),
}));
vi.mock("@/modules/ai-research/pipeline", () => ({
  runAiResearchForBusiness: vi.fn(),
}));
vi.mock("@/modules/services-general/extract", () => ({
  extractServicesForBusiness: vi.fn(),
  recomputeCellServicePrevalence: vi.fn(),
}));
vi.mock("@/modules/cell-intel/recompute-metrics", () => ({
  recomputeCellMetric: vi.fn(),
}));

import prisma from "@/lib/prisma";
import { reconcileRunCredits } from "@/modules/cost/server";
import { runDiscovery } from "@/modules/discovery/run-discovery";
import { scanBusinessContacts } from "@/modules/contacts/scan";
import { runSerpForCell } from "@/modules/cell-intel/serp";
import { runPlaybooksForBusiness } from "@/modules/playbooks/run";
import {
  fanOutRun,
  processJob,
  closeRunIfDone,
  processDiscovery,
} from "../dispatch";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  p.enrichmentRun.update.mockResolvedValue({});
  p.enrichmentJob.createMany.mockResolvedValue({ count: 0 });
  p.enrichmentJob.update.mockResolvedValue({});
  p.business.findUnique.mockResolvedValue({ contactsExtractedAt: null });
  p.business.findMany.mockResolvedValue([]); // no hidden businesses by default
  p.discovery.update.mockResolvedValue({});
});

describe("fanOutRun", () => {
  test("runs per-cell families inline + creates per-business jobs + flips RUNNING", async () => {
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      status: "PENDING",
      enrichmentsJson: ["contacts", "serp"],
      scopeRefsJson: { businessIds: ["b1", "b2"], cellKeys: ["spa|miami|US"] },
    });

    const out = await fanOutRun("r1", new Date());

    expect(runSerpForCell).toHaveBeenCalledTimes(1); // per-cell, inline
    const rows = p.enrichmentJob.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2); // 2 businesses × 1 per-business family
    expect(
      rows.every(
        (r: { family: string; status: string }) =>
          r.family === "CONTACTS" && r.status === "QUEUED",
      ),
    ).toBe(true);
    expect(p.enrichmentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "RUNNING" }),
      }),
    );
    expect(out.jobsCreated).toBe(2);
  });

  test("skips a run that isn't PENDING", async () => {
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      status: "RUNNING",
      enrichmentsJson: [],
      scopeRefsJson: {},
    });
    const out = await fanOutRun("r1");
    expect(out.jobsCreated).toBe(0);
    expect(p.enrichmentJob.createMany).not.toHaveBeenCalled();
  });

  test("reachability gate: skips hidden businesses + records unitsSkippedHidden", async () => {
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      status: "PENDING",
      enrichmentsJson: ["contacts"],
      scopeRefsJson: { businessIds: ["b1", "b2"], cellKeys: [] },
    });
    p.business.findMany.mockResolvedValue([{ id: "b2" }]); // b2 is hidden

    const out = await fanOutRun("r1", new Date());

    const rows = p.enrichmentJob.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1); // only b1 — b2 gated out
    expect(rows[0].businessId).toBe("b1");
    expect(out.jobsCreated).toBe(1);
    const updates = p.enrichmentRun.update.mock.calls.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => c[0].data,
    );
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updates.some((d: any) => d.unitsSkippedHidden === 1),
    ).toBe(true);
  });
});

describe("processJob", () => {
  test("runs the worker and marks DONE", async () => {
    const out = await processJob(
      {
        id: "j1",
        businessId: "b1",
        family: "CONTACTS",
        attempts: 0,
        costUsd: 0.008,
      },
      new Date(),
    );
    expect(scanBusinessContacts).toHaveBeenCalledWith("b1");
    expect(out).toBe("done");
    expect(p.enrichmentJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DONE" }),
      }),
    );
  });

  test("skips a now-fresh unit (no re-fetch / re-bill)", async () => {
    p.business.findUnique.mockResolvedValue({
      contactsExtractedAt: new Date(),
    });
    const out = await processJob(
      {
        id: "j1",
        businessId: "b1",
        family: "CONTACTS",
        attempts: 0,
        costUsd: 0.008,
      },
      new Date(),
    );
    expect(out).toBe("skipped");
    expect(scanBusinessContacts).not.toHaveBeenCalled();
  });

  test("requeues on failure, then fails terminally at max attempts", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (scanBusinessContacts as any).mockRejectedValue(new Error("boom"));
    const first = await processJob({
      id: "j1",
      businessId: "b1",
      family: "CONTACTS",
      attempts: 0,
      costUsd: 0.008,
    });
    expect(first).toBe("requeued");
    const last = await processJob({
      id: "j1",
      businessId: "b1",
      family: "CONTACTS",
      attempts: 2,
      costUsd: 0.008,
    });
    expect(last).toBe("failed");
  });
});

describe("closeRunIfDone", () => {
  test("settles + closes OK when all jobs are terminal", async () => {
    p.enrichmentJob.count.mockResolvedValue(0);
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      status: "RUNNING",
      actualUsd: 0,
    });
    p.enrichmentJob.findMany.mockResolvedValue([
      { status: "DONE", businessId: "b1", costUsd: 0.008 },
      { status: "DONE", businessId: "b2", costUsd: 0.008 },
    ]);

    const closed = await closeRunIfDone("r1", new Date());

    expect(closed).toBe(true);
    expect(runPlaybooksForBusiness).toHaveBeenCalledTimes(2);
    expect(reconcileRunCredits).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ hadProgress: true }),
    );
    expect(p.enrichmentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "OK", unitsCompleted: 2 }),
      }),
    );
  });

  test("closes PARTIAL when a job failed", async () => {
    p.enrichmentJob.count.mockResolvedValue(0);
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      status: "RUNNING",
      actualUsd: 0,
    });
    p.enrichmentJob.findMany.mockResolvedValue([
      { status: "DONE", businessId: "b1", costUsd: 0.008 },
      { status: "FAILED", businessId: "b2", costUsd: 0 },
    ]);

    await closeRunIfDone("r1", new Date());

    expect(p.enrichmentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PARTIAL" }),
      }),
    );
  });

  test("is a no-op while jobs remain", async () => {
    p.enrichmentJob.count.mockResolvedValue(3);
    expect(await closeRunIfDone("r1")).toBe(false);
  });
});

describe("processDiscovery", () => {
  test("reconstructs cells + calls runDiscovery + settles", async () => {
    p.discovery.findUnique
      .mockResolvedValueOnce({
        id: "d1",
        agencyId: "a1",
        requestedByUserId: "u1",
        cellKeys: ["medical_spa|miami|US"],
      })
      .mockResolvedValueOnce({ totalCostUsd: 0.04 });
    p.businessCategory.findFirst.mockResolvedValue({ id: "cat1" });

    const ok = await processDiscovery("d1");

    expect(ok).toBe(true);
    expect(runDiscovery).toHaveBeenCalledWith(
      expect.objectContaining({
        agencyId: "a1",
        userId: "u1",
        cells: [
          expect.objectContaining({
            categorySlug: "medical_spa",
            categoryId: "cat1",
            metroSlug: "miami",
            country: "US",
          }),
        ],
      }),
    );
    expect(reconcileRunCredits).toHaveBeenCalledWith(
      "d1",
      expect.objectContaining({ hadProgress: true }),
    );
  });

  test("no resolvable cells → FAILED + refund", async () => {
    p.discovery.findUnique.mockResolvedValue({
      id: "d2",
      agencyId: "a1",
      requestedByUserId: "u1",
      cellKeys: ["unknown|miami|US"],
    });
    p.businessCategory.findFirst.mockResolvedValue(null);

    const ok = await processDiscovery("d2");

    expect(ok).toBe(false);
    expect(runDiscovery).not.toHaveBeenCalled();
    expect(p.discovery.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "FAILED" } }),
    );
    expect(reconcileRunCredits).toHaveBeenCalledWith(
      "d2",
      expect.objectContaining({ hadProgress: false }),
    );
  });
});
