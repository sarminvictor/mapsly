/**
 * Golden tests for the pure tech fingerprint.
 *
 * Each case uses a small, representative HTML snippet (or header set) so
 * a regression in a signature surfaces as an exact-detection diff. No
 * network, no Prisma — `fingerprintTech` is a pure function.
 */

import { describe, expect, test } from "vitest";

import {
  fingerprintTech,
  hasAnalytics,
  hasBookingTool,
  hasMetaPixel,
} from "../fingerprint";

/** Pull the detected names for terse assertions. */
function names(html: string, headers?: Record<string, string>): string[] {
  return fingerprintTech({ html, headers }).map((t) => t.name);
}

describe("fingerprintTech", () => {
  test("detects a WordPress site", () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta name="generator" content="WordPress 6.5.2" />
          <link rel="stylesheet" href="/wp-content/themes/spa/style.css" />
        </head>
        <body><div class="wp-block-group">Hello</div></body>
      </html>`;
    const techs = fingerprintTech({ html });

    expect(names(html)).toContain("WordPress");
    const wp = techs.find((t) => t.name === "WordPress");
    expect(wp?.category).toBe("CMS");
    expect(wp?.source).toBe("self-fingerprint");
    expect(wp?.confidence).toBe(0.95);
    expect(wp?.evidence).toBeTruthy();
  });

  test("detects a Shopify store", () => {
    const html = `
      <html>
        <head>
          <script src="https://cdn.shopify.com/s/files/1/theme.js"></script>
          <script>var Shopify = Shopify || {}; Shopify.theme = { name: "Dawn" };</script>
        </head>
        <body>Buy now</body>
      </html>`;
    const techs = fingerprintTech({ html });

    expect(names(html)).toContain("Shopify");
    expect(techs.find((t) => t.name === "Shopify")?.category).toBe("CMS");
  });

  test("detects Meta Pixel + Calendly together", () => {
    const html = `
      <html>
        <head>
          <script>
            !function(f,b,e,v,n,t,s){...}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '123456789'); fbq('track', 'PageView');
          </script>
          <link href="https://assets.calendly.com/assets/external/widget.css" rel="stylesheet">
          <script src="https://calendly.com/assets/external/widget.js"></script>
        </head>
        <body>Book a consult</body>
      </html>`;
    const techs = fingerprintTech({ html });
    const detected = techs.map((t) => t.name);

    expect(detected).toContain("Meta Pixel");
    expect(detected).toContain("Calendly");
    expect(techs.find((t) => t.name === "Meta Pixel")?.category).toBe("PIXEL");
    expect(techs.find((t) => t.name === "Calendly")?.category).toBe("BOOKING");

    expect(hasMetaPixel(techs)).toBe(true);
    expect(hasBookingTool(techs)).toBe(true);
  });

  test("detects Cloudflare from response headers alone", () => {
    const html = `<html><body>plain content, no cdn markers in body</body></html>`;
    const headers = {
      "CF-Ray": "8a1b2c3d4e5f6789-MIA",
      Server: "cloudflare",
    };
    const techs = fingerprintTech({ html, headers });

    expect(techs.map((t) => t.name)).toContain("Cloudflare");
    const cf = techs.find((t) => t.name === "Cloudflare");
    expect(cf?.category).toBe("CDN");
    expect(cf?.evidence).toMatch(/cf-ray/i);
  });

  test("detects GA4 analytics and reports hasAnalytics", () => {
    const html = `
      <html><head>
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123XYZ"></script>
      </head><body>page</body></html>`;
    const techs = fingerprintTech({ html });

    expect(techs.map((t) => t.name)).toContain("Google Analytics 4");
    expect(hasAnalytics(techs)).toBe(true);
    expect(hasMetaPixel(techs)).toBe(false);
    expect(hasBookingTool(techs)).toBe(false);
  });

  test("returns empty for bare HTML with nothing recognizable", () => {
    const html = `
      <!DOCTYPE html>
      <html lang="en">
        <head><title>Local Plumber</title></head>
        <body><h1>Call us at 555-1234</h1></body>
      </html>`;
    const techs = fingerprintTech({ html });

    expect(techs).toEqual([]);
    expect(hasMetaPixel(techs)).toBe(false);
    expect(hasBookingTool(techs)).toBe(false);
    expect(hasAnalytics(techs)).toBe(false);
  });

  test("de-dupes by name and sorts by confidence desc then name asc", () => {
    // React (0.7) + Next.js (0.9) both fire; Next must come first.
    const html = `
      <html>
        <head><script id="__NEXT_DATA__" type="application/json">{}</script></head>
        <body><div data-reactroot></div><script src="/_next/static/app.js"></script></body>
      </html>`;
    const techs = fingerprintTech({ html });
    const detected = techs.map((t) => t.name);

    expect(detected).toContain("Next.js");
    expect(detected).toContain("React");
    // Confidence-desc ordering: Next.js (0.9) before React (0.7).
    expect(detected.indexOf("Next.js")).toBeLessThan(detected.indexOf("React"));

    // No duplicate names even though multiple Next.js patterns matched.
    const unique = new Set(detected);
    expect(unique.size).toBe(detected.length);
  });

  test("matches headers case-insensitively (Fastly via x-served-by)", () => {
    const techs = fingerprintTech({
      html: "<html><body>x</body></html>",
      headers: { "X-Served-By": "cache-fastly-MIA-1234" },
    });
    expect(techs.map((t) => t.name)).toContain("Fastly");
  });

  test("handles empty html without throwing", () => {
    expect(fingerprintTech({ html: "" })).toEqual([]);
  });
});
