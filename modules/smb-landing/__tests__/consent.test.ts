/**
 * Tests · landing ad-pixel consent (plan #7).
 *
 * Load-bearing invariant: NO third-party pixel ever loads without BOTH an
 * explicit accept AND a configured env id. `pixelsToLoad` is the single gate
 * the RetargetingPixels component consults — these tests pin it. Also pinned:
 * the cookie round-trip (the bar writes exactly what the pixels read) and
 * that neither client component emits anything in server-rendered HTML
 * (pixels are a strictly post-consent, client-side concern).
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import {
  CONSENT_COOKIE_NAME,
  makeConsent,
  parseConsentCookie,
  pixelsToLoad,
  serializeConsentCookie,
} from "../consent";
import { ConsentBar } from "../components/ConsentBar";
import { RetargetingPixels } from "../components/RetargetingPixels";

describe("consent cookie round-trip", () => {
  test("serialize → parse returns the same record", () => {
    const consent = makeConsent(true, new Date("2026-06-10T12:00:00Z"));
    const cookie = serializeConsentCookie(consent);
    // What the bar writes is what the pixels read (document.cookie shows
    // only `name=value`, other attributes are dropped by the browser).
    const parsed = parseConsentCookie(cookie.split(";")[0]);
    expect(parsed).toEqual({
      v: 1,
      ads: true,
      analytics: true,
      ts: "2026-06-10T12:00:00.000Z",
    });
  });

  test("cookie attributes: one year, path=/, SameSite=Lax", () => {
    const cookie = serializeConsentCookie(makeConsent(false));
    expect(cookie).toContain("max-age=31536000");
    expect(cookie).toContain("path=/");
    expect(cookie).toContain("SameSite=Lax");
  });

  test("decline records ads=false and analytics=false", () => {
    const consent = makeConsent(false);
    expect(consent.ads).toBe(false);
    expect(consent.analytics).toBe(false);
  });

  test("absent / malformed / wrong-shape cookies parse to null", () => {
    expect(parseConsentCookie(null)).toBeNull();
    expect(parseConsentCookie("")).toBeNull();
    expect(parseConsentCookie("other=1; foo=bar")).toBeNull();
    expect(parseConsentCookie(`${CONSENT_COOKIE_NAME}=%%%garbage`)).toBeNull();
    expect(parseConsentCookie(`${CONSENT_COOKIE_NAME}=42`)).toBeNull();
    expect(
      parseConsentCookie(
        `${CONSENT_COOKIE_NAME}=${encodeURIComponent('{"v":2,"ads":true,"analytics":true,"ts":"x"}')}`,
      ),
    ).toBeNull();
    expect(
      parseConsentCookie(
        `${CONSENT_COOKIE_NAME}=${encodeURIComponent('{"v":1,"ads":"yes","analytics":true,"ts":"x"}')}`,
      ),
    ).toBeNull();
  });

  test("finds the consent cookie among other cookies", () => {
    const value = serializeConsentCookie(makeConsent(true)).split(";")[0];
    const parsed = parseConsentCookie(`mapsly_l_vid=abc; ${value}; theme=dark`);
    expect(parsed?.ads).toBe(true);
  });
});

describe("pixelsToLoad · the gate", () => {
  const accepted = makeConsent(true);
  const declined = makeConsent(false);

  test("no consent recorded → nothing loads, even with env ids", () => {
    expect(pixelsToLoad(null, "123", "AW-1")).toEqual({
      meta: null,
      google: null,
    });
  });

  test("declined → nothing loads", () => {
    expect(pixelsToLoad(declined, "123", "AW-1")).toEqual({
      meta: null,
      google: null,
    });
  });

  test("accepted but no env ids → nothing loads (pre-account NO-OP)", () => {
    expect(pixelsToLoad(accepted, undefined, undefined)).toEqual({
      meta: null,
      google: null,
    });
    expect(pixelsToLoad(accepted, "", "  ")).toEqual({
      meta: null,
      google: null,
    });
  });

  test("accepted + one id → only that pixel loads", () => {
    expect(pixelsToLoad(accepted, "1234567890", undefined)).toEqual({
      meta: "1234567890",
      google: null,
    });
    expect(pixelsToLoad(accepted, undefined, "AW-123")).toEqual({
      meta: null,
      google: "AW-123",
    });
  });

  test("accepted + both ids → both load", () => {
    expect(pixelsToLoad(accepted, "1234567890", "AW-123")).toEqual({
      meta: "1234567890",
      google: "AW-123",
    });
  });
});

describe("server-rendered output", () => {
  test("RetargetingPixels renders NOTHING server-side (no script pre-consent)", () => {
    expect(renderToStaticMarkup(createElement(RetargetingPixels))).toBe("");
  });

  test("ConsentBar renders NOTHING server-side (no flash before mount)", () => {
    expect(renderToStaticMarkup(createElement(ConsentBar))).toBe("");
  });
});
