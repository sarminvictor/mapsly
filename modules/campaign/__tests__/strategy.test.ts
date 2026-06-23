// Phase 8 · mapCampaignToStrategy is PURE — a deterministic intent classifier
// over free text. No mocks. Covers the ≥4 selling-intents (website, booking
// SaaS, reputation, PPC, SEO) + the general fallback.

import { describe, expect, test } from "vitest";
import {
  classifyIntent,
  mapCampaignToStrategy,
  STRATEGY_TEMPLATE_SEEDS,
} from "../strategy";

describe("classifyIntent", () => {
  test("marketing / website intent → website bucket", () => {
    expect(classifyIntent({ sellingWhat: "digital marketing" })).toBe(
      "website",
    );
    expect(classifyIntent({ sellingWhat: "I build websites" })).toBe("website");
  });

  test("booking / scheduling SaaS → booking_saas bucket", () => {
    expect(classifyIntent({ sellingWhat: "booking scheduling SaaS" })).toBe(
      "booking_saas",
    );
    expect(classifyIntent({ sellingWhat: "appointment software" })).toBe(
      "booking_saas",
    );
  });

  test("reviews / reputation → reputation bucket", () => {
    expect(classifyIntent({ sellingWhat: "reputation management" })).toBe(
      "reputation",
    );
    expect(classifyIntent({ sellingWhat: "we fix bad reviews" })).toBe(
      "reputation",
    );
  });

  test("ppc / paid ads → ads_ppc bucket", () => {
    expect(classifyIntent({ sellingWhat: "Google Ads management" })).toBe(
      "ads_ppc",
    );
  });

  test("seo → seo bucket", () => {
    expect(classifyIntent({ sellingWhat: "local SEO" })).toBe("seo");
  });

  test("unknown intent → general fallback", () => {
    expect(classifyIntent({ sellingWhat: "artisanal candles" })).toBe(
      "general",
    );
  });

  test("painPoints can disambiguate when sellingWhat is vague", () => {
    expect(
      classifyIntent({
        sellingWhat: "agency services",
        painPoints: "they have unanswered negative reviews",
      }),
    ).toBe("reputation");
  });
});

describe("mapCampaignToStrategy — rules", () => {
  test("marketing/website → weak-website filters + lighthouse enrichment", () => {
    const s = mapCampaignToStrategy({ sellingWhat: "marketing websites" });
    expect(s.recommendedEnrichments).toContain("lighthouse");
    const keys = s.suggestedFilters.map((f) => f.signalKey);
    expect(keys).toContain("lighthouse_performance");
    expect(keys).toContain("lcp_seconds");
    // weights emphasize site quality.
    expect(s.signalWeights.lighthouse_performance).toBeGreaterThan(0);
    expect(s.rationale.length).toBeGreaterThan(0);
  });

  test("booking SaaS → has_booking_widget=false filter + tech enrichment", () => {
    const s = mapCampaignToStrategy({ sellingWhat: "booking scheduling SaaS" });
    expect(s.recommendedEnrichments).toContain("tech");
    const bookingFilter = s.suggestedFilters.find(
      (f) => f.signalKey === "has_booking_widget",
    );
    expect(bookingFilter).toBeDefined();
    expect(bookingFilter?.comparator).toBe("=");
    expect(bookingFilter?.value).toBe(false);
  });

  test("reputation → unanswered / reply-rate filters + reviews enrichment", () => {
    const s = mapCampaignToStrategy({ sellingWhat: "reputation management" });
    expect(s.recommendedEnrichments).toContain("reviews");
    const keys = s.suggestedFilters.map((f) => f.signalKey);
    expect(keys).toContain("unanswered_count");
    expect(keys).toContain("reply_rate");
    // reply_rate filter targets LOW reply rate (< threshold).
    const reply = s.suggestedFilters.find((f) => f.signalKey === "reply_rate");
    expect(reply?.comparator).toBe("<");
  });

  test("ppc → not-advertising filters + meta/google ads enrichment", () => {
    const s = mapCampaignToStrategy({ sellingWhat: "PPC ad management" });
    expect(s.recommendedEnrichments).toEqual(
      expect.arrayContaining(["meta_ads", "google_ads"]),
    );
    const metaFilter = s.suggestedFilters.find(
      (f) => f.signalKey === "has_active_meta_ads",
    );
    expect(metaFilter?.value).toBe(false);
  });

  test("output is a fresh copy (no shared references between calls)", () => {
    const a = mapCampaignToStrategy({ sellingWhat: "websites" });
    const b = mapCampaignToStrategy({ sellingWhat: "websites" });
    expect(a.suggestedFilters).not.toBe(b.suggestedFilters);
    a.suggestedFilters.push({
      signalKey: "x",
      comparator: "=",
      value: true,
    });
    expect(b.suggestedFilters.find((f) => f.signalKey === "x")).toBeUndefined();
  });
});

describe("STRATEGY_TEMPLATE_SEEDS", () => {
  test("seeds at least the website + booking templates with unique slugs", () => {
    const slugs = STRATEGY_TEMPLATE_SEEDS.map((t) => t.slug);
    expect(slugs).toContain("sell-websites");
    expect(slugs).toContain("sell-booking-saas");
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const t of STRATEGY_TEMPLATE_SEEDS) {
      expect(t.recommendedEnrichments.length).toBeGreaterThan(0);
      expect(Object.keys(t.signalWeights).length).toBeGreaterThan(0);
    }
  });
});
