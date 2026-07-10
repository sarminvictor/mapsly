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
    enrichmentRun: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
    enrichmentJob: {
      createMany: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      groupBy: vi.fn(),
    },
    reviewJob: { findFirst: vi.fn() },
    discovery: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    businessCategory: { findFirst: vi.fn() },
    business: { findUnique: vi.fn(), findMany: vi.fn() },
    lighthouseAudit: { findFirst: vi.fn() },
    agency: { findMany: vi.fn() },
    // BUG1 · per-cell billing reads collected cells from AdMarketRun at close.
    adMarketRun: { findMany: vi.fn() },
  },
}));
// WP3-3 · run-progress counters degrade open (no Redis in tests) — mock to no-ops
// so they never touch a real KV client.
vi.mock("@/modules/enrichment/run-progress-counter", () => ({
  incrRunProgress: vi.fn(async () => undefined),
  seedRunProgress: vi.fn(async () => undefined),
  readRunProgress: vi.fn(async () => null),
}));
// WP3-2 · worker dispatch is unavailable in tests (no BOXLY env) — mock so
// fanOutRun/closeRunIfDone take the inline/tick-drain fallback paths.
vi.mock("@/modules/enrichment/enrich-worker-dispatch", () => ({
  enrichWorkerAvailable: vi.fn(() => false),
  enqueueRootJobs: vi.fn(async () => ({
    enqueued: false,
    queued: 0,
    failed: 0,
  })),
  enqueueCellJobs: vi.fn(async () => ({
    enqueued: false,
    queued: 0,
    failed: 0,
  })),
}));
// WP3-12 · close-playbooks dispatcher — mock so closeRunIfDone can assert the
// call without running the real (worker/inline) implementation.
vi.mock("@/modules/enrichment/close-playbooks-dispatch", () => ({
  enqueueClosePlaybooks: vi.fn(async () => "inline"),
}));
vi.mock("@/modules/discovery/enrich-fresh-db", () => ({
  loadFreshTimestamps: vi.fn(async () => ({
    perBusiness: new Map(),
    perCell: new Map(),
  })),
}));
// WP4-6 · reconcileRunCredits now returns the settle result (charged/refunded)
// so closeRunIfDone can persist the run's close receipt. Default to a benign
// zero-charge result; per-test overrides assert the receipt write.
vi.mock("@/modules/cost/server", () => ({
  reconcileRunCredits: vi.fn(async () => ({ charged: 0, refunded: 0 })),
}));
vi.mock("@/modules/discovery/run-discovery", () => ({ runDiscovery: vi.fn() }));
vi.mock("@/modules/discovery/enrich-lighthouse", () => ({
  enrichLighthouseForBusinesses: vi.fn(),
}));
vi.mock("@/modules/contacts/scan", () => ({ scanBusinessContacts: vi.fn() }));
vi.mock("@/modules/reviews/review-job", () => ({ submitReviewJob: vi.fn() }));
vi.mock("@/modules/cell-intel/meta-ads", () => ({
  runMetaAdsForCell: vi.fn(),
}));
vi.mock("@/modules/cell-intel/google-ads", () => ({
  // B1 · dispatch now imports the per-business collector (google_ads is a
  // per-business GOOGLE_ADS job, not a cell family).
  runGoogleAdsForBusiness: vi.fn(),
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
import { enrichLighthouseForBusinesses } from "@/modules/discovery/enrich-lighthouse";
import { scanBusinessContacts } from "@/modules/contacts/scan";
import { submitReviewJob } from "@/modules/reviews/review-job";
import { runSerpForCell } from "@/modules/cell-intel/serp";
import { enqueueClosePlaybooks } from "@/modules/enrichment/close-playbooks-dispatch";
import { incrRunProgress } from "@/modules/enrichment/run-progress-counter";
import {
  fanOutRun,
  processJob,
  closeRunIfDone,
  processDiscovery,
  dispatchPending,
  reconcileStuck,
  updateRunProgress,
  claimAndProcessJob,
  isNonRetryableFailure,
  permanentlyUnavailablePairs,
} from "../dispatch";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const anyMock = (fn: unknown) => fn as any;

beforeEach(() => {
  vi.clearAllMocks();
  p.enrichmentRun.update.mockResolvedValue({});
  // WP1-3 · closeRunIfDone claims the run via a conditional updateMany (finishedAt
  // CAS) before settling — default to a winning claim (count 1).
  p.enrichmentRun.updateMany.mockResolvedValue({ count: 1 });
  // BUG1 · default no collected cells so cell-less closes never hit an unmocked fn.
  p.adMarketRun.findMany.mockResolvedValue([]);
  p.enrichmentJob.createMany.mockResolvedValue({ count: 0 });
  p.enrichmentJob.update.mockResolvedValue({});
  // WP1-1 · dispatchPending claims each QUEUED job via updateMany; WP1-9 ·
  // reconcileReviewJobs runs no-op when no parked REVIEWS jobs exist.
  p.enrichmentJob.updateMany.mockResolvedValue({ count: 1 });
  p.enrichmentJob.findMany.mockResolvedValue([]);
  p.enrichmentJob.findUnique.mockResolvedValue(null);
  p.enrichmentJob.groupBy.mockResolvedValue([]); // WP3-3 · progress seed
  p.reviewJob.findFirst.mockResolvedValue(null);
  p.business.findUnique.mockResolvedValue({ contactsExtractedAt: null });
  // WP9-5 · fanOutRun's scope gate now fetches { id, isHidden } for the scoped
  // ids to BOTH validate existence (drop stale/deleted ids) and gate hidden
  // ones. Default: echo back every requested id as existing + visible, so the
  // existence filter passes for any scoped id (matching the pre-WP9-5 default of
  // "no hidden businesses"). Tests that exercise the hidden gate or a
  // stale/missing id override this per-case. Non-scope findMany callers
  // (reviewCount ordering, cell resolution) also hit this — they select `id`
  // (and reviewCount), which the echoed rows satisfy.
  // WP7-2 · fanOutRun's scope gate now also selects `suppressedAt` and drops
  // suppressed (do-not-sell) businesses (b.suppressedAt === null). The default
  // echo returns suppressedAt:null so a scoped id passes both gates; per-case
  // overrides set it when exercising suppression.
  p.business.findMany.mockImplementation(
    async (args: {
      where?: { id?: { in?: string[] } };
    }): Promise<
      Array<{ id: string; isHidden: boolean; suppressedAt: Date | null }>
    > => {
      const ids = args?.where?.id?.in ?? [];
      return ids.map((id) => ({ id, isHidden: false, suppressedAt: null }));
    },
  );
  p.lighthouseAudit.findFirst.mockResolvedValue(null); // never audited by default
  p.discovery.update.mockResolvedValue({});
  // WP3-5 · processDiscovery claims the PENDING row via updateMany — default to
  // a winning claim (count 1); tests that assert "not claimable" override it.
  p.discovery.updateMany.mockResolvedValue({ count: 1 });
  // WP3-10 · fairness helpers — default to no running runs + default caps.
  p.enrichmentRun.groupBy.mockResolvedValue([]);
  p.enrichmentRun.findFirst.mockResolvedValue(null);
  p.agency.findMany.mockResolvedValue([]);

  // WP1-2 · workers return a WorkerResult now (not raw values). Give the common
  // workers billable-success defaults; individual tests override per-outcome.
  anyMock(scanBusinessContacts).mockResolvedValue({
    businessId: "b1",
    status: "OK",
    contactsUpserted: 1,
    techUpserted: 0,
    reachability: "PHONE_ONLY",
    reachableChannelCount: 1,
    isHidden: false,
  });
  anyMock(enrichLighthouseForBusinesses).mockResolvedValue({
    processed: 1,
    openAudited: 1,
    walledAudited: 0,
    skippedFresh: 0,
    skippedNoWebsite: 0,
    skippedWalledOverCap: 0,
    skippedOverBudget: 0,
    failed: 0,
    usageTotalUsd: 0.00425,
  });
  anyMock(submitReviewJob).mockResolvedValue({
    id: "rj1",
    status: "AWAITING_PINGBACK",
  });
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

  // WP1-6 · the cell cost is accrued OUTCOME-based. A collector that DIDN'T
  // collect (served-from-db / failed → non-"collected" outcome) bills nothing.
  test("cell cost bills only when the collector actually collected (WP1-6)", async () => {
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      status: "PENDING",
      enrichmentsJson: ["serp"],
      scopeRefsJson: { businessIds: [], cellKeys: ["spa|miami|US"] },
    });
    // Collector returns but did NOT collect (e.g. wrote a FAILED AdMarketRun).
    anyMock(runSerpForCell).mockResolvedValue({ outcome: "skipped" });

    const out = await fanOutRun("r1", new Date());

    expect(out.cellCostUsd).toBe(0); // not billed on a non-collection
  });

  test("cell cost bills when the collector collected (WP1-6)", async () => {
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      status: "PENDING",
      enrichmentsJson: ["serp"],
      scopeRefsJson: { businessIds: [], cellKeys: ["spa|miami|US"] },
    });
    anyMock(runSerpForCell).mockResolvedValue({ outcome: "collected" });

    const out = await fanOutRun("r1", new Date());

    expect(out.cellCostUsd).toBeGreaterThan(0); // serp unit price accrued
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
    // WP9-5 · the gate query now returns { id, isHidden } for BOTH scoped ids
    // (existence + hidden in one findMany): b1 exists+visible, b2 exists+hidden.
    p.business.findMany.mockResolvedValue([
      {
        id: "b1",
        isHidden: false,
        suppressedAt: null,
        website: "https://b1.example.com",
      },
      {
        id: "b2",
        isHidden: true,
        suppressedAt: null,
        website: "https://b2.example.com",
      },
    ]);

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

  // WP9-5 · a scoped id that no longer resolves to a Business (stale quote /
  // deleted between preflight and fan-out) is dropped by the existence
  // validation — it never mints an orphan job that would fail at worker time.
  test("scope validation: a stale/deleted business id is dropped, not queued (WP9-5)", async () => {
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      status: "PENDING",
      enrichmentsJson: ["contacts"],
      scopeRefsJson: { businessIds: ["b1", "ghost"], cellKeys: [] },
    });
    // Only b1 still exists; "ghost" was deleted → absent from the gate query.
    p.business.findMany.mockResolvedValue([
      {
        id: "b1",
        isHidden: false,
        suppressedAt: null,
        website: "https://b1.example.com",
      },
    ]);

    const out = await fanOutRun("r1", new Date());

    const rows = p.enrichmentJob.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1); // only b1 — the stale "ghost" id produced no job
    expect(rows[0].businessId).toBe("b1");
    expect(out.jobsCreated).toBe(1);
    // Existence-drop is NOT counted as a hidden skip.
    const updates = p.enrichmentRun.update.mock.calls.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => c[0].data,
    );
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updates.some((d: any) => d.unitsSkippedHidden === 0),
    ).toBe(true);
  });

  test("lighthouse selection creates a LIGHTHOUSE job priced per unit", async () => {
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      status: "PENDING",
      enrichmentsJson: ["lighthouse"],
      scopeRefsJson: { businessIds: ["b1"], cellKeys: [] },
    });

    const out = await fanOutRun("r1", new Date());

    const rows = p.enrichmentJob.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        businessId: "b1",
        family: "LIGHTHOUSE",
        status: "QUEUED",
        // $0.00425 = ENRICHMENT_PRICES.lighthouse.usdPerUnit (DfS lighthouse).
        costUsd: 0.00425,
      }),
    );
    expect(out.jobsCreated).toBe(1);
  });

  test("a fresh lighthouse unit is SKIPPED_FRESH at $0 (no re-audit, no charge)", async () => {
    const { loadFreshTimestamps } =
      await import("@/modules/discovery/enrich-fresh-db");
    // Business b1 was audited just now → within the 30-day window.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (loadFreshTimestamps as any).mockResolvedValueOnce({
      perBusiness: new Map([["b1", { lighthouse: new Date() }]]),
      perCell: new Map(),
    });
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      status: "PENDING",
      enrichmentsJson: ["lighthouse"],
      scopeRefsJson: { businessIds: ["b1"], cellKeys: [] },
    });

    await fanOutRun("r1", new Date());

    const rows = p.enrichmentJob.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        businessId: "b1",
        family: "LIGHTHOUSE",
        status: "SKIPPED_FRESH",
        costUsd: 0,
      }),
    );
  });

  // A4 · services + ai_research now carry a 90-day per-business freshness cursor
  // (Business.servicesLastAt / aiResearchLastAt). A repeat run within that window
  // is SKIPPED_FRESH at $0 — no re-billing the model over the same website text.
  test("a fresh services / ai_research unit is SKIPPED_FRESH at $0 (A4 · 90-day)", async () => {
    const { loadFreshTimestamps } =
      await import("@/modules/discovery/enrich-fresh-db");
    // b1 was enriched for both families ~1 day ago → inside the 90-day window.
    const recent = new Date(Date.now() - 24 * 60 * 60 * 1000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (loadFreshTimestamps as any).mockResolvedValueOnce({
      perBusiness: new Map([["b1", { services: recent, ai_research: recent }]]),
      perCell: new Map(),
    });
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      status: "PENDING",
      enrichmentsJson: ["services", "ai_research"],
      scopeRefsJson: { businessIds: ["b1"], cellKeys: [] },
    });

    await fanOutRun("r1", new Date());

    const rows = p.enrichmentJob.createMany.mock.calls[0][0].data;
    const byFamily = new Map<string, { status: string; costUsd: number }>(
      rows.map((r: { family: string; status: string; costUsd: number }) => [
        r.family,
        { status: r.status, costUsd: r.costUsd },
      ]),
    );
    expect(byFamily.get("SERVICES")).toEqual({
      status: "SKIPPED_FRESH",
      costUsd: 0,
    });
    expect(byFamily.get("AI_RESEARCH")).toEqual({
      status: "SKIPPED_FRESH",
      costUsd: 0,
    });
  });

  // A4 · a never-enriched (or stale) unit is still QUEUED + billed — the fresh
  // gate only frees a unit inside the 90-day window.
  test("a stale/never-enriched services unit is QUEUED + billed (A4)", async () => {
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      status: "PENDING",
      enrichmentsJson: ["services"],
      scopeRefsJson: { businessIds: ["b1"], cellKeys: [] },
    });

    await fanOutRun("r1", new Date());

    const rows = p.enrichmentJob.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        businessId: "b1",
        family: "SERVICES",
        status: "QUEUED",
        // $0.002 = ENRICHMENT_PRICES.services.usdPerUnit.
        costUsd: 0.002,
      }),
    );
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

  test("routes a LIGHTHOUSE job to enrichLighthouseForBusinesses and marks DONE", async () => {
    const out = await processJob(
      {
        id: "j1",
        businessId: "b1",
        family: "LIGHTHOUSE",
        attempts: 0,
        costUsd: 0.00425,
      },
      new Date(),
    );
    expect(enrichLighthouseForBusinesses).toHaveBeenCalledWith(
      ["b1"],
      expect.objectContaining({ walledLimit: 1, maxUsageUsd: 0.1 }),
    );
    expect(out).toBe("done");
    expect(p.enrichmentJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DONE" }),
      }),
    );
  });

  test("skips a now-fresh LIGHTHOUSE unit (no re-audit / re-bill)", async () => {
    p.lighthouseAudit.findFirst.mockResolvedValue({ auditedAt: new Date() });
    const out = await processJob(
      {
        id: "j1",
        businessId: "b1",
        family: "LIGHTHOUSE",
        attempts: 0,
        costUsd: 0.00425,
      },
      new Date(),
    );
    expect(out).toBe("skipped");
    expect(enrichLighthouseForBusinesses).not.toHaveBeenCalled();
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

  // WP1-2 + 2026-07-10 · a CONTACTS worker that returns status FAILED (transient
  // site-down, no throw · reason contacts_fetch_failed) is NOT billed, and now
  // takes the SAME bounded backoff ladder as a throw: it REQUEUES on an early
  // attempt (was one-shot terminal FAILED before) and only goes terminal FAILED
  // once the attempt budget is exhausted. Neither path bills.
  test("REQUEUES a transient CONTACTS FAILED on an early attempt (never billed)", async () => {
    anyMock(scanBusinessContacts).mockResolvedValue({
      businessId: "b1",
      status: "FAILED",
      contactsUpserted: 0,
      techUpserted: 0,
      reachability: null,
      reachableChannelCount: 0,
      isHidden: false,
    });
    const out = await processJob({
      id: "j1",
      businessId: "b1",
      family: "CONTACTS",
      attempts: 0,
      costUsd: 0.008,
    });
    expect(out).toBe("requeued");
    expect(p.enrichmentJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "QUEUED", attempts: 1 }),
      }),
    );
  });

  test("terminal-FAILS a transient CONTACTS FAILED once attempts are exhausted", async () => {
    anyMock(scanBusinessContacts).mockResolvedValue({
      businessId: "b1",
      status: "FAILED",
      contactsUpserted: 0,
      techUpserted: 0,
      reachability: null,
      reachableChannelCount: 0,
      isHidden: false,
    });
    const out = await processJob({
      id: "j1",
      businessId: "b1",
      family: "CONTACTS",
      attempts: 2, // nextAttempts = 3 = MAX_JOB_ATTEMPTS → terminal
      costUsd: 0.008,
    });
    expect(out).toBe("failed");
    expect(p.enrichmentJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED", costUsd: 0 }),
      }),
    );
  });

  // A NON-RETRYABLE soft failure (no source to scan) goes terminal FAILED on the
  // FIRST attempt — retrying can't help, so it must not burn the ladder.
  test("terminal-FAILS a non-retryable CONTACTS skip immediately (no requeue)", async () => {
    anyMock(scanBusinessContacts).mockResolvedValue({
      businessId: "b1",
      status: "SKIPPED",
      contactsUpserted: 0,
      techUpserted: 0,
      reachability: null,
      reachableChannelCount: 0,
      isHidden: false,
    });
    const out = await processJob({
      id: "j1",
      businessId: "b1",
      family: "CONTACTS",
      attempts: 0,
      costUsd: 0.008,
    });
    expect(out).toBe("failed");
    expect(p.enrichmentJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED", costUsd: 0 }),
      }),
    );
  });

  // WP1-2 · a LIGHTHOUSE worker that produced 0 audits is NOT billed.
  test("does NOT bill a LIGHTHOUSE unit that produced 0 audits", async () => {
    anyMock(enrichLighthouseForBusinesses).mockResolvedValue({
      processed: 1,
      openAudited: 0,
      walledAudited: 0,
      skippedFresh: 0,
      skippedNoWebsite: 0,
      skippedWalledOverCap: 0,
      skippedOverBudget: 0,
      failed: 1,
      usageTotalUsd: 0,
    });
    const out = await processJob({
      id: "j1",
      businessId: "b1",
      family: "LIGHTHOUSE",
      attempts: 0,
      costUsd: 0.00425,
    });
    expect(out).toBe("failed");
    expect(p.enrichmentJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED", costUsd: 0 }),
      }),
    );
  });

  // WP1-9 · REVIEWS submit does NOT mark the job DONE — it parks it non-terminal
  // (RUNNING, cost 0) until the ReviewJob lands via the pingback.
  test("parks a REVIEWS job non-terminal on submit (billed only on landing)", async () => {
    const out = await processJob({
      id: "j1",
      businessId: "b1",
      family: "REVIEWS",
      attempts: 0,
      costUsd: 0.015,
    });
    expect(submitReviewJob).toHaveBeenCalledWith("b1", "manual");
    expect(out).toBe("awaiting");
    expect(p.enrichmentJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "RUNNING", costUsd: 0 }),
      }),
    );
    // Never marked DONE at submit time.
    expect(p.enrichmentJob.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DONE" }),
      }),
    );
  });

  // WP1-9 · a REVIEWS submit that itself FAILED (no CID / task_post exhausted) is
  // terminal-non-billable (no async landing will ever come).
  test("marks a REVIEWS job FAILED (unbilled) when submit failed", async () => {
    anyMock(submitReviewJob).mockResolvedValue({ id: "rj1", status: "FAILED" });
    const out = await processJob({
      id: "j1",
      businessId: "b1",
      family: "REVIEWS",
      attempts: 0,
      costUsd: 0.015,
    });
    expect(out).toBe("failed");
    expect(p.enrichmentJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED", costUsd: 0 }),
      }),
    );
  });
});

