/**
 * Unit tests · `LocalBusiness` JSON-LD builder.
 *
 * The builder produces structured data Google validates. Schema.org's
 * validator rejects partial nested objects (e.g. `aggregateRating` with
 * `reviewCount === 0`), so this test suite locks the shape per branch.
 */
import { describe, expect, test } from "vitest";

import { CANONICAL_ORIGIN } from "@/lib/seo/canonical";

import {
  bizCanonicalUrl,
  bizLocalizedPath,
  buildLocalBusinessSchema,
} from "../json-ld";
import { EMPTY_BIZ_PROFILE, type BizProfileData } from "../types";

function biz(overrides: Partial<BizProfileData>): BizProfileData {
  return { ...EMPTY_BIZ_PROFILE, ...overrides };
}

describe("buildLocalBusinessSchema", () => {
  test("minimum viable shape (name + url + @id + @type)", () => {
    const s = buildLocalBusinessSchema(
      biz({ id: "biz_1", slug: "foo", name: "Foo Spa", category: "med_spa" }),
      "https://mapsly.ai/biz/foo",
    );
    expect(s).toMatchObject({
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      "@id": "https://mapsly.ai/biz/foo",
      name: "Foo Spa",
      url: "https://mapsly.ai/biz/foo",
    });
    expect(s.aggregateRating).toBeUndefined();
    expect(s.geo).toBeUndefined();
    expect(s.address).toBeUndefined();
  });

  test("includes PostalAddress when address fields present", () => {
    const s = buildLocalBusinessSchema(
      biz({
        id: "biz_1",
        slug: "foo",
        name: "Foo Spa",
        category: "med_spa",
        address: "123 Main St",
        city: "Miami",
        province: "FL",
        postalCode: "33131",
        country: "US",
      }),
      "https://mapsly.ai/biz/foo",
    );
    expect(s.address).toEqual({
      "@type": "PostalAddress",
      streetAddress: "123 Main St",
      addressLocality: "Miami",
      addressRegion: "FL",
      postalCode: "33131",
      addressCountry: "US",
    });
  });

  test("includes GeoCoordinates when lat+lng both present", () => {
    const s = buildLocalBusinessSchema(
      biz({
        id: "biz_1",
        slug: "foo",
        name: "Foo Spa",
        category: "med_spa",
        lat: 25.767,
        lng: -80.194,
      }),
      "https://mapsly.ai/biz/foo",
    );
    expect(s.geo).toEqual({
      "@type": "GeoCoordinates",
      latitude: 25.767,
      longitude: -80.194,
    });
  });

  test("omits geo when only one of lat/lng is present", () => {
    const s = buildLocalBusinessSchema(
      biz({
        id: "biz_1",
        slug: "foo",
        name: "Foo Spa",
        category: "med_spa",
        lat: 25.767,
        // lng intentionally null
      }),
      "https://mapsly.ai/biz/foo",
    );
    expect(s.geo).toBeUndefined();
  });

  test("includes aggregateRating only when reviewCount > 0", () => {
    const withReviews = buildLocalBusinessSchema(
      biz({
        id: "biz_1",
        slug: "foo",
        name: "Foo Spa",
        category: "med_spa",
        rating: 4.4,
        reviewCount: 128,
      }),
      "https://mapsly.ai/biz/foo",
    );
    expect(withReviews.aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.4,
      reviewCount: 128,
      bestRating: 5,
      worstRating: 1,
    });

    const noReviews = buildLocalBusinessSchema(
      biz({
        id: "biz_1",
        slug: "foo",
        name: "Foo Spa",
        category: "med_spa",
        rating: 4.4,
        reviewCount: 0,
      }),
      "https://mapsly.ai/biz/foo",
    );
    expect(noReviews.aggregateRating).toBeUndefined();
  });

  test("includes phone + sameAs (website)", () => {
    const s = buildLocalBusinessSchema(
      biz({
        id: "biz_1",
        slug: "foo",
        name: "Foo Spa",
        category: "med_spa",
        phone: "+1 305 555 0100",
        website: "https://foospa.example",
      }),
      "https://mapsly.ai/biz/foo",
    );
    expect(s.telephone).toBe("+1 305 555 0100");
    expect(s.sameAs).toEqual(["https://foospa.example"]);
  });

  test("serialises to valid JSON without undefined keys", () => {
    const s = buildLocalBusinessSchema(
      biz({
        id: "biz_1",
        slug: "foo",
        name: "Foo Spa",
        category: "med_spa",
      }),
      "https://mapsly.ai/biz/foo",
    );
    const json = JSON.stringify(s);
    // Undefined values must be stripped by JSON.stringify, never serialised.
    expect(json).not.toContain("undefined");
    // The basic identity must remain.
    expect(json).toContain('"@type":"LocalBusiness"');
    expect(json).toContain('"name":"Foo Spa"');
  });
});

describe("bizCanonicalUrl + bizLocalizedPath", () => {
  // Derived from the SSOT, never a literal: these assertions previously
  // hardcoded the apex and so stayed green while every biz-profile canonical
  // pointed at a host that 307s (fixed 2026-07-15). Deriving means the origin
  // can only be wrong in one place, and canonical.test.ts guards that place.
  test("default locale (en) has no prefix", () => {
    expect(bizCanonicalUrl("foo", "en")).toBe(`${CANONICAL_ORIGIN}/biz/foo`);
    expect(bizLocalizedPath("foo", "en")).toBe("/biz/foo");
  });

  test("non-default locales prefix with lowercased code", () => {
    expect(bizCanonicalUrl("foo", "es")).toBe(`${CANONICAL_ORIGIN}/es/biz/foo`);
    expect(bizCanonicalUrl("foo", "fr")).toBe(`${CANONICAL_ORIGIN}/fr/biz/foo`);
    expect(bizCanonicalUrl("foo", "en-CA")).toBe(
      `${CANONICAL_ORIGIN}/en-ca/biz/foo`,
    );
    expect(bizLocalizedPath("foo", "es")).toBe("/es/biz/foo");
    expect(bizLocalizedPath("foo", "en-CA")).toBe("/en-ca/biz/foo");
  });

  test("every canonical it builds is on the non-redirecting host", () => {
    for (const locale of ["en", "es", "fr", "en-CA"] as const) {
      expect(new URL(bizCanonicalUrl("foo", locale)).hostname).toBe(
        "www.mapsly.ai",
      );
    }
  });
});
