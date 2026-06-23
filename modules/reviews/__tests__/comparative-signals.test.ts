// Phase 6/E5 · review lifecycle + momentum + cell-relative buckets.

import { describe, expect, test } from "vitest";
import {
  classifyLifecycle,
  reviewMomentum,
  comparativeBucket,
  isStaleNoReviews,
} from "../comparative-signals";

describe("classifyLifecycle", () => {
  test("no reviews → NONE", () => {
    expect(
      classifyLifecycle({
        reviewCount: 0,
        velocity30d: 0,
        velocityPrev30d: 0,
        lastReviewAgeDays: null,
      }),
    ).toBe("NONE");
  });
  test("no recent reviews → DORMANT (precedence)", () => {
    expect(
      classifyLifecycle({
        reviewCount: 50,
        velocity30d: 0,
        velocityPrev30d: 3,
        lastReviewAgeDays: 130,
      }),
    ).toBe("DORMANT");
  });
  test("velocity halved → DYING", () => {
    expect(
      classifyLifecycle({
        reviewCount: 50,
        velocity30d: 1,
        velocityPrev30d: 4,
        lastReviewAgeDays: 10,
      }),
    ).toBe("DYING");
  });
  test("velocity surging → TRENDING", () => {
    expect(
      classifyLifecycle({
        reviewCount: 50,
        velocity30d: 5,
        velocityPrev30d: 2,
        lastReviewAgeDays: 5,
      }),
    ).toBe("TRENDING");
  });
  test("steady → STABLE", () => {
    expect(
      classifyLifecycle({
        reviewCount: 50,
        velocity30d: 3,
        velocityPrev30d: 3,
        lastReviewAgeDays: 5,
      }),
    ).toBe("STABLE");
  });
});

describe("reviewMomentum", () => {
  test("up / down / flat", () => {
    expect(reviewMomentum(5, 2).direction).toBe("up");
    expect(reviewMomentum(2, 5).direction).toBe("down");
    expect(reviewMomentum(3, 3).direction).toBe("flat");
    expect(reviewMomentum(5, 2).delta).toBe(3);
  });
});

describe("comparativeBucket", () => {
  test("maps percentile to bucket", () => {
    expect(comparativeBucket(5)).toBe("bottom_decile");
    expect(comparativeBucket(25)).toBe("bottom_quartile");
    expect(comparativeBucket(40)).toBe("below_median");
    expect(comparativeBucket(60)).toBe("above_median");
    expect(comparativeBucket(80)).toBe("top_quartile");
    expect(comparativeBucket(95)).toBe("top_decile");
  });
  test("clamps out-of-range", () => {
    expect(comparativeBucket(-5)).toBe("bottom_decile");
    expect(comparativeBucket(150)).toBe("top_decile");
  });
});

describe("isStaleNoReviews", () => {
  test("threshold at 120 days", () => {
    expect(isStaleNoReviews(130)).toBe(true);
    expect(isStaleNoReviews(30)).toBe(false);
    expect(isStaleNoReviews(null)).toBe(true);
  });
});