describe("closeRunIfDone", () => {
  // enrichmentJob.findMany is called twice per close: once by reconcileReviewJobs
  // (where.family==='REVIEWS' & status==='RUNNING' → no parked jobs here) and
  // once for the main jobs list. Route by `where` so the review-reconcile query
  // returns [] while the main query returns the run's jobs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function routeJobFindMany(jobs: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.enrichmentJob.findMany.mockImplementation(async (args: any) => {
      if (args?.where?.family === "REVIEWS") return []; // no parked reviews
      return jobs;
    });
  }

  // AdMarketRun.findMany is now read by TWO closers: pendingCellCount (all
  // statuses, ranAt≥now−freshness) and cellCreditsForRun (status∈OK/PARTIAL,
  // ranAt≥startedAt). A faithful mock honours the WHERE so one row set feeds both
  // — e.g. a FAILED cell is "attempted this run" (not pending) yet bills 0.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function mockAdMarketRuns(rows: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.adMarketRun.findMany.mockImplementation(async (args: any) => {
      const w = args?.where ?? {};
      return rows.filter((r) => {
        if (w.status?.in && !w.status.in.includes(r.status)) return false;
        if (w.ranAt?.gte && !(new Date(r.ranAt) >= new Date(w.ranAt.gte)))
          return false;
        if (w.cellKey?.in && !w.cellKey.in.includes(r.cellKey)) return false;
        if (w.platform?.in && !w.platform.in.includes(r.platform)) return false;
        return true;
      });
    });
  }

  test("settles + closes OK when all jobs are terminal", async () => {
    p.enrichmentJob.count.mockResolvedValue(0);
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      status: "RUNNING",
      actualUsd: 0,
      enrichmentsJson: ["contacts"],
    });
    routeJobFindMany([
      { status: "DONE", businessId: "b1", costUsd: 0.008 },
      { status: "DONE", businessId: "b2", costUsd: 0.008 },
    ]);

    const closed = await closeRunIfDone("r1", new Date());

    expect(closed).toBe(true);
    // WP1-3 · the close claim (finishedAt CAS) fired and won.
    expect(p.enrichmentRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "RUNNING", finishedAt: null }),
      }),
    );
    // WP3-12 · playbooks are enqueued off the critical tick (settle-first), not
    // run inline in closeRunIfDone. Assert the enqueue with the touched set.
    expect(enqueueClosePlaybooks).toHaveBeenCalledWith(
      "r1",
      expect.arrayContaining(["b1", "b2"]),
    );
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

  // BUG1 · per-cell billing is OUTCOME-GATED: a cell family bills only for cells
  // that collected (an OK/PARTIAL AdMarketRun this run). A blocked meta_ads cell
  // must NOT charge the agency; a collected one must.
  test("blocked meta_ads cell is NOT billed; collected work IS (outcome gate)", async () => {
    const now = new Date("2026-07-06T00:00:00Z");
    p.enrichmentJob.count.mockResolvedValue(0);
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      agencyId: "a1",
      status: "RUNNING",
      actualUsd: 0.008, // contacts COGS only (meta blocked → $0 COGS)
      startedAt: now,
      scopeRefsJson: { businessIds: ["b1"], cellKeys: ["spa|miami|US"] },
      enrichmentsJson: ["contacts", "meta_ads"],
      unitsRequested: 1,
    });
    routeJobFindMany([
      { status: "DONE", businessId: "b1", costUsd: 0.008, family: "CONTACTS" },
    ]);
    // The meta cell BLOCKED → a FAILED AdMarketRun exists (attempt finished this
    // run → NOT pending), but it's not OK/PARTIAL so it bills 0.
    mockAdMarketRuns([
      {
        cellKey: "spa|miami|US",
        platform: "META",
        status: "FAILED",
        ranAt: now,
      },
    ]);

    const closed = await closeRunIfDone("r1", now);

    expect(closed).toBe(true);
    // contacts = 1 credit; meta_ads = 0 (blocked). NOT 1 + 25 = 26.
    expect(reconcileRunCredits).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ actualCredits: 1, hadProgress: true }),
    );
  });

  test("collected meta_ads cell IS billed (25 credits) alongside contacts", async () => {
    const now = new Date("2026-07-06T00:00:00Z");
    p.enrichmentJob.count.mockResolvedValue(0);
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      agencyId: "a1",
      status: "RUNNING",
      actualUsd: 0.02,
      startedAt: now,
      scopeRefsJson: { businessIds: ["b1"], cellKeys: ["spa|miami|US"] },
      enrichmentsJson: ["contacts", "meta_ads"],
      unitsRequested: 1,
    });
    routeJobFindMany([
      { status: "DONE", businessId: "b1", costUsd: 0.008, family: "CONTACTS" },
    ]);
    // The meta cell COLLECTED → an OK AdMarketRun exists for it this run.
    mockAdMarketRuns([
      { cellKey: "spa|miami|US", platform: "META", status: "OK", ranAt: now },
    ]);

    const closed = await closeRunIfDone("r1", now);

    expect(closed).toBe(true);
    // contacts (1) + meta_ads collected (25 credits/cell, repriced 12→25) = 26.
    expect(reconcileRunCredits).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ actualCredits: 26, hadProgress: true }),
    );
  });

  // S3 · a run whose meta cell is still in flight (no AdMarketRun yet, and no
  // fresh prior one) must NOT close — the async enrich-cell callback lands later.
  test("does NOT close while a requested cell is still in flight", async () => {
    const now = new Date("2026-07-06T00:00:00Z");
    p.enrichmentJob.count.mockResolvedValue(0);
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      agencyId: "a1",
      status: "RUNNING",
      actualUsd: 0,
      startedAt: now, // within the ceiling
      scopeRefsJson: { businessIds: ["b1"], cellKeys: ["spa|miami|US"] },
      enrichmentsJson: ["contacts", "meta_ads"],
      unitsRequested: 1,
    });
    routeJobFindMany([
      { status: "DONE", businessId: "b1", costUsd: 0.008, family: "CONTACTS" },
    ]);
    // No AdMarketRun for the cell yet → the meta cell hasn't landed.
    mockAdMarketRuns([]);

    const closed = await closeRunIfDone("r1", now);

    expect(closed).toBe(false);
    expect(reconcileRunCredits).not.toHaveBeenCalled();
  });

  // S3 ceiling · a genuinely-lost cell (worker died) must not stall the run
  // forever — past the 15-min ceiling the run closes (cell bills 0).
  test("closes past the cell ceiling even with no AdMarketRun (reverse-stall guard)", async () => {
    const start = new Date("2026-07-06T00:00:00Z");
    const now = new Date(start.getTime() + 16 * 60_000); // past the 15-min ceiling
    p.enrichmentJob.count.mockResolvedValue(0);
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      agencyId: "a1",
      status: "RUNNING",
      actualUsd: 0,
      startedAt: start,
      scopeRefsJson: { businessIds: ["b1"], cellKeys: ["spa|miami|US"] },
      enrichmentsJson: ["contacts", "meta_ads"],
      unitsRequested: 1,
    });
    routeJobFindMany([
      { status: "DONE", businessId: "b1", costUsd: 0.008, family: "CONTACTS" },
    ]);
    mockAdMarketRuns([]);

    const closed = await closeRunIfDone("r1", now);

    expect(closed).toBe(true);
    // Only contacts bills — the lost cell contributes 0.
    expect(reconcileRunCredits).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ actualCredits: 1 }),
    );
  });

  test("closes PARTIAL when a job failed", async () => {
    p.enrichmentJob.count.mockResolvedValue(0);
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      status: "RUNNING",
      actualUsd: 0,
      enrichmentsJson: ["contacts"],
    });
    routeJobFindMany([
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

  // WP4-3 · unitsCompleted + the terminal seed are in the BUSINESS unit: a
  // 2-business × 3-family run (6 job rows, all terminal) closes at 2 of 2, not
  // 6 of 6. A business with a mix of DONE + FAILED families still counts DONE
  // (it produced some evidence); only an all-FAILED business is PARTIAL-failed.
  test("multi-family run rolls job rows down to one verdict per business", async () => {
    p.enrichmentJob.count.mockResolvedValue(0);
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      status: "RUNNING",
      actualUsd: 0,
      enrichmentsJson: ["contacts", "reviews", "lighthouse"],
      unitsRequested: 2,
    });
    routeJobFindMany([
      // b1: contacts DONE, reviews DONE, lighthouse FAILED → business DONE
      { status: "DONE", businessId: "b1", costUsd: 0.008 },
      { status: "DONE", businessId: "b1", costUsd: 0.015 },
      { status: "FAILED", businessId: "b1", costUsd: 0 },
      // b2: all three families DONE → business DONE
      { status: "DONE", businessId: "b2", costUsd: 0.008 },
      { status: "DONE", businessId: "b2", costUsd: 0.015 },
      { status: "SKIPPED_FRESH", businessId: "b2", costUsd: 0 },
    ]);

    await closeRunIfDone("r1", new Date());

    // 2 businesses done (not 6 rows); no all-failed business → OK, 2 of 2.
    expect(p.enrichmentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "OK", unitsCompleted: 2 }),
      }),
    );
  });

  // WP4-6 · the close persists the settle receipt (creditsCharged) so the
  // workbench header + Enriching done-state can show held/charged/refunded.
  test("persists the settle receipt (creditsCharged) on close", async () => {
    p.enrichmentJob.count.mockResolvedValue(0);
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      status: "RUNNING",
      actualUsd: 0.05,
      enrichmentsJson: ["contacts"],
      unitsRequested: 1,
    });
    routeJobFindMany([{ status: "DONE", businessId: "b1", costUsd: 0.008 }]);
    anyMock(reconcileRunCredits).mockResolvedValue({
      charged: 3,
      refunded: 7,
    });

    await closeRunIfDone("r1", new Date());

    expect(p.enrichmentRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ creditsCharged: 3 }),
      }),
    );
  });

  test("is a no-op while jobs remain", async () => {
    p.enrichmentJob.count.mockResolvedValue(3);
    expect(await closeRunIfDone("r1")).toBe(false);
  });

  // WP1-4 · a RUNNING run with ZERO jobs whose plan was NOT cell-only is a
  // half-fanned phantom — must NOT close (never a phantom OK with 0 units).
  test("refuses to close a zero-job RUNNING run when the plan needs jobs", async () => {
    p.enrichmentJob.count.mockResolvedValue(0);
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      status: "RUNNING",
      actualUsd: 0,
      enrichmentsJson: ["contacts"], // per-business plan → expects jobs
    });
    routeJobFindMany([]); // no jobs at all

    const closed = await closeRunIfDone("r1", new Date());

    expect(closed).toBe(false);
    expect(reconcileRunCredits).not.toHaveBeenCalled();
    expect(p.enrichmentRun.updateMany).not.toHaveBeenCalled(); // never claimed
  });

  // WP1-4 · a genuinely cell-only run (meta/google/serp only) legitimately has
  // no per-business jobs — it MUST close (settling the cell cost).
  test("closes a zero-job cell-only run", async () => {
    p.enrichmentJob.count.mockResolvedValue(0);
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      status: "RUNNING",
      actualUsd: 0.05, // one meta_ads cell collected
      enrichmentsJson: ["meta_ads"], // cell-only plan → 0 per-business jobs
    });
    routeJobFindMany([]);

    const closed = await closeRunIfDone("r1", new Date());

    expect(closed).toBe(true);
    expect(reconcileRunCredits).toHaveBeenCalledWith(
      "r1",
      expect.objectContaining({ hadProgress: true }),
    );
  });

  // WP1-3 · a concurrent close that LOSES the finishedAt CAS (updateMany count 0)
  // must NOT settle — exactly one close settles.
  test("does not settle when the close claim is lost (CAS count 0)", async () => {
    p.enrichmentJob.count.mockResolvedValue(0);
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      status: "RUNNING",
      actualUsd: 0,
      enrichmentsJson: ["contacts"],
    });
    routeJobFindMany([{ status: "DONE", businessId: "b1", costUsd: 0.008 }]);
    p.enrichmentRun.updateMany.mockResolvedValue({ count: 0 }); // lost the race

    const closed = await closeRunIfDone("r1", new Date());

    expect(closed).toBe(false);
    expect(reconcileRunCredits).not.toHaveBeenCalled();
  });

  // WP1-9 · a parked REVIEWS job whose ReviewJob has LANDED (DONE) is flipped to
  // DONE + billed; a run whose only work is such a job then closes.
  test("bills a landed REVIEWS job on data-landing (WP1-9)", async () => {
    p.enrichmentJob.count.mockResolvedValue(0);
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      status: "RUNNING",
      actualUsd: 0,
      enrichmentsJson: ["reviews"],
    });
    // reconcileReviewJobs sees one parked REVIEWS job; its ReviewJob is DONE.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.enrichmentJob.findMany.mockImplementation(async (args: any) => {
      if (args?.where?.family === "REVIEWS") {
        return [
          { id: "ej1", businessId: "b1", costUsd: 0, startedAt: new Date() },
        ];
      }
      // After reconcile flips it, the main jobs query sees it DONE + billed.
      return [{ status: "DONE", businessId: "b1", costUsd: 0.015 }];
    });
    p.reviewJob.findFirst.mockResolvedValue({ status: "DONE" });

    const closed = await closeRunIfDone("r1", new Date());

    expect(closed).toBe(true);
    // The parked reviews EnrichmentJob was flipped DONE + billed the reviews unit.
    expect(p.enrichmentJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ej1" },
        data: expect.objectContaining({ status: "DONE", costUsd: 0.015 }),
      }),
    );
  });
});

