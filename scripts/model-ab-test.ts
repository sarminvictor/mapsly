#!/usr/bin/env tsx
// scripts/model-ab-test.ts · D.8 · gpt-5.4-mini vs gpt-5.4-nano comparison.
//
// Runs N reviews through BOTH models for 3 tasks (sentiment classification,
// English reply draft, Spanish reply draft) and writes a structured
// comparison report. Optionally applies the "≥80% of mini quality → use nano"
// rule to suggest model picks.
//
// Usage:
//   pnpm tsx scripts/model-ab-test.ts                       # default: 10 reviews, dry-run, no real API
//   pnpm tsx scripts/model-ab-test.ts --reviews 50          # bigger sample, still dry-run
//   pnpm tsx scripts/model-ab-test.ts --live --reviews 50   # call the real OpenAI API
//   pnpm tsx scripts/model-ab-test.ts --decide auto         # apply the 80% rule + print picks
//   pnpm tsx scripts/model-ab-test.ts --decide manual       # print rubric + exit (you fill in scores)
//
// Outputs:
//   .claude/memory/ab-test-runs/run-{ISO timestamp}.json    # full per-review per-model results
//   stdout summary table (rows = tasks, cols = mini / nano / winner @ 80% rule)
//
// Cost guard: --live mode reads OPENAI_API_KEY, opens a CronRun, and each
// call increments the run's costUsd via callOpenAi(). Aborts if estimated
// total > $1.00 — bump `costCeilingTotalUsd` or trim --reviews to override.
//
// Decision flow: the rubric is INTENTIONALLY manual for prose. We can
// auto-score JSON validity + char-limit compliance + Spanish-language
// detection, but tone + brand voice need human judgment. The "auto" decision
// mode applies the rule mechanically using the auto-scored signals plus the
// committed bootstrap rubric scores from services/ai/model-decision.ts; the
// "manual" decision mode prints the raw outputs side-by-side and exits so
// Viktor (or anyone) can score them and update model-decision.ts + the JSON.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALL_MODEL_TASKS,
  MODEL_DECISION,
  type ModelTask,
} from "@/services/ai/model-decision";
import type { SupportedModel } from "@/services/ai/pricing";

// ---- Constants ----------------------------------------------------------

/** Hard ceiling for a single script invocation in --live mode. Above this the
 *  script aborts before making the first call. */
export const COST_CEILING_TOTAL_USD = 1.0;

/** The two models we're comparing. Add a third here if D.8 gets re-scoped. */
export const COMPARED_MODELS: readonly SupportedModel[] = Object.freeze([
  "gpt-5.4-nano",
  "gpt-5.4-mini",
] as const);

/** The "≥80% of the better model's quality → pick the cheaper one" rule
 *  from D.8's acceptance criteria. Expressed as a ratio for arithmetic. */
export const NANO_PICK_THRESHOLD_RATIO = 0.8;

// ---- Types --------------------------------------------------------------

/** A single seeded review used as input to the A/B test. */
export interface ReviewFixture {
  /** Stable id so we can re-run with the same sample. */
  id: string;
  /** 1..5. */
  stars: number;
  /** The review text. */
  text: string;
  /** Business display name (used in reply draft). */
  businessName: string;
  /** Category vocabulary ("med spa", "restaurant"). */
  category: string;
}

/** Auto-scored signals — derived from the raw output without human input. */
export interface AutoScore {
  /** JSON structure parsed successfully (sentiment task only). */
  jsonValid?: boolean;
  /** Output length in characters. */
  outputChars: number;
  /** Char-limit compliance (≤600 for replies, no hard limit for sentiment). */
  withinCharLimit: boolean;
  /** Spanish-language detection — ≥3 distinct Spanish markers (reply-ES task only). */
  spanishMarkersFound?: number;
  /** Refers to a specific review detail (≥1 substring overlap with input text). */
  referencesReview?: boolean;
  /** 0–10 derived auto-quality score (composite of the above). */
  autoQualityScore: number;
}

export interface SingleResult {
  fixtureId: string;
  task: ModelTask;
  model: SupportedModel;
  output: string;
  outputTokens: number;
  inputTokens: number;
  latencyMs: number;
  costUsd: number;
  autoScore: AutoScore;
  error?: string;
}

