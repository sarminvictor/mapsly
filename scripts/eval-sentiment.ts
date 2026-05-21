#!/usr/bin/env tsx
// scripts/eval-sentiment.ts · D.6 · sentiment classifier golden-corpus eval.
//
// Runs `services/ai/sentiment.classifyReview` against the bundled 20-sample
// corpus and prints accuracy metrics. Intended as a manual smoke after a
// prompt change or model swap (D.8) — NOT a CI gate, because real model
// outputs are non-deterministic and the per-call cost adds up.
//
// Usage:
//   pnpm eval:sentiment                  # dry-run, uses a stubbed classifier
//   pnpm eval:sentiment --live           # calls the real OpenAI API
//   pnpm eval:sentiment --live --model gpt-5.4-mini    # compare another model
//   pnpm eval:sentiment --threshold 0.85 # exit 1 if sentiment accuracy < threshold
//
// Cost guard: --live mode opens a CronRun via withCronRun() so every call is
// attributable. The dry-run path uses a stubbed classifier that consults the
// corpus's `expected*` fields — useful to validate the harness end-to-end
// without burning API quota.
//
// Required env (only in --live):
//   OPENAI_API_KEY       — your OpenAI secret. Read at first call, not at boot.
//   DATABASE_URL         — for the CronRun row (cost-counter invariant).

import { parseArgs } from "node:util";

import { withCronRun } from "@/lib/cost/cost-counter";
import {
  evaluateSentimentCorpus,
  formatReport,
  loadCorpus,
  type Classifier,
} from "@/services/ai/eval-sentiment";
import {
  classifyReviewUncached,
  type ClassifyReviewInput,
  type ClassifyReviewResult,
} from "@/services/ai/sentiment";
import { PRICING, type SupportedModel } from "@/services/ai/pricing";

const { values } = parseArgs({
  options: {
    live: { type: "boolean", default: false },
    model: { type: "string" },
    threshold: { type: "string" },
    help: { type: "boolean", default: false },
  },
  allowPositionals: false,
});

if (values.help) {
  console.log(
    "Usage: pnpm eval:sentiment [--live] [--model <id>] [--threshold <0..1>]",
  );
  process.exit(0);
}

const live = values.live === true;
const modelOverride = parseModelOverride(values.model);
const sentimentAccuracyThreshold =
  typeof values.threshold === "string"
    ? Number.parseFloat(values.threshold)
    : 0;

if (
  Number.isNaN(sentimentAccuracyThreshold) ||
  sentimentAccuracyThreshold < 0 ||
  sentimentAccuracyThreshold > 1
) {
  console.error(`--threshold must be a number 0..1, got ${values.threshold}`);
  process.exit(2);
}

/** Validate --model against the SupportedModel union before letting it
 *  reach the OpenAI call. Without this guard a typo (`--model gpt-99`)
 *  would surface as an opaque API error after we'd already paid for the
 *  request. PRICING is the source of truth for SupportedModel. */
function parseModelOverride(raw: unknown): SupportedModel | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string") {
    console.error(`--model must be a string, got ${typeof raw}`);
    process.exit(2);
  }
  const supported = Object.keys(PRICING);
  if (!supported.includes(raw)) {
    console.error(
      `--model '${raw}' is not in PRICING (supported: ${supported.join(", ")})`,
    );
    process.exit(2);
  }
  return raw as SupportedModel;
}

async function main(): Promise<void> {
  const corpus = loadCorpus();
  console.log(
    `[eval-sentiment] Loaded corpus v${corpus.version} · ${corpus.samples.length} samples · live=${live}${modelOverride ? ` · model=${modelOverride}` : ""}`,
  );

  const classifier: Classifier = live
    ? (input) =>
        classifyReviewUncached({
          ...input,
          ...(modelOverride ? { model: modelOverride } : {}),
        })
    : makeStubClassifier();

  const job = `eval:sentiment:${live ? "live" : "dryrun"}${modelOverride ? `:${modelOverride}` : ""}`;
  const report = await withCronRun(job, () =>
    evaluateSentimentCorpus(classifier, { corpus }),
  );

  console.log(formatReport(report));

  if (
    sentimentAccuracyThreshold > 0 &&
    report.summary.sentimentAccuracy < sentimentAccuracyThreshold
  ) {
    console.error(
      `[eval-sentiment] FAIL · sentiment accuracy ${(
        report.summary.sentimentAccuracy * 100
      ).toFixed(1)}% < threshold ${(sentimentAccuracyThreshold * 100).toFixed(1)}%`,
    );
    process.exit(1);
  }
}

/**
 * Dry-run stub. Reads the expected outputs straight from the corpus, so the
 * harness wiring can be validated without spending a cent on the API. Useful
 * for "does my new corpus sample run through the harness?" checks before
 * paying for a --live pass.
 *
 * The key is `JSON.stringify({stars,text,language})` rather than a simpler
 * `${stars} ${text}` concat — that avoids a silent collision if two samples
 * share the same (stars, "") combo (the corpus has multiple short/empty-text
 * samples and the prompt is the differentiator).
 */
function makeStubClassifier(): Classifier {
  const corpus = loadCorpus();
  const byKey = new Map<string, { result: ClassifyReviewResult }>();
  for (const s of corpus.samples) {
    const key = JSON.stringify({
      stars: s.stars,
      text: s.text,
      language: s.language,
    });
    byKey.set(key, {
      result: {
        sentiment: s.expectedSentiment,
        themes: s.expectedThemes,
        summary: s.notes?.slice(0, 120) ?? "stub",
        confidence:
          s.minConfidence !== undefined && s.maxConfidence !== undefined
            ? (s.minConfidence + s.maxConfidence) / 2
            : s.minConfidence !== undefined
              ? Math.min(s.minConfidence + 0.05, 1)
              : s.maxConfidence !== undefined
                ? Math.max(s.maxConfidence - 0.05, 0)
                : 0.85,
      },
    });
  }
  return async (input: ClassifyReviewInput) => {
    const key = JSON.stringify({
      stars: input.stars,
      text: input.text,
      language: input.language,
    });
    const hit = byKey.get(key);
    if (!hit) {
      throw new Error(
        `[eval-sentiment stub] no corpus sample matches input (stars=${input.stars}, text=${input.text.slice(0, 60)}...)`,
      );
    }
    return hit.result;
  };
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