describe("processDiscovery", () => {
  test("reconstructs cells + calls runDiscovery + settles", async () => {
    // Discovery is free, so processDiscovery no longer re-fetches totalCostUsd
    // to settle — it settles at 0 credits directly. Only the initial findUnique.
    p.discovery.findUnique.mockResolvedValueOnce({
      id: "d1",
      agencyId: "a1",
      requestedByUserId: "u1",
      cellKeys: ["medical_spa|miami|US"],
    });
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
      // Discovery settles at 0 credits (free) — never bills the absorbed COGS.
      expect.objectContaining({ hadProgress: true, actualCredits: 0 }),
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

describe("updateRunProgress (mid-run header/page progress)", () => {
  // WP9-9 · unitsCompleted is now derived from the SAME groupBy that seeds the
  // Redis counters (the separate distinct findMany was removed). Each groupBy
  // row is { businessId, status, _count }; a QUEUED/RUNNING row makes a business
  // "outstanding". These helpers mint the rows the fold reads.
  const outstandingRows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      businessId: `b${i}`,
      status: "QUEUED",
      _count: { _all: 1 },
    }));

  test("unitsCompleted = requested − businesses with an outstanding job", async () => {
    p.enrichmentRun.findUnique.mockResolvedValue({
      unitsRequested: 73,
      status: "RUNNING",
    });
    // 20 distinct businesses still have a QUEUED/RUNNING job → 53 done.
    p.enrichmentJob.groupBy.mockResolvedValue(outstandingRows(20));
    p.enrichmentRun.update.mockResolvedValue({});

    await updateRunProgress("run_1");

    expect(p.enrichmentRun.update).toHaveBeenCalledWith({
      where: { id: "run_1" },
      data: { unitsCompleted: 53 },
    });
  });

  test("reaches unitsRequested when no jobs are outstanding", async () => {
    p.enrichmentRun.findUnique.mockResolvedValue({
      unitsRequested: 73,
      status: "RUNNING",
    });
    p.enrichmentJob.groupBy.mockResolvedValue([]);
    p.enrichmentRun.update.mockResolvedValue({});

    await updateRunProgress("run_1");

    expect(p.enrichmentRun.update).toHaveBeenCalledWith({
      where: { id: "run_1" },
      data: { unitsCompleted: 73 },
    });
  });

  test("never goes negative (clamped at 0)", async () => {
    p.enrichmentRun.findUnique.mockResolvedValue({
      unitsRequested: 5,
      status: "RUNNING",
    });
    // More outstanding businesses than requested (shouldn't happen, but guard).
    p.enrichmentJob.groupBy.mockResolvedValue(outstandingRows(8));
    p.enrichmentRun.update.mockResolvedValue({});

    await updateRunProgress("run_1");

    expect(p.enrichmentRun.update).toHaveBeenCalledWith({
      where: { id: "run_1" },
      data: { unitsCompleted: 0 },
    });
  });

  test("no-op when the run is gone", async () => {
    p.enrichmentRun.findUnique.mockResolvedValue(null);
    p.enrichmentRun.update.mockClear();

    await updateRunProgress("run_gone");

    expect(p.enrichmentRun.update).not.toHaveBeenCalled();
  });
});

describe("dispatchPending (WP1-1 · atomic QUEUED→RUNNING claim)", () => {
  // The tick claims each candidate via a conditional updateMany
  // (`WHERE id AND status='QUEUED'` → RUNNING). A claim LOST to a concurrent
  // tick (count 0) must drop the job — its worker is never invoked, so two
  // overlapping ticks can never double-process (= double-bill) a unit. The
  // won claim (count 1) is processed exactly once.
  test("a lost claim (count 0) is never processed; a won claim (count 1) runs once", async () => {
    // reconcileStuck finds nothing; no discoveries / runs pending or running.
    p.discovery.findMany.mockResolvedValue([]);
    p.discovery.updateMany.mockResolvedValue({ count: 0 });
    p.enrichmentRun.findMany.mockResolvedValue([]);
    // Two QUEUED CONTACTS jobs in the pool; every other findMany (stuck jobs,
    // DOM-dependency gate) returns [].
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.enrichmentJob.findMany.mockImplementation(async (args: any) =>
      args?.where?.status === "QUEUED"
        ? [
            {
              id: "j1",
              businessId: "b1",
              family: "CONTACTS",
              attempts: 0,
              costUsd: 0.008,
            },
            {
              id: "j2",
              businessId: "b2",
              family: "CONTACTS",
              attempts: 0,
              costUsd: 0.008,
            },
          ]
        : [],
    );
    // j1's claim is LOST (a concurrent tick already flipped it RUNNING);
    // j2's claim WINS.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.enrichmentJob.updateMany.mockImplementation(async (args: any) =>
      args?.where?.id === "j1" ? { count: 0 } : { count: 1 },
    );

    const out = await dispatchPending();

    // Both candidates were claimed CONDITIONALLY on still being QUEUED…
    expect(p.enrichmentJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "j1", status: "QUEUED" },
        data: expect.objectContaining({ status: "RUNNING" }),
      }),
    );
    expect(p.enrichmentJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "j2", status: "QUEUED" },
        data: expect.objectContaining({ status: "RUNNING" }),
      }),
    );
    // …but only the winner's worker ran — exactly once, and never for b1.
    expect(scanBusinessContacts).toHaveBeenCalledTimes(1);
    expect(scanBusinessContacts).toHaveBeenCalledWith("b2");
    expect(out.unitsDone).toBe(1);
  });
});

