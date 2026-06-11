import { describe, expect, test } from "vitest";

import {
  evaluateFunnelGates,
  FUNNEL_GATES,
  VERDICT_MAX_SENDS,
  VERDICT_MIN_SENDS,
} from "../funnel-thresholds";

describe("FUNNEL_GATES", () => {
  test("encodes the agreed Miami draft gates (decision log #17)", () => {
    const byId = Object.fromEntries(FUNNEL_GATES.map((g) => [g.id, g.minRate]));
    expect(byId).toEqual({
      email_to_page: 0.05,
      page_to_engaged: 0.08,
      page_to_paid: 0.005,
    });
  });

  test("every gate names a fix layer", () => {
    for (const gate of FUNNEL_GATES) {
      expect(["email", "landing", "offer"]).toContain(gate.fixLayer);
      expect(gate.fixHint.length).toBeGreaterThan(0);
    }
  });

  test("verdict window matches the ~2–3k sends agreement", () => {
    expect(VERDICT_MIN_SENDS).toBe(2000);
    expect(VERDICT_MAX_SENDS).toBe(3000);
  });
});

describe("evaluateFunnelGates", () => {
  test("all gates pass on healthy numbers", () => {
    const results = evaluateFunnelGates({
      delivered: 1000,
      humanPageVisits: 60, // 6% ≥ 5%
      humanEngaged: 6, // 10% ≥ 8%
      paid: 1, // 1.67% ≥ 0.5%
    });
    expect(results.map((r) => r.pass)).toEqual([true, true, true]);
  });

  test("each gate fails independently below its threshold", () => {
    const results = evaluateFunnelGates({
      delivered: 1000,
      humanPageVisits: 40, // 4% < 5% → email layer
      humanEngaged: 2, // 5% < 8% → landing layer
      paid: 0, // 0% < 0.5% → offer layer
    });
    expect(results.map((r) => r.pass)).toEqual([false, false, false]);
    expect(results.map((r) => r.gate.fixLayer)).toEqual([
      "email",
      "landing",
      "offer",
    ]);
  });

  test("exactly at threshold passes (gates are ≥, not >)", () => {
    const results = evaluateFunnelGates({
      delivered: 1000,
      humanPageVisits: 50, // exactly 5%
      humanEngaged: 4, // exactly 8%
      paid: 1, // 2% — irrelevant here, above
    });
    expect(results[0]?.pass).toBe(true);
    expect(results[1]?.pass).toBe(true);
  });

  test("zero denominators yield null (no data yet), never division blowups", () => {
    const results = evaluateFunnelGates({
      delivered: 0,
      humanPageVisits: 0,
      humanEngaged: 0,
      paid: 0,
    });
    expect(results.map((r) => r.rate)).toEqual([null, null, null]);
    expect(results.map((r) => r.pass)).toEqual([null, null, null]);
  });
});
