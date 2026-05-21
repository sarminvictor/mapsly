// Sentiment classifier eval harness · D.6
//
// Loads the golden corpus from __fixtures__/sentiment-corpus.json, runs an
// arbitrary classifier function against each sample, and aggregates accuracy
// metrics so we can spot prompt regressions across model swaps (D.8) without
// re-reading every sample by hand.
//
// Two consumers:
//
//   1. scripts/eval-sentiment.ts — invoked manually as
//      `pnpm eval:sentiment` against the real OpenAI API to validate
//      prompt quality after a change.
//   2. services/ai/__tests__/eval-sentiment.test.ts — invoked in CI with a
//      stubbed classifier to validate that the harness itself scores
//      correctly. The real model is never called in tests (cost discipline
//      + determinism).
//
// The corpus expectedThemes field uses subset semantics: a sample passes if
// every expected theme appears in the model's output. The model is allowed
// to add additional ALLOWED_THEMES tags — we only fail on missing primaries.
// This avoids brittle "exact set" tests since theme selection is naturally
// noisy across runs.

import { z } from "zod";
import corpusJson from "@/services/ai/__fixtures__/sentiment-corpus.json";
import { ALLOWED_THEMES } from "@/services/ai/sentiment";
import type {
  ClassifyReviewInput,
  ClassifyReviewResult,
  ReviewTheme,
  Sentiment,
} from "@/services/ai/sentiment";

export type Classifier = (
  input: ClassifyReviewInput,
) => Promise<ClassifyReviewResult>;

// ---- Zod schema for the corpus -----------------------------------------
//
// Per .claude/rules/conventions.md "Validate with Zod at every boundary."
// We import the corpus as JSON (typed as `any` by tsc's resolveJsonModule
// inference); validating it via Zod inside loadCorpus replaces the bad
// `as unknown as` cast pattern with a real runtime + compile-time check
// that the imported JSON matches our SentimentCorpusSample shape, with
// structural rules baked in:
//
//   - theme strings are constrained to ALLOWED_THEMES
//   - sentiment is the 3-value enum
//   - stars is integer 1..5
//   - sample ids are unique across the corpus (custom refinement)

const SentimentEnum = z.enum(["POSITIVE", "NEUTRAL", "NEGATIVE"]);
const ThemeEnum = z.enum(ALLOWED_THEMES);

export const SentimentCorpusSampleSchema = z.object({
  id: z.string().min(1),
  stars: z.number().int().min(1).max(5),
  text: z.string(),
  language: z.string().optional(),
  expectedSentiment: SentimentEnum,
  expectedThemes: z.array(ThemeEnum),
  expectedThemesMode: z.enum(["subset", "exact"]).optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  maxConfidence: z.number().min(0).max(1).optional(),
  notes: z.string().optional(),
});
export type SentimentCorpusSample = z.infer<typeof SentimentCorpusSampleSchema>;

