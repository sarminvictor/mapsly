/**
 * Public business profile · presentation helpers.
 *
 * Pure formatters · server-component-safe · no React imports. Centralised so
 * the page handler, metadata builder, and JSON-LD builder all agree on the
 * same human-readable strings.
 *
 * Per `.claude/rules/copy-voice.md`, the public profile speaks Maria's voice
 * by default (warm, outcome-first) — it's a SMB-facing surface even though
 * the URL is public (Google indexes it, but the audience reading the page is
 * either the business owner or a prospective customer).
 */

import type { BizProfileData } from "./types";

/**
 * Map raw category slugs (snake_case from DataForSEO) to a human-readable
 * label. Falls back to a title-cased version of the slug if not in the map.
 *
 * Stable, frozen — adding a category should bump this map AND the signal
 * registry. The seed is `med_spa` only today; other verticals land with
 * the SMB / agency expansion phases (E.x, F.x).
 */
const CATEGORY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  med_spa: "Medical spa",
  hair_salon: "Hair salon",
  restaurant: "Restaurant",
  auto_body: "Auto body shop",
  dentist: "Dental practice",
  chiropractor: "Chiropractor",
  law_firm: "Law firm",
  accountant: "Accounting firm",
});

/** Human-readable category label. Falls back to title-cased slug. */
export function formatCategory(slug: string): string {
  if (slug in CATEGORY_LABELS) return CATEGORY_LABELS[slug]!;
  return slug
    .split("_")
    .map((s) => (s.length === 0 ? "" : s[0]!.toUpperCase() + s.slice(1)))
    .join(" ");
}

/**
 * Compact location string · "Miami, FL" / "Toronto, ON, Canada" / "Miami".
 * Drops empty segments and dedups the country when it's "United States".
 */
export function formatLocation(biz: BizProfileData): string {
  const parts: string[] = [];
  if (biz.city) parts.push(biz.city);
  if (biz.province) parts.push(biz.province);
  if (biz.country && biz.country !== "United States" && biz.country !== "US") {
    parts.push(biz.country);
  }
  return parts.join(", ");
}

/**
 * Format a rating like "4.4 ★ (128 reviews)" for the hero. Returns null
 * when there's no rating data (page omits the line entirely).
 */
export function formatRatingLine(biz: BizProfileData): string | null {
  if (biz.rating == null) return null;
  const stars = biz.rating.toFixed(1);
  if (biz.reviewCount == null || biz.reviewCount === 0) {
    return `${stars} ★`;
  }
  const noun = biz.reviewCount === 1 ? "review" : "reviews";
  return `${stars} ★ · ${biz.reviewCount} ${noun}`;
}

/**
 * Hostname-only URL for display (strips protocol + path). Returns the raw
 * string on parse failure so the page never shows "undefined".
 */
export function formatWebsiteDisplay(website: string | null): string | null {
  if (!website) return null;
  try {
    const url = new URL(website);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return website;
  }
}

/**
 * Meta-description copy · used by `generateMetadata`. Plain English, mentions
 * the business name + category + city when available. Capped to ~155 chars
 * (Google truncates above ~160 on mobile).
 */
export function buildMetaDescription(biz: BizProfileData): string {
  const cat = formatCategory(biz.category);
  const loc = formatLocation(biz);
  const where = loc ? ` in ${loc}` : "";
  const ratingPart =
    biz.rating != null && biz.reviewCount != null && biz.reviewCount > 0
      ? ` Rated ${biz.rating.toFixed(1)}★ across ${biz.reviewCount} reviews.`
      : "";
  return `${biz.name} — ${cat}${where}.${ratingPart} See the Mapsly Score, market position, and competitive context for ${biz.name}.`.slice(
    0,
    160,
  );
}
