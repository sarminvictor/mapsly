// Phase 8 · the first-touch skeleton must be HONEST: only grounded signals
// produce copy, never an empty token, and email enforces a CAN-SPAM footer.

import { describe, expect, test } from "vitest";
import {
  buildFirstTouch,
  withCanSpamFooter,
  hasUnfilledToken,
} from "../first-touch";
import type { TouchSignals } from "../first-touch";

const base = {
  sellingWhat: "marketing",
  channel: "email" as const,
  mailingAddress: "1 Main St, Miami FL",
};

describe("buildFirstTouch — honesty", () => {
  test("only grounded signals appear; absent ones are dropped", () => {
    const t = buildFirstTouch(
      { businessName: "Glow Spa", city: "Miami", unansweredNegative: 3 },
      base,
    );
    expect(t.body).toContain("3 unanswered negative review");
    expect(t.usedSignals).toContain("unanswered_negative");
    // No slow-site claim because no LCP signal was provided.
    expect(t.body).not.toMatch(/load on mobile/);
    expect(t.droppedTokens).toContain("slow_site");
    expect(hasUnfilledToken(t.body)).toBe(false);
  });

  test("sharpest pain is chosen first (HIPAA > others)", () => {
    const t = buildFirstTouch(
      {
        businessName: "Derma Co",
        hipaaPixelRisk: true,
        unansweredNegative: 1,
        lcpSeconds: 6,
      },
      base,
    );
    expect(t.usedSignals[0]).toBe("hipaa_pixel_risk");
    expect(t.predictedTier).toBe("high"); // 3 grounded → but capped to top 2 chosen... see below
  });

  test("predicted tier scales with grounded-signal count", () => {
    const none = buildFirstTouch({ businessName: "A" }, base);
    expect(none.predictedTier).toBe("low");
    expect(none.usedSignals).toHaveLength(0);

    const one = buildFirstTouch(
      { businessName: "B", unansweredNegative: 2 },
      base,
    );
    expect(one.predictedTier).toBe("low"); // 1 chosen

    const two = buildFirstTouch(
      { businessName: "C", unansweredNegative: 2, lcpSeconds: 5 },
      base,
    );
    expect(two.predictedTier).toBe("medium"); // 2 chosen
  });

  test("never emits an unfilled token", () => {
    const t = buildFirstTouch({ businessName: "No Signals Inc" }, base);
    expect(hasUnfilledToken(t.body)).toBe(false);
    expect(t.body).toContain("No Signals Inc");
  });
});

describe("opener grammar — sellingWhat reads as a service, not a double noun", () => {
  test("a plural-category sellingWhat no longer yields a double noun", () => {
    const t = buildFirstTouch(
      { businessName: "Glow Spa", city: "West Kelowna", unansweredNegative: 1 },
      { ...base, sellingWhat: "med spas" },
    );
    // The old bug rendered "...for med spas businesses around ...".
    expect(t.body).not.toContain("med spas businesses");
    // The opener now composes the service after "local businesses".
    expect(t.body).toContain("I help local businesses");
    expect(t.body).toContain("with med spas");
  });

  test("direct opener (no city) drops the trailing ' businesses' noun", () => {
    const t = buildFirstTouch(
      { businessName: "Glow Spa", unansweredNegative: 1 },
      { ...base, sellingWhat: "med spas" },
    );
    expect(t.body).not.toContain("med spas businesses");
    expect(t.body).toContain("I help local businesses with med spas.");
  });

  test("warm opener composes the service after 'local businesses'", () => {
    const t = buildFirstTouch(
      { businessName: "Glow Spa", city: "West Kelowna", unansweredNegative: 1 },
      { ...base, tone: "warm", sellingWhat: "med spas" },
    );
    expect(t.body).not.toContain("med spas businesses");
    expect(t.body).toContain(
      "I help local businesses around West Kelowna with med spas",
    );
  });
});

