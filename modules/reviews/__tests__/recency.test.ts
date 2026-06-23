/**
 * Unit tests for the pure recency-depth logic (Phase 5 reviews rearchitecture).
 *
 * The load-bearing invariant per `modules/reviews/recency.ts`:
 *
 *   DataForSEO returns reviews newest-first, so the last-12-month window is a
 *   PREFIX. Depth is governed by RECENCY, never lifetime review count. A
 *   business with 5,000 lifetime reviews but few recent ones must NOT be
 *   escalated to the deepest page — the anti-regression captured below.
 *
 * Every case passes an explicit `now: Date` so the logic is deterministic.
 */

import { describe, expect, test } from "vitest";

import {
  DEPTH_LADDER,
  REVIEW_WINDOW_DAYS,
  chooseInitialDepth,
  isWithinWindow,
  nextDepth,
  planReviewFetch,
  shouldEscalate,
  trimToWindow,
} from "../recency";

const NOW = new Date("2026-06-22T00:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

/** A date `days` days before NOW. */
function daysAgo(days: number, now: Date = NOW): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

describe("chooseInitialDepth", () => {
  test("0 lifetime reviews → 50 (floor)", () => {
    expect(chooseInitialDepth(0)).toBe(50);
  });

  test("null lifetime reviews → 50 (floor)", () => {
    expect(chooseInitialDepth(null)).toBe(50);
  });

  test("30 → 50 (rounds to 30, clamped up to floor)", () => {
    expect(chooseInitialDepth(30)).toBe(50);
  });

  test("150 → 150 (in range, unchanged)", () => {
    expect(chooseInitialDepth(150)).toBe(150);
  });

  test("5000 → 200 (ceiling)", () => {
    expect(chooseInitialDepth(5000)).toBe(200);
  });

  test("1234 → 200 (ceiling)", () => {
    expect(chooseInitialDepth(1234)).toBe(200);
  });
});

describe("nextDepth", () => {
  test("climbs the ladder rung by rung", () => {
    expect(nextDepth(200)).toBe(700);
    expect(nextDepth(700)).toBe(2000);
    expect(nextDepth(2000)).toBe(4490);
  });

  test("returns null at the max rung (4490)", () => {
    expect(nextDepth(4490)).toBeNull();
  });

  test("returns null above the max rung", () => {
    expect(nextDepth(9999)).toBeNull();
  });

  test("a sub-ladder depth jumps to the first larger rung", () => {
    expect(nextDepth(50)).toBe(200);
    expect(nextDepth(199)).toBe(200);
  });

  test("DEPTH_LADDER matches the documented rungs", () => {
    expect([...DEPTH_LADDER]).toEqual([200, 700, 2000, 4490]);
  });
});

describe("isWithinWindow", () => {
  test("review inside the window is in scope", () => {
    expect(isWithinWindow(daysAgo(100), NOW)).toBe(true);
  });

  test("review exactly at the boundary is inclusive", () => {
    expect(isWithinWindow(daysAgo(REVIEW_WINDOW_DAYS), NOW)).toBe(true);
  });

  test("review older than the window is out of scope", () => {
    expect(isWithinWindow(daysAgo(REVIEW_WINDOW_DAYS + 1), NOW)).toBe(false);
  });

  test("respects a custom windowDays", () => {
    expect(isWithinWindow(daysAgo(40), NOW, 30)).toBe(false);
    expect(isWithinWindow(daysAgo(20), NOW, 30)).toBe(true);
  });
});

describe("shouldEscalate · the anti-regression", () => {
  test("5000-lifetime business whose 200th review is OLDER than 365d → STOP", () => {
    // The full first page (200) came back, but the oldest of those 200 reviews
    // is already past the cutoff — everything deeper is out of the window.
    // Despite the huge lifetime count, we must NOT escalate.
    expect(
      shouldEscalate({
        pageSize: 200,
        depthRequested: 200,
        oldestPostedAt: daysAgo(400),
        now: NOW,
      }),
    ).toBe(false);
  });

  test("high-velocity business whose 200th review is WITHIN 365d + page full → ESCALATE", () => {
    expect(
      shouldEscalate({
        pageSize: 200,
        depthRequested: 200,
        oldestPostedAt: daysAgo(120),
        now: NOW,
      }),
    ).toBe(true);
    // And the next depth after 200 is 700.
    expect(nextDepth(200)).toBe(700);
  });

  test("page NOT full (pageSize < depth) → STOP even if oldest within window", () => {
    expect(
      shouldEscalate({
        pageSize: 150,
        depthRequested: 200,
        oldestPostedAt: daysAgo(30),
        now: NOW,
      }),
    ).toBe(false);
  });

  test("no reviews returned (oldestPostedAt null) → STOP", () => {
    expect(
      shouldEscalate({
        pageSize: 0,
        depthRequested: 200,
        oldestPostedAt: null,
        now: NOW,
      }),
    ).toBe(false);
  });

  test("oldest exactly at the boundary + full page → ESCALATE (boundary inclusive)", () => {
    expect(
      shouldEscalate({
        pageSize: 200,
        depthRequested: 200,
        oldestPostedAt: daysAgo(REVIEW_WINDOW_DAYS),
        now: NOW,
      }),
    ).toBe(true);
  });
});

describe("trimToWindow", () => {
  test("drops out-of-window reviews, keeps in-window, preserves order", () => {
    const reviews = [
      { id: "a", postedAt: daysAgo(10) },
      { id: "b", postedAt: daysAgo(200) },
      { id: "c", postedAt: daysAgo(400) },
      { id: "d", postedAt: daysAgo(REVIEW_WINDOW_DAYS) },
    ];
    const kept = trimToWindow(reviews, NOW);
    expect(kept.map((r) => r.id)).toEqual(["a", "b", "d"]);
  });

  test("respects a custom windowDays", () => {
    const reviews = [{ postedAt: daysAgo(5) }, { postedAt: daysAgo(45) }];
    expect(trimToWindow(reviews, NOW, 30)).toHaveLength(1);
  });

  test("empty input → empty output", () => {
    expect(trimToWindow([], NOW)).toEqual([]);
  });
});

describe("planReviewFetch", () => {
  test("initial mode uses chooseInitialDepth", () => {
    expect(planReviewFetch({ reviewCount: 5000, mode: "initial" })).toEqual({
      depth: 200,
    });
    expect(planReviewFetch({ reviewCount: 30, mode: "initial" })).toEqual({
      depth: 50,
    });
    expect(planReviewFetch({ reviewCount: 150, mode: "initial" })).toEqual({
      depth: 150,
    });
  });

  test("delta mode always uses depth 50", () => {
    expect(planReviewFetch({ reviewCount: 5000, mode: "delta" })).toEqual({
      depth: 50,
    });
    expect(planReviewFetch({ reviewCount: null, mode: "delta" })).toEqual({
      depth: 50,
    });
  });
});
