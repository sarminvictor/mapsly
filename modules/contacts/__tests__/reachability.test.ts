/**
 * Reachability gate invariants · Phase 4
 *
 * Golden tests over `modules/contacts/reachability.ts`. The load-bearing
 * invariant — and the reason this gate is its own module — is:
 *
 *     FAILED ≠ UNREACHABLE.
 *
 * A failed scan tells us nothing; gating on it would silently delete reachable
 * businesses. Only a SUCCESSFUL scan with zero reach (OK + 0), or an explicit
 * hide, blocks enrichment. These tests lock that down plus the full
 * UNREACHABLE / EMAIL_ONLY / PHONE_ONLY / MULTI / RICH classification matrix.
 */

import { describe, expect, test } from "vitest";
import {
  assertEnrichable,
  canonicalizeUrl,
  computeHidden,
  isEnrichable,
  isReachableChannel,
  normalizeEmail,
  normalizePhone,
  reachabilityFromContacts,
  type ContactChannel,
} from "@/modules/contacts/reachability";

/** Build a contact list from a bare channel array. */
function c(...channels: ContactChannel[]): Array<{ channel: ContactChannel }> {
  return channels.map((channel) => ({ channel }));
}

describe("isReachableChannel", () => {
  test("email / phone / whatsapp / socials are reachable", () => {
    for (const ch of [
      "EMAIL",
      "PHONE",
      "WHATSAPP",
      "FACEBOOK",
      "INSTAGRAM",
      "LINKEDIN",
      "TIKTOK",
      "YOUTUBE",
      "X",
      "YELP",
    ] as ContactChannel[]) {
      expect(isReachableChannel(ch)).toBe(true);
    }
  });
  test("website / booking_url are NOT reachable touchpoints", () => {
    expect(isReachableChannel("WEBSITE")).toBe(false);
    expect(isReachableChannel("BOOKING_URL")).toBe(false);
  });
});

describe("normalizers", () => {
  test("normalizeEmail", () => {
    expect(normalizeEmail("  Foo@BAR.com ")).toBe("foo@bar.com");
  });
  test("normalizePhone", () => {
    expect(normalizePhone("(305) 555-0142")).toBe("+13055550142");
    expect(normalizePhone("bad")).toBeNull();
  });
  test("canonicalizeUrl strips www, scheme, query, trailing slash", () => {
    expect(canonicalizeUrl("http://www.Solea-Spa.com/Contact/?x=1#top")).toBe(
      "https://solea-spa.com/contact",
    );
  });
  test("canonicalizeUrl handles bare host", () => {
    expect(canonicalizeUrl("solea-spa.com")).toBe("https://solea-spa.com");
  });
  test("canonicalizeUrl returns input on unparseable value", () => {
    expect(canonicalizeUrl("   ")).toBe("");
  });
});

describe("reachabilityFromContacts · classification matrix", () => {
  test("0 reachable channels → UNREACHABLE", () => {
    expect(reachabilityFromContacts([])).toEqual({
      status: "UNREACHABLE",
      reachableChannelCount: 0,
    });
    // Non-reachable channels (website only) still UNREACHABLE.
    expect(reachabilityFromContacts(c("WEBSITE", "BOOKING_URL"))).toEqual({
      status: "UNREACHABLE",
      reachableChannelCount: 0,
    });
  });

  test("only email → EMAIL_ONLY", () => {
    expect(reachabilityFromContacts(c("EMAIL"))).toEqual({
      status: "EMAIL_ONLY",
      reachableChannelCount: 1,
    });
  });

  test("only phone → PHONE_ONLY", () => {
    expect(reachabilityFromContacts(c("PHONE"))).toEqual({
      status: "PHONE_ONLY",
      reachableChannelCount: 1,
    });
  });

  test("only whatsapp → PHONE_ONLY (whatsapp is phone-like)", () => {
    expect(reachabilityFromContacts(c("WHATSAPP"))).toEqual({
      status: "PHONE_ONLY",
      reachableChannelCount: 1,
    });
  });

  test("email + phone → MULTI", () => {
    expect(reachabilityFromContacts(c("EMAIL", "PHONE"))).toEqual({
      status: "MULTI",
      reachableChannelCount: 2,
    });
  });

  test("two distinct kinds: phone + social → MULTI", () => {
    expect(reachabilityFromContacts(c("PHONE", "INSTAGRAM"))).toEqual({
      status: "MULTI",
      reachableChannelCount: 2,
    });
  });

  test("only socials (no email/phone) → MULTI", () => {
    expect(reachabilityFromContacts(c("FACEBOOK", "INSTAGRAM"))).toEqual({
      status: "MULTI",
      reachableChannelCount: 2,
    });
  });

  test("email + phone + ≥1 social → RICH", () => {
    expect(reachabilityFromContacts(c("EMAIL", "PHONE", "INSTAGRAM"))).toEqual({
      status: "RICH",
      reachableChannelCount: 3,
    });
  });

  test("email + whatsapp + yelp → RICH (whatsapp counts as phone-like)", () => {
    expect(reachabilityFromContacts(c("EMAIL", "WHATSAPP", "YELP"))).toEqual({
      status: "RICH",
      reachableChannelCount: 3,
    });
  });

  test("de-dupes repeated channels in the count (single social → MULTI, count 1)", () => {
    expect(
      reachabilityFromContacts(c("INSTAGRAM", "INSTAGRAM", "INSTAGRAM")),
    ).toEqual({ status: "MULTI", reachableChannelCount: 1 });
  });
});

