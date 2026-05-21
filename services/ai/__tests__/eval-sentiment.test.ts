// Unit tests for the sentiment corpus eval harness · D.6.
//
// The harness orchestrates a Classifier across samples and aggregates
// verdicts. These tests pin three invariants:
//
//   1. Bundled corpus passes structural validation (every theme is in
//      ALLOWED_THEMES, every stars is 1..5, no duplicate ids). This is the
//      regression guard for "corpus drift after a refactor."
//   2. The scoring math is correct given known classifier outputs: subset
//      themes, sentiment exact-match, confidence range checks.
//   3. The harness aggregates accuracy correctly even when individual
//      samples error.
//
// No real API is invoked — we stub the Classifier with deterministic
// returns. Real-model evaluation is gated to `pnpm eval:sentiment` and
// requires Viktor's API key + cron context.

import { describe, expect, test } from "vitest";
import {
  evaluateSentimentCorpus,
  formatReport,
  loadCorpus,
  scoreSample,
  type Classifier,
  type SentimentCorpusSample,
} from "@/services/ai/eval-sentiment";
import type { ClassifyReviewResult, Sentiment } from "@/services/ai/sentiment";

function makeResult(
  sentiment: Sentiment,
  themes: ClassifyReviewResult["themes"],
  confidence = 0.85,
): ClassifyReviewResult {
  return {
    sentiment,
    themes,
    summary: "stub",
    confidence,
  };
}

describe("loadCorpus", () => {
  test("returns the bundled corpus with at least 20 samples", () => {
    const c = loadCorpus();
    expect(c.samples.length).toBeGreaterThanOrEqual(20);
  });

  test("every sample exercises an allowed theme or none", () => {
    // loadCorpus throws if any theme is not in ALLOWED_THEMES, so just
    // calling it twice and asserting no throw is enough; we also check
    // every sample has a sentiment field.
    const c = loadCorpus();
    for (const s of c.samples) {
      expect(["POSITIVE", "NEUTRAL", "NEGATIVE"]).toContain(
        s.expectedSentiment,
      );
    }
  });

  test("ids are unique", () => {
    const c = loadCorpus();
    const ids = new Set(c.samples.map((s) => s.id));
    expect(ids.size).toBe(c.samples.length);
  });
});

describe("scoreSample", () => {
  const baseSample: SentimentCorpusSample = {
    id: "test-1",
    stars: 5,
    text: "Loved it",
    expectedSentiment: "POSITIVE",
    expectedThemes: ["staff", "results"],
    expectedThemesMode: "subset",
    minConfidence: 0.8,
  };

  test("passes when sentiment + all expected themes present + confidence in range", () => {
    const v = scoreSample(
      baseSample,
      makeResult("POSITIVE", ["staff", "results", "atmosphere"], 0.9),
    );
    expect(v.pass).toBe(true);
    expect(v.sentimentMatch).toBe(true);
    expect(v.themesMatch).toBe(true);
    expect(v.confidenceInRange).toBe(true);
    // Subset mode tolerates extra themes — atmosphere is not in expected
    // but shouldn't surface as unexpected.
    expect(v.unexpectedThemes).toEqual([]);
  });

  test("fails when sentiment mismatches", () => {
    const v = scoreSample(
      baseSample,
      makeResult("NEUTRAL", ["staff", "results"], 0.9),
    );
    expect(v.pass).toBe(false);
    expect(v.sentimentMatch).toBe(false);
    expect(v.themesMatch).toBe(true);
  });

  test("fails + reports missing themes when an expected theme is absent", () => {
    const v = scoreSample(baseSample, makeResult("POSITIVE", ["staff"], 0.9));
    expect(v.pass).toBe(false);
    expect(v.themesMatch).toBe(false);
    expect(v.missingThemes).toEqual(["results"]);
  });

  test("exact mode rejects unexpected themes", () => {
    const v = scoreSample(
      { ...baseSample, expectedThemesMode: "exact" },
      makeResult("POSITIVE", ["staff", "results", "atmosphere"], 0.9),
    );
    expect(v.pass).toBe(false);
    expect(v.unexpectedThemes).toEqual(["atmosphere"]);
  });

  test("confidence below minConfidence fails", () => {
    const v = scoreSample(
      baseSample,
      makeResult("POSITIVE", ["staff", "results"], 0.5),
    );
    expect(v.pass).toBe(false);
    expect(v.confidenceInRange).toBe(false);
  });

  test("confidence above maxConfidence fails", () => {
    const v = scoreSample(
      { ...baseSample, minConfidence: undefined, maxConfidence: 0.5 },
      makeResult("POSITIVE", ["staff", "results"], 0.9),
    );
    expect(v.pass).toBe(false);
    expect(v.confidenceInRange).toBe(false);
  });

  test("empty expected themes + empty actual themes = themes match", () => {
    const v = scoreSample(
      {
        ...baseSample,
        expectedThemes: [],
        minConfidence: undefined,
      },
      makeResult("POSITIVE", [], 0.9),
    );
    expect(v.themesMatch).toBe(true);
  });
});

