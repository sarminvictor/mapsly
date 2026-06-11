/**
 * Unit tests · /l trust footer (improvement plan #3).
 *
 * Invariants that would break the trust block if regressed:
 *   - the wordmark is a real link to www.mapsly.ai (not a dead lockup)
 *   - legal links (privacy / terms / refunds) render
 *   - the removal link points at /r/[token] with THIS landing's token
 *   - © line is brand-only "Mapsly" — no corporate suffix, no person named
 *     (Viktor's explicit legal-identity decision)
 *   - © + provenance are ONE merged line (Viktor's improvement-plan call) and
 *     the #data-sources anchor target exists (the hero's "see how" link
 *     depends on the id)
 *
 * Rendered via react-dom/server (node env, no DOM) — `createElement` instead
 * of JSX so this stays a plain .ts file like the rest of the module's tests.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { LandingFooter } from "../components/LandingView";

const TOKEN = "4820731965540827";

function html(): string {
  return renderToStaticMarkup(createElement(LandingFooter, { token: TOKEN }));
}

describe("LandingFooter · trust block", () => {
  test("wordmark links to www.mapsly.ai", () => {
    expect(html()).toContain('href="https://www.mapsly.ai"');
  });

  test("legal links render (privacy · terms · refunds)", () => {
    const out = html();
    expect(out).toContain('href="/privacy"');
    expect(out).toContain('href="/terms"');
    expect(out).toContain('href="/refunds"');
  });

  test("removal link is keyed by the landing token", () => {
    const out = html();
    expect(out).toContain(`href="/r/${TOKEN}"`);
    expect(out).toContain("Not your business? Remove this page");
  });

  test("© line is brand-only Mapsly — no corporate suffix", () => {
    const out = html();
    expect(out).toContain("© 2026 Mapsly");
    expect(out).not.toMatch(/Mapsly,? (Inc|LLC|Ltd|Corp|GmbH)/i);
  });

  test("© + provenance render as one continuous merged line with the #data-sources anchor target", () => {
    const out = html();
    expect(out).toContain('id="data-sources"');
    // Single text node — © and provenance must be one uninterrupted flow,
    // not two separate blocks.
    expect(out).toContain(
      "© 2026 Mapsly · Every number here comes from public sources: your Google listing, ad libraries, and your public website.",
    );
  });
});
