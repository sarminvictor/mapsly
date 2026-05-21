/**
 * Unit tests · format helpers + meta-description builder.
 *
 * These are pure functions used by `generateMetadata` (which Google
 * crawlers consume) — regressions silently mangle SEO. Lock the shapes.
 */
import { describe, expect, test } from "vitest";

import {
  buildMetaDescription,
  formatCategory,
  formatLocation,
  formatRatingLine,
  formatWebsiteDisplay,
} from "../format";
import { EMPTY_BIZ_PROFILE, type BizProfileData } from "../types";

function biz(overrides: Partial<BizProfileData>): BizProfileData {
  return { ...EMPTY_BIZ_PROFILE, ...overrides };
}

describe("formatCategory", () => {
  test("maps known slugs to human-readable labels", () => {
    expect(formatCategory("med_spa")).toBe("Medical spa");
    expect(formatCategory("hair_salon")).toBe("Hair salon");
    expect(formatCategory("auto_body")).toBe("Auto body shop");
  });

  test("title-cases unknown slugs as a fallback", () => {
    expect(formatCategory("yoga_studio")).toBe("Yoga Studio");
    expect(formatCategory("widget")).toBe("Widget");
  });

  test("handles single-word slugs", () => {
    expect(formatCategory("plumber")).toBe("Plumber");
  });
});

describe("formatLocation", () => {
  test("city only", () => {
    expect(formatLocation(biz({ city: "Miami" }))).toBe("Miami");
  });

  test("city + province (US)", () => {
    expect(
      formatLocation(biz({ city: "Miami", province: "FL", country: "US" })),
    ).toBe("Miami, FL");
  });

  test("city + province + country (non-US)", () => {
    expect(
      formatLocation(
        biz({ city: "Toronto", province: "ON", country: "Canada" }),
      ),
    ).toBe("Toronto, ON, Canada");
  });

  test("empty input returns empty string", () => {
    expect(formatLocation(biz({}))).toBe("");
  });
});

describe("formatRatingLine", () => {
  test("rating with reviews", () => {
    expect(formatRatingLine(biz({ rating: 4.4, reviewCount: 128 }))).toBe(
      "4.4 ★ · 128 reviews",
    );
  });

  test("rating with single review uses singular", () => {
    expect(formatRatingLine(biz({ rating: 5, reviewCount: 1 }))).toBe(
      "5.0 ★ · 1 review",
    );
  });

  test("rating without reviews", () => {
    expect(formatRatingLine(biz({ rating: 4.4, reviewCount: 0 }))).toBe(
      "4.4 ★",
    );
  });

  test("no rating returns null", () => {
    expect(formatRatingLine(biz({}))).toBeNull();
  });
});

describe("formatWebsiteDisplay", () => {
  test("strips protocol + www", () => {
    expect(formatWebsiteDisplay("https://www.example.com/about")).toBe(
      "example.com",
    );
  });

  test("preserves subdomain (non-www)", () => {
    expect(formatWebsiteDisplay("https://shop.example.com")).toBe(
      "shop.example.com",
    );
  });

  test("returns raw string on parse failure", () => {
    expect(formatWebsiteDisplay("not a url")).toBe("not a url");
  });

  test("null input returns null", () => {
    expect(formatWebsiteDisplay(null)).toBeNull();
  });
});

describe("buildMetaDescription", () => {
  test("includes name, category, location, rating", () => {
    const out = buildMetaDescription(
      biz({
        name: "Radiance Laser Center",
        category: "med_spa",
        city: "Miami",
        province: "FL",
        rating: 4.4,
        reviewCount: 128,
      }),
    );
    expect(out).toContain("Radiance Laser Center");
    expect(out).toContain("Medical spa");
    expect(out).toContain("Miami");
    expect(out).toContain("4.4");
    expect(out).toContain("128");
  });

  test("omits rating block when no rating data", () => {
    const out = buildMetaDescription(
      biz({ name: "Foo", category: "med_spa", city: "Miami" }),
    );
    expect(out).not.toContain("★");
    expect(out).not.toContain("Rated");
  });

  test("capped at 160 chars", () => {
    const out = buildMetaDescription(
      biz({
        name: "A".repeat(80),
        category: "med_spa",
        city: "Miami",
        rating: 4.4,
        reviewCount: 128,
      }),
    );
    expect(out.length).toBeLessThanOrEqual(160);
  });
});