export const SentimentCorpusSchema = z
  .object({
    version: z.number().int().min(1),
    description: z.string(),
    samples: z.array(SentimentCorpusSampleSchema).min(1),
  })
  .superRefine((c, ctx) => {
    const seen = new Set<string>();
    for (const s of c.samples) {
      if (seen.has(s.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate sample id: ${s.id}`,
          path: ["samples"],
        });
        return;
      }
      seen.add(s.id);
    }
  });
export type SentimentCorpus = z.infer<typeof SentimentCorpusSchema>;

// ---- Verdict shapes ----------------------------------------------------

export interface SampleVerdict {
  id: string;
  pass: boolean;
  sentimentMatch: boolean;
  themesMatch: boolean;
  confidenceInRange: boolean;
  expected: {
    sentiment: Sentiment;
    themes: ReviewTheme[];
  };
  actual: {
    sentiment: Sentiment;
    themes: ReviewTheme[];
    confidence: number;
    summary: string;
  };
  missingThemes: ReviewTheme[];
  unexpectedThemes: ReviewTheme[];
  errorMessage?: string;
}

export interface EvalSummary {
  totalSamples: number;
  passed: number;
  failed: number;
  errored: number;
  sentimentAccuracy: number;
  themesAccuracy: number;
  confidenceMeanReported: number;
}

export interface EvalReport {
  summary: EvalSummary;
  verdicts: SampleVerdict[];
}

/** Pure-function loader for the bundled corpus. Validates via Zod so any
 *  drift in the JSON file (renamed enum, unknown theme, duplicate id) fails
 *  loudly with a precise error. */
export function loadCorpus(): SentimentCorpus {
  return SentimentCorpusSchema.parse(corpusJson);
}

/** Compare two theme sets per the sample's mode and return missing/extra. */
function diffThemes(
  expected: ReviewTheme[],
  actual: ReviewTheme[],
  mode: "subset" | "exact",
): { match: boolean; missing: ReviewTheme[]; unexpected: ReviewTheme[] } {
  const actualSet = new Set(actual);
  const missing = expected.filter((t) => !actualSet.has(t));
  if (mode === "exact") {
    const expectedSet = new Set(expected);
    const unexpected = actual.filter((t) => !expectedSet.has(t));
    return {
      match: missing.length === 0 && unexpected.length === 0,
      missing,
      unexpected,
    };
  }
  return { match: missing.length === 0, missing, unexpected: [] };
}

function inRange(
  value: number,
  min: number | undefined,
  max: number | undefined,
): boolean {
  if (min !== undefined && value < min) return false;
  if (max !== undefined && value > max) return false;
  return true;
}

/**
 * Score a single sample against the classifier's output. Pure function —
 * useful in tests where you want to feed in a known ClassifyReviewResult
 * without invoking the harness's classifier-iteration logic.
 */
export function scoreSample(
  sample: SentimentCorpusSample,
  actual: ClassifyReviewResult,
): SampleVerdict {
  const sentimentMatch = actual.sentiment === sample.expectedSentiment;
  const themeDiff = diffThemes(
    sample.expectedThemes,
    actual.themes,
    sample.expectedThemesMode ?? "subset",
  );
  const confidenceInRange = inRange(
    actual.confidence,
    sample.minConfidence,
    sample.maxConfidence,
  );
  return {
    id: sample.id,
    pass: sentimentMatch && themeDiff.match && confidenceInRange,
    sentimentMatch,
    themesMatch: themeDiff.match,
    confidenceInRange,
    expected: {
      sentiment: sample.expectedSentiment,
      themes: sample.expectedThemes,
    },
    actual: {
      sentiment: actual.sentiment,
      themes: actual.themes,
      confidence: actual.confidence,
      summary: actual.summary,
    },
    missingThemes: themeDiff.missing,
    unexpectedThemes: themeDiff.unexpected,
  };
}

/**
 * Run the supplied classifier across every sample in the corpus and produce
 * an aggregate report. The classifier is called serially to avoid surprising
 * a rate-limited API; corpora at this size (20 samples) finish in a few
 * seconds.
 *
 * `withCronRun` (or equivalent CronRun context) must wrap the call when the
 * classifier touches the cost-counter — `services/ai/sentiment.ts` does.
 * For mocked classifiers in tests, no wrap is needed.
 */
export async function evaluateSentimentCorpus(
  classifier: Classifier,
  options: { corpus?: SentimentCorpus } = {},
): Promise<EvalReport> {
  const c = options.corpus ?? loadCorpus();
  const verdicts: SampleVerdict[] = [];
  let errored = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;

  for (const sample of c.samples) {
    try {
      const result = await classifier({
        stars: sample.stars,
        text: sample.text,
        language: sample.language,
      });
      const verdict = scoreSample(sample, result);
      verdicts.push(verdict);
      confidenceSum += result.confidence;
      confidenceCount += 1;
    } catch (err) {
      errored += 1;
      verdicts.push({
        id: sample.id,
        pass: false,
        sentimentMatch: false,
        themesMatch: false,
        confidenceInRange: false,
        expected: {
          sentiment: sample.expectedSentiment,
          themes: sample.expectedThemes,
        },
        actual: {
          sentiment: "NEUTRAL",
          themes: [],
          confidence: 0,
          summary: "",
        },
        missingThemes: sample.expectedThemes,
        unexpectedThemes: [],
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const sentimentHits = verdicts.filter((v) => v.sentimentMatch).length;
  const themeHits = verdicts.filter((v) => v.themesMatch).length;
  const passed = verdicts.filter((v) => v.pass).length;

  const summary: EvalSummary = {
    totalSamples: c.samples.length,
    passed,
    failed: verdicts.length - passed - errored,
    errored,
    sentimentAccuracy: sentimentHits / c.samples.length,
    themesAccuracy: themeHits / c.samples.length,
    confidenceMeanReported:
      confidenceCount > 0 ? confidenceSum / confidenceCount : 0,
  };

  return { summary, verdicts };
}

/** Pretty-printed multi-line report for the CLI. Plain text — no ANSI. */
export function formatReport(report: EvalReport): string {
  const { summary, verdicts } = report;
  const lines: string[] = [];
  lines.push("");
  lines.push("=".repeat(60));
  lines.push(" Sentiment corpus eval");
  lines.push("=".repeat(60));
  lines.push(
    `Samples: ${summary.totalSamples} · passed ${summary.passed} · failed ${summary.failed} · errored ${summary.errored}`,
  );
  lines.push(
    `Sentiment accuracy: ${(summary.sentimentAccuracy * 100).toFixed(1)}%`,
  );
  lines.push(`Themes accuracy:    ${(summary.themesAccuracy * 100).toFixed(1)}%`);
  lines.push(
    `Mean confidence:    ${(summary.confidenceMeanReported * 100).toFixed(1)}%`,
  );
  lines.push("");
  lines.push("-".repeat(60));
  for (const v of verdicts) {
    const tag = v.pass ? "PASS" : v.errorMessage ? "ERROR" : "FAIL";
    lines.push(
      `[${tag}] ${v.id} · sentiment=${v.actual.sentiment} (exp ${v.expected.sentiment}) · conf=${v.actual.confidence.toFixed(2)}`,
    );
    if (v.errorMessage) {
      lines.push(`       error: ${v.errorMessage}`);
      continue;
    }
    if (!v.themesMatch) {
      if (v.missingThemes.length > 0) {
        lines.push(`       missing themes: ${v.missingThemes.join(", ")}`);
      }
      if (v.unexpectedThemes.length > 0) {
        lines.push(
          `       unexpected themes: ${v.unexpectedThemes.join(", ")}`,
        );
      }
    }
    if (!v.confidenceInRange) {
      lines.push(`       confidence out of range: ${v.actual.confidence}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}
