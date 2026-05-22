/**
 * SMB activity feed · payload types.
 *
 * `SmbActivityData` is the flat shape the `/(smb)/activity` page
 * renders from. It bundles Maria's own business identity + a
 * chronological event stream pulled from Review, AdLibraryEntry, and
 * Business creates — both her own activity and that of her
 * same-category-+-same-city neighbours.
 *
 * `EMPTY_SMB_ACTIVITY` is the build-phase / no-biz / error short-
 * circuit shape per `.claude/rules/cache-components.md` Pattern 1.
 *
 * The feed is intentionally Maria-calm: events are plain-English
 * one-liners ("You got 3 new reviews this week", "Lux Med Spa
 * launched 4 new ads") sorted by `at` desc, capped at MAX_EVENTS.
 * No deep drill-down, no jargon — the page itself just renders the
 * list with source pills.
 */

export type SmbActivitySource =
  /** Review-related events (own + competitor). */
  | "reviews"
  /** Ad-related events (own + competitor). */
  | "ads"
  /** Search-rank / SERP-related events. */
  | "search"
  /** Market-level events: newcomers, big movers. */
  | "market";

export type SmbActivityScope = "you" | "competitor" | "market";

export interface SmbActivityEvent {
  /** Stable id (deterministic so React reconciliation is cheap). */
  id: string;
  /** Single-line body Maria reads. */
  body: string;
  /** When the underlying event happened — used to format
   * "2 hours ago" / "3 days ago" / "May 14" inside the renderer. */
  at: Date;
  /** Source pill — drives the chip palette. */
  source: SmbActivitySource;
  /** Who/what the event is about — drives the "You" highlight. */
  scope: SmbActivityScope;
}

export interface SmbActivityData {
  /** Owned business id, or `""` for empty / build-phase. */
  ownedBusinessId: string;
  /** Display name. */
  businessName: string;
  /** Time-ordered event stream. */
  events: SmbActivityEvent[];
  /** When the feed was assembled (mostly for the footer line). */
  generatedAt: Date | null;
}

export const EMPTY_SMB_ACTIVITY: SmbActivityData = {
  ownedBusinessId: "",
  businessName: "",
  events: [],
  generatedAt: null,
};

/** Max event rows the page surfaces. */
export const MAX_ACTIVITY_EVENTS = 50;

/** Lookback window — 30 days mirrors the rest of the SMB surfaces. */
export const ACTIVITY_LOOKBACK_DAYS = 30;
