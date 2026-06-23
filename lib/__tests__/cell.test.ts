// Phase 1/2 · cell key + 6-month discovery freshness (serve-from-DB = $0).

import { describe, expect, test } from "vitest";
import {
  cellKey,
  parseCellKey,
  isCellFresh,
  nextStaleAt,
  cellFreshnessState,
  daysBetween,
  CELL_DISCOVERY_FRESHNESS_DAYS,
} from "../cell";

const NOW = new Date("2026-06-22T00:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe("cellKey", () => {
  test("round-trips", () => {
    const k = cellKey("medical_spa", "miami");
    expect(k).toBe("medical_spa|miami|US");
    expect(parseCellKey(k)).toEqual({
      categorySlug: "medical_spa",
      metroSlug: "miami",
      country: "US",
    });
  });
  test("rejects malformed keys", () => {
    expect(parseCellKey("a|b")).toBeNull();
    expect(parseCellKey("a||c")).toBeNull();
  });
});

describe("isCellFresh — 6-month rule", () => {
  test("discovered 100 days ago → fresh", () => {
    expect(isCellFresh(daysAgo(100), NOW)).toBe(true);
  });
  test("discovered 200 days ago → stale", () => {
    expect(isCellFresh(daysAgo(200), NOW)).toBe(false);
  });
  test("exactly at the window boundary is stale", () => {
    expect(isCellFresh(daysAgo(CELL_DISCOVERY_FRESHNESS_DAYS), NOW)).toBe(
      false,
    );
  });
  test("never discovered → not fresh", () => {
    expect(isCellFresh(null, NOW)).toBe(false);
  });
});

describe("cellFreshnessState", () => {
  test("classifies the chip state", () => {
    expect(cellFreshnessState(null, NOW)).toBe("never");
    expect(cellFreshnessState(daysAgo(10), NOW)).toBe("fresh");
    expect(cellFreshnessState(daysAgo(140), NOW)).toBe("aging"); // >70% of 182
    expect(cellFreshnessState(daysAgo(200), NOW)).toBe("stale");
  });
});

describe("nextStaleAt / daysBetween", () => {
  test("nextStaleAt is window days out", () => {
    const at = nextStaleAt(NOW);
    expect(daysBetween(NOW, at)).toBe(CELL_DISCOVERY_FRESHNESS_DAYS);
  });
});