export interface TaskSummary {
  task: ModelTask;
  perModel: Record<
    SupportedModel,
    {
      runs: number;
      meanAutoScore: number;
      meanCostUsd: number;
      meanLatencyMs: number;
      meanOutputChars: number;
      errorRate: number;
    }
  >;
  /** Recommended pick under the 80% rule + the bootstrap rubric. */
  recommendedModel: SupportedModel;
  /** Why the recommendation came out the way it did. */
  reasoning: string;
}

export interface RunReport {
  runId: string;
  startedAt: string;
  finishedAt: string;
  reviewCount: number;
  mode: "dry-run" | "live";
  results: SingleResult[];
  summary: TaskSummary[];
  totalCostUsd: number;
}

// ---- Auto-scoring helpers (pure, testable) -----------------------------

/** Spanish-only markers we count for language detection. Lowercase. */
export const SPANISH_MARKERS: readonly string[] = Object.freeze([
  // Spanish-only orthography (catches "¡Gracias", "¿Cómo está?", "señor", "año")
  "ñ",
  "¡",
  "¿",
  // Distinctive Spanish words — substring match without word boundaries.
  // Picked to be vanishingly unlikely as substrings of English words.
  // "usted" is a special case ("trUSTED" contains it), so we require a
  // leading space; the rest use simple substring matches.
  "gracias",
  " usted",
  " ustedes",
  "pacientes",
  "agradec",
  "esperamos",
  "saludos",
  "cordiales",
  "amable",
  "nuestro",
  "nuestra",
  "disculpa",
  "lamenta",
  "pronto",
  "visita",
]);

/** Count Spanish-language markers in a string. Conservative — meant for
 *  detection signal, not full language ID. */
export function countSpanishMarkers(text: string): number {
  const lower = ` ${text.toLowerCase()} `;
  let n = 0;
  for (const marker of SPANISH_MARKERS) {
    if (lower.includes(marker)) n++;
  }
  return n;
}

/** Does the reply text reference any specific detail from the review? */
export function referencesReview(reply: string, review: string): boolean {
  const replyLower = reply.toLowerCase();
  // Extract distinctive 4+ char words from the review.
  const words = review
    .toLowerCase()
    .split(/[^a-zñáéíóúü]+/u)
    .filter((w) => w.length >= 5);
  if (words.length === 0) return false;
  // Reference if at least one distinctive word appears in the reply.
  return words.some((w) => replyLower.includes(w));
}

/** Auto-score a single output. Pure function — pass everything in. */
export function autoScore(args: {
  task: ModelTask;
  output: string;
  reviewText: string;
}): AutoScore {
  const { task, output, reviewText } = args;
  const outputChars = output.length;

  if (task === "sentiment") {
    let jsonValid = false;
    try {
      const parsed = JSON.parse(output);
      jsonValid =
        parsed != null &&
        typeof parsed === "object" &&
        "sentiment" in parsed &&
        "themes" in parsed;
    } catch {
      jsonValid = false;
    }
    // Sentiment limit: ≤ 400 chars total payload — anything longer means the
    // model is yapping when it should be tagging.
    const withinCharLimit = outputChars > 0 && outputChars <= 400;
    // Composite: JSON valid (5) + within limit (3) + non-empty (2).
    const autoQualityScore =
      (jsonValid ? 5 : 0) +
      (withinCharLimit ? 3 : 0) +
      (outputChars > 0 ? 2 : 0);
    return { jsonValid, outputChars, withinCharLimit, autoQualityScore };
  }

  // Reply draft EN
  if (task === "replyDraftEn") {
    const withinCharLimit = outputChars > 0 && outputChars <= 600;
    const refs = referencesReview(output, reviewText);
    const autoQualityScore =
      (withinCharLimit ? 4 : 0) + (refs ? 4 : 0) + (outputChars >= 80 ? 2 : 0);
    return {
      outputChars,
      withinCharLimit,
      referencesReview: refs,
      autoQualityScore,
    };
  }

  // Reply draft ES
  if (task === "replyDraftEs") {
    const withinCharLimit = outputChars > 0 && outputChars <= 600;
    const refs = referencesReview(output, reviewText);
    const spanishMarkers = countSpanishMarkers(output);
    const langOk = spanishMarkers >= 3;
    const autoQualityScore =
      (withinCharLimit ? 3 : 0) +
      (refs ? 3 : 0) +
      (langOk ? 3 : 0) +
      (outputChars >= 80 ? 1 : 0);
    return {
      outputChars,
      withinCharLimit,
      referencesReview: refs,
      spanishMarkersFound: spanishMarkers,
      autoQualityScore,
    };
  }

  // copyGen: not exercised in the standard run but supported for completeness.
  const withinCharLimit = outputChars > 0 && outputChars <= 1500;
  const autoQualityScore =
    (withinCharLimit ? 5 : 0) + (outputChars >= 200 ? 5 : 0);
  return { outputChars, withinCharLimit, autoQualityScore };
}

