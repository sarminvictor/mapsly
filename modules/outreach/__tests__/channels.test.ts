// Phase 8 · buildChannelTouch renders the same grounded skeleton at
// channel-appropriate length/format: email keeps the CAN-SPAM footer, phone is
// a short call script, social is a 1–2 line DM with NO footer.

import { describe, expect, test } from "vitest";
import { buildChannelTouch } from "../channels";
import type { TouchSignals } from "../first-touch";

const signals: TouchSignals = {
  businessName: "Glow Spa",
  city: "Miami",
  noun: "patients",
  unansweredNegative: 3,
  lcpSeconds: 5,
};

describe("buildChannelTouch — email", () => {
  test("delegates to the full skeleton + CAN-SPAM footer", () => {
    const t = buildChannelTouch(signals, {
      channel: "email",
      sellingWhat: "marketing",
      mailingAddress: "1 Main St, Miami FL",
      unsubscribeUrl: "https://mapsly.ai/u/abc",
    });
    expect(t.channel).toBe("email");
    expect(t.subject).toBeTruthy();
    expect(t.body).toContain("3 unanswered negative review");
    // Email has the footer.
    expect(t.body).toContain("1 Main St, Miami FL");
    expect(t.body).toContain("Unsubscribe:");
    expect(t.body).not.toMatch(/\{\{[^}]+\}\}/);
  });

  test("email without a mailing address throws (CAN-SPAM)", () => {
    expect(() =>
      buildChannelTouch(signals, {
        channel: "email",
        sellingWhat: "marketing",
      }),
    ).toThrow(/CAN-SPAM/);
  });
});

describe("buildChannelTouch — phone_script", () => {
  test("renders a short spoken script with cues, no subject, no footer", () => {
    const t = buildChannelTouch(signals, {
      channel: "phone_script",
      sellingWhat: "marketing",
    });
    expect(t.channel).toBe("phone_script");
    expect(t.subject).toBeUndefined();
    // Spoken-script cue labels for the caller.
    expect(t.body).toContain("[Open]");
    expect(t.body).toContain("[Ask]");
    expect(t.body).toContain("[If yes]");
    // No CAN-SPAM footer (that's email-only).
    expect(t.body).not.toContain("Unsubscribe");
    // Grounded fact carried through.
    expect(t.body).toContain("3 unanswered negative review");
    expect(t.body).not.toMatch(/\{\{[^}]+\}\}/);
    // The grounded reasons + tier still flow through.
    expect(t.usedSignals.length).toBeGreaterThan(0);
  });
});

describe("opener grammar — no double noun, consistent across channels", () => {
  test("phone opener drops ' businesses' after a plural sellingWhat", () => {
    const t = buildChannelTouch(signals, {
      channel: "phone_script",
      sellingWhat: "med spas",
    });
    // Old bug rendered "...I work with med spas businesses around Miami.".
    expect(t.body).not.toContain("med spas businesses");
    // New phrasing composes the service after "local businesses".
    expect(t.body).toContain(
      "I help local businesses around Miami with med spas",
    );
  });

  test("email and phone openers share the same 'I help local businesses ... with <sellingWhat>' composition", () => {
    const email = buildChannelTouch(signals, {
      channel: "email",
      sellingWhat: "med spas",
      mailingAddress: "1 Main St, Miami FL",
      unsubscribeUrl: "https://mapsly.ai/u/abc",
    });
    const phone = buildChannelTouch(signals, {
      channel: "phone_script",
      sellingWhat: "med spas",
    });
    for (const body of [email.body, phone.body]) {
      expect(body).not.toContain("med spas businesses");
      expect(body).toContain("I help local businesses");
      expect(body).toContain("with med spas");
    }
  });
});

describe("buildChannelTouch — social_dm", () => {
  test("renders a 1–2 line DM, no subject, no footer, no signature", () => {
    const t = buildChannelTouch(signals, {
      channel: "social_dm",
      sellingWhat: "marketing",
    });
    expect(t.channel).toBe("social_dm");
    expect(t.subject).toBeUndefined();
    // No footer / unsubscribe on a DM (the "\n\n—\n" footer delimiter is email-only).
    expect(t.body).not.toContain("Unsubscribe");
    expect(t.body).not.toContain("\n\n—\n");
    // 1–2 lines only.
    const lines = t.body.split("\n").filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(2);
    // Names the business + carries a grounded hook.
    expect(t.body).toContain("Glow Spa");
    expect(t.body).not.toMatch(/\{\{[^}]+\}\}/);
  });

  test("no-signal business still produces a clean DM (no empty token)", () => {
    const t = buildChannelTouch(
      { businessName: "Quiet Co" },
      { channel: "social_dm", sellingWhat: "marketing" },
    );
    expect(t.body).toContain("Quiet Co");
    expect(t.body).not.toMatch(/\{\{[^}]+\}\}/);
    expect(t.body.split("\n").filter(Boolean).length).toBeLessThanOrEqual(2);
  });
});
