// Phase 8 · the first-touch skeleton must be HONEST: only grounded signals
// produce copy, never an empty token, and email enforces a compliance footer.
// Touchpoints audit 2026-07-07 invariants: plain body-backed subjects (A1–A3),
// percentile-gated comparative copy (A4), partial-pull "at least N" (A5),
// pitch-aware ranking (A7), US-only CAN-SPAM short footer (A11), human opt-out
// (A13), short-name CTA variants (A14), per-business frame variation (A16).

import { describe, expect, test } from "vitest";
import {
  buildFirstTouch,
  withCanSpamFooter,
  hasUnfilledToken,
  shortBusinessName,
  PAIN_THEMES,
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
    // A14 · the body names the business SHORT (legal suffix stripped).
    expect(t.body).toContain("No Signals");
    expect(t.body).not.toContain("No Signals Inc");
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

describe("WP7-4 / A11 · CASL vs CAN-SPAM footer branch (US-only short form)", () => {
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

  test("A11 · null/unknown country defaults to the CASL footer (stricter-safe superset)", () => {
    // Pre-A11 an unknown-country lead (possibly Canadian) silently got the
    // short CAN-SPAM footer — CASL-non-compliant for a CA recipient. The CASL
    // form is compliant for BOTH regimes, so unknown → CASL.
    const t = buildFirstTouch(
      { businessName: "X", country: null, unansweredNegative: 1 },
      { ...base },
    );
    expect(t.body).toContain("1 Main St, Miami FL");
    expect(t.body).toContain("receiving this because");
  });

  test("A11 · a non-US, non-CA country also gets the CASL footer", () => {
    const out = withCanSpamFooter("hi", {
      mailingAddress: "1 A St",
      country: "GB",
    });
    expect(out).toContain("receiving this because");
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

  test("A13 · no unsubscribeUrl → a human reply ask, never 'Reply STOP' (both branches)", () => {
    const us = withCanSpamFooter("hi", {
      mailingAddress: "1 A St",
      country: "US",
    });
    const ca = withCanSpamFooter("hi", {
      mailingAddress: "1 A St",
      country: "CA",
    });
    for (const out of [us, ca]) {
      expect(out).toContain(`Just reply "no" and I won't email again.`);
      expect(out).not.toContain("STOP");
    }
    // unsubscribeUrl set → the Unsubscribe line, unchanged.
    const withUrl = withCanSpamFooter("hi", {
      mailingAddress: "1 A St",
      country: "US",
      unsubscribeUrl: "https://x/u/1",
    });
    expect(withUrl).toContain("Unsubscribe: https://x/u/1");
    expect(withUrl).not.toContain(`Just reply "no"`);
  });
});

// ── Touchpoints audit 2026-07-07 · A1–A5, A7, A14, A16 ──────────────────────

describe("A1/A2/A3 · subjects: plain, short, cohort-varied, body-backed", () => {
  // One signal set per theme that makes it the TOP (only allowed) pain.
  const themeSignals: Record<string, TouchSignals> = {
    hipaa_pixel_risk: { businessName: "Derma Co", hipaaPixelRisk: true },
    unanswered_negative: { businessName: "Glow Spa", unansweredNegative: 2 },
    review_decline: { businessName: "Glow Spa", reviewLifecycle: "DYING" },
    ads_no_booking: {
      businessName: "Glow Spa",
      runsAds: true,
      hasBookingTool: false,
    },
    slow_site: { businessName: "Glow Spa", lcpSeconds: 8 },
    competitor_ads: {
      businessName: "Glow Spa",
      city: "Kelowna",
      competitorAdsCount: 3,
    },
    no_booking: { businessName: "Glow Spa", hasBookingTool: false },
  };

  test("every theme × variant: ≤50 chars, no internal vocabulary, no legal name, numbers in the body", () => {
    // The audit's worst live output: "… — review momentum declining vs cell"
    // and "… — slow lcp" shipped to prospects. None of these may ever appear.
    const banned = ["vs cell", "lcp", "cell", "momentum", "mapsly", " — "];
    for (const theme of PAIN_THEMES.map((t) => t.key)) {
      const signals = themeSignals[theme];
      expect(signals, `signal fixture for ${theme}`).toBeTruthy();
      const subjects = new Set<string>();
      for (let i = 0; i < 24; i += 1) {
        const t = buildFirstTouch(signals, {
          ...base,
          allowedPainKeys: [theme],
          variantSeed: `biz-${i}`,
        });
        expect(t.usedSignals[0], theme).toBe(theme);
        const subject = t.subject ?? "";
        subjects.add(subject);
        expect(subject.length, subject).toBeLessThanOrEqual(50);
        expect(subject.split(/\s+/).length, subject).toBeLessThanOrEqual(8);
        for (const b of banned) {
          expect(subject.toLowerCase(), subject).not.toContain(b);
        }
        // Never the (legal) business name padding a pain subject.
        expect(subject).not.toContain(signals.businessName);
        // A3 · every number the subject claims appears verbatim in the body.
        const bodyNums = new Set(t.body.match(/\d+(?:\.\d+)?/g) ?? []);
        for (const n of subject.match(/\d+(?:\.\d+)?/g) ?? []) {
          expect(bodyNums.has(n), `subject number ${n} in body`).toBe(true);
        }
      }
      // A2 · the cohort doesn't share one byte-identical subject.
      expect(subjects.size, theme).toBeGreaterThanOrEqual(2);
    }
  });

  test("same business (seed) always gets the same subject — deterministic", () => {
    const build = () =>
      buildFirstTouch(themeSignals.unanswered_negative, {
        ...base,
        variantSeed: "biz-77",
      });
    expect(build().subject).toBe(build().subject);
  });

  test("A3 structural: the subject derives from the TOP CHOSEN pain (which is in the body)", () => {
    // slow_site subject variant carries the LCP number formatted exactly like
    // the body's line — claim and evidence can't drift apart.
    const t = buildFirstTouch(
      { businessName: "Glow Spa", lcpSeconds: 23.2 },
      { ...base, variantSeed: "pick-lcp-variant-1" },
    );
    expect(t.usedSignals[0]).toBe("slow_site");
    expect(t.body).toContain("23.2s");
  });

  test("sparse lead keeps a plain generic subject with the SHORT name", () => {
    const t = buildFirstTouch({ businessName: "No Signals Inc" }, base);
    expect(t.subject).toBe("a quick look at No Signals");
  });

  test("follow-up subjects read as replies with the SHORT name", () => {
    const t = buildFirstTouch(
      { businessName: "Glow Spa LLC", unansweredNegative: 2 },
      { ...base, sequenceStep: 2 },
    );
    expect(t.subject).toBe("re: Glow Spa — a quick look");
  });
});

describe("A4 · comparative claim gated on reviewsVsCellPercentile", () => {
  test("percentile null → self-referential copy only (no market claim)", () => {
    const dying = buildFirstTouch(
      { businessName: "X", reviewLifecycle: "DYING" },
      base,
    );
    expect(dying.body).toContain("Your review pace has been slipping.");
    expect(dying.body).not.toContain("neighbors");

    const dormant = buildFirstTouch(
      { businessName: "X", reviewLifecycle: "DORMANT" },
      base,
    );
    expect(dormant.body).toContain("Your reviews have gone quiet for months.");
    expect(dormant.body).not.toContain("neighbors");
  });

  test("percentile present → the comparative phrasing is allowed", () => {
    const t = buildFirstTouch(
      {
        businessName: "X",
        reviewLifecycle: "DYING",
        reviewsVsCellPercentile: 30,
      },
      base,
    );
    expect(t.body).toContain("while neighbors keep climbing");
  });
});

describe("A5 · partial-pull honesty ('at least N')", () => {
  test("partial review sample → 'at least N', number exact", () => {
    const t = buildFirstTouch(
      { businessName: "X", unansweredNegative: 2, reviewSamplePartial: true },
      base,
    );
    expect(t.body).toContain("at least 2 unanswered negative reviews");
  });

  test("full pull → the exact count, no hedge", () => {
    const t = buildFirstTouch(
      { businessName: "X", unansweredNegative: 2, reviewSamplePartial: false },
      base,
    );
    expect(t.body).toContain("You have 2 unanswered negative reviews");
    expect(t.body).not.toContain("at least");
  });
});

describe("A7 · pitch-aware pain ranking", () => {
  const zahra: TouchSignals = {
    businessName: "Zahra Salon",
    unansweredNegative: 2, // sev 80
    reviewLifecycle: "DYING", // sev 70
    lcpSeconds: 23.2, // sev 55 → boosted to 85 under a speed pitch
  };

  test("a 23.2s LCP under 'website speed fixes' lands in step 1's top-2 (the audit acceptance)", () => {
    const t = buildFirstTouch(zahra, {
      ...base,
      sellingWhat: "website speed fixes",
    });
    expect(t.usedSignals.slice(0, 2)).toContain("slow_site");
  });

  test("no keyword match → canonical severity order unchanged", () => {
    const t = buildFirstTouch(zahra, { ...base, sellingWhat: "marketing" });
    expect(t.usedSignals).toEqual(["unanswered_negative", "review_decline"]);
  });

  test("the boost is capped below the HIPAA band — the standout still leads", () => {
    const t = buildFirstTouch(
      { ...zahra, hipaaPixelRisk: true },
      { ...base, sellingWhat: "website speed fixes" },
    );
    expect(t.usedSignals[0]).toBe("hipaa_pixel_risk");
  });

  test("a review-pitch boosts the review themes", () => {
    const t = buildFirstTouch(
      { businessName: "X", reviewLifecycle: "DYING", lcpSeconds: 9 },
      { ...base, sellingWhat: "review management" },
    );
    // review_decline (70+30 capped 89) outranks slow_site (55).
    expect(t.usedSignals[0]).toBe("review_decline");
  });
});

describe("A14 · shortBusinessName + CTA variants", () => {
  test("strips legal suffixes and descriptor tails conservatively, never empty", () => {
    expect(
      shortBusinessName("Serenity Aesthetics Laser & Advanced Skin Care Inc"),
    ).toBe("Serenity Aesthetics Laser & Advanced Skin Care");
    expect(shortBusinessName("Glow Spa LLC")).toBe("Glow Spa");
    expect(shortBusinessName("Glow Spa, Ltd.")).toBe("Glow Spa");
    expect(shortBusinessName("Tommy Gun's Original Barbershop")).toBe(
      "Tommy Gun's Original Barbershop",
    );
    // A dash descriptor tail only comes off when the name is long (>30).
    expect(
      shortBusinessName("Serenity Aesthetics — Laser & Advanced Skin Care"),
    ).toBe("Serenity Aesthetics");
    expect(shortBusinessName("Glow - Spa")).toBe("Glow - Spa");
    // Never a dangling "&", never empty.
    expect(shortBusinessName("Smith & Co")).toBe("Smith & Co");
    expect(shortBusinessName("Inc")).toBe("Inc");
    expect(shortBusinessName("Glow Spa (Downtown)")).toBe("Glow Spa");
    expect(shortBusinessName("Glow Spa · Med Spa Kelowna")).toBe("Glow Spa");
  });

  test("the CTA names the business SHORT — no legal suffix ships", () => {
    const t = buildFirstTouch(
      { businessName: "Serenity Aesthetics Inc", unansweredNegative: 2 },
      base, // no variantSeed → the canonical CTA variant
    );
    expect(t.body).toContain(
      "Want a quick rundown of what I found for Serenity Aesthetics?",
    );
    expect(t.body).not.toContain("Inc?");
  });

  test("CTA variants rotate per business, stay exactly one question", () => {
    const signals: TouchSignals = {
      businessName: "Glow Spa",
      unansweredNegative: 2,
    };
    const ctas = new Set<string>();
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      // Footer-free channel so the last paragraph IS the close.
      const t = buildFirstTouch(signals, {
        sellingWhat: "marketing",
        channel: "dm",
        variantSeed: seed,
      });
      const paras = t.body.split(/\n{2,}/).filter(Boolean);
      const close = paras[paras.length - 1];
      ctas.add(close);
      expect(close.match(/\?/g) ?? []).toHaveLength(1);
      expect(close.endsWith("?")).toBe(true);
    }
    expect(ctas.size).toBeGreaterThanOrEqual(2);
  });
});

describe("A16 · per-business body variation (anti-fingerprinting)", () => {
  const signals: TouchSignals = {
    businessName: "Glow Spa",
    city: "Kelowna",
    unansweredNegative: 2,
    reviewLifecycle: "DYING",
  };

  test("a same-agency cohort with identical pains produces materially differing bodies", () => {
    const bodies = new Set<string>();
    for (const biz of ["b1", "b2", "b3", "b4", "b5", "b6"]) {
      const t = buildFirstTouch(signals, {
        ...base,
        agencySeed: "agency-1",
        variantSeed: biz,
      });
      bodies.add(t.body);
      // The grounded FACTS never vary.
      expect(t.body).toContain("2 unanswered negative reviews");
    }
    expect(bodies.size).toBeGreaterThanOrEqual(2);
  });

  test("no variantSeed → the canonical phrasing (legacy byte-stable)", () => {
    const t = buildFirstTouch(signals, base);
    expect(t.body).toContain(
      "Hi — I help local businesses around Kelowna with marketing.",
    );
    expect(t.body).toContain(
      "Want a quick rundown of what I found for Glow Spa?",
    );
  });

  test("same seed → same body (deterministic / replayable)", () => {
    const a = buildFirstTouch(signals, { ...base, variantSeed: "biz-9" });
    const b = buildFirstTouch(signals, { ...base, variantSeed: "biz-9" });
    expect(a.body).toBe(b.body);
    expect(a.subject).toBe(b.subject);
  });
});