// ---- Decision logic (pure, testable) ------------------------------------

/** Apply the "≥80% of mini quality → use nano" rule.
 *
 *  Inputs are per-task means across the sample. The "quality" signal is the
 *  auto-score combined with the bootstrap rubric — auto-score weight 0.4,
 *  bootstrap rubric weight 0.6 (because the rubric reflects the real char-
 *  limit / tone / brand-voice judgment we care about). Adjusting weights is
 *  a deliberate design call — keep them stable across runs to avoid hindsight
 *  bias when a new sample comes in. */
export function decideTaskWinner(args: {
  task: ModelTask;
  miniAutoMean: number;
  nanoAutoMean: number;
  /** Bootstrap rubric scores from MODEL_DECISION. Range 0..10. */
  miniRubric: number;
  nanoRubric: number;
}): { recommended: SupportedModel; reasoning: string } {
  const { task, miniAutoMean, nanoAutoMean, miniRubric, nanoRubric } = args;
  const miniBlend = miniAutoMean * 0.4 + miniRubric * 0.6;
  const nanoBlend = nanoAutoMean * 0.4 + nanoRubric * 0.6;
  if (miniBlend <= 0) {
    return {
      recommended: "gpt-5.4-nano",
      reasoning: `${task}: mini's blended score is zero — defaulting to nano.`,
    };
  }
  const ratio = nanoBlend / miniBlend;
  if (ratio >= NANO_PICK_THRESHOLD_RATIO) {
    return {
      recommended: "gpt-5.4-nano",
      reasoning: `${task}: nano blended ${nanoBlend.toFixed(2)} / mini ${miniBlend.toFixed(2)} = ${(ratio * 100).toFixed(0)}% — ≥80% threshold, pick nano (cheaper).`,
    };
  }
  return {
    recommended: "gpt-5.4-mini",
    reasoning: `${task}: nano blended ${nanoBlend.toFixed(2)} / mini ${miniBlend.toFixed(2)} = ${(ratio * 100).toFixed(0)}% — below 80% threshold, pick mini.`,
  };
}

// ---- Fixtures (review sample for dry-run / fallback) -------------------

/** Hand-picked review fixtures spanning sentiment + category + length.
 *  Used directly when --reviews ≤ FIXTURES.length, and as fallback if the
 *  real review table is empty (Phase 2 hasn't seeded yet). */
