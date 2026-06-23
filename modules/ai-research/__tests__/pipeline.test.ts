// Tests for runAiResearchForBusiness · the three required invariants:
//   1. a cold business runs all 5 stages → 5 EnrichmentStageRun(OK) rows +
//      one BusinessEnrichment rollup with each stage's field populated.
//   2. a stage with a fresh prior OK run is SKIPPED (no model call) and its
//      prior output is carried into the rollup.
//   3. per-stage freshness windows differ (ER-1 180d still fresh at 100d ago,
//      ER-3 30d is stale at 100d ago → recomputed).

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---- AI client mock -----------------------------------------------------
const ai = vi.hoisted(() => ({ callOpenAi: vi.fn() }));
vi.mock("@/services/ai/client", () => ({ callOpenAi: ai.callOpenAi }));

// ---- prisma mock --------------------------------------------------------
interface StageRow {
  businessId: string;
  stage: string;
  status: string;
  outputJson: unknown;
  computedAt: Date;
}

const db = vi.hoisted(() => {
  const stageCreates: Array<Record<string, unknown>> = [];
  const enrichmentUpserts: Array<Record<string, unknown>> = [];
  let priorStages: StageRow[] = [];
  let business: Record<string, unknown> | null = null;
  let cellLeader: Record<string, unknown> | null = null;
  return {
    stageCreates,
    enrichmentUpserts,
    setPriorStages(s: StageRow[]) {
      priorStages = s;
    },
    getPriorStages() {
      return priorStages;
    },
    setBusiness(b: Record<string, unknown> | null) {
      business = b;
    },
    getBusiness() {
      return business;
    },
    setCellLeader(b: Record<string, unknown> | null) {
      cellLeader = b;
    },
    getCellLeader() {
      return cellLeader;
    },
  };
});

vi.mock("@/lib/prisma", () => ({
  default: {
    business: {
      findUnique: vi.fn(async () => db.getBusiness()),
      findFirst: vi.fn(async () => db.getCellLeader()),
    },
    enrichmentStageRun: {
      findMany: vi.fn(async () =>
        // mirror "OK only, computedAt desc" ordering the loader expects
        db
          .getPriorStages()
          .filter((r) => r.status === "OK")
          .sort((a, b) => b.computedAt.getTime() - a.computedAt.getTime()),
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        db.stageCreates.push(data);
        return { id: `sr_${db.stageCreates.length}` };
      }),
    },
    businessEnrichment: {
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        db.enrichmentUpserts.push(args);
        return { id: "be_1" };
      }),
    },
  },
  Prisma: { JsonNull: null },
}));

import { runAiResearchForBusiness, STAGE_FRESHNESS_DAYS } from "../pipeline";

const BIZ = "biz_1";
const NOW = new Date("2026-06-22T12:00:00.000Z");

function baseBusiness() {
  return {
    id: BIZ,
    name: "Solea Brickell Spa",
    category: "medical_spa",
    city: "Miami",
    country: "US",
    cellKey: "medical_spa|miami|US",
    description: "We offer Botox and fillers in Brickell.",
    placeTopics: { botox: 20, fillers: 5 },
    services: [{ name: "Botox" }, { name: "Lip filler" }],
  };
}

// Each stage's mocked JSON, keyed by the operation tag substring.
function mockAiByStage(): void {
  ai.callOpenAi.mockImplementation(
    async ({ operation }: { operation: string }) => {
      const json = operation.includes("ER-1")
        ? { subType: "injectables med spa", sophistication: "high" }
        : operation.includes("ER-2")
          ? {
              pricingTransparency: "opaque",
              positioningSummary: "Premium injectables clinic.",
            }
          : operation.includes("ER-3")
            ? { complianceCues: ["medical-director-required"] }
            : operation.includes("ER-4")
              ? { painHypotheses: ["No visible pricing reduces conversion"] }
              : { competitivePositioning: "Mid-pack vs the cell leader." };
      return {
        text: JSON.stringify(json),
        finishReason: "stop",
        usage: { inputTokens: 100, outputTokens: 30 },
        costUsd: 0.0001,
        model: "gpt-5.4-nano",
      };
    },
  );
}

beforeEach(() => {
  db.stageCreates.length = 0;
  db.enrichmentUpserts.length = 0;
  db.setPriorStages([]);
  db.setBusiness(baseBusiness());
  db.setCellLeader({ name: "Glow Bar Miami" });
  ai.callOpenAi.mockReset();
});

afterEach(() => vi.clearAllMocks());

