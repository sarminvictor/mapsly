// WP6-14 · tests for the pure signal→outcome correlation ranker.
//
// Invariants:
//   - baseline reply-rate = replies / total scored leads;
//   - per-signal lift = firedReplyRate − baseline, ranked desc;
//   - a signal below the min fired-lead threshold is excluded (no correlation
//     claim from a handful of leads);
//   - a signal key repeated within one lead counts that lead once.

import { describe, expect, test } from "vitest";

import {
  rankSignalLift,
  type LeadOutcome,
} from "../signal-outcome-correlation";

describe("rankSignalLift", () => {
  test("baseline + positive/negative lift, ranked desc", () => {
    // 10 leads: 5 reply overall → baseline 50%.
    // signalA fires on 6 leads (idx 0-5), 5 of them reply → 83% → +33% lift.
    // signalB fires on 5 leads (idx 3,4,6,7,8), 1 replies → 20% → −30% lift.
    const leads: LeadOutcome[] = [
      { replied: true, firedSignalKeys: ["a"] }, // 0
      { replied: true, firedSignalKeys: ["a"] }, // 1
      { replied: true, firedSignalKeys: ["a"] }, // 2
      { replied: true, firedSignalKeys: ["a", "b"] }, // 3
      { replied: false, firedSignalKeys: ["a", "b"] }, // 4
      { replied: true, firedSignalKeys: ["a"] }, // 5 → 5th signalA reply
      { replied: false, firedSignalKeys: ["b"] }, // 6
      { replied: false, firedSignalKeys: ["b"] }, // 7
      { replied: false, firedSignalKeys: ["b"] }, // 8
      { replied: false, firedSignalKeys: [] }, // 9
    ];
    const r = rankSignalLift(leads);
    expect(r.totalLeads).toBe(10);
    expect(r.baselineReplyRate).toBeCloseTo(0.5);
    // both signals clear the min-fired threshold (a=6, b=5)
    const a = r.signals.find((s) => s.signalKey === "a")!;
    const b = r.signals.find((s) => s.signalKey === "b")!;
    expect(a.firedLeads).toBe(6);
    expect(a.firedReplies).toBe(5);
    expect(a.lift).toBeCloseTo(5 / 6 - 0.5);
    expect(b.lift).toBeCloseTo(1 / 5 - 0.5);
    // ranked desc → the positive-lift signal leads
    expect(r.signals[0].signalKey).toBe("a");
  });

  test("excludes a signal below the min fired-lead threshold", () => {
    // signalC fires on only 2 leads (< 5) → not shown.
    const leads: LeadOutcome[] = Array.from({ length: 30 }, (_, i) => ({
      replied: i % 2 === 0,
      firedSignalKeys: i < 2 ? ["c"] : [],
    }));
    const r = rankSignalLift(leads);
    expect(r.signals.find((s) => s.signalKey === "c")).toBeUndefined();
  });

  test("a signal key repeated within one lead counts once", () => {
    const leads: LeadOutcome[] = Array.from({ length: 6 }, () => ({
      replied: true,
      firedSignalKeys: ["a", "a", "a"], // duped within the lead
    }));
    const r = rankSignalLift(leads);
    const a = r.signals.find((s) => s.signalKey === "a")!;
    expect(a.firedLeads).toBe(6); // 6 leads, not 18
  });

  test("empty set → zero baseline, no signals", () => {
    const r = rankSignalLift([]);
    expect(r.totalLeads).toBe(0);
    expect(r.baselineReplyRate).toBe(0);
    expect(r.signals).toEqual([]);
  });
});
