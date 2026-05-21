/**
 * Match Score · invariant tests · D.5
 *
 * Per `.claude/rules/testing.md` §"Signal scoring", scoring formulas need
 * 100% formula coverage — wrong score = wrong rank = wrong agency
 * outreach order = lost revenue. The matrix below covers the algebraic
 * boundaries (zero, one, half) × the quality multiplier extremes
 * (NEUTRAL, perfect, zero, null, NaN) × the defensive paths (excluded,
 * empty spec, unknown signal key, malformed mapslyScore).
 *
 * Test fixtures use the smallest legal {@link EvaluationRow} shape — a
 * `business` object with just the columns the chosen signals' `column`
 * field references. The chosen signals here all live on `Business.*`
 * (rating, reviewCount, isClaimed) so no joins are required.
 */

import { describe, expect, test } from "vitest";
import {
  computeMatchScore,
  computeMatchScoreFromSnapshot,
  MATCH_SCORE_MAX,
  MATCH_SCORE_MIN,
  NEUTRAL_MAPSLY_SCORE,
  QUALITY_FLOOR,
  QUALITY_LIFT,
  rankByMatchScore,
} from "../match-score";
import type { EvaluationRow, FilterSpec } from "@/modules/hunter";
import { SIGNALS } from "@/modules/signals";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures: pick three signals that live on Business.* so we can build minimal rows.
// ─────────────────────────────────────────────────────────────────────────────

// Find three real numeric/boolean signals that read from Business.*
function findBusinessSignal(predicate: (column: string) => boolean): string {
  const match = Object.entries(SIGNALS).find(([, def]) =>
    predicate(def.column),
  );
  if (!match) {
    throw new Error(
      "Test fixture: no signal in registry matches predicate. " +
        "Update fixtures or add a Business.* signal to modules/signals/registry.ts.",
    );
  }
  return match[0];
}

const RATING_SIGNAL = findBusinessSignal((col) => col === "Business.rating");
const REVIEW_COUNT_SIGNAL = findBusinessSignal(
  (col) => col === "Business.reviewCount",
);
const CLAIMED_SIGNAL = findBusinessSignal(
  (col) => col === "Business.isClaimed",
);

function row(
  id: string,
  fields: { rating?: number; reviewCount?: number; isClaimed?: boolean },
): EvaluationRow {
  return {
    id,
    business: {
      rating: fields.rating ?? null,
      reviewCount: fields.reviewCount ?? null,
      isClaimed: fields.isClaimed ?? null,
    },
  };
}

// A spec with 2 ordinary rows: rating ≥ 4 AND reviewCount ≥ 50.
// Comparators chosen from the canonical numeric set; if the registry's
// signal doesn't support them, the test will throw at evaluator-time —
// which is the right signal to update the fixture.
const TWO_ROW_SPEC: FilterSpec = {
  rows: [
    { signalKey: RATING_SIGNAL, comparator: ">=", value: 4 },
    { signalKey: REVIEW_COUNT_SIGNAL, comparator: ">=", value: 50 },
  ],
  combine: "and",
};

