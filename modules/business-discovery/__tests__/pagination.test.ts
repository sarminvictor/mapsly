/**
 * Discovery pagination math · pure-function invariants.
 *
 * The runner trusts these to (a) never request past DfS's 1000-row
 * per-call cap, (b) never request past the requested limit or the
 * cell's total_count, (c) clamp admin input into [1, 5000]. Getting
 * any of these wrong either truncates dense cells (the pre-v0.15.19
 * 200-cap problem) or over-bills.
 */

import { describe, expect, test } from "vitest";

import {
  DEFAULT_DISCOVERY_LIMIT,
  DFS_PAGE_SIZE,
  MAX_DISCOVERY_LIMIT,
  clampLimit,
  estimateDiscoveryCostUsd,
  nextPageLimit,
} from "../pagination";

describe("clampLimit", () => {
  test("garbage → default", () => {
    expect(clampLimit(NaN)).toBe(DEFAULT_DISCOVERY_LIMIT);
    expect(clampLimit(0)).toBe(DEFAULT_DISCOVERY_LIMIT);
    expect(clampLimit(-5)).toBe(DEFAULT_DISCOVERY_LIMIT);
    expect(clampLimit(Infinity)).toBe(DEFAULT_DISCOVERY_LIMIT);
  });

  test("floors fractions, caps at MAX", () => {
    expect(clampLimit(2.9)).toBe(2);
    expect(clampLimit(10_000)).toBe(MAX_DISCOVERY_LIMIT);
    expect(clampLimit(99_999)).toBe(MAX_DISCOVERY_LIMIT);
  });

  test("passes ordinary values through", () => {
    expect(clampLimit(1)).toBe(1);
    expect(clampLimit(200)).toBe(200);
    expect(clampLimit(1000)).toBe(1000);
  });
});

describe("nextPageLimit", () => {
  test("small request → single page of that size", () => {
    expect(
      nextPageLimit({ requestedLimit: 500, fetched: 0, totalAvailable: null }),
    ).toBe(500);
  });

  test("large request pages in DFS_PAGE_SIZE chunks until limit", () => {
    expect(
      nextPageLimit({ requestedLimit: 2500, fetched: 0, totalAvailable: null }),
    ).toBe(DFS_PAGE_SIZE);
    expect(
      nextPageLimit({
        requestedLimit: 2500,
        fetched: 2000,
        totalAvailable: null,
      }),
    ).toBe(500);
    expect(
      nextPageLimit({
        requestedLimit: 2500,
        fetched: 2500,
        totalAvailable: null,
      }),
    ).toBe(0);
  });

  test("totalAvailable caps the request — never asks past the cell", () => {
    // 1800 in the cell, 2500 requested: second page asks for exactly 800.
    expect(
      nextPageLimit({
        requestedLimit: 2500,
        fetched: 1000,
        totalAvailable: 1800,
      }),
    ).toBe(800);
    expect(
      nextPageLimit({
        requestedLimit: 2500,
        fetched: 1800,
        totalAvailable: 1800,
      }),
    ).toBe(0);
  });

  test("empty cell (totalAvailable 0) stops immediately after first page", () => {
    expect(
      nextPageLimit({ requestedLimit: 100, fetched: 0, totalAvailable: 0 }),
    ).toBe(0);
  });
});

describe("estimateDiscoveryCostUsd", () => {
  test("matches observed billing at historical run sizes", () => {
    // Real DiscoveryRun rows 2026-05-26: limit=25 → $0.0175, limit=50 → $0.025
    expect(estimateDiscoveryCostUsd(25)).toBeCloseTo(0.0175, 4);
    expect(estimateDiscoveryCostUsd(50)).toBeCloseTo(0.025, 4);
  });

  test("full 10000 pull stays under the $5 approval ceiling", () => {
    expect(estimateDiscoveryCostUsd(MAX_DISCOVERY_LIMIT)).toBeLessThan(5);
  });
});