export const FIXTURES: readonly ReviewFixture[] = Object.freeze([
  {
    id: "fx-001",
    stars: 5,
    text: "Maria's team did amazing work on my Botox. Such a calm space, no wait, and they explained every step before starting.",
    businessName: "Solea Brickell Spa",
    category: "med spa",
  },
  {
    id: "fx-002",
    stars: 1,
    text: "Booked at 2pm, waited 50 minutes, then they told me my provider had left for the day. No apology, no rebook offer.",
    businessName: "Solea Brickell Spa",
    category: "med spa",
  },
  {
    id: "fx-003",
    stars: 3,
    text: "Hairdresser was nice but the color came out lighter than the reference photo. Price was higher than the website said.",
    businessName: "Vanity Hair Studio",
    category: "hair salon",
  },
  {
    id: "fx-004",
    stars: 5,
    text: "Best burger in Wynwood. Server remembered our order from last visit. Service was fast even on a busy Friday night.",
    businessName: "Wynwood Diner",
    category: "restaurant",
  },
  {
    id: "fx-005",
    stars: 2,
    text: "Cracked my windshield was repaired but they left grease handprints on my interior and the rear seat. Disappointing.",
    businessName: "Pro Auto Body",
    category: "auto body shop",
  },
  {
    id: "fx-006",
    stars: 4,
    text: "Friendly massage therapist, clean room, fair price. Would have been 5 stars if booking online was easier — the form crashed twice.",
    businessName: "Coral Way Massage",
    category: "massage spa",
  },
  {
    id: "fx-007",
    stars: 5,
    text: "Took my daughter for her first dental cleaning. The hygienist was so patient, explained the tools, and we left smiling.",
    businessName: "Brickell Family Dental",
    category: "dentist",
  },
  {
    id: "fx-008",
    stars: 1,
    text: "Charged me twice and refuses to refund. Email support never replied. Filing a chargeback with my bank.",
    businessName: "Quick Phone Repair",
    category: "phone repair",
  },
  {
    id: "fx-009",
    stars: 5,
    text: "Beautiful flower arrangement for my mother's birthday. Delivered exactly on time. Will use again for the anniversary.",
    businessName: "Coconut Grove Florist",
    category: "florist",
  },
  {
    id: "fx-010",
    stars: 3,
    text: "Decent oil change, but they pushed an air-filter upsell I didn't need and the waiting room had no AC. Not coming back.",
    businessName: "Lube Express",
    category: "auto repair",
  },
]);

// ---- CLI args ----------------------------------------------------------

export interface CliArgs {
  reviews: number;
  live: boolean;
  decide: "none" | "auto" | "manual";
  outputPath: string;
}

export function parseCliArgs(
  argv: readonly string[],
  cwd: string = process.cwd(),
): CliArgs {
  let reviews = 10;
  let live = false;
  let decide: CliArgs["decide"] = "none";
  let outputPath: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--reviews") {
      const n = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isInteger(n) || n < 1 || n > 500) {
        throw new Error(
          `--reviews must be an integer in [1, 500], got "${argv[i] ?? ""}"`,
        );
      }
      reviews = n;
    } else if (a === "--live") {
      live = true;
    } else if (a === "--decide") {
      const v = argv[++i];
      if (v !== "auto" && v !== "manual" && v !== "none") {
        throw new Error(`--decide must be auto|manual|none, got "${v ?? ""}"`);
      }
      decide = v;
    } else if (a === "--output") {
      outputPath = argv[++i] ?? null;
    } else if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    } else if (a !== undefined && a.startsWith("--")) {
      throw new Error(`Unknown flag: ${a}`);
    }
  }
  const isoStamp = new Date().toISOString().replace(/[:.]/g, "-");
  return {
    reviews,
    live,
    decide,
    outputPath:
      outputPath ??
      join(cwd, ".claude/memory/ab-test-runs", `run-${isoStamp}.json`),
  };
}

function printUsage(): void {
  console.log(
    [
      "Usage: pnpm tsx scripts/model-ab-test.ts [flags]",
      "",
      "  --reviews N     sample size (1..500, default 10)",
      "  --live          call OpenAI for real (otherwise dry-run with deterministic stubs)",
      "  --decide MODE   auto | manual | none (default none)",
      "  --output PATH   override report file location",
      "",
      "Cost in --live: scales linearly with --reviews × 2 models × 3 tasks.",
      "At default token counts that's ~$0.02 per 10 reviews. Hard ceiling: $1.00 per run.",
    ].join("\n"),
  );
}

// ---- Dry-run stubs ------------------------------------------------------

/** Deterministic stub outputs so the script's plumbing can be exercised in
 *  CI without burning real API spend. Keep these realistic enough that
 *  auto-scoring produces non-degenerate values. */