describe("reconcileStuck (WP1-4 · half-fanned run recovery)", () => {
  // A run whose fan-out crashed AFTER the RUNNING flip but BEFORE createMany
  // sits RUNNING with zero jobs forever. reconcileStuck resets it to PENDING
  // (re-fan-out) once it's older than the fan-out cutoff; a RUNNING run that
  // HAS jobs is a normal in-flight run and must be left alone.
  test("resets a stale zero-job RUNNING run to PENDING; leaves a run with jobs alone", async () => {
    const now = new Date("2026-07-01T12:00:00Z");
    p.discovery.updateMany.mockResolvedValue({ count: 0 });
    // No stuck RUNNING jobs; two RUNNING runs matched the stuck-run query.
    p.enrichmentJob.findMany.mockResolvedValue([]);
    p.enrichmentRun.findMany.mockResolvedValue([
      { id: "r1", enrichmentsJson: ["contacts"] }, // crashed pre-createMany
      { id: "r2", enrichmentsJson: ["contacts"] }, // fanned out fine
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.enrichmentJob.count.mockImplementation(async (args: any) =>
      args?.where?.runId === "r1" ? 0 : 3,
    );

    await reconcileStuck(now);

    // The stuck-run query targets RUNNING runs older than the fan-out cutoff
    // (STUCK_RUN_FANOUT_MINUTES = 15) that never finished.
    expect(p.enrichmentRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "RUNNING",
          finishedAt: null,
          startedAt: { lt: new Date(now.getTime() - 15 * 60_000) },
        }),
      }),
    );
    // r1 (zero jobs + per-business plan) re-fans-out: PENDING, cell cost reset
    // so the re-run re-accrues it.
    expect(p.enrichmentRun.update).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { status: "PENDING", actualUsd: 0 },
    });
    // r2 has jobs — not half-fanned, left RUNNING (no other update fired).
    expect(p.enrichmentRun.update).toHaveBeenCalledTimes(1);
  });

  // WP3-5 · the stuck-discovery reset anchors on startedAt (real run-start),
  // NOT createdAt — with a NULL-startedAt fallback to createdAt for legacy rows.
  test("stuck-discovery recovery filters on startedAt (WP3-5)", async () => {
    const now = new Date("2026-07-01T12:00:00Z");
    p.enrichmentJob.findMany.mockResolvedValue([]); // no stuck jobs
    p.enrichmentRun.findMany.mockResolvedValue([]); // no stuck runs

    await reconcileStuck(now);

    const cutoff = new Date(now.getTime() - 30 * 60_000); // STUCK_DISCOVERY_MINUTES
    expect(p.discovery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: "RUNNING",
          finishedAt: null,
          OR: [
            { startedAt: { lt: cutoff } },
            { startedAt: null, createdAt: { lt: cutoff } },
          ],
        }),
        data: expect.objectContaining({ status: "PENDING" }),
      }),
    );
  });
});

