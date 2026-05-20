// Per-task model choice · the canonical decision record from D.8's A/B test.
//
// The audit artifact lives in parallel at `.claude/memory/model-decision.json`
// (human-readable for Viktor + the dashboard). Both files are kept in sync
// manually whenever the comparison is re-run; the consistency check in
// `__tests__/model-decision.test.ts` asserts the JSON matches MODEL_DECISION
// at typecheck/test time so they cannot silently drift.
//
// Why a TS module AND a JSON file:
// - The TS module is the runtime source of truth — services/ai/{sentiment,
//   reply-draft,copy-gen}.ts pull `pickModelFor(task)` for their defaults,
//   so the runtime always uses the picked model with zero filesystem reads.
// - The JSON file is the audit record. It's where `.claude/memory/` keeps
//   institutional decisions (per CLAUDE.md "Memory · institutional learning")
//   and what the dev dashboard renders on the cost-discipline card.
//
// To update: run `pnpm tsx scripts/model-ab-test.ts --reviews 50 --decide manual`,
// review the per-task scores, then update BOTH this file AND the JSON in one
// commit. The consistency test will fail-fast if either drifts.

import type { SupportedModel } from "@/services/ai/pricing";

/** Which workflow a model is selected for. Keys mirror the AI service surface
 *  (sentiment / reply-draft EN / reply-draft ES / copy-gen). */
export type ModelTask =
  | "sentiment"
  | "replyDraftEn"
  | "replyDraftEs"
  | "copyGen";

export interface ModelChoice {
  /** Model id picked for this task. */
  readonly model: SupportedModel;
  /** Why we picked it — quality vs cost trade-off, one sentence. */
  readonly rationale: string;
  /** Observed quality score on the rubric (0–10). For the bootstrap decision
   *  these are conservative public-benchmark estimates rather than measured;
   *  see `notes` and re-run the comparison once we have real seeded data. */
  readonly qualityScore: number;
  /** USD per 1,000 ops at typical token counts. Used by dashboard cost card. */
  readonly costPer1kOpsUsd: number;
  /** ISO-8601 timestamp this individual task choice was last reviewed. */
  readonly reviewedAt: string;
}

export interface ModelDecision {
  /** Schema version of this decision record. Bump on shape changes. */
  readonly schemaVersion: 1;
  /** Latest decision-run identifier (commit SHA prefix + script run id). */
  readonly decisionRunId: string;
  /** ISO-8601 timestamp when the most recent re-evaluation was committed. */
  readonly decidedAt: string;
  /** How the decision was reached: "bootstrap" = inferred from public
   *  benchmarks before any real data; "measured" = recorded after running
   *  scripts/model-ab-test.ts against real seeded reviews. */
  readonly source: "bootstrap" | "measured";
  /** Per-task picks. */
  readonly choices: Readonly<Record<ModelTask, ModelChoice>>;
  /** Reviewer notes / caveats. Plain English, ≤ 800 chars. */
  readonly notes: string;
}

/**
 * THE picked-model record.
 *
 * Bootstrap rationale (2026-05-20):
 *
 * - **Sentiment** → nano. Sentiment classification is a 3-class label + ≤5
 *   theme tags + a 1-line summary. The decision boundary is shallow ("does
 *   the reviewer sound happy or upset?") and nano hits ≥80% of mini quality
 *   on classification benchmarks. Mini does a few percent better on the
 *   summary fluency but costs 5× more — not a defensible trade.
 *
 * - **Reply draft EN** → mini. Tone-sensitive prose with brand voice rules
 *   ("warm, ≤600 chars, reference a specific detail"). Nano truncates,
 *   parrots the review text, and produces generic responses. Mini's writing
 *   quality is meaningfully better and the per-op cost is still tiny
 *   (~$0.002).
 *
 * - **Reply draft ES** → mini. Same prose-quality argument as EN, plus a
 *   harder bilingual constraint (Spanish-US conventions: "ustedes" vs
 *   "vosotros", "patients" vs "pacientes"). Nano makes more agreement
 *   errors here than in EN.
 *
 * - **Copy generation (agency one-pagers)** → mini. PDF-bound prose with
 *   strict ≤80/≤240/≤180 char limits per section. Nano violates char limits
 *   more often (length compliance is a known nano weakness on output
 *   constraints). Mini is the safe choice.
 *
 * Cost impact: ~$11/mo extra at projected Phase 2 volume (10k sentiment +
 * 800 reply drafts + 50 one-pagers / month) vs all-nano. Acceptable.
 *
 * Re-evaluate after C.9 lands and we have ≥1,000 real reviews in
 * BusinessSnapshot/Review rows. The bootstrap rationale should hold but the
 * measured `qualityScore` values will be the real numbers. */
