// Unit tests for scripts/model-ab-test.ts · the D.8 A/B comparison script.
//
// These tests cover the pure functions (auto-scoring, decision logic, CLI
// parsing, fixtures) and a small dry-run smoke test of runComparison. The
// live API path is NOT exercised here — it's tested by Vercel CI build
// (tsx compiles the script) and gated by --live + OPENAI_API_KEY.

import { describe, expect, test } from "vitest";

import {
  autoScore,
  COMPARED_MODELS,
  countSpanishMarkers,
  decideTaskWinner,
  DEFAULT_RUN_TASKS,
  estimateCostUsd,
  estimateLiveCostUsd,
  FIXTURES,
  formatSummaryTable,
  NANO_PICK_THRESHOLD_RATIO,
  parseCliArgs,
  referencesReview,
  runComparison,
  stubOutput,
  summarizeTask,
} from "../model-ab-test";

describe("countSpanishMarkers", () => {
  test("counts canonical Spanish markers", () => {
    const n = countSpanishMarkers(
      "¡Hola! Gracias por su visita. Usted es muy amable.",
    );
    expect(n).toBeGreaterThanOrEqual(3);
  });

  test("returns 0 on English text", () => {
    expect(countSpanishMarkers("Thanks for visiting!")).toBe(0);
  });

  test("is case-insensitive", () => {
    expect(countSpanishMarkers("GRACIAS POR SU VISITA")).toBeGreaterThanOrEqual(
      2,
    );
  });
});

describe("referencesReview", () => {
  test("true when reply contains a 5+ char word from the review", () => {
    expect(
      referencesReview(
        "Thanks for mentioning the friendly staff!",
        "The friendly staff were amazing.",
      ),
    ).toBe(true);
  });

  test("false when no distinctive word overlaps", () => {
    expect(referencesReview("Thank you!", "Service was OK.")).toBe(false);
  });

  test("ignores short words (<5 chars)", () => {
    expect(referencesReview("the and was", "the and was bad")).toBe(false);
  });
});

describe("autoScore", () => {
  test("sentiment: rewards JSON validity + brevity", () => {
    const s = autoScore({
      task: "sentiment",
      output: JSON.stringify({
        sentiment: "POSITIVE",
        themes: ["staff"],
        summary: "ok",
        confidence: 0.9,
      }),
      reviewText: "Great service.",
    });
    expect(s.jsonValid).toBe(true);
    expect(s.withinCharLimit).toBe(true);
    expect(s.autoQualityScore).toBeGreaterThanOrEqual(8);
  });

  test("sentiment: penalizes bad JSON", () => {
    const s = autoScore({
      task: "sentiment",
      output: "POSITIVE — happy customer",
      reviewText: "Great",
    });
    expect(s.jsonValid).toBe(false);
    expect(s.autoQualityScore).toBeLessThan(8);
  });

  test("replyDraftEn: rewards reference + length compliance", () => {
    const reply =
      "Thanks for highlighting our patient front-desk team and the calm space — we'll make sure they hear it!";
    const s = autoScore({
      task: "replyDraftEn",
      output: reply,
      reviewText: "The patient front-desk team was great.",
    });
    expect(s.withinCharLimit).toBe(true);
    expect(s.referencesReview).toBe(true);
    expect(s.autoQualityScore).toBeGreaterThanOrEqual(8);
  });

  test("replyDraftEn: penalizes over-limit replies", () => {
    const huge = "x".repeat(800);
    const s = autoScore({
      task: "replyDraftEn",
      output: huge,
      reviewText: "Great service.",
    });
    expect(s.withinCharLimit).toBe(false);
  });

  test("replyDraftEs: rewards Spanish markers + reference", () => {
    const reply =
      "¡Gracias por mencionar nuestro personal! Esperamos verle de nuevo pronto. Saludos cordiales del equipo. Usted es muy amable.";
    const s = autoScore({
      task: "replyDraftEs",
      output: reply,
      reviewText: "Personal staff were great.",
    });
    expect(s.spanishMarkersFound).toBeGreaterThanOrEqual(3);
    expect(s.referencesReview).toBe(true);
    expect(s.autoQualityScore).toBeGreaterThanOrEqual(7);
  });

  test("replyDraftEs: low score on monolingual English", () => {
    const s = autoScore({
      task: "replyDraftEs",
      output: "Thank you for your kind review of our business and service.",
      reviewText: "The staff were great.",
    });
    expect(s.spanishMarkersFound ?? 0).toBeLessThan(3);
  });
});