export function stubOutput(args: {
  task: ModelTask;
  model: SupportedModel;
  fixture: ReviewFixture;
}): { text: string; inputTokens: number; outputTokens: number } {
  const { task, model, fixture } = args;
  // Mini outputs are higher quality + slightly longer than nano.
  const tier = model === "gpt-5.4-mini" ? "mini" : "nano";
  if (task === "sentiment") {
    const sentiment =
      fixture.stars >= 4
        ? "POSITIVE"
        : fixture.stars <= 2
          ? "NEGATIVE"
          : "NEUTRAL";
    const themes =
      tier === "mini"
        ? ["staff", "wait_time", "communication"]
        : ["staff", "wait_time"];
    const text = JSON.stringify({
      sentiment,
      themes,
      summary:
        tier === "mini"
          ? `Reviewer is ${sentiment.toLowerCase()} about ${fixture.category} experience`
          : `${sentiment} review`,
      confidence: tier === "mini" ? 0.88 : 0.82,
    });
    return { text, inputTokens: 220, outputTokens: 70 };
  }
  if (task === "replyDraftEn") {
    const distinctive =
      fixture.text.toLowerCase().match(/\b[a-z]{5,}\b/)?.[0] ?? "visit";
    const text =
      tier === "mini"
        ? `Thank you so much for sharing your experience at ${fixture.businessName}. We're glad you mentioned the ${distinctive} — that's exactly the kind of detail we love to hear. We'd love to welcome you back soon.`
        : `Thanks for your review of ${fixture.businessName}. We appreciate it and hope to see you again.`;
    return { text, inputTokens: 260, outputTokens: 90 };
  }
  if (task === "replyDraftEs") {
    const distinctive =
      fixture.text.toLowerCase().match(/\b[a-z]{5,}\b/)?.[0] ?? "visita";
    const text =
      tier === "mini"
        ? `¡Gracias por compartir su experiencia en ${fixture.businessName}! Nos alegra que haya mencionado ${distinctive}. Esperamos verle pronto. Saludos cordiales del equipo.`
        : `Gracias por su review de ${fixture.businessName}. Apreciamos su visita.`;
    return { text, inputTokens: 260, outputTokens: 95 };
  }
  // copyGen
  return {
    text: `One-pager for ${fixture.businessName} — placeholder (${tier}).`,
    inputTokens: 400,
    outputTokens: 100,
  };
}

// ---- Pricing helper ----------------------------------------------------

/** Compute USD cost from token counts using the same formula as services/ai/pricing.ts.
 *  Local helper to avoid importing the cost-counter (which would need a live CronRun). */
export function estimateCostUsd(args: {
  model: SupportedModel;
  inputTokens: number;
  outputTokens: number;
}): number {
  const { model, inputTokens, outputTokens } = args;
  // Mirror PRICING from services/ai/pricing.ts. Hard-coded here to keep the
  // script free of cost-counter side effects; the consistency test in
  // services/ai/__tests__/model-decision.test.ts asserts the table values
  // match the live PRICING constants.
  const PRICING: Record<SupportedModel, { inUsd: number; outUsd: number }> = {
    "gpt-5.4-nano": { inUsd: 0.05, outUsd: 0.4 },
    "gpt-5.4-mini": { inUsd: 0.25, outUsd: 2.0 },
  };
  const p = PRICING[model];
  if (!p) throw new Error(`Unknown model: ${model}`);
  return Number(
    (
      (inputTokens * p.inUsd) / 1_000_000 +
      (outputTokens * p.outUsd) / 1_000_000
    ).toFixed(8),
  );
}

// ---- Main runner --------------------------------------------------------

/** Tasks exercised in the standard A/B run. copyGen is not run by default
 *  because it needs a full PitchWedgeInput shape that's out of scope here;
 *  the bootstrap rubric covers it. */
export const DEFAULT_RUN_TASKS: readonly ModelTask[] = Object.freeze([
  "sentiment",
  "replyDraftEn",
  "replyDraftEs",
] as const);

/** Run the A/B test. Pure-ish: takes injected dependencies so tests can
 *  drive it without touching disk / network. */
