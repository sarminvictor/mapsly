/**
 * PrivacyMarkedReplyText · S5 inline marking of privacy-flagged phrases.
 *
 * Per `.claude/rules/testing.md` — invariants, not coverage:
 *   1. Every distinct flagged excerpt gets a visible <mark> in the
 *      rendered reply (two different phrases → two marks).
 *   2. Unflagged text passes through untouched — no <mark>, content
 *      preserved verbatim.
 *   3. "Weird" excerpts are safe: regex metacharacters never throw
 *      (indexOf matching, no regex), and the detector's straight
 *      apostrophes still locate curly-apostrophe originals.
 *   4. Overlapping / duplicate excerpts merge into sane, non-nested
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

describe("PrivacyMarkedReplyText", () => {
  test("a reply with two different flagged phrases renders both marked", () => {
    const text =
      "We loved having you as a patient and hope the botox settled in nicely. See you soon.";
    const html = renderToStaticMarkup(
      <PrivacyMarkedReplyText
        text={text}
        excerpts={["having you as a patient", "botox"]}
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

  test("real detector output (ellipsized excerpts) re-locates in the original reply", () => {
    const text =
      "Thanks so much for the lovely note. We truly loved having you as a patient here at the spa and the whole team appreciated your visit very much.";
    const risk = detectPhiRisk(text);
    expect(risk.flagged).toBe(true);
    const html = renderToStaticMarkup(
      <PrivacyMarkedReplyText
        text={text}
        excerpts={risk.matches.map((m) => m.excerpt)}
        markTitle="hint"
      />,
    );
    // Excerpts carry "…" + context padding — they must still mark.
    expect(countMarks(html)).toBeGreaterThanOrEqual(1);
    expect(html).toContain("having you as a patient");
  });

  test("unflagged text passes through untouched", () => {
    const text = "Thank you for the kind words — we're glad you enjoyed it!";
    const noExcerpts = renderToStaticMarkup(
      <PrivacyMarkedReplyText text={text} excerpts={[]} />,
    );
    expect(countMarks(noExcerpts)).toBe(0);
    expect(noExcerpts).toBe(renderToStaticMarkup(<>{text}</>));

    // Excerpt that doesn't occur in the text → no mark, text intact.
    const noHit = renderToStaticMarkup(
      <PrivacyMarkedReplyText text={text} excerpts={["botox"]} />,
    );
    expect(countMarks(noHit)).toBe(0);
  });

  test("excerpts with regex metacharacters are safe and still mark", () => {
    const text = "We sent the $50 (deposit) back the same day. [Ref #12].";
    const html = renderToStaticMarkup(
      <PrivacyMarkedReplyText
        text={text}
        excerpts={["$50 (deposit)", "[Ref #12]"]}
        markTitle="hint"
      />,
    );
    expect(countMarks(html)).toBe(2);
    expect(html).toContain("$50 (deposit)");
  });

  test("curly apostrophes in the original match the detector's straight-apostrophe excerpt", () => {
    // detectPhiRisk normalizes ’ → ' before matching, so its excerpt
    // carries the straight form while the reply keeps the curly one.
    const text = "Our records show you weren’t a patient here.";
    const html = renderToStaticMarkup(
      <PrivacyMarkedReplyText
        text={text}
        excerpts={["you weren't a patient"]}
        markTitle="hint"
      />,
    );
    expect(countMarks(html)).toBe(1);
    // Rendered slice preserves the ORIGINAL curly form.
    expect(html).toContain("weren’t a patient");
  });

  test("overlapping and duplicate excerpts merge into non-nested marks", () => {
    const text = "We loved having you as a patient at our clinic.";
    const html = renderToStaticMarkup(
      <PrivacyMarkedReplyText
        text={text}
        excerpts={[
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
      <PrivacyMarkedReplyText text={text} excerpts={["botox"]} />,
    );
    expect(html).toMatch(/<mark[^>]*>Botox<\/mark>/);
  });
});
