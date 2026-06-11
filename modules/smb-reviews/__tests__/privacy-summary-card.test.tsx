/**
 * PrivacySummaryCard · S5 warning icon + tap-friendly info-tip.
 *
 * Invariants (per `.claude/rules/testing.md`):
 *   1. The card renders the coral warning triangle (decorative SVG) and
 *      a real info <button> with `aria-expanded` + `aria-controls`.
 *   2. Expanding shows the stakes copy (HIPAA fines note); collapsed it
 *      stays in the DOM but `hidden` (so aria-controls always resolves).
 *   3. The card body is still a Link to `?tab=privacy`, and the info
 *      button lives OUTSIDE the anchor — toggling can't hijack the
 *      card's navigation.
 *
 * Rendered via `react-dom/server` in node env. `@/i18n/navigation` is
 * mocked to a plain <a> — next-intl's Link needs request context that
 * doesn't exist in unit tests.
 */
import { describe, expect, test, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/i18n/navigation", async () => {
  const ReactMod = await import("react");
  return {
    Link: ({
      href,
      children,
      ...rest
    }: {
      href: { pathname: string; query?: Record<string, string> } | string;
      children: React.ReactNode;
    } & Record<string, unknown>) => {
      const resolved =
        typeof href === "string"
          ? href
          : `${href.pathname}${
              href.query ? `?${new URLSearchParams(href.query)}` : ""
            }`;
      return ReactMod.createElement("a", { ...rest, href: resolved }, children);
    },
  };
});

import { PrivacySummaryCard } from "../components/PrivacySummaryCard";

const LABELS = {
  summary:
    "Privacy check: 2 of your replies may need an edit — they mention treatments or confirm someone was a patient.",
  cta: "See which ones",
  infoButton: "What's this?",
  infoNote:
    "Public replies that confirm someone was a patient or mention their treatment can break US health-privacy law (HIPAA). Regulators have fined practices $10,000–$50,000 for exactly this. Editing these replies removes the risk.",
};

describe("PrivacySummaryCard", () => {
  test("renders the warning icon, the summary, and the info button (collapsed)", () => {
    const html = renderToStaticMarkup(<PrivacySummaryCard labels={LABELS} />);

    // Coral warning triangle · decorative, text carries the meaning.
    expect(html).toContain("<svg");
    expect(html).toContain("aria-hidden");
    expect(html).toContain(LABELS.summary);

    // Tap-friendly info-tip · real button, collapsed by default, wired
    // to the note via aria-controls.
    expect(html).toContain('aria-expanded="false"');
    const controlsId = html.match(/aria-controls="([^"]+)"/)?.[1];
    expect(controlsId).toBeTruthy();
    expect(html).toContain(`id="${controlsId}"`);
    // renderToStaticMarkup escapes the apostrophe.
    expect(html).toContain("What&#x27;s this?");

    // Note stays in the DOM but hidden while collapsed (bare `hidden`
    // attribute — distinct from the icon's aria-hidden="true").
    expect(html).toMatch(/hidden=""/);
  });

  test("expanding shows the fines copy", () => {
    const html = renderToStaticMarkup(
      <PrivacySummaryCard labels={LABELS} defaultInfoOpen />,
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toMatch(/hidden=""/);
    expect(html).toContain("$10,000");
    expect(html).toContain("HIPAA");
    expect(html).toContain(LABELS.infoNote);
  });

  test("card link still points at ?tab=privacy and the button sits outside it", () => {
    const html = renderToStaticMarkup(<PrivacySummaryCard labels={LABELS} />);
    expect(html).toContain('href="/reviews?tab=privacy"');
    expect(html).toContain(LABELS.cta);

    // The info button must NOT be nested inside the anchor — placing it
    // outside is what guarantees the toggle can't hijack navigation.
    const anchorClose = html.indexOf("</a>");
    const buttonOpen = html.indexOf("<button");
    expect(anchorClose).toBeGreaterThan(-1);
    expect(buttonOpen).toBeGreaterThan(-1);
    expect(buttonOpen).toBeGreaterThan(anchorClose);
  });
});
