// Pure display-helper tests for the single-lead deep view.
// C1 · socialHandle must not surface Facebook script/redirect segments
//      ("profile.php") as a handle — it falls back to the platform label.
// C2 · formatAddressLine must not duplicate city/region when the DataForSEO
//      full address already contains them (token-based dedup).
// Owner 2026-07-06 · phone identity (phoneKey) must collide across formats so
//      a GBP listing scalar never renders beside its scraped twin, and
//      formatPhoneDisplay must normalize every NANP number to ONE format.

import { describe, expect, test } from "vitest";
import {
  socialHandle,
  formatAddressLine,
  formatPhoneDisplay,
  phoneDigits,
  phoneKey,
} from "../lead-detail";

describe("socialHandle (C1 · Facebook profile.php)", () => {
  test("facebook.com/profile.php?id=NNN → platform label, not '@profile.php'", () => {
    expect(
      socialHandle("FACEBOOK", "https://facebook.com/profile.php?id=100063"),
    ).toBe("Facebook");
  });

  test("real Facebook vanity URL still yields the handle", () => {
    expect(socialHandle("FACEBOOK", "https://facebook.com/AcuKimberly")).toBe(
      "@AcuKimberly",
    );
  });

  test("instagram.com/soleaspa → '@soleaspa' (regression)", () => {
    expect(socialHandle("INSTAGRAM", "https://instagram.com/soleaspa")).toBe(
      "@soleaspa",
    );
  });
});

describe("formatAddressLine (C2 · no duplicated components)", () => {
  test("full DataForSEO address does not re-append its city", () => {
    const line = formatAddressLine([
      "1626 Richter St, Kelowna, BC V1Y 2M3, Canada",
      "Kelowna",
      "British Columbia",
      "CA",
    ]);
    const kelownaCount = (line.match(/kelowna/gi) ?? []).length;
    expect(kelownaCount).toBe(1);
  });

  test("no full address → joins the discrete components", () => {
    expect(formatAddressLine([null, "Boise", "Idaho", "US"])).toBe(
      "Boise, Idaho, US",
    );
  });

  test("all-empty falls back to em-dash", () => {
    expect(formatAddressLine([null, undefined, "", "  "])).toBe("—");
  });
});

describe("phoneDigits / phoneKey (owner 2026-07-06 · contact dedupe)", () => {
  test("phoneDigits strips every non-digit", () => {
    expect(phoneDigits("+1 (208) 965-3777")).toBe("12089653777");
    expect(phoneDigits("208.965.3777 ext")).toBe("2089653777");
  });

  test("the same number in different formats shares ONE key", () => {
    const key = phoneKey("(208) 965-3777");
    expect(phoneKey("+1 208-965-3777")).toBe(key);
    expect(phoneKey("12089653777")).toBe(key);
    expect(phoneKey("208.965.3777")).toBe(key);
  });

  test("different numbers get different keys", () => {
    expect(phoneKey("(208) 965-3777")).not.toBe(phoneKey("(208) 730-1886"));
  });

  test("short (non-NANP-length) values compare on their full digits", () => {
    expect(phoneKey("965-3777")).toBe("9653777");
    expect(phoneKey("965-3777")).not.toBe(phoneKey("(208) 965-3777"));
  });

  test("no digits → null (never matches anything)", () => {
    expect(phoneKey("call us")).toBeNull();
    expect(phoneKey("")).toBeNull();
  });
});

describe("formatPhoneDisplay (owner 2026-07-06 · ONE phone format)", () => {
  test('10-digit NANP → "(208) 965-3777"', () => {
    expect(formatPhoneDisplay("2089653777")).toBe("(208) 965-3777");
    expect(formatPhoneDisplay("208-965-3777")).toBe("(208) 965-3777");
  });

  test("11-digit with a leading 1 drops the country code", () => {
    expect(formatPhoneDisplay("+1 (208) 965-3777")).toBe("(208) 965-3777");
    expect(formatPhoneDisplay("12089653777")).toBe("(208) 965-3777");
  });

  test("idempotent — an already-pretty value re-formats to itself", () => {
    expect(formatPhoneDisplay("(208) 965-3777")).toBe("(208) 965-3777");
  });

  test("non-NANP values render as stored (trimmed)", () => {
    expect(formatPhoneDisplay("+44 20 7946 0958")).toBe("+44 20 7946 0958");
    expect(formatPhoneDisplay(" 965-3777 ")).toBe("965-3777");
  });
});
