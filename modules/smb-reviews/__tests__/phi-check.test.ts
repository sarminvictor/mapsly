import { describe, expect, test } from "vitest";

import {
  detectPhiRisk,
  mergeAiSentenceMatches,
  summarizeReplyRisks,
  type PrivacyMatch,
} from "../phi-check";

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
    // The phrase is the BARE match — no padding, no ellipses.
    expect(statusMatch?.phrase).toBe("your consent");
  });

  test("phrase is the bare matched text · no excerpt padding, no ellipses", () => {
    const text =
      "Since 2016 we have refrained to offered 1/4 syringe after your appointment.";
    const result = detectPhiRisk(text);
    expect(result.flagged).toBe(true);
    for (const m of result.matches) {
      expect(m.phrase).not.toContain("…");
      expect(m.phrase).toBe(m.phrase.trim());
      // Every phrase occurs verbatim in the source text.
      expect(text.toLowerCase()).toContain(m.phrase.toLowerCase());
    }
    const treatment = result.matches.find((m) => m.kind === "treatment");
    expect(treatment?.phrase).toBe("syringe");
    // The excerpt keeps the context window for tooltips.
    expect(treatment?.excerpt).toContain("syringe");
    expect(treatment?.excerpt.length).toBeGreaterThan("syringe".length);
  });

  test("every distinct body-part mention is captured, not just the first alternation hit", () => {
    const result = detectPhiRisk(
      "You wanted any left over in your face and the height you wanted in your lips.",
    );
    const phrases = result.matches.map((m) => m.phrase.toLowerCase());
    expect(phrases).toContain("your face");
    expect(phrases).toContain("your lips");
  });

  test("repeated identical phrases dedupe to a single match", () => {
    const result = detectPhiRisk("Botox is safe. Botox is quick.");
    const botox = result.matches.filter(
      (m) => m.phrase.toLowerCase() === "botox",
    );
    expect(botox).toHaveLength(1);
  });

  test("matches are capped and deduped", () => {
    const result = detectPhiRisk(
      "Botox, filler, syringe, injection, laser, units, prescription, " +
        "procedure, surgery, treatment plan — your visit, your results, " +
        "your recovery, your consent, coming in, $100, refund, deposit.",
    );
    expect(result.matches.length).toBeLessThanOrEqual(8);
    const keys = result.matches.map(
      (m) => `${m.kind}:${m.phrase.toLowerCase()}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

/**
 * 2026-06 production fixtures · three real replies (lightly paraphrased)
 * that Viktor's screenshot review exposed. These lock in the vocabulary
 * broadening — if any stops flagging (or Jessie starts), that's a
 * regression against live data.
 */
describe("detectPhiRisk · production fixtures (2026-06 screenshots)", () => {
  const SERENA =
    "Since 2016 we have refrained to offered 1/4 syringe. You wanted any " +
    "left over in your face and the height you wanted in your lips, and " +
    "opted not to return.";

  const NADINE =
    "Botox and Dysport are priced per unit. We only offered what was " +
    "needed. We request that all clients complete the intake forms sent " +
    "with the post treatment instructions before your first appointment " +
    "with us.";

  const JESSIE = "Thanks Jessie! We appreciate you coming in and sharing this.";

  test("Serena reply flags high via your-face / your-lips + syringe", () => {
    const result = detectPhiRisk(SERENA);
    expect(result.flagged).toBe(true);
    expect(result.level).toBe("high");
    const phrases = result.matches.map((m) => m.phrase.toLowerCase());
    expect(phrases).toEqual(
      expect.arrayContaining(["your face", "your lips", "syringe"]),
    );
    // The old padded excerpts covered innocuous connectives (", and
    // opted") — bare phrases never include them.
    for (const p of phrases) {
      expect(p).not.toContain("opted");
      expect(p).not.toContain("refrained");
    }
  });

  test("Nadine reply flags high via post treatment + dysport + intake forms (botox already)", () => {
    const result = detectPhiRisk(NADINE);
    expect(result.flagged).toBe(true);
    expect(result.level).toBe("high");
    const phrases = result.matches.map((m) => m.phrase.toLowerCase());
    expect(phrases).toEqual(
      expect.arrayContaining([
        "botox",
        "dysport",
        "intake forms",
        "post treatment",
        "your first appointment",
      ]),
    );
  });

  test("Jessie reply unchanged · still flags only via the pre-existing pattern", () => {
    const result = detectPhiRisk(JESSIE);
    expect(result.flagged).toBe(true);
    // The broadened vocabulary must add NOTHING here — exactly the one
    // phrase that flagged before this round.
    expect(result.matches.map((m) => m.phrase.toLowerCase())).toEqual([
      "coming in",
    ]);
  });
});

describe("detectPhiRisk · 2026-06 vocabulary broadening", () => {
  test.each([
    "Everyone responds to the post treatment instructions differently.",
    "Post-treatment care was emailed the same day.",
    "A touch up is included within two weeks.",
    "Touch-ups are complimentary for members.",
    "The toxin we use is FDA approved.",
    "The dose was exactly what we discussed.",
    "Our dosage recommendations are conservative.",
    "We are deliberately careful with dosing.",
    "Please complete the intake form before arriving.",
    "All clients sign intake forms first.",
    "The numbing cream needs twenty minutes.",
    "We went over the aftercare together.",
    "Some swelling and bruising is normal for a few days.",
    "Dysport lasts about three months.",
    "Juvederm results vary by area.",
    "Restylane was the better option for you.",
    "Sculptra builds collagen gradually.",
    "Kybella requires multiple sessions.",
    "Xeomin is a great alternative.",
    "The lip flip turned out beautifully.",
  ])("new treatment vocabulary flags high: %s", (text) => {
    const result = detectPhiRisk(text);
    expect(result.flagged).toBe(true);
    expect(result.level).toBe("high");
    expect(result.matches.map((m) => m.kind)).toContain("treatment");
  });

  test.each([
    "You wanted any left over in your face.",
    "We added the height you wanted in your lips.",
    "Your lip looked great when you left.",
    "Your skin responded well to the peel.",
    "We kept your forehead conservative.",
    "Your cheeks needed less product this time.",
    "We balanced your chin and jawline.",
    "Your brows healed nicely.",
    "Your brow mapping was precise.",
    "We avoided your under-eyes entirely.",
  ])("possessive + body part flags high (patient-status): %s", (text) => {
    const result = detectPhiRisk(text);
    expect(result.flagged).toBe(true);
    expect(result.level).toBe("high");
    expect(result.matches.map((m) => m.kind)).toContain("patient-status");
  });

  test.each([
    "We reviewed everything at your first appointment.",
    "See you at your next appointment.",
    "Your last appointment ran long — sorry about that.",
    "This was your first appointment with us.",
    "That morning was the first appointment for us.",
  ])("appointment variants flag high (patient-status): %s", (text) => {
    const result = detectPhiRisk(text);
    expect(result.flagged).toBe(true);
    expect(result.level).toBe("high");
    expect(result.matches.map((m) => m.kind)).toContain("patient-status");
  });

  test("strict-bar judgment · service marketing inside a reply still flags", () => {
    // In a reply addressed to a reviewer, naming treatments IS the risk
    // pattern — see the module-header judgment note. The detector only
    // ever runs on medical businesses' reply text.
    const result = detectPhiRisk("We offer Botox and touch ups every day.");
    expect(result.flagged).toBe(true);
    expect(result.level).toBe("high");
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
    // 2026-06 precision guards for the broadened vocabulary:
    // plural "toxins" = detox marketing, not botulinum toxin.
    "Our detox tea helps flush out toxins.",
    // past-tense "touched up" (decor, paint) ≠ "touch up" the procedure.
    "We touched up the paint in the lobby last week.",
    // bare "swelling" without the aftercare pairing stays clean.
    "We're sorry to hear about the swelling.",
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

  test("carries ALL match excerpts (S5 · inline marking) — hint stays the first", () => {
    const map = summarizeReplyRisks([
      {
        id: "r1",
        text: "We loved having you as a patient. The botox units were on us.",
      },
    ]);
    const entry = map.get("r1");
    expect(entry).toBeDefined();
    // Two different kinds flagged → both excerpts present for marking.
    expect(entry!.matches.length).toBeGreaterThanOrEqual(2);
    const kinds = entry!.matches.map((m) => m.kind);
    expect(kinds).toContain("patient-status");
    expect(kinds).toContain("treatment");
    // Back-compat: hint is still the first match's excerpt.
    expect(entry!.hint).toBe(entry!.matches[0]!.excerpt);
    // Payload cap: never more than 10 per reply.
    expect(entry!.matches.length).toBeLessThanOrEqual(10);
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

/**
 * F3 · merge contract: AI sentences join the deterministic marks as
 * `ai-sentence` matches IFF they appear VERBATIM in the reply (same
 * normalization as the detector + the UI marker). Pure, no AI here —
 * the model call is tested in services/ai/__tests__/phi-sentences and
 * the server seam in __tests__/phi-ai-enrich.
 */
describe("mergeAiSentenceMatches", () => {
  const reply =
    "After reviewing footage from that afternoon, we are perplexed why you voiced frustration. Thanks for coming in.";
  const sentence =
    "After reviewing footage from that afternoon, we are perplexed why you voiced frustration.";
  const phraseMatch: PrivacyMatch = {
    kind: "patient-status",
    phrase: "coming in",
    excerpt: "…Thanks for coming in.",
  };

  test("appends a located sentence as an ai-sentence match", () => {
    const out = mergeAiSentenceMatches([phraseMatch], [sentence], reply);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({
      kind: "ai-sentence",
      phrase: sentence,
      excerpt: sentence,
    });
  });

  test("returns a NEW array — never mutates the deterministic matches", () => {
    const matches = [phraseMatch];
    const out = mergeAiSentenceMatches(matches, [sentence], reply);
    expect(matches).toHaveLength(1);
    expect(out).not.toBe(matches);
  });

  test("drops sentences not present verbatim (model paraphrased)", () => {
    const out = mergeAiSentenceMatches(
      [phraseMatch],
      ["We reviewed the footage and saw your frustration."],
      reply,
    );
    expect(out).toEqual([phraseMatch]);
  });

  test("locates sentences across curly/straight apostrophe variants", () => {
    const curlyReply = "We weren’t aware of your concerns until today.";
    const out = mergeAiSentenceMatches(
      [],
      ["We weren't aware of your concerns until today."],
      curlyReply,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("ai-sentence");
  });

  test("dedupes repeated sentences and sentences equal to an existing phrase", () => {
    const out = mergeAiSentenceMatches(
      [phraseMatch],
      [sentence, sentence.toUpperCase(), "Thanks for coming in."],
      reply + " Thanks for coming in.",
    );
    // The repeated sentence collapses; "Thanks for coming in." is new
    // (only the bare phrase "coming in" was marked deterministically).
    const aiPhrases = out
      .filter((m) => m.kind === "ai-sentence")
      .map((m) => m.phrase.toLowerCase());
    expect(aiPhrases).toEqual([
      sentence.toLowerCase(),
      "thanks for coming in.",
    ]);
    // A sentence identical to an existing phrase never doubles up.
    const dupOut = mergeAiSentenceMatches([phraseMatch], ["coming in"], reply);
    expect(dupOut).toEqual([phraseMatch]);
  });

  test("caps the merged list at the payload bound (10)", () => {
    const longReply = Array.from(
      { length: 14 },
      (_, i) => `Unique offending sentence number ${i}.`,
    ).join(" ");
    const sentences = Array.from(
      { length: 14 },
      (_, i) => `Unique offending sentence number ${i}.`,
    );
    const out = mergeAiSentenceMatches([phraseMatch], sentences, longReply);
    expect(out.length).toBeLessThanOrEqual(10);
    // Deterministic match always survives the cap (it sits first).
    expect(out[0]).toEqual(phraseMatch);
  });

  test("empty sentences / empty reply → deterministic matches unchanged", () => {
    expect(mergeAiSentenceMatches([phraseMatch], [], reply)).toEqual([
      phraseMatch,
    ]);
    expect(mergeAiSentenceMatches([phraseMatch], [sentence], "")).toEqual([
      phraseMatch,
    ]);
    expect(mergeAiSentenceMatches([], ["", "   "], reply)).toEqual([]);
  });
});