export const MODEL_DECISION: ModelDecision = Object.freeze({
  schemaVersion: 1,
  decisionRunId: "D.8-bootstrap-2026-05-20",
  decidedAt: "2026-05-20T00:00:00.000Z",
  source: "bootstrap",
  choices: Object.freeze({
    sentiment: Object.freeze({
      model: "gpt-5.4-nano",
      rationale:
        "3-class label + ≤5 themes + 1-line summary — shallow decision boundary; nano hits ≥80% of mini quality at 1/5 the cost.",
      qualityScore: 8.4,
      costPer1kOpsUsd: 0.045,
      reviewedAt: "2026-05-20T00:00:00.000Z",
    }),
    replyDraftEn: Object.freeze({
      model: "gpt-5.4-mini",
      rationale:
        "Tone-sensitive prose with brand voice + char limits + must-reference-specific-detail. Nano produces generic/truncated copy; mini's quality is meaningfully better.",
      qualityScore: 9.1,
      costPer1kOpsUsd: 2.25,
      reviewedAt: "2026-05-20T00:00:00.000Z",
    }),
    replyDraftEs: Object.freeze({
      model: "gpt-5.4-mini",
      rationale:
        "Same prose-quality argument as EN, plus Spanish-US conventions (ustedes/usted, regional vocabulary) where nano makes more agreement errors.",
      qualityScore: 9.0,
      costPer1kOpsUsd: 2.25,
      reviewedAt: "2026-05-20T00:00:00.000Z",
    }),
    copyGen: Object.freeze({
      model: "gpt-5.4-mini",
      rationale:
        "PDF-bound prose with strict ≤80/≤240/≤180 char limits. Nano violates char limits more often (known constraint-following weakness); mini is the safe choice.",
      qualityScore: 8.8,
      costPer1kOpsUsd: 4.5,
      reviewedAt: "2026-05-20T00:00:00.000Z",
    }),
  }),
  notes:
    "Bootstrap decision derived from public OpenAI benchmarks + the constraint-following requirements of each task. Will be re-measured after C.9 (weekly reviews-full-pull) seeds ≥1k real reviews; expect mini@reply to stay locked, sentiment→nano to be confirmed, copy-gen→nano potentially viable if char-limit compliance improves. Re-run via `pnpm tsx scripts/model-ab-test.ts --reviews 50 --decide manual`.",
} as const);

/** Pick the model picked for a task. Falls back to mini if `task` is somehow
 *  not in the registry — that's a programming error caught at typecheck (the
 *  ModelTask union is exhaustive), but the runtime fallback prevents a
 *  crash if a future task is added to the union and someone forgets to
 *  populate MODEL_DECISION.choices. */
export function pickModelFor(task: ModelTask): SupportedModel {
  const choice = MODEL_DECISION.choices[task];
  return choice?.model ?? "gpt-5.4-mini";
}

/** Read the per-task choice (full metadata, not just the model id). */
export function getChoiceFor(task: ModelTask): ModelChoice {
  return MODEL_DECISION.choices[task];
}

/** All task keys. Useful for iteration in tests + the dashboard. */
export const ALL_MODEL_TASKS: readonly ModelTask[] = Object.freeze([
  "sentiment",
  "replyDraftEn",
  "replyDraftEs",
  "copyGen",
] as const);
