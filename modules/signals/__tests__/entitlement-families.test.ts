import { describe, expect, test } from "vitest";

import { SIGNALS } from "../registry";
import {
  entitledSignalKeys,
  isGatedSignal,
  isSearchBasicSignal,
  signalFamily,
  SIGNAL_FAMILY,
  type ResearchFamily,
} from "../entitlement-families";

describe("signal → research-family entitlement map", () => {
  test("every registry signal resolves to a family or null (no gaps)", () => {
    const keys = Object.keys(SIGNALS);
    expect(keys.length).toBeGreaterThan(100); // ~105 today
    for (const k of keys) {
      // present in the static map, and typed as ResearchFamily | null
      expect(k in SIGNAL_FAMILY).toBe(true);
    }
    expect(Object.keys(SIGNAL_FAMILY).length).toBe(keys.length);
  });

  test("the basic / gated partition is exhaustive and disjoint", () => {
    const keys = Object.keys(SIGNALS);
    for (const k of keys) {
      // exactly one of the two holds for every signal
      expect(isGatedSignal(k)).toBe(!isSearchBasicSignal(k));
    }
    const basic = keys.filter(isSearchBasicSignal).length;
    const gated = keys.filter(isGatedSignal).length;
    expect(basic + gated).toBe(keys.length);
    // The moat: the large majority of the 105 signals are research-gated.
    expect(gated).toBeGreaterThanOrEqual(60);
    expect(basic).toBeGreaterThanOrEqual(35);
  });

  test("discovery / profile / internal signals are basic (null family)", () => {
    for (const k of [
      "has_phone",
      "has_website",
      "has_email",
      "photo_count",
      "category",
      "is_active",
      "exclude_already_contacted",
      "new_competitors_90d", // computed-from-snapshots, Maps-number cell agg
      "rating_gap_to_leader",
      "phone_only",
    ]) {
      expect(signalFamily(k)).toBeNull();
      expect(isSearchBasicSignal(k)).toBe(true);
    }
  });

  test("rating / review_count are basic (raw Maps numbers, not Review rows)", () => {
    expect(signalFamily("rating")).toBeNull();
    expect(signalFamily("review_count")).toBeNull();
  });

  test("contacts signals map to the contacts family but count as search-basic", () => {
    for (const k of [
      "is_reachable",
      "email_count",
      "phone_count",
      "has_owner_contact",
    ]) {
      expect(signalFamily(k)).toBe("contacts");
      expect(isGatedSignal(k)).toBe(false);
      expect(isSearchBasicSignal(k)).toBe(true);
    }
  });

  test("research-gated signals map to the correct paid family", () => {
    const expected: Record<string, ResearchFamily> = {
      reply_rate: "reviews",
      unanswered_count: "reviews",
      avg_sentiment: "reviews",
      msi_rank: "reviews", // computed-from-snapshots → reviews
      reviews_vs_cell_pct: "reviews",
      mapsly_score: "reviews",
      local_pack_rank: "serp",
      share_of_voice: "serp", // computed-from-snapshots → serp
      lighthouse_performance: "lighthouse",
      lcp_seconds: "lighthouse",
      has_active_meta_ads: "meta_ads",
      estimated_monthly_ad_spend: "meta_ads", // computed-from-snapshots → meta_ads
      has_active_google_ads: "google_ads",
      cms_platform: "tech",
      has_meta_pixel: "tech",
      compliance_gap: "tech", // playbook → evidence family
      ada_risk: "lighthouse", // playbook → evidence family
    };
    for (const [k, fam] of Object.entries(expected)) {
      expect(signalFamily(k)).toBe(fam);
      expect(isGatedSignal(k)).toBe(true);
      expect(isSearchBasicSignal(k)).toBe(false);
    }
  });

  test("entitledSignalKeys keeps discovery + entitled families, drops the rest", () => {
    const picked = [
      "has_website", // basic → always kept
      "reply_rate", // reviews → kept only if entitled
      "local_pack_rank", // serp → dropped
      "is_reachable", // contacts → kept only if entitled
    ];
    const entitled = new Set<ResearchFamily>(["reviews", "contacts"]);
    expect(entitledSignalKeys(picked, entitled).sort()).toEqual(
      ["has_website", "is_reachable", "reply_rate"].sort(),
    );
    // With no entitlements, only discovery-basic (null) signals survive.
    expect(entitledSignalKeys(picked, new Set())).toEqual(["has_website"]);
  });
});