describe("decideTaskWinner", () => {
  test("picks nano when blended ratio ≥ 80%", () => {
    const r = decideTaskWinner({
      task: "sentiment",
      miniAutoMean: 10,
      nanoAutoMean: 9,
      miniRubric: 8,
      nanoRubric: 8.4,
    });
    expect(r.recommended).toBe("gpt-5.4-nano");
  });

  test("picks mini when blended ratio < 80%", () => {
    const r = decideTaskWinner({
      task: "replyDraftEn",
      miniAutoMean: 10,
      nanoAutoMean: 4,
      miniRubric: 9.1,
      nanoRubric: 6,
    });
    expect(r.recommended).toBe("gpt-5.4-mini");
  });

  test("threshold is configured at 0.8", () => {
    expect(NANO_PICK_THRESHOLD_RATIO).toBe(0.8);
  });

  test("reasoning includes a percentage", () => {
    const r = decideTaskWinner({
      task: "sentiment",
      miniAutoMean: 5,
      nanoAutoMean: 4,
      miniRubric: 8,
      nanoRubric: 7,
    });
    expect(r.reasoning).toMatch(/\d+%/);
  });

  test("graceful degenerate input (mini=0)", () => {
    const r = decideTaskWinner({
      task: "sentiment",
      miniAutoMean: 0,
      nanoAutoMean: 0,
      miniRubric: 0,
      nanoRubric: 0,
    });
    expect(r.recommended).toBe("gpt-5.4-nano");
  });
});

describe("FIXTURES", () => {
  test("has ≥ 10 fixtures spanning star ratings", () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(10);
    const stars = new Set(FIXTURES.map((f) => f.stars));
    // At least 3 different star ratings represented.
    expect(stars.size).toBeGreaterThanOrEqual(3);
  });

  test("fixtures cover both extremes", () => {
    expect(FIXTURES.some((f) => f.stars === 1)).toBe(true);
    expect(FIXTURES.some((f) => f.stars === 5)).toBe(true);
  });

  test("ids are unique", () => {
    const ids = new Set(FIXTURES.map((f) => f.id));
    expect(ids.size).toBe(FIXTURES.length);
  });
});

describe("estimateCostUsd", () => {
  test("nano is cheaper than mini for same usage", () => {
    const nano = estimateCostUsd({
      model: "gpt-5.4-nano",
      inputTokens: 1000,
      outputTokens: 100,
    });
    const mini = estimateCostUsd({
      model: "gpt-5.4-mini",
      inputTokens: 1000,
      outputTokens: 100,
    });
    expect(nano).toBeLessThan(mini);
    expect(nano).toBeGreaterThan(0);
  });

  test("zero tokens → zero cost", () => {
    expect(
      estimateCostUsd({
        model: "gpt-5.4-mini",
        inputTokens: 0,
        outputTokens: 0,
      }),
    ).toBe(0);
  });
});

describe("estimateLiveCostUsd", () => {
  test("scales linearly with --reviews", () => {
    const tasks = DEFAULT_RUN_TASKS;
    const a = estimateLiveCostUsd({
      reviews: 10,
      tasks,
      models: COMPARED_MODELS,
    });
    const b = estimateLiveCostUsd({
      reviews: 20,
      tasks,
      models: COMPARED_MODELS,
    });
    // Allow tiny floating-point drift.
    expect(Math.abs(b - 2 * a)).toBeLessThan(0.0001);
  });

  test("a default 10-review run is well under the $1 ceiling", () => {
    const e = estimateLiveCostUsd({
      reviews: 10,
      tasks: DEFAULT_RUN_TASKS,
      models: COMPARED_MODELS,
    });
    expect(e).toBeLessThan(1.0);
  });
});

