// Phase 8 · the first-touch skeleton must be HONEST: only grounded signals
// produce copy, never an empty token, and email enforces a CAN-SPAM footer.

import { describe, expect, test } from "vitest";
import {
  buildFirstTouch,
  withCanSpamFooter,
  hasUnfilledToken,
} from "../first-touch";

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
    expect(() => withCanSpamFooter("hi", {})).toThrow(/CAN-SPAM/);
  });
});