describe("evaluateSentimentCorpus", () => {
  test("aggregates passed/failed counts across all samples", async () => {
    // Stub classifier that returns the expected sentiment + themes for
    // every sample. Should pass every sample.
    const oracle: Classifier = async (input) => {
      const sample = loadCorpus().samples.find(
        (s) => s.stars === input.stars && s.text === input.text,
      );
      if (!sample) throw new Error(`no sample for input: ${input.text}`);
      return makeResult(
        sample.expectedSentiment,
        sample.expectedThemes,
        // Pick a confidence safely inside the (min, max) window if any.
        sample.minConfidence !== undefined && sample.maxConfidence !== undefined
          ? (sample.minConfidence + sample.maxConfidence) / 2
          : sample.minConfidence !== undefined
            ? Math.min(sample.minConfidence + 0.05, 1)
            : sample.maxConfidence !== undefined
              ? Math.max(sample.maxConfidence - 0.05, 0)
              : 0.85,
      );
    };

    const report = await evaluateSentimentCorpus(oracle);
    expect(report.summary.passed).toBe(report.summary.totalSamples);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.errored).toBe(0);
    expect(report.summary.sentimentAccuracy).toBe(1);
    expect(report.summary.themesAccuracy).toBe(1);
  });

  test("classifier exception counts as errored, not as silent fail", async () => {
    const exploding: Classifier = async () => {
      throw new Error("api down");
    };
    const report = await evaluateSentimentCorpus(exploding);
    expect(report.summary.errored).toBe(report.summary.totalSamples);
    expect(report.summary.passed).toBe(0);
    expect(report.verdicts.every((v) => v.errorMessage === "api down")).toBe(
      true,
    );
  });

  test("partial failure produces a coherent summary", async () => {
    // Returns POSITIVE for every sample — only the actual POSITIVE
    // samples get sentimentMatch.
    const wrongly: Classifier = async () => makeResult("POSITIVE", [], 0.85);
    const report = await evaluateSentimentCorpus(wrongly);
    const positiveSamples = loadCorpus().samples.filter(
      (s) => s.expectedSentiment === "POSITIVE",
    ).length;
    const sentimentHits = report.verdicts.filter(
      (v) => v.sentimentMatch,
    ).length;
    expect(sentimentHits).toBe(positiveSamples);
    expect(report.summary.sentimentAccuracy).toBeCloseTo(
      positiveSamples / report.summary.totalSamples,
      5,
    );
  });
});

describe("formatReport", () => {
  test("renders a non-empty multi-line report with summary + verdicts", async () => {
    const oracle: Classifier = async (input) =>
      makeResult(
        input.stars >= 4
          ? "POSITIVE"
          : input.stars === 3
            ? "NEUTRAL"
            : "NEGATIVE",
        [],
        0.85,
      );
    const report = await evaluateSentimentCorpus(oracle);
    const text = formatReport(report);
    expect(text).toContain("Sentiment corpus eval");
    expect(text).toMatch(/Samples: \d+/);
    expect(text).toMatch(/Sentiment accuracy:/);
  });
});
