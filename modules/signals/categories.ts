/**
 * Signal categories · D.1
 *
 * 8 canonical signal categories. Hunter UI groups filters by these in the
 * Filter Picker. Each category has metadata for the agency-portal UX.
 *
 * Keep stable. Adding a 9th category is a design decision (see
 * `.claude/rules/signal-engineering.md`).
 */

import type { SignalCategory } from "./types";

export interface CategoryDefinition {
  readonly key: SignalCategory;
  /** Tom-facing label (agency dense table). Sentence case. */
  readonly label: string;
  /** One-line plain-English description for the Filter Picker. */
  readonly description: string;
  /**
   * Approximate display order in the Filter Picker (lower = earlier).
   * Reviews + Search are the highest-leverage filters per agency UX research,
   * so they lead.
   */
  readonly sortOrder: number;
  /**
   * Hex color hint for the category chip in the agency portal palette.
   * (Cool-gray + indigo per `.claude/rules/ui-ux-agency.md`. These are
   * accents, not full backgrounds.)
   */
  readonly colorHint: string;
}

export const CATEGORIES: Record<SignalCategory, CategoryDefinition> = {
  reviews: {
    key: "reviews",
    label: "Reviews & reputation",
    description:
      "Rating, review velocity, reply rate, and AI-classified sentiment from the last 20 reviews.",
    sortOrder: 10,
    colorHint: "#5b3df5", // indigo · agency primary
  },
  search: {
    key: "search",
    label: "Search & local SEO",
    description:
      "Local-pack rank, organic rank, share of voice across the target keyword set.",
    sortOrder: 20,
    colorHint: "#3b6ec4", // info-blue
  },
  website: {
    key: "website",
    label: "Website & tech",
    description:
      "Lighthouse scores, Core Web Vitals, schema markup, NAP consistency, booking CTA.",
    sortOrder: 30,
    colorHint: "#2d8659", // success-green (good site = healthy)
  },
  ads: {
    key: "ads",
    label: "Ads & paid",
    description:
      "Active Meta + Google ads, ad themes, brand-hijack detection, estimated spend.",
    sortOrder: 40,
    colorHint: "#d4a574", // gold
  },
  profile: {
    key: "profile",
    label: "Profile completeness",
    description:
      "Google Business Profile fields: phone, website, hours, photos, attributes, claimed status.",
    sortOrder: 50,
    colorHint: "#6b4f9b", // purple
  },
  competitive: {
    key: "competitive",
    label: "Competitive & geo",
    description:
      "Market position (MSI), competitor proximity, new entrants, rating gap to leader.",
    sortOrder: 60,
    colorHint: "#b53d47", // berry
  },
  qualifiers: {
    key: "qualifiers",
    label: "Business qualifiers",
    description:
      "Category, metro, revenue band proxies, Mapsly Score, claimed/unclaimed.",
    sortOrder: 70,
    colorHint: "#5c544d", // text-2 (neutral)
  },
  exclusions: {
    key: "exclusions",
    label: "Exclusions",
    description:
      "Skip filters: already on a list, already contacted, existing client, recently won-back.",
    sortOrder: 80,
    colorHint: "#9a9088", // text-3 (muted)
  },
};

/** Convenience: categories in canonical display order. */
export const CATEGORIES_ORDERED: readonly CategoryDefinition[] = Object.values(
  CATEGORIES,
).sort((a, b) => a.sortOrder - b.sortOrder);
