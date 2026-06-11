/**
 * PrivacyMarkedReplyText · S5 inline marking of privacy-flagged phrases.
 *
 * Per `.claude/rules/testing.md` — invariants, not coverage:
 *   1. Every distinct flagged PHRASE gets a visible <mark> in the
 *      rendered reply (two different phrases → two marks).
 *   2. Marks cover ONLY the bare matched phrase — never the padded
 *      excerpt. Production screenshots (2026-06) showed excerpt-marking
 *      starting/ending mid-word ("r|efrained to offered 1/4 sy|ringe",
 *      "need|ed. We request") and covering innocuous connectives
 *      (", and opted"). A mark must begin and end at word boundaries.
 *   3. Unflagged text passes through untouched — no <mark>, content
 *      preserved verbatim.
 *   4. "Weird" phrases are safe: regex metacharacters never throw
 *      (indexOf matching, no regex), and the detector's straight
 *      apostrophes still locate curly-apostrophe originals.
 *   5. Overlapping / duplicate phrases merge into sane, non-nested
 *      marks.
 *
 * Rendered via `react-dom/server` — node environment, no jsdom needed.
 * The component is pure (no server-action imports), so this stays a
 * fast unit test.
 */
import { describe, expect, test } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PrivacyMarkedReplyText } from "../components/PrivacyMarkedReplyText";
import { detectPhiRisk } from "../phi-check";

const countMarks = (html: string): number =>
  (html.match(/<mark/g) ?? []).length;

/** Text content of every <mark> in render order. */
const extractMarks = (html: string): string[] =>
  Array.from(html.matchAll(/<mark[^>]*>([^<]*)<\/mark>/g), (m) => m[1]!);

/**
 * Regression assertion for the 2026-06 production screenshots: no mark
 * may start or end inside a word. Splits the rendered HTML on the mark
 * tags (odd segments = mark contents) and checks the boundary chars on
 * both sides of every mark.
 */
function expectMarksAtWordBoundaries(html: string): void {
  const word = /[A-Za-z0-9]/;
  const segments = html.split(/<\/?mark[^>]*>/);
  expect(segments.length).toBeGreaterThan(1); // at least one mark
  for (let i = 1; i < segments.length; i += 2) {
    const content = segments[i]!;
    expect(content.length).toBeGreaterThan(0);
    const prevChar = (segments[i - 1] ?? "").slice(-1);
    const nextChar = (segments[i + 1] ?? "").charAt(0);
    // Never starts mid-word ("r|efrained…").
    expect(word.test(prevChar) && word.test(content.charAt(0))).toBe(false);
    // Never ends mid-word ("…sy|ringe", "need|ed").
    expect(word.test(content.slice(-1)) && word.test(nextChar)).toBe(false);
  }
}

