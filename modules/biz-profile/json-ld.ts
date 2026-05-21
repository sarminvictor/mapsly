/**
 * Public business profile · structured-data builder.
 *
 * Produces `LocalBusiness` JSON-LD per `.claude/rules/seo.md`. The output is
 * a plain JSON-serialisable object the page injects via
 * `<script type="application/ld+json">`.
 *
 * Schema.org choices:
 *   - `@type: "LocalBusiness"` (generic; could specialise per category but
 *     LocalBusiness is the widest crawler-supported root type).
 *   - `name`, `url` (the public profile URL), `address` (PostalAddress) —
 *     present when we have the fields.
 *   - `geo` (GeoCoordinates) — present when lat+lng are non-null.
 *   - `aggregateRating` — present only when rating + reviewCount > 0, so
 *     Google doesn't reject the rich result for missing data (their
 *     validator flags ratings with reviewCount === 0 as incomplete).
 *   - `telephone`, `sameAs` (website) — present when available.
 *
 * Per Schema.org validator rules, every nested object declares `@type`.
 * Omitting fields rather than nulling them out keeps the JSON-LD clean —
 * `JSON.stringify(undefined)` strips keys, so we use `undefined` for absent
 * fields and TS readers should not access them.
 */

import { absoluteUrl } from "@/lib/seo/canonical";

import type { BizProfileData } from "./types";

interface PostalAddress {
  "@type": "PostalAddress";
  streetAddress?: string;
  addressLocality?: string;
  addressRegion?: string;
  postalCode?: string;
  addressCountry?: string;
}

interface GeoCoordinates {
  "@type": "GeoCoordinates";
  latitude: number;
  longitude: number;
}

interface AggregateRating {
  "@type": "AggregateRating";
  ratingValue: number;
  reviewCount: number;
  bestRating: 5;
  worstRating: 1;
}

export interface LocalBusinessSchema {
  "@context": "https://schema.org";
  "@type": "LocalBusiness";
  "@id": string;
  name: string;
  url: string;
  description?: string;
  telephone?: string;
  sameAs?: string[];
  address?: PostalAddress;
  geo?: GeoCoordinates;
  aggregateRating?: AggregateRating;
}

/**
 * Build a `LocalBusiness` JSON-LD object for a business profile.
 *
 * `localizedUrl` is the locale-prefixed public-profile URL on
 * `mapsly.ai/biz/{slug}` (absolute · used as both `url` and `@id`).
 */
export function buildLocalBusinessSchema(
  biz: BizProfileData,
  localizedUrl: string,
): LocalBusinessSchema {
  const out: LocalBusinessSchema = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": localizedUrl,
    name: biz.name,
    url: localizedUrl,
  };

  if (biz.phone) out.telephone = biz.phone;
  if (biz.website) out.sameAs = [biz.website];

  if (biz.address || biz.city || biz.province || biz.postalCode) {
    const addr: PostalAddress = { "@type": "PostalAddress" };
    if (biz.address) addr.streetAddress = biz.address;
    if (biz.city) addr.addressLocality = biz.city;
    if (biz.province) addr.addressRegion = biz.province;
    if (biz.postalCode) addr.postalCode = biz.postalCode;
    if (biz.country) addr.addressCountry = biz.country;
    out.address = addr;
  }

  if (biz.lat != null && biz.lng != null) {
    out.geo = {
      "@type": "GeoCoordinates",
      latitude: biz.lat,
      longitude: biz.lng,
    };
  }

  if (biz.rating != null && biz.reviewCount != null && biz.reviewCount > 0) {
    out.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: biz.rating,
      reviewCount: biz.reviewCount,
      bestRating: 5,
      worstRating: 1,
    };
  }

  return out;
}

/**
 * Return the absolute, canonical-origin URL for a business profile slug.
 * `/biz/[slug]` is the SAME path in every locale (slug is locale-agnostic);
 * the locale prefix governs the leading segment.
 *
 *   bizCanonicalUrl("radiance-laser-center", "en")    → "https://mapsly.ai/biz/radiance-laser-center"
 *   bizCanonicalUrl("radiance-laser-center", "es")    → "https://mapsly.ai/es/biz/radiance-laser-center"
 *   bizCanonicalUrl("radiance-laser-center", "fr")    → "https://mapsly.ai/fr/biz/radiance-laser-center"
 */
export function bizCanonicalUrl(slug: string, locale: string): string {
  const prefix = locale === "en" ? "" : `/${locale.toLowerCase()}`;
  return absoluteUrl(`${prefix}/biz/${slug}`);
}

/** Relative path version · used inside `alternates.languages`. */
export function bizLocalizedPath(slug: string, locale: string): string {
  const prefix = locale === "en" ? "" : `/${locale.toLowerCase()}`;
  return `${prefix}/biz/${slug}`;
}