describe("processJob (WP3-6 backoff · WP3-3 counters)", () => {
  // WP3-6 · a requeue (worker threw, under max attempts) stamps
  // nextAttemptAt = now + 2^attempts min so the pool claim delays the retry.
  test("requeue stamps an exponential nextAttemptAt", async () => {
    const now = new Date("2026-07-01T12:00:00Z");
    anyMock(scanBusinessContacts).mockRejectedValueOnce(new Error("boom"));

    const outcome = await processJob(
      {
        id: "j1",
        businessId: "b1",
        family: "CONTACTS",
        attempts: 0,
        costUsd: 0.008,
        runId: "r1",
      },
      now,
    );

    expect(outcome).toBe("requeued");
    // attempts 0 → next 1 → 2^1 = 2 min.
    const expected = new Date(now.getTime() + 2 * 60_000);
    expect(p.enrichmentJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "j1" },
        data: expect.objectContaining({
          status: "QUEUED",
          attempts: 1,
          nextAttemptAt: expected,
        }),
      }),
    );
  });

  // WP3-6 · backoff is capped (2^attempts minutes, ≤ 60 min).
  test("backoff is capped at ~60 minutes", async () => {
    const now = new Date("2026-07-01T12:00:00Z");
    anyMock(scanBusinessContacts).mockRejectedValueOnce(new Error("boom"));

    // attempts 8 → next 9 → 2^9 = 512 min, capped to 60.
    await processJob(
      {
        id: "j1",
        businessId: "b1",
        family: "CONTACTS",
        attempts: 1,
        costUsd: 0.008,
        runId: "r1",
      },
      now,
    );
    const call = p.enrichmentJob.update.mock.calls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => c[0]?.data?.status === "QUEUED",
    );
    const stamped: Date = call[0].data.nextAttemptAt;
    // attempts 1 → next 2 → 2^2 = 4 min (still under cap).
    expect(stamped.getTime()).toBe(now.getTime() + 4 * 60_000);
  });

  // WP3-3 · a terminal DONE transition bumps the run's Redis "done" counter.
  test("a DONE transition bumps the run progress counter once the business is fully done (WP3-3)", async () => {
    const now = new Date();
    anyMock(scanBusinessContacts).mockResolvedValue({
      businessId: "b1",
      status: "OK",
      contactsUpserted: 1,
      techUpserted: 0,
      reachability: "PHONE_ONLY",
      reachableChannelCount: 1,
      isHidden: false,
    });
    // bumpRunProgress is BUSINESS-unit: it counts a business only when it has no
    // more open family jobs, and classifies by the business's own verdict.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.enrichmentJob.count.mockImplementation(async (args: any) => {
      const inStatus: string[] = args?.where?.status?.in ?? [];
      return inStatus.includes("QUEUED") ? 0 : 1; // 0 open · 1 terminal-success
    });

    const outcome = await processJob(
      {
        id: "j1",
        businessId: "b1",
        family: "CONTACTS",
        attempts: 0,
        costUsd: 0.008,
        runId: "r1",
      },
      now,
    );

    expect(outcome).toBe("done");
    expect(incrRunProgress).toHaveBeenCalledWith("r1", "done");
  });

  test("does NOT bump progress while the business has other families still open", async () => {
    const now = new Date();
    anyMock(scanBusinessContacts).mockResolvedValue({
      businessId: "b1",
      status: "OK",
      contactsUpserted: 1,
      techUpserted: 0,
      reachability: "PHONE_ONLY",
      reachableChannelCount: 1,
      isHidden: false,
    });
    // One family still QUEUED → business not done yet → no counter bump.
    p.enrichmentJob.count.mockResolvedValue(1);

    const outcome = await processJob(
      {
        id: "j1",
        businessId: "b1",
        family: "CONTACTS",
        attempts: 0,
        costUsd: 0.008,
        runId: "r1",
      },
      now,
    );

    expect(outcome).toBe("done");
    expect(incrRunProgress).not.toHaveBeenCalled();
  });
});

