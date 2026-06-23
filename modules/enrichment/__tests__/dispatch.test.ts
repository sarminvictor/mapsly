// Unit tests for the enrichment dispatcher (Phase 3 glue). We mock @/lib/prisma
// + every worker module so the tests assert ROUTING + status transitions, not
// the workers themselves (each has its own suite). Invariants:
//   - per-business + per-cell families route to the right worker, scoped to the
//     run's businessIds / cellKeys;
//   - the expert layer (playbooks) auto-runs once per touched business;
//   - one throwing unit → run closes PARTIAL, the rest still run;
//   - a PENDING Discovery reconstructs cells (resolving categoryId) → runDiscovery.

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({
  default: {
    enrichmentRun: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    discovery: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    businessCategory: { findFirst: vi.fn() },
  },
}));
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
}));

import prisma from "@/lib/prisma";
import { runDiscovery } from "@/modules/discovery/run-discovery";
import { scanBusinessContacts } from "@/modules/contacts/scan";
import { runSerpForCell } from "@/modules/cell-intel/serp";
import { runPlaybooksForBusiness } from "@/modules/playbooks/run";
import { extractServicesForBusiness } from "@/modules/services-general/extract";
import { processEnrichmentRun, processDiscovery } from "../dispatch";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  p.enrichmentRun.update.mockResolvedValue({});
  p.discovery.update.mockResolvedValue({});
});

describe("processEnrichmentRun", () => {
  test("routes per-business + per-cell families and closes OK", async () => {
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r1",
      enrichmentsJson: ["contacts", "serp"],
      scopeRefsJson: { businessIds: ["b1", "b2"], cellKeys: ["spa|miami|US"] },
    });

    const out = await processEnrichmentRun("r1");

    expect(scanBusinessContacts).toHaveBeenCalledTimes(2);
    expect(runSerpForCell).toHaveBeenCalledTimes(1);
    expect(runPlaybooksForBusiness).toHaveBeenCalledTimes(2); // auto expert layer
    expect(out).toEqual({ done: 3, failed: 0 });
    expect(p.enrichmentRun.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "OK", unitsCompleted: 3 }),
      }),
    );
  });

  test("a thrown unit → PARTIAL, others still run", async () => {
    p.enrichmentRun.findUnique.mockResolvedValue({
      id: "r2",
      enrichmentsJson: ["services"],
      scopeRefsJson: { businessIds: ["b1", "b2"] },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (extractServicesForBusiness as any).mockRejectedValueOnce(
      new Error("boom"),
    );

    const out = await processEnrichmentRun("r2");

    expect(extractServicesForBusiness).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ done: 1, failed: 1 });
    expect(p.enrichmentRun.update).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PARTIAL" }),
      }),
    );
  });

  test("missing run → no-op", async () => {
    p.enrichmentRun.findUnique.mockResolvedValue(null);
    expect(await processEnrichmentRun("nope")).toEqual({ done: 0, failed: 0 });
  });
});

describe("processDiscovery", () => {
  test("reconstructs cells + calls runDiscovery", async () => {
    p.discovery.findUnique.mockResolvedValue({
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
  });

  test("no resolvable cells → FAILED", async () => {
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
  });
});