describe("parseCliArgs", () => {
  test("defaults", () => {
    const a = parseCliArgs([]);
    expect(a.reviews).toBe(10);
    expect(a.live).toBe(false);
    expect(a.decide).toBe("none");
    expect(a.outputPath).toContain("ab-test-runs");
  });

  test("--reviews", () => {
    expect(parseCliArgs(["--reviews", "50"]).reviews).toBe(50);
  });

  test("--live + --decide auto", () => {
    const a = parseCliArgs(["--live", "--decide", "auto"]);
    expect(a.live).toBe(true);
    expect(a.decide).toBe("auto");
  });

  test("rejects out-of-range --reviews", () => {
    expect(() => parseCliArgs(["--reviews", "0"])).toThrow();
    expect(() => parseCliArgs(["--reviews", "9999"])).toThrow();
    expect(() => parseCliArgs(["--reviews", "abc"])).toThrow();
  });

  test("rejects unknown flag", () => {
    expect(() => parseCliArgs(["--bogus"])).toThrow();
  });

  test("rejects invalid --decide value", () => {
    expect(() => parseCliArgs(["--decide", "bogus"])).toThrow();
  });
});

describe("stubOutput", () => {
  test("sentiment produces valid JSON for both models", () => {
    for (const model of COMPARED_MODELS) {
      const r = stubOutput({
        task: "sentiment",
        model,
        fixture: FIXTURES[0],
      });
      expect(() => JSON.parse(r.text)).not.toThrow();
    }
  });

  test("mini reply is longer than nano reply (quality proxy)", () => {
    const miniEn = stubOutput({
      task: "replyDraftEn",
      model: "gpt-5.4-mini",
      fixture: FIXTURES[0],
    });
    const nanoEn = stubOutput({
      task: "replyDraftEn",
      model: "gpt-5.4-nano",
      fixture: FIXTURES[0],
    });
    expect(miniEn.text.length).toBeGreaterThan(nanoEn.text.length);
  });
});

describe("runComparison dry-run smoke", () => {
  test("returns a report with one summary per task and one result per (fixture,task,model)", async () => {
    const report = await runComparison({
      fixtures: FIXTURES.slice(0, 3),
      generate: async (input) => ({
        ...stubOutput(input),
        latencyMs: 100,
      }),
      runId: "test-run",
      mode: "dry-run",
    });
    expect(report.summary.length).toBe(DEFAULT_RUN_TASKS.length);
    expect(report.results.length).toBe(
      3 * DEFAULT_RUN_TASKS.length * COMPARED_MODELS.length,
    );
    expect(report.totalCostUsd).toBeGreaterThan(0);
  });

  test("each task summary picks one of the compared models", async () => {
    const report = await runComparison({
      fixtures: FIXTURES.slice(0, 5),
      generate: async (input) => ({
        ...stubOutput(input),
        latencyMs: 100,
      }),
      runId: "test-run",
      mode: "dry-run",
    });
    for (const s of report.summary) {
      expect(COMPARED_MODELS).toContain(s.recommendedModel);
    }
  });

  test("captures generator errors per row without aborting", async () => {
    let calls = 0;
    const report = await runComparison({
      fixtures: FIXTURES.slice(0, 2),
      generate: async (input) => {
        calls++;
        if (calls === 2) throw new Error("boom");
        return { ...stubOutput(input), latencyMs: 100 };
      },
      runId: "test-run-err",
      mode: "dry-run",
    });
    expect(report.results.some((r) => r.error === "boom")).toBe(true);
    expect(report.results.length).toBeGreaterThan(1);
  });

  test("summarizeTask aggregates per-model means", async () => {
    const report = await runComparison({
      fixtures: FIXTURES.slice(0, 4),
      generate: async (input) => ({
        ...stubOutput(input),
        latencyMs: 100,
      }),
      runId: "test-aggr",
      mode: "dry-run",
    });
    const sentimentSummary = summarizeTask("sentiment", report.results);
    for (const m of COMPARED_MODELS) {
      expect(sentimentSummary.perModel[m].runs).toBe(4);
    }
  });
});

describe("formatSummaryTable", () => {
  test("renders one row per (task, model) plus header + reasoning", async () => {
    const report = await runComparison({
      fixtures: FIXTURES.slice(0, 2),
      generate: async (input) => ({
        ...stubOutput(input),
        latencyMs: 100,
      }),
      runId: "test-fmt",
      mode: "dry-run",
    });
    const table = formatSummaryTable(report.summary);
    expect(table).toContain("gpt-5.4-nano");
    expect(table).toContain("gpt-5.4-mini");
    expect(table).toContain("★"); // marker on recommended row
  });
});
