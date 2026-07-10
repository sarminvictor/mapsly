// INC-59 · the dead-website / parked-domain verdicts. Pure functions — these
// tests are the contract that keeps "domain doesn't exist" from ever landing
// back in the generic retry bucket.

import { describe, expect, test } from "vitest";

import { classifySiteFailure, looksParkedDomain } from "../site-verdict";

describe("classifySiteFailure", () => {
  test("DNS-gone codes (Node + Chromium spellings) → site_gone_dns", () => {
    expect(classifySiteFailure("ENOTFOUND")).toBe("site_gone_dns");
    expect(classifySiteFailure("EAI_NONAME")).toBe("site_gone_dns");
    expect(classifySiteFailure("net::ERR_NAME_NOT_RESOLVED")).toBe(
      "site_gone_dns",
    );
    expect(classifySiteFailure("DNS_PROBE_FINISHED_NXDOMAIN")).toBe(
      "site_gone_dns",
    );
  });

  test("connection-gone codes → site_gone_conn", () => {
    expect(classifySiteFailure("ECONNREFUSED")).toBe("site_gone_conn");
    expect(classifySiteFailure("net::ERR_CONNECTION_REFUSED")).toBe(
      "site_gone_conn",
    );
    expect(classifySiteFailure("EHOSTUNREACH")).toBe("site_gone_conn");
  });

  test("transient / ambiguous failures stay null (retry ladder keeps them)", () => {
    expect(classifySiteFailure("ETIMEDOUT")).toBeNull();
    expect(classifySiteFailure("EAI_AGAIN")).toBeNull(); // OUR resolver hiccup
    expect(classifySiteFailure("ECONNRESET")).toBeNull();
    expect(classifySiteFailure("HTTP_500")).toBeNull(); // bad deploy ≠ dead site
    expect(classifySiteFailure("HTTP_403")).toBeNull(); // WAF ≠ dead site
    expect(classifySiteFailure("AbortError")).toBeNull();
    expect(classifySiteFailure(undefined)).toBeNull();
    expect(classifySiteFailure("")).toBeNull();
  });
});

describe("looksParkedDomain", () => {
  test("registrar for-sale phrases in the title are decisive", () => {
    expect(
      looksParkedDomain(
        "<html><head><title>livingwaterplumbing.ca — this domain may be for sale</title></head><body></body></html>",
      ),
    ).toBe(true);
    expect(
      looksParkedDomain(
        "<html><head><title>Buy this domain</title></head><body>Contact our broker.</body></html>",
      ),
    ).toBe(true);
  });

  test("parking-provider scripts anywhere in the HTML are decisive", () => {
    expect(
      looksParkedDomain(
        '<html><body><script src="https://www.sedoparking.com/frmpark.js"></script></body></html>',
      ),
    ).toBe(true);
    expect(
      looksParkedDomain(
        '<html><body><iframe src="https://parkingcrew.net/lander"></iframe></body></html>',
      ),
    ).toBe(true);
    expect(
      looksParkedDomain(
        '<html><body><a href="https://www.hugedomains.com/domain_profile.cfm?d=example.com">HugeDomains</a></body></html>',
      ),
    ).toBe(true);
  });

  test("for-sale phrase in leading visible text of a small page trips it", () => {
    expect(
      looksParkedDomain(
        "<html><body><h1>example.ca</h1><p>This domain is parked free, courtesy of the registrar.</p></body></html>",
      ),
    ).toBe(true);
  });

  test("a real business site never trips it", () => {
    expect(
      looksParkedDomain(
        `<html><head><title>Aspen Heating & Sheet Metal — Kelowna HVAC</title></head>
         <body><nav><a href="/services">Services</a><a href="/contact">Contact</a></nav>
         <h1>Furnace repair in Kelowna</h1>
         <p>Call (250) 762-2126 for 24/7 heating and cooling service.</p></body></html>`,
      ),
    ).toBe(false);
  });

  test("a big real page QUOTING a for-sale phrase does not trip it", () => {
    const article =
      "<html><head><title>Kelowna Plumbing Blog</title></head><body>" +
      "<p>" +
      "plumbing tips and seasonal advice ".repeat(12_000) + // > size cap
      "</p><p>We once saw a rival's site replaced by a 'buy this domain' page.</p>" +
      "</body></html>";
    expect(looksParkedDomain(article)).toBe(false);
  });

  test("empty / missing html is not parked", () => {
    expect(looksParkedDomain("")).toBe(false);
    expect(looksParkedDomain(null)).toBe(false);
    expect(looksParkedDomain(undefined)).toBe(false);
  });
});
