// Unit tests for the per-cell freshness gate (pure time math).

import { describe, expect, test } from "vitest";
import { isCellRunFresh, CELL_INTEL_FRESHNESS_DAYS } from "../freshness";

const DAY = 86_400_000;
const NOW = new Date("2026-06-22T12:00:00.000Z");

describe("isCellRunFresh", () => {
  test("null (never run) is always stale", () => {
    expect(isCellRunFresh(null, NOW)).toBe(false);
  });

  test("a run from today is fresh", () => {
    expect(isCellRunFresh(new Date(NOW.getTime() - DAY), NOW)).toBe(true);
  });

  test("exactly at the boundary (30d) is still fresh", () => {
    const at = new Date(NOW.getTime() - CELL_INTEL_FRESHNESS_DAYS * DAY);
    expect(isCellRunFresh(at, NOW)).toBe(true);
  });

  test("one day past the window is stale", () => {
    const at = new Date(NOW.getTime() - (CELL_INTEL_FRESHNESS_DAYS + 1) * DAY);
    expect(isCellRunFresh(at, NOW)).toBe(false);
  });

  test("a future run (clock skew) is treated as fresh", () => {
    expect(isCellRunFresh(new Date(NOW.getTime() + DAY), NOW)).toBe(true);
  });

  test("custom window is honoured", () => {
    const at = new Date(NOW.getTime() - 5 * DAY);
    expect(isCellRunFresh(at, NOW, 3)).toBe(false);
    expect(isCellRunFresh(at, NOW, 7)).toBe(true);
  });
});