describe("processDiscovery (WP3-5 · atomic claim)", () => {
  // WP3-5 · the discovery is claimed via a conditional updateMany
  // (`WHERE status='PENDING'` → RUNNING + startedAt). A lost claim (count 0 —
  // a concurrent tick already claimed it) returns false WITHOUT running it.
  test("a lost claim (count 0) returns false and never runs the discovery", async () => {
    p.discovery.updateMany.mockResolvedValue({ count: 0 });

    const ok = await processDiscovery("d1", new Date());

    expect(ok).toBe(false);
    expect(runDiscovery).not.toHaveBeenCalled();
    // The claim WAS attempted, conditional on PENDING + stamping startedAt.
    expect(p.discovery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "d1", status: "PENDING" },
        data: expect.objectContaining({ status: "RUNNING" }),
      }),
    );
  });

  test("a won claim stamps startedAt then runs the discovery", async () => {
    const now = new Date("2026-07-01T12:00:00Z");
    p.discovery.updateMany.mockResolvedValue({ count: 1 });
    p.discovery.findUnique
      .mockResolvedValueOnce({
        id: "d1",
        agencyId: "a1",
        requestedByUserId: "u1",
        cellKeys: ["medical_spa|miami|US"],
      })
      .mockResolvedValueOnce({ totalCostUsd: 0.04 });
    p.businessCategory.findFirst.mockResolvedValue({ id: "cat1" });

    const ok = await processDiscovery("d1", now);

    expect(ok).toBe(true);
    expect(p.discovery.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "d1", status: "PENDING" },
        data: { status: "RUNNING", startedAt: now },
      }),
    );
    expect(runDiscovery).toHaveBeenCalled();
  });
});