// Same two rows + an exclusion: skip unclaimed businesses.
const TWO_ROW_SPEC_WITH_EXCLUSION: FilterSpec = {
  rows: TWO_ROW_SPEC.rows,
  combine: "and",
  exclusions: [{ signalKey: CLAIMED_SIGNAL, comparator: "is", value: false }],
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants + self-checks
// ─────────────────────────────────────────────────────────────────────────────

describe("MATCH_SCORE_MIN/MAX", () => {
  test("range is 0..100", () => {
    expect(MATCH_SCORE_MIN).toBe(0);
    expect(MATCH_SCORE_MAX).toBe(100);
  });
});

describe("QUALITY_FLOOR + QUALITY_LIFT", () => {
  test("sum to 1.0", () => {
    expect(QUALITY_FLOOR + QUALITY_LIFT).toBeCloseTo(1, 9);
  });
});

describe("NEUTRAL_MAPSLY_SCORE", () => {
  test("is midpoint of [0, 10]", () => {
    expect(NEUTRAL_MAPSLY_SCORE).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Core formula
// ─────────────────────────────────────────────────────────────────────────────

describe("computeMatchScore · core formula", () => {
  test("all match + perfect mapslyScore → MATCH_SCORE_MAX", () => {
    const r = computeMatchScore({
      row: row("b1", { rating: 5, reviewCount: 1000 }),
      spec: TWO_ROW_SPEC,
      mapslyScore: 10,
    });
    expect(r.score).toBe(MATCH_SCORE_MAX);
    expect(r.matchRatio).toBe(1);
    expect(r.matchedCount).toBe(2);
    expect(r.totalCount).toBe(2);
    expect(r.excluded).toBe(false);
  });

  test("all match + zero mapslyScore → MATCH_SCORE_MAX × QUALITY_FLOOR (= 50)", () => {
    const r = computeMatchScore({
      row: row("b1", { rating: 5, reviewCount: 1000 }),
      spec: TWO_ROW_SPEC,
      mapslyScore: 0,
    });
    expect(r.score).toBe(MATCH_SCORE_MAX * QUALITY_FLOOR);
    expect(r.matchRatio).toBe(1);
  });

  test("all match + NEUTRAL fallback (no score) → MATCH_SCORE_MAX × 0.75", () => {
    // QUALITY_FLOOR + QUALITY_LIFT × 0.5 = 0.75
    const r = computeMatchScore({
      row: row("b1", { rating: 5, reviewCount: 1000 }),
      spec: TWO_ROW_SPEC,
      // mapslyScore omitted → NEUTRAL (5/10)
    });
    expect(r.score).toBeCloseTo(75, 9);
    expect(r.mapslyScoreUsed).toBe(NEUTRAL_MAPSLY_SCORE);
  });

  test("zero match → 0 regardless of quality", () => {
    const r = computeMatchScore({
      row: row("b1", { rating: 1, reviewCount: 0 }),
      spec: TWO_ROW_SPEC,
      mapslyScore: 10,
    });
    expect(r.score).toBe(0);
    expect(r.matchRatio).toBe(0);
    expect(r.matchedCount).toBe(0);
  });

  test("half match (rating yes, reviewCount no) + perfect quality → 50", () => {
    const r = computeMatchScore({
      row: row("b1", { rating: 5, reviewCount: 10 }),
      spec: TWO_ROW_SPEC,
      mapslyScore: 10,
    });
    // 0.5 × 100 × (0.5 + 0.5 × 1.0) = 50
    expect(r.score).toBe(50);
    expect(r.matchRatio).toBe(0.5);
    expect(r.matchedCount).toBe(1);
  });

  test("excluded → score = 0 even when match ratio = 1", () => {
    const r = computeMatchScore({
      row: row("b1", { rating: 5, reviewCount: 1000, isClaimed: false }),
      spec: TWO_ROW_SPEC_WITH_EXCLUSION,
      mapslyScore: 10,
    });
    expect(r.score).toBe(0);
    expect(r.excluded).toBe(true);
    expect(r.matchRatio).toBe(0);
  });

  test("exclusion that doesn't match → does not affect score", () => {
    const r = computeMatchScore({
      row: row("b1", { rating: 5, reviewCount: 1000, isClaimed: true }),
      spec: TWO_ROW_SPEC_WITH_EXCLUSION,
      mapslyScore: 10,
    });
    expect(r.score).toBe(MATCH_SCORE_MAX);
    expect(r.excluded).toBe(false);
  });

  test("empty spec (no rows, no exclusions) → score = 0", () => {
    const r = computeMatchScore({
      row: row("b1", { rating: 5 }),
      spec: {},
    });
    expect(r.score).toBe(0);
    expect(r.totalCount).toBe(0);
    expect(r.matchedCount).toBe(0);
    expect(r.excluded).toBe(false);
  });

  test("spec with only exclusions and no rows → score = 0", () => {
    const r = computeMatchScore({
      row: row("b1", { rating: 5, isClaimed: true }),
      spec: {
        exclusions: [
          { signalKey: CLAIMED_SIGNAL, comparator: "is", value: false },
        ],
      },
      mapslyScore: 10,
    });
    expect(r.score).toBe(0);
    expect(r.totalCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Defensive paths
// ─────────────────────────────────────────────────────────────────────────────

describe("computeMatchScore · defensive paths", () => {
  test("NaN mapslyScore → NEUTRAL fallback", () => {
    const r = computeMatchScore({
      row: row("b1", { rating: 5, reviewCount: 1000 }),
      spec: TWO_ROW_SPEC,
      mapslyScore: Number.NaN,
    });
    expect(r.mapslyScoreUsed).toBe(NEUTRAL_MAPSLY_SCORE);
  });

  test("Infinity mapslyScore → NEUTRAL fallback", () => {
    const r = computeMatchScore({
      row: row("b1", { rating: 5, reviewCount: 1000 }),
      spec: TWO_ROW_SPEC,
      mapslyScore: Number.POSITIVE_INFINITY,
    });
    expect(r.mapslyScoreUsed).toBe(NEUTRAL_MAPSLY_SCORE);
  });

  test("negative mapslyScore → clamped to 0", () => {
    const r = computeMatchScore({
      row: row("b1", { rating: 5, reviewCount: 1000 }),
      spec: TWO_ROW_SPEC,
      mapslyScore: -5,
    });
    expect(r.mapslyScoreUsed).toBe(0);
    // All match + clamped-zero quality → 50
    expect(r.score).toBe(MATCH_SCORE_MAX * QUALITY_FLOOR);
  });

  test("above-10 mapslyScore → clamped to 10", () => {
    const r = computeMatchScore({
      row: row("b1", { rating: 5, reviewCount: 1000 }),
      spec: TWO_ROW_SPEC,
      mapslyScore: 999,
    });
    expect(r.mapslyScoreUsed).toBe(10);
    expect(r.score).toBe(MATCH_SCORE_MAX);
  });

  test("null mapslyScore → NEUTRAL", () => {
    const r = computeMatchScore({
      row: row("b1", { rating: 5, reviewCount: 1000 }),
      spec: TWO_ROW_SPEC,
      mapslyScore: null,
    });
    expect(r.mapslyScoreUsed).toBe(NEUTRAL_MAPSLY_SCORE);
  });

  test("score is always within [MIN, MAX] for arbitrary inputs", () => {
    const inputs: Array<{
      readonly mapslyScore: number | null | undefined;
    }> = [
      { mapslyScore: Number.NaN },
      { mapslyScore: -Infinity },
      { mapslyScore: 1e9 },
      { mapslyScore: null },
      { mapslyScore: undefined },
    ];
    const variants = inputs.map((opts) =>
      computeMatchScore({
        row: row("b1", { rating: 5, reviewCount: 1000 }),
        spec: TWO_ROW_SPEC,
        ...opts,
      }),
    );
    for (const v of variants) {
      expect(v.score).toBeGreaterThanOrEqual(MATCH_SCORE_MIN);
      expect(v.score).toBeLessThanOrEqual(MATCH_SCORE_MAX);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Contributions panel
// ─────────────────────────────────────────────────────────────────────────────

describe("computeMatchScore · contributions", () => {
  test("matched non-exclusion rows have positive contribution", () => {
    const r = computeMatchScore({
      row: row("b1", { rating: 5, reviewCount: 1000 }),
      spec: TWO_ROW_SPEC,
      mapslyScore: 10,
    });
    expect(r.contributions).toHaveLength(2);
    for (const c of r.contributions) {
      expect(c.matched).toBe(true);
      expect(c.contribution).toBeGreaterThan(0);
    }
  });

  test("contributions sum to score (within tolerance)", () => {
    const r = computeMatchScore({
      row: row("b1", { rating: 5, reviewCount: 1000 }),
      spec: TWO_ROW_SPEC,
      mapslyScore: 10,
    });
    const sum = r.contributions.reduce((acc, c) => acc + c.contribution, 0);
    expect(sum).toBeCloseTo(r.score, 6);
  });

  test("contributions sum to score on half-match (equal-weight division)", () => {
    const r = computeMatchScore({
      row: row("b1", { rating: 5, reviewCount: 10 }),
      spec: TWO_ROW_SPEC,
      mapslyScore: 10,
    });
    const sum = r.contributions.reduce((acc, c) => acc + c.contribution, 0);
    expect(sum).toBeCloseTo(r.score, 6);
    expect(r.score).toBe(50);
  });

  test("contributions sum to score on quality-floor case (zero quality)", () => {
    const r = computeMatchScore({
      row: row("b1", { rating: 5, reviewCount: 1000 }),
      spec: TWO_ROW_SPEC,
      mapslyScore: 0,
    });
    const sum = r.contributions.reduce((acc, c) => acc + c.contribution, 0);
    expect(sum).toBeCloseTo(r.score, 6);
    expect(r.score).toBe(50);
  });

  test("exclusion row appears in contributions with isExclusion=true, contribution=0", () => {
    const r = computeMatchScore({
      row: row("b1", { rating: 5, reviewCount: 1000, isClaimed: false }),
      spec: TWO_ROW_SPEC_WITH_EXCLUSION,
      mapslyScore: 10,
    });
    const exclusion = r.contributions.find((c) => c.isExclusion);
    expect(exclusion).toBeDefined();
    expect(exclusion?.contribution).toBe(0);
    expect(exclusion?.matched).toBe(true);
  });

  test("excluded → all contributions zero (but matched flags still set)", () => {
    const r = computeMatchScore({
      row: row("b1", { rating: 5, reviewCount: 1000, isClaimed: false }),
      spec: TWO_ROW_SPEC_WITH_EXCLUSION,
      mapslyScore: 10,
    });
    expect(r.excluded).toBe(true);
    for (const c of r.contributions) expect(c.contribution).toBe(0);
    // The two ordinary rows still report matched=true so the UI can show
    // "would have matched but excluded".
    const ordinary = r.contributions.filter((c) => !c.isExclusion);
    expect(ordinary.every((c) => c.matched)).toBe(true);
  });

  test("contributions sorted: contribution desc, then signalKey asc", () => {
    const r = computeMatchScore({
      row: row("b1", { rating: 5, reviewCount: 10 }), // half-match
      spec: TWO_ROW_SPEC,
      mapslyScore: 10,
    });
    // First contribution should be matched (>0); second should be unmatched (0).
    expect(r.contributions[0]?.matched).toBe(true);
    expect(r.contributions[1]?.matched).toBe(false);
    expect(r.contributions[0]!.contribution).toBeGreaterThan(
      r.contributions[1]!.contribution,
    );
  });

  test("uses registry label when signal key exists", () => {
    const r = computeMatchScore({
      row: row("b1", { rating: 5, reviewCount: 1000 }),
      spec: TWO_ROW_SPEC,
    });
    const ratingContrib = r.contributions.find(
      (c) => c.signalKey === RATING_SIGNAL,
    );
    expect(ratingContrib?.label).toBe(SIGNALS[RATING_SIGNAL]!.label);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeMatchScoreFromSnapshot · thin wrapper
// ─────────────────────────────────────────────────────────────────────────────

describe("computeMatchScoreFromSnapshot", () => {
  test("reads mapslyScore from snapshot column", () => {
    const r = computeMatchScoreFromSnapshot({
      row: row("b1", { rating: 5, reviewCount: 1000 }),
      spec: TWO_ROW_SPEC,
      snapshot: { mapslyScore: 10 },
    });
    expect(r.score).toBe(MATCH_SCORE_MAX);
  });

  test("null snapshot → NEUTRAL fallback", () => {
    const r = computeMatchScoreFromSnapshot({
      row: row("b1", { rating: 5, reviewCount: 1000 }),
      spec: TWO_ROW_SPEC,
      snapshot: null,
    });
    expect(r.mapslyScoreUsed).toBe(NEUTRAL_MAPSLY_SCORE);
  });

  test("snapshot without mapslyScore → NEUTRAL fallback", () => {
    const r = computeMatchScoreFromSnapshot({
      row: row("b1", { rating: 5, reviewCount: 1000 }),
      spec: TWO_ROW_SPEC,
      snapshot: {},
    });
    expect(r.mapslyScoreUsed).toBe(NEUTRAL_MAPSLY_SCORE);
  });

  test("undefined snapshot → NEUTRAL fallback", () => {
    const r = computeMatchScoreFromSnapshot({
      row: row("b1", { rating: 5, reviewCount: 1000 }),
      spec: TWO_ROW_SPEC,
      snapshot: undefined,
    });
    expect(r.mapslyScoreUsed).toBe(NEUTRAL_MAPSLY_SCORE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// rankByMatchScore
// ─────────────────────────────────────────────────────────────────────────────

describe("rankByMatchScore", () => {
  test("orders by score desc", () => {
    const rows: EvaluationRow[] = [
      row("low", { rating: 4, reviewCount: 10 }), // half-match
      row("high", { rating: 5, reviewCount: 1000 }), // all-match
      row("mid", { rating: 4, reviewCount: 50 }), // all-match (different volume)
    ];
    const r = rankByMatchScore(rows, TWO_ROW_SPEC, {
      mapslyScores: new Map([
        ["low", 10],
        ["high", 10],
        ["mid", 5],
      ]),
    });
    expect(r.map((x) => x.id)).toEqual(["high", "mid", "low"]);
  });

  test("ties on score broken by mapslyScore desc, then id asc", () => {
    const rows: EvaluationRow[] = [
      row("c", { rating: 5, reviewCount: 1000 }),
      row("a", { rating: 5, reviewCount: 1000 }),
      row("b", { rating: 5, reviewCount: 1000 }),
    ];
    const r = rankByMatchScore(rows, TWO_ROW_SPEC, {
      mapslyScores: new Map([
        ["c", 7],
        ["a", 9],
        ["b", 9],
      ]),
    });
    // a and b both at 9; b and a tied → id asc → a before b. c (7) last.
    expect(r.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  test("dropExcluded removes excluded rows", () => {
    const rows: EvaluationRow[] = [
      row("ok", { rating: 5, reviewCount: 1000, isClaimed: true }),
      row("excluded", { rating: 5, reviewCount: 1000, isClaimed: false }),
    ];
    const all = rankByMatchScore(rows, TWO_ROW_SPEC_WITH_EXCLUSION);
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.id === "excluded")?.score).toBe(0);

    const dropped = rankByMatchScore(rows, TWO_ROW_SPEC_WITH_EXCLUSION, {
      dropExcluded: true,
    });
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.id).toBe("ok");
  });

  test("empty input → empty output", () => {
    expect(rankByMatchScore([], TWO_ROW_SPEC)).toEqual([]);
  });

  test("missing mapslyScore entry for a row → NEUTRAL fallback", () => {
    const r = rankByMatchScore(
      [row("noscore", { rating: 5, reviewCount: 1000 })],
      TWO_ROW_SPEC,
      { mapslyScores: new Map() },
    );
    expect(r[0]?.breakdown.mapslyScoreUsed).toBe(NEUTRAL_MAPSLY_SCORE);
  });

  test("output is stable across repeated calls", () => {
    const rows: EvaluationRow[] = [
      row("a", { rating: 5, reviewCount: 1000 }),
      row("b", { rating: 4, reviewCount: 50 }),
    ];
    const r1 = rankByMatchScore(rows, TWO_ROW_SPEC);
    const r2 = rankByMatchScore(rows, TWO_ROW_SPEC);
    expect(r1.map((x) => x.id)).toEqual(r2.map((x) => x.id));
  });
});