describe("PrivacyMarkedReplyText", () => {
  test("a reply with two different flagged phrases renders both marked", () => {
    const text =
      "We loved having you as a patient and hope the botox settled in nicely. See you soon.";
    const html = renderToStaticMarkup(
      <PrivacyMarkedReplyText
        text={text}
        phrases={["having you as a patient", "botox"]}
        markTitle="May confirm a patient relationship — consider an edit"
      />,
    );
    expect(countMarks(html)).toBe(2);
    expect(html).toMatch(/<mark[^>]*>having you as a patient<\/mark>/);
    expect(html).toMatch(/<mark[^>]*>botox<\/mark>/);
    // The explanation rides on each mark via title.
    expect(html).toContain(
      'title="May confirm a patient relationship — consider an edit"',
    );
  });

  test("real detector output (bare phrases) marks in the original reply", () => {
    const text =
      "Thanks so much for the lovely note. We truly loved having you as a patient here at the spa and the whole team appreciated your visit very much.";
    const risk = detectPhiRisk(text);
    expect(risk.flagged).toBe(true);
    const html = renderToStaticMarkup(
      <PrivacyMarkedReplyText
        text={text}
        phrases={risk.matches.map((m) => m.phrase)}
        markTitle="hint"
      />,
    );
    expect(countMarks(html)).toBeGreaterThanOrEqual(1);
    expect(html).toMatch(/<mark[^>]*>having you as a patient<\/mark>/);
    expectMarksAtWordBoundaries(html);
  });

  test("screenshot regression · Serena: bare phrases only, never mid-word, no innocuous connectives", () => {
    // Production (2026-06) marked "r|efrained to offered 1/4 sy|ringe"
    // and ", and opted" because the padded EXCERPT was marked. Phrases
    // fix both failure modes.
    const text =
      "Since 2016 we have refrained to offered 1/4 syringe. You wanted any left over in your face and the height you wanted in your lips, and opted not to return.";
    const risk = detectPhiRisk(text);
    expect(risk.flagged).toBe(true);
    const html = renderToStaticMarkup(
      <PrivacyMarkedReplyText
        text={text}
        phrases={risk.matches.map((m) => m.phrase)}
        markTitle="hint"
      />,
    );
    expectMarksAtWordBoundaries(html);
    const marks = extractMarks(html);
    expect(marks).toContain("syringe");
    expect(marks).toContain("your face");
    expect(marks).toContain("your lips");
    for (const m of marks) {
      // No mark drags in the excerpt-window neighbours.
      expect(m).not.toMatch(/refrained|offered|opted|height/);
      expect(m).toBe(m.trim());
    }
  });

  test("screenshot regression · Nadine: 'need|ed. We request' mid-word mark is gone", () => {
    const text =
      "Botox and Dysport are priced per unit. We only offered what was needed. We request that all clients complete the intake forms sent with the post treatment instructions before your first appointment with us.";
    const risk = detectPhiRisk(text);
    expect(risk.flagged).toBe(true);
    const html = renderToStaticMarkup(
      <PrivacyMarkedReplyText
        text={text}
        phrases={risk.matches.map((m) => m.phrase)}
        markTitle="hint"
      />,
    );
    expectMarksAtWordBoundaries(html);
    const marks = extractMarks(html);
    expect(marks).toEqual(
      expect.arrayContaining([
        "Botox",
        "Dysport",
        "intake forms",
        "post treatment",
        // "your first appointment" + "first appointment with us" overlap
        // in the text → the component merges them into one clean span.
        "your first appointment with us",
      ]),
    );
    // The exact production defect: a mark spanning "needed. We request".
    for (const m of marks) {
      expect(m).not.toMatch(/needed|We request/);
    }
  });

  test("unflagged text passes through untouched", () => {
    const text = "Thank you for the kind words — we're glad you enjoyed it!";
    const noPhrases = renderToStaticMarkup(
      <PrivacyMarkedReplyText text={text} phrases={[]} />,
    );
    expect(countMarks(noPhrases)).toBe(0);
    expect(noPhrases).toBe(renderToStaticMarkup(<>{text}</>));

    // Phrase that doesn't occur in the text → no mark, text intact.
    const noHit = renderToStaticMarkup(
      <PrivacyMarkedReplyText text={text} phrases={["botox"]} />,
    );
    expect(countMarks(noHit)).toBe(0);
  });

  test("phrases with regex metacharacters are safe and still mark", () => {
    const text = "We sent the $50 (deposit) back the same day. [Ref #12].";
    const html = renderToStaticMarkup(
      <PrivacyMarkedReplyText
        text={text}
        phrases={["$50 (deposit)", "[Ref #12]"]}
        markTitle="hint"
      />,
    );
    expect(countMarks(html)).toBe(2);
    expect(html).toContain("$50 (deposit)");
  });

  test("curly apostrophes in the original match the detector's straight-apostrophe phrase", () => {
    // detectPhiRisk normalizes ’ → ' before matching, so its phrase
    // carries the straight form while the reply keeps the curly one.
    const text = "Our records show you weren’t a patient here.";
    const html = renderToStaticMarkup(
      <PrivacyMarkedReplyText
        text={text}
        phrases={["you weren't a patient"]}
        markTitle="hint"
      />,
    );
    expect(countMarks(html)).toBe(1);
    // Rendered slice preserves the ORIGINAL curly form.
    expect(html).toContain("weren’t a patient");
  });

  test("stale-payload defence · an old padded excerpt degrades gracefully (ellipses stripped)", () => {
    // A cached payload from before the `phrase` field may still hand us
    // an ellipsized excerpt — it must mark its (padded) window without
    // throwing, exactly as the pre-phrase behavior did.
    const text = "We loved having you as a patient at our clinic.";
    const html = renderToStaticMarkup(
      <PrivacyMarkedReplyText
        text={text}
        phrases={["…having you as a patient…"]}
        markTitle="hint"
      />,
    );
    expect(countMarks(html)).toBe(1);
    expect(html).toMatch(/<mark[^>]*>having you as a patient<\/mark>/);
  });

  test("overlapping and duplicate phrases merge into non-nested marks", () => {
    const text = "We loved having you as a patient at our clinic.";
    const html = renderToStaticMarkup(
      <PrivacyMarkedReplyText
        text={text}
        phrases={[
          "having you as a patient",
          "you as a patient at our clinic",
          "having you as a patient", // duplicate
        ]}
        markTitle="hint"
      />,
    );
    // Overlap merges to a single mark covering the union.
    expect(countMarks(html)).toBe(1);
    expect(html).toMatch(
      /<mark[^>]*>having you as a patient at our clinic<\/mark>/,
    );
    // No nesting artifacts.
    expect(html).not.toMatch(/<mark[^>]*><mark/);
  });

  test("case-insensitive matching, original casing preserved", () => {
    const text = "The Botox appointment went great.";
    const html = renderToStaticMarkup(
      <PrivacyMarkedReplyText text={text} phrases={["botox"]} />,
    );
    expect(html).toMatch(/<mark[^>]*>Botox<\/mark>/);
  });

  test("phrase that is a substring of an EARLIER larger word marks its own word-aligned occurrence", () => {
    // The detector matched "toxin" at a word boundary (the second
    // occurrence) — bare indexOf would land inside the earlier
    // "toxins" and render "toxin|s" mid-word. The marker must skip
    // substring hits and mark the boundary-clean occurrence.
    const text =
      "Detox teas flush toxins fast, but the toxin we use is measured.";
    const risk = detectPhiRisk(text);
    expect(risk.matches.map((m) => m.phrase)).toContain("toxin");
    const html = renderToStaticMarkup(
      <PrivacyMarkedReplyText
        text={text}
        phrases={risk.matches.map((m) => m.phrase)}
        markTitle="hint"
      />,
    );
    expectMarksAtWordBoundaries(html);
    // The mark sits on the standalone "toxin", not inside "toxins".
    expect(html).toContain("flush toxins fast");
    expect(html).toMatch(/the <mark[^>]*>toxin<\/mark> we use/);
  });

  test("phrase with no word-aligned occurrence anywhere renders unmarked (never mid-word)", () => {
    // Only a substring occurrence exists — better no mark than a
    // mid-word mark.
    const text = "Detox teas flush toxins fast.";
    const html = renderToStaticMarkup(
      <PrivacyMarkedReplyText text={text} phrases={["toxin"]} />,
    );
    expect(countMarks(html)).toBe(0);
    expect(html).toBe(renderToStaticMarkup(<>{text}</>));
  });
});