describe("claimAndProcessJob (WP3-2 · worker callback idempotency)", () => {
  // WP3-2 · the enrich-job worker callback claims a QUEUED job via a conditional
  // updateMany. A DOUBLE DELIVERY (worker retry / racing tick) that loses the
  // claim (count!==1) is a NO-OP: the worker never runs a second time.
  test("a double-delivery that loses the claim is a no-op", async () => {
    p.enrichmentJob.updateMany.mockResolvedValue({ count: 0 }); // already claimed

    const outcome = await claimAndProcessJob("j1", new Date());

    expect(outcome).toBe("not-claimable");
    expect(scanBusinessContacts).not.toHaveBeenCalled();
    expect(p.enrichmentJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "j1", status: "QUEUED" },
        data: expect.objectContaining({ status: "RUNNING" }),
      }),
    );
  });

  test("a won claim loads the job and processes it once (idempotent single-run)", async () => {
    p.enrichmentJob.updateMany.mockResolvedValue({ count: 1 }); // we won the claim
    p.enrichmentJob.findUnique.mockResolvedValue({
      id: "j1",
      businessId: "b1",
      family: "CONTACTS",
      attempts: 0,
      costUsd: 0.008,
      runId: "r1",
    });
    anyMock(scanBusinessContacts).mockResolvedValue({
      businessId: "b1",
      status: "OK",
      contactsUpserted: 1,
      techUpserted: 0,
      reachability: "PHONE_ONLY",
      reachableChannelCount: 1,
      isHidden: false,
    });

    const outcome = await claimAndProcessJob("j1", new Date());

    expect(outcome).toBe("done");
    expect(scanBusinessContacts).toHaveBeenCalledTimes(1);
    expect(scanBusinessContacts).toHaveBeenCalledWith("b1");
  });
});

describe("dispatchPending (WP3-10 · multi-tenant fairness)", () => {
  // WP3-10 · the QUEUED-job claim is round-robined across agencies: with
  // PER_AGENCY_JOBS_PER_TICK small, one tenant can't monopolise the batch. Here
  // two agencies each have many CONTACTS jobs; the claim interleaves them rather
  // than draining agency A fully first.
  test("round-robins the claim across agencies", async () => {
    p.discovery.findMany.mockResolvedValue([]);
    p.discovery.updateMany.mockResolvedValue({ count: 0 });
    // No PENDING runs to fan out; the RUNNING-run close loop sees none.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.enrichmentRun.findMany.mockImplementation(async (args: any) => {
      // agencyByRun resolution: map runs → agencies.
      if (args?.where?.id?.in) {
        return [
          { id: "runA", agencyId: "agA" },
          { id: "runB", agencyId: "agB" },
        ];
      }
      return []; // PENDING runs + RUNNING runs
    });
    // Pool: 3 jobs for agency A's run, 3 for agency B's run (interleaved output
    // proves round-robin; without it agency A's 3 would all come first).
    const poolJobs = [
      {
        id: "a1",
        businessId: "ba1",
        family: "CONTACTS",
        attempts: 0,
        costUsd: 0.008,
        runId: "runA",
      },
      {
        id: "a2",
        businessId: "ba2",
        family: "CONTACTS",
        attempts: 0,
        costUsd: 0.008,
        runId: "runA",
      },
      {
        id: "a3",
        businessId: "ba3",
        family: "CONTACTS",
        attempts: 0,
        costUsd: 0.008,
        runId: "runA",
      },
      {
        id: "b1",
        businessId: "bb1",
        family: "CONTACTS",
        attempts: 0,
        costUsd: 0.008,
        runId: "runB",
      },
      {
        id: "b2",
        businessId: "bb2",
        family: "CONTACTS",
        attempts: 0,
        costUsd: 0.008,
        runId: "runB",
      },
      {
        id: "b3",
        businessId: "bb3",
        family: "CONTACTS",
        attempts: 0,
        costUsd: 0.008,
        runId: "runB",
      },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.enrichmentJob.findMany.mockImplementation(async (args: any) =>
      args?.where?.status === "QUEUED" ? poolJobs : [],
    );

    const claimOrder: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.enrichmentJob.updateMany.mockImplementation(async (args: any) => {
      if (args?.where?.id && args?.where?.status === "QUEUED") {
        claimOrder.push(args.where.id);
      }
      return { count: 1 };
    });

    await dispatchPending();

    // The first two claims must be from DIFFERENT agencies (A then B, or B then
    // A) — proving the batch interleaves tenants rather than draining one first.
    const agencyOf = (id: string) => (id.startsWith("a") ? "agA" : "agB");
    expect(claimOrder.length).toBeGreaterThanOrEqual(2);
    expect(agencyOf(claimOrder[0]!)).not.toBe(agencyOf(claimOrder[1]!));
  });
});