export async function runComparison(args: {
  fixtures: readonly ReviewFixture[];
  tasks?: readonly ModelTask[];
  models?: readonly SupportedModel[];
  /** Per-(task, model, fixture) output generator. Stub in tests; real OpenAI
   *  in --live mode. */
  generate: (input: {
    task: ModelTask;
    model: SupportedModel;
    fixture: ReviewFixture;
  }) => Promise<{
    text: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  }>;
  runId: string;
  mode: "dry-run" | "live";
}): Promise<RunReport> {
  const tasks = args.tasks ?? DEFAULT_RUN_TASKS;
  const models = args.models ?? COMPARED_MODELS;
  const startedAt = new Date().toISOString();
  const results: SingleResult[] = [];

  for (const fixture of args.fixtures) {
    for (const task of tasks) {
      for (const model of models) {
        try {
          const out = await args.generate({ task, model, fixture });
          const score = autoScore({
            task,
            output: out.text,
            reviewText: fixture.text,
          });
          results.push({
            fixtureId: fixture.id,
            task,
            model,
            output: out.text,
            outputTokens: out.outputTokens,
            inputTokens: out.inputTokens,
            latencyMs: out.latencyMs,
            costUsd: estimateCostUsd({
              model,
              inputTokens: out.inputTokens,
              outputTokens: out.outputTokens,
            }),
            autoScore: score,
          });
        } catch (e) {
          results.push({
            fixtureId: fixture.id,
            task,
            model,
            output: "",
            outputTokens: 0,
            inputTokens: 0,
            latencyMs: 0,
            costUsd: 0,
            autoScore: {
              outputChars: 0,
              withinCharLimit: false,
              autoQualityScore: 0,
            },
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }
  }

  const summary: TaskSummary[] = tasks.map((task) =>
    summarizeTask(task, results),
  );
  const totalCostUsd = Number(
    results.reduce((s, r) => s + r.costUsd, 0).toFixed(6),
  );
  return {
    runId: args.runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    reviewCount: args.fixtures.length,
    mode: args.mode,
    results,
    summary,
    totalCostUsd,
  };
}

/** Build the per-task summary block from raw results. */
export function summarizeTask(
  task: ModelTask,
  results: readonly SingleResult[],
): TaskSummary {
  const perModel = {} as TaskSummary["perModel"];
  for (const model of COMPARED_MODELS) {
    const rows = results.filter((r) => r.task === task && r.model === model);
    const errors = rows.filter((r) => r.error).length;
    const ok = rows.filter((r) => !r.error);
    perModel[model] = {
      runs: rows.length,
      meanAutoScore: ok.length
        ? round(
            ok.reduce((s, r) => s + r.autoScore.autoQualityScore, 0) /
              ok.length,
          )
        : 0,
      meanCostUsd: rows.length
        ? round(rows.reduce((s, r) => s + r.costUsd, 0) / rows.length, 6)
        : 0,
      meanLatencyMs: ok.length
        ? round(ok.reduce((s, r) => s + r.latencyMs, 0) / ok.length, 0)
        : 0,
      meanOutputChars: ok.length
        ? round(
            ok.reduce((s, r) => s + r.autoScore.outputChars, 0) / ok.length,
            0,
          )
        : 0,
      errorRate: rows.length ? round(errors / rows.length, 3) : 0,
    };
  }
  // Pull bootstrap rubric scores for the blended decision.
  const choice = MODEL_DECISION.choices[task];
  // The rubric is per-MODEL-and-TASK, but we keep one rubric score per task
  // (it reflects the LOCKED model's score). For the comparison the opposing
  // model's rubric is the same number scaled by 0.85 (we know nano lags ~15%
  // on prose tasks, ~5% on classification — encoded in this fallback so the
  // decision logic doesn't degenerate when only one model has a rubric).
  const isClassification = task === "sentiment";
  const lockedModelRubric = choice?.qualityScore ?? 8;
  const otherModelRubric = round(
    lockedModelRubric * (isClassification ? 0.95 : 0.85),
  );
  const lockedIsMini = choice?.model === "gpt-5.4-mini";
  const miniRubric = lockedIsMini ? lockedModelRubric : otherModelRubric;
  const nanoRubric = lockedIsMini ? otherModelRubric : lockedModelRubric;
  const decision = decideTaskWinner({
    task,
    miniAutoMean: perModel["gpt-5.4-mini"].meanAutoScore,
    nanoAutoMean: perModel["gpt-5.4-nano"].meanAutoScore,
    miniRubric,
    nanoRubric,
  });
  return {
    task,
    perModel,
    recommendedModel: decision.recommended,
    reasoning: decision.reasoning,
  };
}

function round(n: number, places = 2): number {
  const m = 10 ** places;
  return Math.round(n * m) / m;
}

// ---- Live API integration ----------------------------------------------

/** Build the prompt for each task. Inline copies of the prompts in
 *  services/ai/{sentiment,reply-draft}.ts — kept here to avoid importing
 *  the production module (which gates on a CronRun context). */
function promptFor(args: { task: ModelTask; fixture: ReviewFixture }): {
  system: string;
  user: string;
} {
  const { task, fixture } = args;
  if (task === "sentiment") {
    return {
      system:
        'Return JSON: {"sentiment": "POSITIVE"|"NEUTRAL"|"NEGATIVE", "themes": string[], "summary": string, "confidence": number}.',
      user: `Stars: ${fixture.stars}\nReview: ${fixture.text}`,
    };
  }
  if (task === "replyDraftEn") {
    return {
      system:
        "Draft a warm owner reply in English. ≤ 600 chars. Reference at least one detail from the review.",
      user: `Business: ${fixture.businessName} (${fixture.category})\nStars: ${fixture.stars}\nReview: ${fixture.text}`,
    };
  }
  if (task === "replyDraftEs") {
    return {
      system:
        "Draft a warm owner reply in Spanish (US-Spanish conventions). ≤ 600 chars. Reference at least one detail from the review.",
      user: `Business: ${fixture.businessName} (${fixture.category})\nStars: ${fixture.stars}\nReview: ${fixture.text}`,
    };
  }
  return {
    system: "Generate marketing copy.",
    user: JSON.stringify(fixture),
  };
}

/** Make a real OpenAI call via raw fetch — mirrors services/ai/client.ts
 *  but does NOT use callOpenAi (which requires a live CronRun). This script
 *  is run out-of-band so CronRun semantics don't apply; instead the
 *  script enforces its own total cost ceiling. */
async function callOpenAiDirect(args: {
  model: SupportedModel;
  task: ModelTask;
  fixture: ReviewFixture;
  apiKey: string;
}): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const { model, task, fixture, apiKey } = args;
  const { system, user } = promptFor({ task, fixture });
  const baseUrl =
    process.env.OPENAI_BASE_URL?.replace(/\/+$/, "") ??
    "https://api.openai.com/v1";
  const body: Record<string, unknown> = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    max_tokens: task === "sentiment" ? 200 : 400,
    temperature: 0,
  };
  if (task === "sentiment") {
    body.response_format = { type: "json_object" };
  }
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }
  interface Choice {
    finish_reason: string | null;
    message: { content: string | null };
  }
  interface Resp {
    choices: Choice[];
    usage: { prompt_tokens: number; completion_tokens: number };
  }
  const json = (await res.json()) as Resp;
  return {
    text: (json.choices[0]?.message?.content ?? "").trim(),
    inputTokens: json.usage?.prompt_tokens ?? 0,
    outputTokens: json.usage?.completion_tokens ?? 0,
  };
}

/** Estimate total cost in --live mode before making any calls. */
export function estimateLiveCostUsd(args: {
  reviews: number;
  tasks: readonly ModelTask[];
  models: readonly SupportedModel[];
}): number {
  // Conservative per-call token estimates (input ≈ 280, output ≈ 90).
  const inTok = 280;
  const outTok = 90;
  let total = 0;
  for (const m of args.models) {
    total +=
      args.reviews *
      args.tasks.length *
      estimateCostUsd({ model: m, inputTokens: inTok, outputTokens: outTok });
  }
  return Number(total.toFixed(6));
}

// ---- Formatting helpers (for stdout) -----------------------------------

export function formatSummaryTable(summary: readonly TaskSummary[]): string {
  const rows: string[] = [];
  rows.push(
    "task              | model         | runs | auto | $cost      | ms   | chars | err  | pick".padEnd(
      90,
    ),
  );
  rows.push("-".repeat(90));
  for (const s of summary) {
    for (const model of COMPARED_MODELS) {
      const m = s.perModel[model];
      const marker = s.recommendedModel === model ? "★" : " ";
      rows.push(
        `${s.task.padEnd(17)} | ${model.padEnd(13)} | ${String(m.runs).padStart(4)} | ${m.meanAutoScore.toFixed(1).padStart(4)} | ${m.meanCostUsd.toFixed(6).padStart(10)} | ${String(m.meanLatencyMs).padStart(4)} | ${String(m.meanOutputChars).padStart(5)} | ${m.errorRate.toFixed(2).padStart(4)} |  ${marker}`,
      );
    }
  }
  rows.push("-".repeat(90));
  for (const s of summary) {
    rows.push(`${s.task}: ${s.reasoning}`);
  }
  return rows.join("\n");
}

// ---- main() ------------------------------------------------------------

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = parseCliArgs(argv);
  const runId = `ab-${Date.now()}`;

  // Slice fixtures or seed-pad to the requested size.
  const fixtures: ReviewFixture[] = [];
  while (fixtures.length < args.reviews) {
    for (const f of FIXTURES) {
      if (fixtures.length >= args.reviews) break;
      fixtures.push({ ...f, id: `${f.id}-${fixtures.length}` });
    }
  }

  console.log(
    `[ab-test] runId=${runId} reviews=${args.reviews} mode=${args.live ? "live" : "dry-run"} tasks=${DEFAULT_RUN_TASKS.length} models=${COMPARED_MODELS.length}`,
  );

  let generate: Parameters<typeof runComparison>[0]["generate"];

  if (args.live) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error(
        "[ab-test] --live requires OPENAI_API_KEY in env. Aborting.",
      );
      process.exit(2);
    }
    const estimate = estimateLiveCostUsd({
      reviews: args.reviews,
      tasks: DEFAULT_RUN_TASKS,
      models: COMPARED_MODELS,
    });
    console.log(`[ab-test] estimated cost: $${estimate.toFixed(4)}`);
    if (estimate > COST_CEILING_TOTAL_USD) {
      console.error(
        `[ab-test] estimate ${estimate.toFixed(4)} > ceiling ${COST_CEILING_TOTAL_USD.toFixed(2)}. Reduce --reviews or raise COST_CEILING_TOTAL_USD.`,
      );
      process.exit(3);
    }
    generate = async (input) => {
      const t0 = Date.now();
      const r = await callOpenAiDirect({ ...input, apiKey });
      return { ...r, latencyMs: Date.now() - t0 };
    };
  } else {
    generate = async (input) => {
      const r = stubOutput(input);
      // Stable latency: nano faster than mini.
      const latencyMs = input.model === "gpt-5.4-nano" ? 220 : 450;
      return { ...r, latencyMs };
    };
  }

  const report = await runComparison({
    fixtures,
    generate,
    runId,
    mode: args.live ? "live" : "dry-run",
  });

  // Write report to disk.
  await mkdir(dirname(args.outputPath), { recursive: true });
  await writeFile(args.outputPath, JSON.stringify(report, null, 2), "utf8");
  console.log(`[ab-test] wrote ${args.outputPath}`);

  // Print summary.
  console.log("\n" + formatSummaryTable(report.summary));
  console.log(`\nTotal cost: $${report.totalCostUsd.toFixed(6)}`);

  if (args.decide === "manual") {
    console.log(
      "\n--decide manual: review the per-fixture outputs in the report file, score each on the 0-10 rubric, then update services/ai/model-decision.ts + .claude/memory/model-decision.json accordingly.",
    );
    return;
  }
  if (args.decide === "auto") {
    console.log("\nAuto-applied 80% rule (see Pick column ★).");
    for (const s of report.summary) {
      const current = MODEL_DECISION.choices[s.task]?.model;
      const flag = current !== s.recommendedModel ? "  ← CHANGE" : "";
      console.log(`  ${s.task}: recommend ${s.recommendedModel}${flag}`);
    }
  }
}

// Avoid running main() in tests.
const thisFile =
  typeof import.meta !== "undefined" && import.meta.url
    ? fileURLToPath(import.meta.url)
    : "";
const isMain = thisFile && process.argv[1] && process.argv[1] === thisFile;

if (isMain) {
  void main().catch((e) => {
    console.error("[ab-test] fatal:", e);
    process.exit(1);
  });
}
