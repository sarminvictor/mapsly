/**
 * Agency list-activity page · payload type definitions.
 *
 * Surface: `/(agency)/list-activity`. Tom drops in here to scan
 * "what happened across my lists in the last 14 days?" — status
 * changes, new lead arrivals, refresh completions. A 1-screen
 * activity feed grouped by day.
 *
 * Per `.claude/rules/cache-components.md` Pattern 1 + INC-25, the
 * `EMPTY_AGENCY_ACTIVITY` shape is the FULL shape of the interface
 * so the build-phase short-circuit and the catch-block return value
 * type-check at literal-comparison time on Vercel build.
 *
 * Per `.claude/rules/conventions.md` we keep enum literal unions
 * local rather than depending on Prisma type imports — matches the
 * F.1 / F.3 / F.5 pattern.
 */

/** Mirror of Prisma `LeadStatus` enum · keep in lock-step. */
export type LeadStatusValue =
  | "NEW"
  | "CONTACTED"
  | "REPLIED"
  | "WON"
  | "LOST"
  | "HIDDEN";

/**
 * The kind of activity event we surface. Status-transition events
 * dominate the v1 feed; "new lead" events round out the picture so
 * Tom sees cron-driven arrivals alongside team-driven status moves.
 *
 * Each event corresponds to a single Lead row + a single timestamp
 * column on that row (Lead.contactedAt / repliedAt / wonAt / lostAt
 * / createdAt). The event ID is composed of the leadId + the event
 * kind so React keys stay stable across refreshes.
 */
export type ActivityEventKind =
  | "lead_new"
  | "lead_contacted"
  | "lead_replied"
  | "lead_won"
  | "lead_lost";

/**
 * One feed row. The page groups items by day; this shape is
 * day-agnostic and renders linearly in the component. Sort order is
 * `at DESC` (most recent first) — caller-supplied.
 */
export interface ActivityItem {
  /** Stable React key · `${leadId}-${kind}`. */
  id: string;
  /** ISO timestamp when the event occurred. */
  at: string;
  /** What happened. Drives the icon + verb in the row copy. */
  kind: ActivityEventKind;
  /** The Lead row's current status — drives the trailing status pill. */
  currentStatus: LeadStatusValue;
  /** Business name + locale-aware deep-link target. */
  businessId: string;
  businessName: string;
  /** Optional short locality blurb · "Brickell, FL". */
  businessLocale: string | null;
  /** List the event belongs to · drives the secondary `→ list` link. */
  listId: string;
  listName: string;
}

/**
 * The flat shape `/(agency)/list-activity` renders from. `items` is
 * pre-sorted by `at DESC` so the page just iterates. `lastListRefresh`
 * surfaces the most recent cron-driven list refresh so Tom knows the
 * data isn't stale.
 */
export interface AgencyActivityData {
  /** Agency the signed-in user belongs to · `""` for build/empty/no-membership. */
  agencyId: string;
  agencyName: string;
  /** Feed entries · sorted DESC by `at` · capped at `MAX_FEED_ITEMS` (50). */
  items: ActivityItem[];
  /** Total events the query had access to (matches `items.length` when ≤ cap). */
  totalEvents: number;
  /** ISO timestamp of the most recent list refresh; null when no refresh has run. */
  lastListRefresh: string | null;
}

/**
 * Canonical empty / short-circuit shape per cache-components Pattern 1.
 * Returned for the build phase, no-membership, and Prisma-error cases.
 * Callers identify the no-membership case via `data.agencyId === ""`.
 */
export const EMPTY_AGENCY_ACTIVITY: AgencyActivityData = {
  agencyId: "",
  agencyName: "",
  items: [],
  totalEvents: 0,
  lastListRefresh: null,
};