// 2026-07-10 · P3 · the soft-failure taxonomy + the cross-run permanent-failure
// cap that renders a hopeless (business, family) "Not available".
describe("isNonRetryableFailure", () => {
  test("structural reasons are non-retryable", () => {
    expect(isNonRetryableFailure("contacts_skipped_no_source")).toBe(true);
    expect(isNonRetryableFailure("google_ads_no-website")).toBe(true);
    expect(isNonRetryableFailure("reviews_submit_failed")).toBe(true);
    expect(isNonRetryableFailure("lighthouse_0_audited")).toBe(true);
    expect(isNonRetryableFailure("some_family_no_cid")).toBe(true); // regex tail
  });
  test("transient reasons (vendor blip, site down) ARE retryable", () => {
    expect(isNonRetryableFailure("contacts_fetch_failed")).toBe(false);
    expect(isNonRetryableFailure("google_ads_error")).toBe(false);
    expect(isNonRetryableFailure("boom")).toBe(false);
    expect(isNonRetryableFailure(undefined)).toBe(false);
  });
});

describe("permanentlyUnavailablePairs (cross-run cap)", () => {
  test("empty input short-circuits without a query", async () => {
    const set = await permanentlyUnavailablePairs([], ["CONTACTS"]);
    expect(set.size).toBe(0);
    expect(p.enrichmentJob.findMany).not.toHaveBeenCalled();
  });

  test("flags a pair that hit the 3-attempt cross-run cap", async () => {
    p.enrichmentJob.findMany.mockResolvedValue([
      {
        businessId: "b1",
        family: "CONTACTS",
        errorMessage: "boom",
        finishedAt: new Date(1),
      },
      {
        businessId: "b1",
        family: "CONTACTS",
        errorMessage: "boom",
        finishedAt: new Date(2),
      },
      {
        businessId: "b1",
        family: "CONTACTS",
        errorMessage: "boom",
        finishedAt: new Date(3),
      },
      // b2 only failed twice → still retryable.
      {
        businessId: "b2",
        family: "CONTACTS",
        errorMessage: "boom",
        finishedAt: new Date(1),
      },
      {
        businessId: "b2",
        family: "CONTACTS",
        errorMessage: "boom",
        finishedAt: new Date(2),
      },
    ]);
    const set = await permanentlyUnavailablePairs(["b1", "b2"], ["CONTACTS"]);
    expect(set.has("b1:CONTACTS")).toBe(true);
    expect(set.has("b2:CONTACTS")).toBe(false);
  });

  test("flags a pair whose latest failure is structurally non-retryable (1 attempt)", async () => {
    p.enrichmentJob.findMany.mockResolvedValue([
      {
        businessId: "b3",
        family: "GOOGLE_ADS",
        errorMessage: "google_ads_no-website",
        finishedAt: new Date(1),
      },
    ]);
    const set = await permanentlyUnavailablePairs(["b3"], ["GOOGLE_ADS"]);
    expect(set.has("b3:GOOGLE_ADS")).toBe(true);
  });

  test("bounds the query to the recovery window so failures age out (Medium-2)", async () => {
    p.enrichmentJob.findMany.mockResolvedValue([]);
    const now = new Date("2026-07-10T00:00:00Z");
    await permanentlyUnavailablePairs(["b1"], ["CONTACTS"], now);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const call = (p.enrichmentJob.findMany.mock.calls[0][0] as any).where;
    expect(call.finishedAt.gte).toBeInstanceOf(Date);
    const windowMs = now.getTime() - call.finishedAt.gte.getTime();
    expect(windowMs).toBeGreaterThan(29 * 24 * 3600 * 1000);
    expect(windowMs).toBeLessThan(31 * 24 * 3600 * 1000);
  });
});

// ── P5 (2026-07-10) · parked-reviews stall ceiling ──
describe("closeRunIfDone · P5 parked-reviews stall ceiling", () => {
  test("a REVIEWS job parked past the ceiling flips FAILED so the run can close", async () => {
    const start = new Date("2026-07-06T00:00:00Z");
    const now = new Date(start.getTime() + 31 * 60_000); // 31 min parked
    p.enrichmentJob.count.mockResolvedValue(0);
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      agencyId: "a1",
      status: "RUNNING",
      actualUsd: 0,
      startedAt: start,
      scopeRefsJson: { businessIds: ["b1"], cellKeys: [] },
      enrichmentsJson: ["reviews"],
      unitsRequested: 1,
    });
    // The reviews-reconcile query returns the parked job; the main jobs query
    // then sees it FAILED (flipped by the ceiling).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.enrichmentJob.findMany.mockImplementation(async (args: any) => {
      if (args?.where?.family === "REVIEWS") {
        return [{ id: "ej1", businessId: "b1", costUsd: 0, startedAt: start }];
      }
      return [
        { status: "FAILED", businessId: "b1", costUsd: 0, family: "REVIEWS" },
      ];
    });
    p.reviewJob.findFirst.mockResolvedValue(null); // submit never landed one
    // failParked flips via a status-guarded updateMany (TOCTOU-safe) — it wins.
    p.enrichmentJob.updateMany.mockResolvedValue({ count: 1 });

    const closed = await closeRunIfDone("r1", now);

    expect(closed).toBe(true);
    expect(p.enrichmentJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ej1", status: "RUNNING" },
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: "reviews_landing_timeout",
        }),
      }),
    );
  });

  test("a freshly-parked REVIEWS job (under the ceiling) keeps the run open", async () => {
    const start = new Date("2026-07-06T00:00:00Z");
    const now = new Date(start.getTime() + 5 * 60_000); // 5 min parked
    p.enrichmentJob.count.mockResolvedValue(1); // the parked job is still open
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p.enrichmentJob.findMany.mockImplementation(async (args: any) => {
      if (args?.where?.family === "REVIEWS") {
        return [{ id: "ej1", businessId: "b1", costUsd: 0, startedAt: start }];
      }
      return [];
    });
    p.reviewJob.findFirst.mockResolvedValue(null);

    const closed = await closeRunIfDone("r1", now);

    expect(closed).toBe(false);
    expect(p.enrichmentJob.update).not.toHaveBeenCalled();
  });
});
