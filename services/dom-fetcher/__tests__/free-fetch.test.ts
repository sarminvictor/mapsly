/**
 * Unit tests for the free ($0) plain-fetch first pass.
 *
 * The whole cost win rides on `isBlockedResponse` not over-blocking (paying for
 * open sites) or under-blocking (dropping walled ones). We test the pure
 * classifier exhaustively, plus a couple of `freeFetchDom` integration cases
 * with a mocked global fetch.
 */

import { afterEach, describe, expect, test, vi } from "vitest";
import { freeFetchDom, isBlockedResponse } from "../free-fetch";

const LONG_HTML =
  "<html><head><title>Real Spa</title></head><body>" +
  "x".repeat(800) +
  "</body></html>";

describe("isBlockedResponse · Cloudflare / challenge detection", () => {
  test("403 is blocked even with a full body", () => {
    expect(isBlockedResponse(403, LONG_HTML)).toBe(true);
  });

  test("503 is blocked", () => {
    expect(isBlockedResponse(503, LONG_HTML)).toBe(true);
  });

  test("'Just a moment...' Cloudflare interstitial is blocked", () => {
    const body =
      "<html><head><title>Just a moment...</title></head><body>" +
      "cf-browser-verification".repeat(40) +
      "</body></html>";
    expect(isBlockedResponse(200, body)).toBe(true);
  });

  test("'Attention Required! | Cloudflare' is blocked", () => {
    const body =
      "<html><body>Attention Required! | Cloudflare " +
      "y".repeat(600) +
      "</body></html>";
    expect(isBlockedResponse(200, body)).toBe(true);
  });

  test("'Checking your browser' is blocked", () => {
    const body =
      "Checking your browser before accessing the site. " + "z".repeat(600);
    expect(isBlockedResponse(200, body)).toBe(true);
  });

  test("'enable JavaScript and cookies to continue' is blocked", () => {
    const body =
      "Please enable JavaScript and cookies to continue. " + "q".repeat(600);
    expect(isBlockedResponse(200, body)).toBe(true);
  });

  test("an empty / tiny shell body (<500 bytes) is blocked", () => {
    expect(isBlockedResponse(200, "<html></html>")).toBe(true);
    expect(isBlockedResponse(200, "")).toBe(true);
    expect(isBlockedResponse(200, "   ")).toBe(true);
  });

  test("a real, long 200 homepage is NOT blocked", () => {
    expect(isBlockedResponse(200, LONG_HTML)).toBe(false);
  });

  test("detection is case-insensitive", () => {
    const body = "JUST A MOMENT... " + "w".repeat(600);
    expect(isBlockedResponse(200, body)).toBe(true);
  });
});

describe("freeFetchDom · routing", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("returns html for an open 200 HTML page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(LONG_HTML, {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      ),
    );
    const res = await freeFetchDom("https://open-spa.com");
    expect(res.blocked).toBe(false);
    expect(res.html).toContain("Real Spa");
    expect(res.status).toBe(200);
  });

  test("marks a 403 Cloudflare response as blocked (no html)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("Just a moment...", {
            status: 403,
            headers: { "content-type": "text/html" },
          }),
      ),
    );
    const res = await freeFetchDom("https://walled-spa.com");
    expect(res.blocked).toBe(true);
    expect(res.html).toBeUndefined();
    expect(res.status).toBe(403);
  });

  test("marks a non-HTML body (PDF) as blocked", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("%PDF-1.7 ...", {
            status: 200,
            headers: { "content-type": "application/pdf" },
          }),
      ),
    );
    const res = await freeFetchDom("https://pdf-home.com");
    expect(res.blocked).toBe(true);
  });

  test("a network error collapses to blocked (routes to paid actor)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    );
    const res = await freeFetchDom("https://dead-host.com");
    expect(res.blocked).toBe(true);
    expect(res.html).toBeUndefined();
  });

  test("a non-http(s) / empty URL is blocked without a fetch", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    // A non-http(s) scheme is rejected by the protocol guard; a blank string
    // is rejected outright — neither reaches `fetch`.
    expect((await freeFetchDom("javascript:alert(1)")).blocked).toBe(true);
    expect((await freeFetchDom("   ")).blocked).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });
});
