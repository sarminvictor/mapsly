import { describe, expect, test } from "vitest";

import { detectPhiRisk, summarizeReplyRisks } from "../phi-check";

/**
 * Detector contract:
 *   - flags replies that confirm a patient relationship, name a
 *     treatment, pin a visit/date, or discuss payment — in public
 *   - does NOT flag generic warm thank-you replies (false positives
 *     erode trust in the whole privacy check)
 *   - `high` for patient-status / treatment (the fined patterns),
 *     `caution` for date / payment only
 *
 * English-only vocabulary for now — es/fr replies pass through
 * unflagged. Acceptable v1 scope; the upstream gate (medical category)
 * and the AI-draft guardrail still apply in every locale.
 */
describe("detectPhiRisk · positives", () => {
  test("real example · consent + follow-up reply flags high (patient-status)", () => {
    // Paraphrase of the real Calgary clinic reply that motivated S2.
    const result = detectPhiRisk(
      "Besides the standard consent and release form, the only mention is to allow us any follow up required after the appointment.",
    );
    expect(result.flagged).toBe(true);
    expect(result.level).toBe("high");
    expect(result.matches.map((m) => m.kind)).toContain("patient-status");
  });

  test("real example · syringe/left-over reply flags high (treatment)", () => {
    const result = detectPhiRisk(
      "Since 2016 we have refrained to offered 1/4 syringe. You wanted any left over in your face and we explained why we could not.",
    );
    expect(result.flagged).toBe(true);
    expect(result.level).toBe("high");
    expect(result.matches.map((m) => m.kind)).toContain("treatment");
  });

  test.each([
    "Thanks so much for coming in last week.",
    "We loved having you as a patient.",
    "We loved having you as a client.",
    "Our records show you were a patient in 2023.",
    "We have no record of you in our system.",
    "We have no record of your visit.",
    "We discussed this during your appointment.",
    "Per your consent form, we documented everything.",
    "Please follow up with us about your results.",
    "We hope your recovery is going smoothly.",
  ])("patient-status flags high: %s", (text) => {
    const result = detectPhiRisk(text);
    expect(result.flagged).toBe(true);
    expect(result.level).toBe("high");
    expect(result.matches.map((m) => m.kind)).toContain("patient-status");
  });

  test("denial also flags · 'you weren't a patient' (curly apostrophe)", () => {
    const result = detectPhiRisk("As we told you, you weren’t a patient here.");
    expect(result.flagged).toBe(true);
    expect(result.level).toBe("high");
    expect(result.matches.map((m) => m.kind)).toContain("patient-status");
  });

  test.each([
    "We never recommend more Botox than needed.",
    "The filler we used is FDA approved.",
    "We always explain the injection process beforehand.",
    "Our laser settings are calibrated per session.",
    "We charged for 40 units as agreed.",
    "Your prescription was sent to the pharmacy.",
    "That procedure carries some swelling.",
    "The surgery went exactly as planned.",
    "We reviewed the treatment plan together.",
  ])("treatment vocabulary flags high: %s", (text) => {
    const result = detectPhiRisk(text);
    expect(result.flagged).toBe(true);
    expect(result.level).toBe("high");
    expect(result.matches.map((m) => m.kind)).toContain("treatment");
  });

  test("service-name injection · business's own service flags as treatment", () => {
    const text = "We're sorry the HydraFacial didn't meet your expectations.";
    // Without the service name → clean.
    expect(detectPhiRisk(text).flagged).toBe(false);
    // With it → high.
    const result = detectPhiRisk(text, {
      serviceNames: ["HydraFacial", "Lip filler"],
    });
    expect(result.flagged).toBe(true);
    expect(result.level).toBe("high");
    expect(result.matches).toContainEqual(
      expect.objectContaining({ kind: "treatment" }),
    );
  });

  test("multi-word service name matches case-insensitively", () => {
    const result = detectPhiRisk("The brow lamination took longer that day.", {
      serviceNames: ["Brow Lamination"],
    });
    expect(result.flagged).toBe(true);
    expect(result.level).toBe("high");
  });

  test("short service names (< 3 chars) are skipped, regex chars escaped", () => {
    // "IV" alone would hit "Ivy"-style words; "(VIP)" must not blow up
    // the RegExp constructor.
    const result = detectPhiRisk("Ivy helped you at the front desk.", {
      serviceNames: ["IV", "(VIP) package"],
    });
    expect(result.flagged).toBe(false);
  });

  test.each([
    "You stopped by on March 12 and we talked it through.",
    "When you visited last Tuesday the lobby was busy.",
    "A lot has changed since your visit.",
  ])("visit/date reference flags caution: %s", (text) => {
    const result = detectPhiRisk(text);
    expect(result.flagged).toBe(true);
    expect(result.matches.map((m) => m.kind)).toContain("visit-or-date");
  });

  test.each([
    "We charged $150 as quoted.",
    "Your card was refunded the same day.",
    "As you know, you paid in two installments.",
    "The deposit is non-refundable after 24 hours.",
  ])("payment reference flags: %s", (text) => {
    const result = detectPhiRisk(text);
    expect(result.flagged).toBe(true);
    expect(result.matches.map((m) => m.kind)).toContain("payment");
  });

  test("level is caution when only date/payment match, high once treatment joins", () => {
    const cautionOnly = detectPhiRisk("We issued the refund on March 3.");
    expect(cautionOnly.flagged).toBe(true);
    expect(cautionOnly.level).toBe("caution");

    const escalated = detectPhiRisk(
      "We issued the refund on March 3 for the laser session.",
    );
    expect(escalated.level).toBe("high");
  });

  test("excerpt carries the matched phrase with surrounding context", () => {
    const result = detectPhiRisk(
      "We are sorry to hear this. Per your consent form we keep records of everything discussed.",
    );
    const statusMatch = result.matches.find((m) => m.kind === "patient-status");
    expect(statusMatch?.excerpt).toContain("your consent");
  });

  test("matches are capped and deduped", () => {
    const result = detectPhiRisk(
      "Botox, filler, syringe, injection, laser, units, prescription, " +
        "procedure, surgery, treatment plan — your visit, your results, " +
        "your recovery, your consent, coming in, $100, refund, deposit.",
    );
    expect(result.matches.length).toBeLessThanOrEqual(8);
    const keys = result.matches.map((m) => `${m.kind}:${m.excerpt}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("detectPhiRisk · negatives (false-positive guard)", () => {
  test.each([
    // The canonical safe replies — these MUST stay clean or Maria stops
    // trusting the privacy check entirely.
    "Thank you for the kind words.",
    "We're glad you had a great experience.",
    "Please call our office.",
    "Thank you so much for the five stars. It means a lot to our team.",
    "We're sorry to hear this. Please reach out so we can make it right.",
    "We appreciate you taking the time to share your thoughts.",
    "Our team works hard every day — reviews like this keep us going.",
    "We'd love to welcome you back anytime.",
    // "treatments" alone is generic marketing speak, not PHI.
    "We offer many treatments and our team is happy to answer questions.",
  ])("does not flag: %s", (text) => {
    const result = detectPhiRisk(text);
    expect(result.flagged).toBe(false);
    expect(result.matches).toEqual([]);
  });

  test("empty / whitespace / null-ish input is never flagged", () => {
    expect(detectPhiRisk("").flagged).toBe(false);
    expect(detectPhiRisk("   \n  ").flagged).toBe(false);
  });

  test("month word without the 'on <Month> <day>' shape stays clean", () => {
    expect(detectPhiRisk("We may be closed for the holidays.").flagged).toBe(
      false,
    );
    expect(detectPhiRisk("Our December hours are extended.").flagged).toBe(
      false,
    );
  });
});

describe("summarizeReplyRisks", () => {
  test("returns only flagged replies, keyed by id, hint from first match", () => {
    const map = summarizeReplyRisks([
      { id: "r1", text: "Thank you for the kind words." },
      { id: "r2", text: "We loved having you as a patient." },
      { id: "r3", text: null },
      { id: "r4", text: "Your card was refunded the same day." },
    ]);
    expect(map.size).toBe(2);
    expect(map.has("r1")).toBe(false);
    expect(map.get("r2")?.level).toBe("high");
    expect(map.get("r2")?.hint).toContain("having you as a patient");
    expect(map.get("r4")?.level).toBe("caution");
  });

  test("passes service names through to the detector", () => {
    const map = summarizeReplyRisks(
      [{ id: "r1", text: "Sorry the HydraFacial ran late." }],
      { serviceNames: ["HydraFacial"] },
    );
    expect(map.get("r1")?.level).toBe("high");
  });

  test("empty input → empty map", () => {
    expect(summarizeReplyRisks([]).size).toBe(0);
  });
});
