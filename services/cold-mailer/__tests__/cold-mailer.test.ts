import { describe, expect, test } from "vitest";

import { isBlockError, isHardBounce } from "../index";
import { COLD_RAMP_STEPS, effectiveDailyCap, utcDateKey } from "../ramp";

const day = (n: number): Date => new Date(2026, 5, n, 12, 0, 0); // local noon

describe("effectiveDailyCap", () => {
  test("no ramp start → 0 (mailbox still warming)", () => {
    expect(effectiveDailyCap(30, null, day(10))).toBe(0);
  });

  test("day 0 uses the first ramp step", () => {
    const start = day(10);
    expect(effectiveDailyCap(30, start, start)).toBe(COLD_RAMP_STEPS[0]);
  });

  test("ramps up day by day, capped at target", () => {
    const start = day(1);
    expect(effectiveDailyCap(30, start, day(1))).toBe(3); // day 0
    expect(effectiveDailyCap(30, start, day(3))).toBe(5); // day 2
    expect(effectiveDailyCap(30, start, day(12))).toBe(30); // beyond ramp → target
  });

  test("target dailyCap clamps the ramp step", () => {
    const start = day(1);
    expect(effectiveDailyCap(4, start, day(7))).toBe(4); // step (15) clamped to cap 4
  });
});

describe("utcDateKey", () => {
  test("returns YYYY-MM-DD", () => {
    expect(utcDateKey(new Date("2026-06-09T23:30:00Z"))).toBe("2026-06-09");
  });
});

describe("bounce/block classifiers", () => {
  test("hard bounces detected", () => {
    expect(isHardBounce("550 5.1.1 user unknown", 550)).toBe(true);
    expect(isHardBounce("Recipient address rejected: does not exist")).toBe(
      true,
    );
  });
  test("transient failures are not hard bounces", () => {
    expect(isHardBounce("451 4.7.1 try again later", 451)).toBe(false);
  });
  test("provider blocks detected", () => {
    expect(isBlockError("550 5.4.6 Unusual sending activity")).toBe(true);
    expect(isBlockError("421 too many messages", 421)).toBe(true);
    expect(isBlockError("250 OK")).toBe(false);
  });
});
