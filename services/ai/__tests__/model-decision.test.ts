// Consistency tests for the D.8 model-decision record.
//
// Asserts that:
// 1. MODEL_DECISION schema is well-formed (all required tasks present,
//    valid model ids, scores in 0–10, costs > 0).
// 2. The TS MODEL_DECISION matches the JSON audit artifact bit-for-bit.
// 3. The picked models match the DEFAULT_*_MODEL constants in
//    services/ai/{sentiment,reply-draft,copy-gen}.ts — drift between the
//    decision record and the runtime defaults would silently mis-cost the
//    AI service, so we lock them together at test time.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, test } from "vitest";

import {
  ALL_MODEL_TASKS,
  getChoiceFor,
  MODEL_DECISION,
  pickModelFor,
  type ModelTask,
} from "@/services/ai/model-decision";
import { PRICING, type SupportedModel } from "@/services/ai/pricing";
import { DEFAULT_SENTIMENT_MODEL } from "@/services/ai/sentiment";
import { DEFAULT_REPLY_DRAFT_MODEL } from "@/services/ai/reply-draft";
import { DEFAULT_COPY_GEN_MODEL } from "@/services/ai/copy-gen";

const HERE = dirname(fileURLToPath(import.meta.url));
const JSON_PATH = resolve(
  HERE,
  "..",
  "..",
  "..",
  ".claude",
  "memory",
  "model-decision.json",
);

describe("MODEL_DECISION shape", () => {
  test("schemaVersion is 1", () => {
    expect(MODEL_DECISION.schemaVersion).toBe(1);
  });

  test("decidedAt + reviewedAt are valid ISO timestamps", () => {
    expect(() => new Date(MODEL_DECISION.decidedAt).toISOString()).not.toThrow();
    for (const task of ALL_MODEL_TASKS) {
      expect(() =>
        new Date(MODEL_DECISION.choices[task].reviewedAt).toISOString(),
      ).not.toThrow();
    }
  });

  test("every ModelTask key has a choice", () => {
    for (const task of ALL_MODEL_TASKS) {
      expect(MODEL_DECISION.choices[task]).toBeDefined();
    }
  });

  test("every choice picks a model that's priced in PRICING", () => {
    for (const task of ALL_MODEL_TASKS) {
      const model = MODEL_DECISION.choices[task].model;
      expect(PRICING[model]).toBeDefined();
    }
  });

  test("qualityScore is in 0..10", () => {
    for (const task of ALL_MODEL_TASKS) {
      const q = MODEL_DECISION.choices[task].qualityScore;
      expect(q).toBeGreaterThanOrEqual(0);
      expect(q).toBeLessThanOrEqual(10);
    }
  });

  test("costPer1kOpsUsd is positive", () => {
    for (const task of ALL_MODEL_TASKS) {
      const cost = MODEL_DECISION.choices[task].costPer1kOpsUsd;
      expect(cost).toBeGreaterThan(0);
    }
  });

  test("MODEL_DECISION is frozen (deep)", () => {
    expect(Object.isFrozen(MODEL_DECISION)).toBe(true);
    expect(Object.isFrozen(MODEL_DECISION.choices)).toBe(true);
    for (const task of ALL_MODEL_TASKS) {
      expect(Object.isFrozen(MODEL_DECISION.choices[task])).toBe(true);
    }
  });
});

describe("pickModelFor + getChoiceFor", () => {
  test("pickModelFor returns the choice.model for every task", () => {
    for (const task of ALL_MODEL_TASKS) {
      expect(pickModelFor(task)).toBe(MODEL_DECISION.choices[task].model);
    }
  });

  test("getChoiceFor returns the full choice block", () => {
    for (const task of ALL_MODEL_TASKS) {
      expect(getChoiceFor(task)).toEqual(MODEL_DECISION.choices[task]);
    }
  });

  test("ALL_MODEL_TASKS is exhaustive (no undeclared task in MODEL_DECISION)", () => {
    const declared = new Set(Object.keys(MODEL_DECISION.choices) as ModelTask[]);
    const known = new Set(ALL_MODEL_TASKS);
    expect(declared).toEqual(known);
  });
});

describe("runtime DEFAULT_*_MODEL constants match the decision", () => {
  test("sentiment runtime default matches MODEL_DECISION.choices.sentiment", () => {
    expect(DEFAULT_SENTIMENT_MODEL).toBe(MODEL_DECISION.choices.sentiment.model);
  });

  test("reply-draft runtime default matches MODEL_DECISION.choices.replyDraftEn", () => {
    expect(DEFAULT_REPLY_DRAFT_MODEL).toBe(
      MODEL_DECISION.choices.replyDraftEn.model,
    );
  });

  test("reply-draft runtime default matches MODEL_DECISION.choices.replyDraftEs", () => {
    expect(DEFAULT_REPLY_DRAFT_MODEL).toBe(
      MODEL_DECISION.choices.replyDraftEs.model,
    );
  });

  test("copy-gen runtime default matches MODEL_DECISION.choices.copyGen", () => {
    expect(DEFAULT_COPY_GEN_MODEL).toBe(MODEL_DECISION.choices.copyGen.model);
  });
});

describe("JSON audit artifact stays in sync with the TS constant", () => {
  test(".claude/memory/model-decision.json parses + equals MODEL_DECISION", () => {
    let raw: string;
    try {
      raw = readFileSync(JSON_PATH, "utf8");
    } catch (e) {
      throw new Error(
        `Could not read JSON audit at ${JSON_PATH}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;

    expect(parsed.schemaVersion).toBe(MODEL_DECISION.schemaVersion);
    expect(parsed.decisionRunId).toBe(MODEL_DECISION.decisionRunId);
    expect(parsed.decidedAt).toBe(MODEL_DECISION.decidedAt);
    expect(parsed.source).toBe(MODEL_DECISION.source);
    expect(parsed.notes).toBe(MODEL_DECISION.notes);

    const jsonChoices = parsed.choices as Record<string, Record<string, unknown>>;
    for (const task of ALL_MODEL_TASKS) {
      const ts = MODEL_DECISION.choices[task];
      const js = jsonChoices[task];
      expect(js, `JSON missing task=${task}`).toBeDefined();
      expect(js.model).toBe(ts.model);
      expect(js.rationale).toBe(ts.rationale);
      expect(js.qualityScore).toBe(ts.qualityScore);
      expect(js.costPer1kOpsUsd).toBe(ts.costPer1kOpsUsd);
      expect(js.reviewedAt).toBe(ts.reviewedAt);
    }
  });
});

describe("model coverage", () => {
  test("at least one task picks each compared model (otherwise the comparison was redundant)", () => {
    const picked = new Set<SupportedModel>();
    for (const task of ALL_MODEL_TASKS) {
      picked.add(MODEL_DECISION.choices[task].model);
    }
    expect(picked.size).toBeGreaterThanOrEqual(2);
  });
});
