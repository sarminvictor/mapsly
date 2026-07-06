// Pure display-helper tests for the single-lead deep view.
// C1 · socialHandle must not surface Facebook script/redirect segments
//      ("profile.php") as a handle — it falls back to the platform label.
// C2 · formatAddressLine must not duplicate city/region when the DataForSEO
//      full address already contains them (token-based dedup).

import { describe, expect, test } from "vitest";
import { socialHandle, formatAddressLine } from "../lead-detail";

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