describe("assertEnrichable · the FAILED ≠ UNREACHABLE invariant", () => {
  test("OK + 0 reachable → throws unreachable", () => {
    expect(() =>
      assertEnrichable({
        contactScanStatus: "OK",
        reachableChannelCount: 0,
        isHidden: false,
      }),
    ).toThrow("unreachable");
  });

  test("FAILED + 0 reachable → does NOT throw (we don't know)", () => {
    expect(() =>
      assertEnrichable({
        contactScanStatus: "FAILED",
        reachableChannelCount: 0,
        isHidden: false,
      }),
    ).not.toThrow();
  });

  test("PENDING + 0 reachable → does NOT throw", () => {
    expect(() =>
      assertEnrichable({
        contactScanStatus: "PENDING",
        reachableChannelCount: 0,
        isHidden: false,
      }),
    ).not.toThrow();
  });

  test("PARTIAL + 0 reachable → does NOT throw", () => {
    expect(() =>
      assertEnrichable({
        contactScanStatus: "PARTIAL",
        reachableChannelCount: 0,
        isHidden: false,
      }),
    ).not.toThrow();
  });

  test("isHidden=true → throws even with reachable channels and OK scan", () => {
    expect(() =>
      assertEnrichable({
        contactScanStatus: "OK",
        reachableChannelCount: 5,
        isHidden: true,
      }),
    ).toThrow("unreachable");
  });

  test("OK + ≥1 reachable → does NOT throw", () => {
    expect(() =>
      assertEnrichable({
        contactScanStatus: "OK",
        reachableChannelCount: 1,
        isHidden: false,
      }),
    ).not.toThrow();
  });
});

describe("isEnrichable · non-throwing mirror", () => {
  test("matches assertEnrichable across the matrix", () => {
    expect(
      isEnrichable({
        contactScanStatus: "OK",
        reachableChannelCount: 0,
        isHidden: false,
      }),
    ).toBe(false);
    expect(
      isEnrichable({
        contactScanStatus: "FAILED",
        reachableChannelCount: 0,
        isHidden: false,
      }),
    ).toBe(true);
    expect(
      isEnrichable({
        contactScanStatus: "OK",
        reachableChannelCount: 3,
        isHidden: true,
      }),
    ).toBe(false);
    expect(
      isEnrichable({
        contactScanStatus: "OK",
        reachableChannelCount: 2,
        isHidden: false,
      }),
    ).toBe(true);
  });
});

describe("computeHidden", () => {
  test("permanently closed → hidden with reason", () => {
    expect(computeHidden({ isPermanentlyClosed: true })).toEqual({
      isHidden: true,
      hiddenReason: "permanently closed",
    });
  });

  test("OK scan + no reach + no website/phone/email → hidden", () => {
    expect(
      computeHidden({
        contactScanStatus: "OK",
        reachableChannelCount: 0,
        website: null,
        phone: null,
        email: null,
      }),
    ).toEqual({
      isHidden: true,
      hiddenReason: "no website · no phone · no email",
    });
  });

  test("FAILED scan + no reach → NOT hidden (mirrors gate)", () => {
    expect(
      computeHidden({
        contactScanStatus: "FAILED",
        reachableChannelCount: 0,
        website: null,
        phone: null,
        email: null,
      }),
    ).toEqual({ isHidden: false, hiddenReason: null });
  });

  test("has a website → NOT hidden even with OK + 0 reach", () => {
    expect(
      computeHidden({
        contactScanStatus: "OK",
        reachableChannelCount: 0,
        website: "https://solea-spa.com",
      }),
    ).toEqual({ isHidden: false, hiddenReason: null });
  });

  test("has reachable channels → NOT hidden", () => {
    expect(
      computeHidden({
        contactScanStatus: "OK",
        reachableChannelCount: 2,
      }),
    ).toEqual({ isHidden: false, hiddenReason: null });
  });
});
