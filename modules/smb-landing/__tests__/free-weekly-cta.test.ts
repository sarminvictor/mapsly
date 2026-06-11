/**
 * Tests · free weekly-score CTA (plan #7).
 *
 * Invariants:
 *   - The trigger carries `data-landing-cta="free-weekly"` (the existing
 *     LandingAnalytics click listener depends on it for CTA_CLICKED).
 *   - Approved copy direction renders verbatim-ish: "Not ready? Get your
 *     score by email every week — free."
 *   - The email field starts EMPTY — the page must never print an email
 *     address it doesn't already show (no discovered-email leak into HTML).
 *   - PricingSection mounts it as the SECONDARY option while the $29 pills
 *     stay primary.
 *
 * Rendered via react-dom/server (node env) like the other landing tests.
 * The server action module is mocked: importing it pulls next/headers +
 * @/lib/prisma, which tests must never load for real.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("../subscribe-action", () => ({
  subscribeWeeklyScore: vi.fn(),
}));

import { FreeWeeklyCta } from "../components/FreeWeeklyCta";
import { PricingSection } from "../components/sections/Pricing";

const TOKEN = "4820731965540827";

const PRICING_COPY = {
  titleLead: "Everything above,",
  emphasis: "watched for you",
  body: "We keep an eye on your market every week.",
  guarantee: "Cancel anytime. No contracts.",
};

describe("FreeWeeklyCta", () => {
  test("collapsed trigger carries the analytics hook + approved copy", () => {
    const out = renderToStaticMarkup(
      createElement(FreeWeeklyCta, { token: TOKEN }),
    );
    expect(out).toContain('data-landing-cta="free-weekly"');
    expect(out).toContain(
      "Not ready? Get your score by email every week — free.",
    );
    // It's a real button (keyboard + analytics listener), not a styled div.
    expect(out).toMatch(/<button[^>]*data-landing-cta="free-weekly"/);
  });

  test("collapsed state renders no email input — field only appears on click, empty", () => {
    const out = renderToStaticMarkup(
      createElement(FreeWeeklyCta, { token: TOKEN }),
    );
    expect(out).not.toContain("<input");
    expect(out).not.toContain("@");
  });
});

describe("PricingSection · free option placement", () => {
  function html(): string {
    return renderToStaticMarkup(
      createElement(PricingSection, {
        copy: PRICING_COPY,
        ctaHref: `/api/checkout/start?landing=${TOKEN}&term=monthly`,
        ctaHrefAnnual: `/api/checkout/start?landing=${TOKEN}&term=annual`,
        token: TOKEN,
      }),
    );
  }

  test("renders the free CTA inside the pricing card", () => {
    const out = html();
    expect(out).toContain('data-landing-cta="free-weekly"');
  });

  test("the $29 CTAs remain the primary actions", () => {
    const out = html();
    expect(out).toContain('data-landing-cta="pricing"');
    expect(out).toContain('data-landing-cta="pricing-annual"');
    expect(out).toContain("$29");
    // Primary pills come BEFORE the free option in the card.
    expect(out.indexOf('data-landing-cta="pricing"')).toBeLessThan(
      out.indexOf('data-landing-cta="free-weekly"'),
    );
  });
});
