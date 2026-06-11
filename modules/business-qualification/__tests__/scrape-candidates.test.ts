/**
 * Email-candidate scoring + extraction · invariants added with the
 * 2026-06-11 robustness pass:
 *
 *  1. **Alignment normalization** — `www.` on the stored domain doesn't
 *     break alignment, and the old reverse-inclusion hole is closed: a
 *     business hosted at `mybiz.godaddysites.com` must NOT treat
 *     `x@godaddysites.com` as aligned (platform parent domain).
 *  2. **Platform hosts are junk** — godaddysites/wixsite/square.site
 *     etc. score below zero and never rank.
 *  3. **Obfuscation extraction** — "[at]/[dot]"-style spellings on
 *     contact pages decode to real candidates (exercised through
 *     buildCandidate via the exported helpers' contract: the regexes
 *     are private, so we pin via scrapeEmailsFromWebsite with a
 *     stubbed fetch).
 *  4. **Shared generic-inbox vocabulary** — isGenericLocalPart is the
 *     one classifier (AI tier consumes it too).
 */

import { afterEach, describe, expect, test, vi } from "vitest";

import {
  buildCandidate,
  isGenericLocalPart,
  scrapeEmailsFromWebsite,
} from "../scrape-email";

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

/** Stub fetch: homepage returns `html`, every other URL 404s. */
function stubSite(html: string): void {
  global.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "https://glowspa.com" || url === "https://glowspa.com/") {
      return new Response(html, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
}

describe("buildCandidate · domain alignment", () => {
  test("www. prefix on the stored domain still aligns", () => {
    const c = buildCandidate(
      "info@glowspa.com",
      "SCRAPE_CONTACT",
      "www.glowspa.com",
    );
    expect(c.isDomainAligned).toBe(true);
  });

  test("subdomain of the business domain aligns", () => {
    const c = buildCandidate(
      "hello@mail.glowspa.com",
      "SCRAPE_CONTACT",
      "glowspa.com",
    );
    expect(c.isDomainAligned).toBe(true);
  });

  test("platform parent domain does NOT align for a platform-hosted business", () => {
    const c = buildCandidate(
      "anything@godaddysites.com",
      "SCRAPE_FOOTER",
      "mybiz.godaddysites.com",
    );
    expect(c.isDomainAligned).toBe(false);
    // And it's junk outright — hosting platforms have no real inboxes.
    expect(c.score).toBeLessThan(0);
  });

  test("unrelated third-party custom domain is not aligned (footer-credit shape)", () => {
    const c = buildCandidate(
      "john@webagency.com",
      "SCRAPE_FOOTER",
      "glowspa.com",
    );
    expect(c.isDomainAligned).toBe(false);
    expect(c.isFreeProvider).toBe(false);
  });
});

describe("isGenericLocalPart", () => {
  test("classifies the shared vocabulary", () => {
    expect(isGenericLocalPart("info")).toBe(true);
    expect(isGenericLocalPart("FRONTDESK")).toBe(true);
    expect(isGenericLocalPart("vanessa")).toBe(false);
  });
});

describe("obfuscated-email extraction (through the scraper)", () => {
  test("decodes 'info [at] glowspa [dot] com' from contact-page prose", async () => {
    stubSite(
      `<html><body><p>Reach us: info <span>[at]</span> glowspa <span>[dot]</span> com</p></body></html>`,
    );
    const result = await scrapeEmailsFromWebsite({
      website: "https://glowspa.com",
      domain: "glowspa.com",
    });
    expect(result.candidates.map((c) => c.email)).toContain("info@glowspa.com");
  });

  test("decodes worded form 'booking at glowspa dot com'", async () => {
    stubSite(`<p>Email us at booking at glowspa dot com today.</p>`);
    const result = await scrapeEmailsFromWebsite({
      website: "https://glowspa.com",
      domain: "glowspa.com",
    });
    expect(result.candidates.map((c) => c.email)).toContain(
      "booking@glowspa.com",
    );
  });

  test("plain prose 'meet us at the spa' produces no candidate", async () => {
    stubSite(`<p>Come meet us at the spa downtown. We love dot art.</p>`);
    const result = await scrapeEmailsFromWebsite({
      website: "https://glowspa.com",
      domain: "glowspa.com",
    });
    expect(result.candidates).toHaveLength(0);
  });
});

describe("browser-UA rescue pass", () => {
  test("when the bot UA is blocked everywhere, retries key pages as a browser", async () => {
    const calls: Array<{ url: string; ua: string }> = [];
    global.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const ua = String(
          (init?.headers as Record<string, string>)?.["User-Agent"] ?? "",
        );
        calls.push({ url, ua });
        // WAF behavior: 403 for the bot UA, 200 for a browser UA.
        if (/MapslyBot/.test(ua)) {
          return new Response("blocked", { status: 403 });
        }
        return new Response(
          `<html><body><a href="mailto:owner@glowspa.com">email</a></body></html>`,
          { status: 200, headers: { "content-type": "text/html" } },
        );
      },
    ) as typeof fetch;

    const result = await scrapeEmailsFromWebsite({
      website: "https://glowspa.com",
      domain: "glowspa.com",
    });

    // The rescue pass found the email the bot UA never saw.
    expect(result.websiteUnreachable).toBe(false);
    expect(result.candidates.map((c) => c.email)).toContain(
      "owner@glowspa.com",
    );
    // And the rescue is bounded — browser-UA requests stay a small
    // fixed set (3 pages + ≤3 bundles), not a full re-crawl.
    const browserCalls = calls.filter((c) => !/MapslyBot/.test(c.ua));
    expect(browserCalls.length).toBeLessThanOrEqual(6);
  });
});
