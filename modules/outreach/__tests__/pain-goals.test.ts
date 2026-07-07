// A8 (touchpoints audit 2026-07-07) · the GOAL → PAIN-THEME bridge. Invariants:
// every mapped theme is a real PAIN_THEMES key; restricted groups map to their
// problem domain only; unrestricted groups (growing/under/other) and unknown /
// empty inputs derive to null — "no restriction", never "restrict to nothing".

import { describe, expect, test } from "vitest";

import { PAIN_THEMES } from "../first-touch";
import {
  ALL_PAIN_KEYS,
  PAIN_KEYS_BY_OUTCOME_GROUP,
  defaultPainKeysForSignals,
} from "../pain-goals";

describe("PAIN_KEYS_BY_OUTCOME_GROUP", () => {
  test("every mapped theme key is a real PAIN_THEMES key", () => {
    const catalog = new Set(PAIN_THEMES.map((t) => t.key));
    for (const keys of Object.values(PAIN_KEYS_BY_OUTCOME_GROUP)) {
      for (const k of keys) expect(catalog.has(k), k).toBe(true);
    }
  });

  test("restricted groups map to their problem domain", () => {
    expect(PAIN_KEYS_BY_OUTCOME_GROUP.reputation).toEqual([
      "unanswered_negative",
      "review_decline",
    ]);
    expect(PAIN_KEYS_BY_OUTCOME_GROUP["weak-web"]).toEqual([
      "slow_site",
      "no_booking",
    ]);
    // `no_booking` is deliberately absent from wasting: its presence gate
    // requires runsAds !== true, contradicting the group's ad-spend premise.
    expect(PAIN_KEYS_BY_OUTCOME_GROUP.wasting).toEqual([
      "ads_no_booking",
      "competitor_ads",
    ]);
  });

  test("growing / under / other are unrestricted (all themes)", () => {
    for (const g of ["growing", "under", "other"] as const) {
      expect(PAIN_KEYS_BY_OUTCOME_GROUP[g]).toEqual(ALL_PAIN_KEYS);
    }
  });
});

describe("defaultPainKeysForSignals", () => {
  test("reputation-goal signals → the review themes", () => {
    // Real SIG_META keys in the "reputation" outcome group.
    expect(
      defaultPainKeysForSignals(["unanswered_1star", "low_reply_rate"]),
    ).toEqual(["unanswered_negative", "review_decline"]);
  });

  test("mixed groups union in catalog order", () => {
    // reputation + weak-web ("slow_site" is also a SIG_META key).
    expect(
      defaultPainKeysForSignals(["unanswered_1star", "slow_site"]),
    ).toEqual([
      "unanswered_negative",
      "review_decline",
      "slow_site",
      "no_booking",
    ]);
  });

  test("a wasting-goal signal → the ad-spend themes", () => {
    expect(defaultPainKeysForSignals(["ads_without_pixel"])).toEqual([
      "ads_no_booking",
      "competitor_ads",
    ]);
  });

  test("null (= no restriction) for empty, unknown, and unrestricted-group inputs", () => {
    expect(defaultPainKeysForSignals([])).toBeNull();
    expect(defaultPainKeysForSignals(["not_a_signal"])).toBeNull();
    // "reviews_percentile" lives in "growing" → the union covers all themes.
    expect(defaultPainKeysForSignals(["reviews_percentile"])).toBeNull();
    // An unrestricted group in a MIX also lifts the restriction.
    expect(
      defaultPainKeysForSignals(["unanswered_1star", "reviews_percentile"]),
    ).toBeNull();
  });

  test("unknown keys are ignored, not treated as a restriction", () => {
    expect(defaultPainKeysForSignals(["garbage", "unanswered_1star"])).toEqual([
      "unanswered_negative",
      "review_decline",
    ]);
  });
});