describe("WP6-15 · per-agency pain-order diversification", () => {
  // Signals that populate the three band-1 pains (severity 80/70/65) so
  // rotation is observable, plus HIPAA (band 0) which must always lead.
  const multiBand: TouchSignals = {
    businessName: "Glow Spa",
    city: "Miami",
    hipaaPixelRisk: true, // band 0 · severity 100
    unansweredNegative: 2, // band 1 · severity 80
    reviewLifecycle: "DYING", // band 1 · severity 70
    runsAds: true,
    hasBookingTool: false, // band 1 · severity 65 (ads_no_booking)
  };

  test("no seed → canonical severity-desc order (unchanged behavior)", () => {
    const t = buildFirstTouch(multiBand, base);
    // HIPAA leads; step 1 takes the top 2 grounded pains by severity.
    expect(t.usedSignals[0]).toBe("hipaa_pixel_risk");
    expect(t.usedSignals[1]).toBe("unanswered_negative"); // 80 > 70 > 65
  });

  test("the standout (band 0) hook always leads regardless of seed", () => {
    for (const seed of ["agency-A", "agency-B", "zzz", "1"]) {
      const t = buildFirstTouch(multiBand, { ...base, agencySeed: seed });
      expect(t.usedSignals[0], `seed ${seed}`).toBe("hipaa_pixel_risk");
    }
  });

  test("different agencies can lead their band-1 pain differently", () => {
    // Drop HIPAA so band 1 is the top band and its rotation drives step 1.
    const band1Only: TouchSignals = {
      businessName: "Glow Spa",
      unansweredNegative: 2, // 80
      reviewLifecycle: "DYING", // 70
      runsAds: true,
      hasBookingTool: false, // 65
    };
    const leads = new Set<string>();
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const t = buildFirstTouch(band1Only, { ...base, agencySeed: seed });
      leads.add(t.usedSignals[0]);
    }
    // At least two distinct band-1 pains lead across the seed space.
    expect(leads.size).toBeGreaterThanOrEqual(2);
    // Every lead is a genuine band-1 pain (never a lower-band leak).
    for (const l of leads) {
      expect([
        "unanswered_negative",
        "review_decline",
        "ads_no_booking",
      ]).toContain(l);
    }
  });

  test("same seed is deterministic (idempotent / replayable)", () => {
    const a = buildFirstTouch(multiBand, { ...base, agencySeed: "agency-X" });
    const b = buildFirstTouch(multiBand, { ...base, agencySeed: "agency-X" });
    expect(a.body).toBe(b.body);
    expect(a.usedSignals).toEqual(b.usedSignals);
  });
});

describe("CAN-SPAM footer", () => {
  test("email gets a postal address + unsubscribe", () => {
    const t = buildFirstTouch(
      { businessName: "X", unansweredNegative: 1 },
      { ...base, unsubscribeUrl: "https://mapsly.ai/u/abc" },
    );
    expect(t.body).toContain("1 Main St, Miami FL");
    expect(t.body).toContain("Unsubscribe: https://mapsly.ai/u/abc");
  });

  test("email without a mailing address throws (compliance guard)", () => {
    expect(() =>
      buildFirstTouch(
        { businessName: "X", unansweredNegative: 1 },
        { sellingWhat: "marketing", channel: "email" },
      ),
    ).toThrow(/CAN-SPAM/);
  });

  test("non-email channels skip the footer", () => {
    const t = buildFirstTouch(
      { businessName: "X", unansweredNegative: 1 },
      { sellingWhat: "marketing", channel: "dm" },
    );
    expect(t.body).not.toContain("Unsubscribe");
  });

  test("withCanSpamFooter throws without an address", () => {
    expect(() => withCanSpamFooter("hi", {})).toThrow(/mailing address/);
  });
});

describe("WP7-4 · CASL vs CAN-SPAM footer branch", () => {
  test("a US recipient gets the plain CAN-SPAM footer (address + unsubscribe, no consent line)", () => {
    const t = buildFirstTouch(
      { businessName: "X", country: "US", unansweredNegative: 1 },
      { ...base, unsubscribeUrl: "https://mapsly.ai/u/abc" },
    );
    expect(t.body).toContain("1 Main St, Miami FL");
    expect(t.body).toContain("Unsubscribe: https://mapsly.ai/u/abc");
    // No CASL consent-basis language for a US recipient.
    expect(t.body).not.toContain("receiving this because");
  });

  test("a CA recipient gets the CASL framing: sender ID + consent basis + address + unsubscribe", () => {
    const t = buildFirstTouch(
      { businessName: "X", country: "CA", unansweredNegative: 1 },
      {
        ...base,
        unsubscribeUrl: "https://mapsly.ai/u/abc",
        senderName: "Anchor Local",
      },
    );
    // Sender identification (CASL requirement).
    expect(t.body).toContain("Anchor Local");
    // Consent-basis language.
    expect(t.body).toContain("receiving this because");
    // Still carries the address + unsubscribe.
    expect(t.body).toContain("1 Main St, Miami FL");
    expect(t.body).toContain("Unsubscribe: https://mapsly.ai/u/abc");
  });

  test("null/unknown country defaults to CAN-SPAM (no CASL consent line)", () => {
    const t = buildFirstTouch(
      { businessName: "X", country: null, unansweredNegative: 1 },
      { ...base },
    );
    expect(t.body).toContain("1 Main St, Miami FL");
    expect(t.body).not.toContain("receiving this because");
  });

  test("withCanSpamFooter · CA branch injects the consent basis even without a sender name", () => {
    const out = withCanSpamFooter("hi", {
      mailingAddress: "1 A St",
      unsubscribeUrl: "https://x/u/1",
      country: "ca", // case-insensitive
    });
    expect(out).toContain("receiving this because");
    expect(out).toContain("commercial message"); // generic sender-ID fallback
    expect(out).toContain("1 A St");
  });
});
