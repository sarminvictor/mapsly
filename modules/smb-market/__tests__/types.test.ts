/**
 * Unit tests for `deriveMedians` — the only pure helper in the
 * smb-market module. Per `.claude/rules/testing.md` we cover the
 * invariants Maria would notice if they flipped (odd/even median
 * arithmetic + null-skipping).
 */

import { describe, expect, test } from "vitest";

import { EMPTY_MARKET_MEDIANS, deriveMedians } from "../types";

const row = (
  overrides: Partial<{
    rating: number | null;
    reviewCount: number | null;
    replyRate: number | null;
    photosCount: number | null;
    velocityLast30d: number | null;
  }>,
) => ({
  rating: null,
  reviewCount: null,
  replyRate: null,
  photosCount: null,
  velocityLast30d: null,
  ...overrides,
});

describe("deriveMedians", () => {
  test("empty list returns the EMPTY shape", () => {
    expect(deriveMedians([])).toEqual(EMPTY_MARKET_MEDIANS);
  });

  test("odd-count median is the middle value", () => {
    const out = deriveMedians([
      row({ rating: 3.0 }),
      row({ rating: 4.0 }),
      row({ rating: 5.0 }),
    ]);
    expect(out.rating).toBe(4.0);
    expect(out.total).toBe(3);
  });

  test("even-count median averages the two middle values", () => {
    const out = deriveMedians([
      row({ rating: 3.0 }),
      row({ rating: 4.0 }),
      row({ rating: 4.5 }),
      row({ rating: 5.0 }),
    ]);
    expect(out.rating).toBeCloseTo(4.25, 5);
  });

  test("nulls are skipped per field", () => {
    const out = deriveMedians([
      row({ rating: 4.0, reviewCount: 100 }),
      row({ rating: null, reviewCount: 200 }),
      row({ rating: 5.0, reviewCount: 300 }),
    ]);
    expect(out.rating).toBe(4.5);
    expect(out.reviewCount).toBe(200);
  });

  test("all-null column returns null median", () => {
    const out = deriveMedians([row({ rating: 4.0 }), row({ rating: 5.0 })]);
    expect(out.replyRate).toBeNull();
    expect(out.photosCount).toBeNull();
  });

  test("total reflects ALL rows including ones with null columns", () => {
    const out = deriveMedians([
      row({ rating: 4.0 }),
      row({ rating: null }),
      row({ rating: null }),
    ]);
    expect(out.total).toBe(3);
  });
});
