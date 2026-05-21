/**
 * Agency lists page · payload type definitions.
 *
 * `AgencyListsData` is the flat shape the `/(agency)/lists` page renders
 * from. Each `AgencyListSummary` denormalises one `List` row + a small
 * set of cheap aggregates (qualified count, this-week delta, engaged
 * count) so the page doesn't have to drill through `leads[]` to render
 * the per-card stats.
 *
 * `EMPTY_AGENCY_LISTS` is the build-phase / no-agency / error
 * short-circuit shape per `.claude/rules/cache-components.md` Pattern 1.
 * Every field of `AgencyListsData` MUST be present so TypeScript catches
 * partial shapes at literal-comparison time on Vercel build.
 *
 * Callers identify the no-membership case by `data.agencyId === ""`.
 * The page redirects those users to `/dashboard` (SMB) so a stray SMB
 * user landing on `/lists` doesn't see a blank shell.
 *
 * Per `.claude/rules/conventions.md` we keep the enum literal unions
 * local instead of pulling Prisma types in — the F.0 component library
 * uses the same pattern for `LeadStatusValue`.
 */

/** Mirror of Prisma `ListServiceType` enum · keep these in lock-step. */
export type ListServiceTypeValue =
  | "WEBSITE_REBUILD"
  | "META_ADS_CAMPAIGN"
  | "GOOGLE_ADS_LAUNCH"
  | "LOCAL_SEO"
  | "REVIEW_MANAGEMENT"
  | "BRAND_DEFENSE"
  | "NEW_BUSINESS_LAUNCH"
  | "FULL_AUDIT"
  | "CUSTOM";

/** Mirror of Prisma `ListCadence` enum. */
export type ListCadenceValue = "DAILY" | "WEEKLY" | "MANUAL";

/** Mirror of Prisma `LeadStatus` enum · keep these in lock-step. */
export type LeadStatusValue =
  | "NEW"
  | "CONTACTED"
  | "REPLIED"
  | "WON"
  | "LOST"
  | "HIDDEN";

export interface AgencyListSummary {
  id: string;
  name: string;
  serviceType: ListServiceTypeValue;
  /** Optional sales pitch displayed under the list name. */
  pitch: string | null;
  refreshCadence: ListCadenceValue;
  /** False when the agency has paused the list. */
  isActive: boolean;
  /** When the list was last paused; null when active. */
  pausedAt: Date | null;
  /** Last cron-driven list-refresh write; null if never refreshed. */
  lastRefreshedAt: Date | null;
  /** Target market shorthand. */
  category: string | null;
  metro: string | null;
  radiusMi: number | null;

  /** Lead totals (cheap denormalised aggregates). */
  qualifiedCount: number;
  /** Leads created in the last 7 days · drives the "X new" pill. */
  newThisWeekCount: number;
  /** Leads in CONTACTED/REPLIED/WON status · drives "X engaged". */
  engagedCount: number;

  createdAt: Date;
}

export interface AgencyListsData {
  /** Agency the signed-in user belongs to · `""` for build/empty. */
  agencyId: string;
  agencyName: string;
  /** Active lists, sorted by `lastRefreshedAt DESC NULLS FIRST`. */
  active: AgencyListSummary[];
  /** Paused lists, sorted by `pausedAt DESC`. */
  paused: AgencyListSummary[];
  /** Sum of `newThisWeekCount` across active lists · "today/this week strip". */
  totalNewThisWeek: number;
}

/**
 * The canonical empty shape. Returned by `getAgencyListsData` for:
 *
 *   - the user has no AgencyMember row (SMB-only user landed here)
 *   - we're in Vercel's build phase (NEXT_PHASE === 'phase-production-build')
 *   - Prisma threw an error
 *
 * Per `.claude/rules/cache-components.md` Pattern 1 — every field present
 * to keep the literal-shape compatible with the interface during build.
 */
export const EMPTY_AGENCY_LISTS: AgencyListsData = {
  agencyId: "",
  agencyName: "",
  active: [],
  paused: [],
  totalNewThisWeek: 0,
};