describe("runAiResearchForBusiness · cold run", () => {
  test("runs all 5 stages → 5 OK stage rows + rollup with every field", async () => {
    mockAiByStage();
    const res = await runAiResearchForBusiness(BIZ, { now: NOW });

    // 5 model calls, no web_search tool (mock receives no tools arg).
    expect(ai.callOpenAi).toHaveBeenCalledTimes(5);
    for (const call of ai.callOpenAi.mock.calls) {
      expect(call[0].model).toBe("gpt-5.4-nano");
      expect(call[0]).not.toHaveProperty("tools");
    }

    // 5 OK EnrichmentStageRun rows.
    const okRows = db.stageCreates.filter((r) => r.status === "OK");
    expect(okRows).toHaveLength(5);
    expect(new Set(okRows.map((r) => r.stage))).toEqual(
      new Set(["ER-1", "ER-2", "ER-3", "ER-4", "ER-5"]),
    );

    // Rollup populated from each stage.
    expect(db.enrichmentUpserts).toHaveLength(1);
    const up = db.enrichmentUpserts[0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(up.create.subType).toBe("injectables med spa");
    expect(up.create.sophistication).toBe("high");
    expect(up.create.pricingTransparency).toBe("opaque");
    expect(up.create.complianceCues).toEqual(["medical-director-required"]);
    expect(up.create.painHypotheses).toEqual([
      "No visible pricing reduces conversion",
    ]);
    expect(up.create.competitivePositioning).toContain("leader");
    expect(up.create.model).toBe("gpt-5.4-nano");

    expect(res.rolledUp).toBe(true);
    expect(res.costUsd).toBeCloseTo(0.0005, 6);
    expect(Object.values(res.stages).every((s) => s === "computed")).toBe(true);
  });
});

describe("runAiResearchForBusiness · per-stage freshness", () => {
  test("a fresh prior OK stage is skipped (no model call) + carried to rollup", async () => {
    mockAiByStage();
    // ER-1 was computed 10 days ago (within its 180d window) → fresh.
    db.setPriorStages([
      {
        businessId: BIZ,
        stage: "ER-1",
        status: "OK",
        outputJson: { subType: "prior subtype", sophistication: "medium" },
        computedAt: new Date(NOW.getTime() - 10 * 86_400_000),
      },
    ]);

    const res = await runAiResearchForBusiness(BIZ, { now: NOW });

    // ER-1 skipped → only 4 model calls (ER-2..ER-5).
    expect(ai.callOpenAi).toHaveBeenCalledTimes(4);
    const calledStages = ai.callOpenAi.mock.calls.map(
      (c) => c[0].operation as string,
    );
    expect(calledStages.some((op) => op.includes("ER-1"))).toBe(false);

    expect(res.stages["ER-1"]).toBe("fresh");
    // A SKIPPED_FRESH audit row records the decision.
    const skipped = db.stageCreates.filter((r) => r.status === "SKIPPED_FRESH");
    expect(skipped).toHaveLength(1);
    expect(skipped[0].stage).toBe("ER-1");

    // The prior ER-1 output is carried into the rollup.
    const up = db.enrichmentUpserts[0] as { create: Record<string, unknown> };
    expect(up.create.subType).toBe("prior subtype");
    expect(up.create.sophistication).toBe("medium");
  });

  test("freshness windows differ per stage: ER-1 180d fresh vs ER-3 30d stale at 100d ago", async () => {
    mockAiByStage();
    const hundredDaysAgo = new Date(NOW.getTime() - 100 * 86_400_000);
    db.setPriorStages([
      {
        businessId: BIZ,
        stage: "ER-1",
        status: "OK",
        outputJson: { subType: "old subtype", sophistication: "low" },
        computedAt: hundredDaysAgo, // < 180d → still fresh
      },
      {
        businessId: BIZ,
        stage: "ER-3",
        status: "OK",
        outputJson: { complianceCues: ["old-cue"] },
        computedAt: hundredDaysAgo, // > 30d → stale, recompute
      },
    ]);

    const res = await runAiResearchForBusiness(BIZ, { now: NOW });

    expect(STAGE_FRESHNESS_DAYS["ER-1"]).toBe(180);
    expect(STAGE_FRESHNESS_DAYS["ER-3"]).toBe(30);
    expect(res.stages["ER-1"]).toBe("fresh");
    expect(res.stages["ER-3"]).toBe("computed");

    // ER-1 carries the OLD subtype; ER-3 gets the freshly-computed cue.
    const up = db.enrichmentUpserts[0] as { create: Record<string, unknown> };
    expect(up.create.subType).toBe("old subtype");
    expect(up.create.complianceCues).toEqual(["medical-director-required"]);
  });
});

describe("runAiResearchForBusiness · isolation", () => {
  test("a single stage failure is recorded FAILED and does not abort the others", async () => {
    ai.callOpenAi.mockImplementation(
      async ({ operation }: { operation: string }) => {
        if (operation.includes("ER-4")) throw new Error("nano blew up");
        const json = operation.includes("ER-1")
          ? { subType: "x", sophistication: "low" }
          : operation.includes("ER-2")
            ? { pricingTransparency: "unknown", positioningSummary: "p" }
            : operation.includes("ER-3")
              ? { complianceCues: [] }
              : { competitivePositioning: "c" };
        return {
          text: JSON.stringify(json),
          finishReason: "stop",
          usage: { inputTokens: 10, outputTokens: 5 },
          costUsd: 0.0001,
          model: "gpt-5.4-nano",
        };
      },
    );

    const res = await runAiResearchForBusiness(BIZ, { now: NOW });
    expect(res.stages["ER-4"]).toBe("failed");
    const failedRows = db.stageCreates.filter((r) => r.status === "FAILED");
    expect(failedRows).toHaveLength(1);
    expect(failedRows[0].stage).toBe("ER-4");
    // Rollup still written from the 4 good stages.
    expect(res.rolledUp).toBe(true);
  });
});
