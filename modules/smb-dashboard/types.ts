/**
 * SMB dashboard · payload type definitions.
 *
 * `SmbDashboardData` is the flat shape the dashboard page renders from.
 * It denormalises one `Business` + its latest `BusinessSnapshot` into a
 * single object so the page doesn't have to drill through `snapshots[0]`
 * everywhere.
 *
 * `EMPTY_SMB_DASHBOARD` is the build-phase / no-biz / error short-circuit
 * shape per `.claude/rules/cache-components.md` Pattern 1. It MUST have
 * every field of the interface (including nullables) so TypeScript catches
 * partial shapes at literal-comparison time on Vercel build.
 *
 * Callers identify the empty state by `data.ownedBusinessId === ""`.
 */

/**
 * One row in the "what needs your attention today" feed. Derived
 * from latest snapshot, recent reviews, brand-hijack scan, etc.
 * Always plain English; never raw metric jargon. The dashboard
 * shows the top `MAX_ALERTS` (4) in priority order.
 */
export interface SmbDashboardAlert {
  /** Stable id (deterministic from kind + key business field) so
   * React reconciliation is stable across refreshes. */
  id: string;
  /** Severity drives AlertCard tone — "bad" = coral/red,
   * "warn" = gold, "info" = blue, "good" = green. */
  tone: "bad" | "warn" | "info" | "good";
  /** Priority — 1 surfaces first. Lower priorities fall off
   * the bottom of the 4-card cap. */
  priority: number;
  /** The body line Maria reads. */
  body: string;
  /** Optional source / impact meta line (mono, smaller). */
  meta?: string;
}

/**
 * One "highest-impact fix" row in the numbered list. Always 3.
 * Computed from the same signals as the alerts but framed as an
 * action ("Reply to 8 unanswered reviews") with a quantified
 * impact value ("+0.7 Mapsly Score").
 */
export interface SmbDashboardFix {
  /** 1, 2, 3 (rank in priority order). */
  rank: 1 | 2 | 3;
  /** Imperative action sentence Maria can act on. */
  action: string;
  /** Optional meta line under the action — typically the signal
   * trigger ("8 reviews unanswered · benchmark 89%"). */
  meta?: string;
  /** Big impact value — e.g. "+0.7", "+5 patients/mo". */
  impact: string;
  /** Smaller line under the impact value. */
  impactSub: string;
  /** FixCard tone — good (green), warn (gold), neutral (text). */
  tone: "good" | "warn" | "neutral";
}

/**
 * One row in "This week in your market" — a competitor activity
 * event from the last 7 days. The dashboard surfaces up to 5.
 */
export interface SmbMarketEvent {
  /** Stable id. */
  id: string;
  /** Plain-English description ("Lux Med Spa launched 4 new ads"). */
  body: string;
  /** When it happened — `lastSeenAt` for ads, `snapshotDate` for
   * BusinessSnapshot deltas, etc. Used for the relative timestamp. */
  at: Date;
  /** Source pill — "Reviews" / "Ads" / "Search" / "Market". Maps
   * to the dashboard's source-chip palette. */
  source: "reviews" | "ads" | "search" | "market";
}

export interface SmbDashboardData {
  /** Owned business id, or `""` for empty / build-phase. */
  ownedBusinessId: string;
  slug: string;
  name: string;
  category: string;
  city: string | null;
  province: string | null;

  /** Current Google rating (0–5), nullable until the first snapshot. */
  rating: number | null;
  /** Total Google review count, nullable until first snapshot. */
  reviewCount: number | null;
  isClaimed: boolean;

  /** Composite Mapsly Score 0–10, nullable until first snapshot. */
  mapslyScore: number | null;
  msiRank: number | null;
  msiTotal: number | null;
  replyRate: number | null;
  velocityLast30d: number | null;

  /** Per-dimension sub-scores (0–1), nullable until first snapshot. */
  reputationScore: number | null;
  communicationScore: number | null;
  profileCompletenessScore: number | null;
  trustScore: number | null;
  pricingTransparencyScore: number | null;
  brandPresenceScore: number | null;

  /** When the latest snapshot was written, nullable for new businesses. */
  lastSnapshotAt: Date | null;

  /** Count of reviews with no owner reply — drives the unanswered
   * KPI tile and seeds the top-priority alert + fix. Nullable when
   * we have no Review rows yet. */
  unansweredReviewCount: number | null;
  /** Reviews collected in the last 30 days. Used for the velocity
   * KPI tile and the rating-change alert. */
  reviewsLast30d: number | null;
  /** "Brand hijack" status — was a competitor running ads on
   * Maria's brand keywords this week? Drives the brand-hijack KPI
   * pill (Clean / Watch / Hit). */
  brandHijackStatus: "clean" | "watch" | "hit";

  /** Top-N alerts in priority order, capped at MAX_ALERTS. */
  alerts: SmbDashboardAlert[];
  /** Exactly 3 highest-impact fixes (or fewer if Maria's data is
   * incomplete). Always rank 1..3. */
  topFixes: SmbDashboardFix[];
  /** Up to MAX_MARKET_EVENTS rows from the last 7 days. */
  marketActivity: SmbMarketEvent[];
}

export const MAX_ALERTS = 4;
export const MAX_MARKET_EVENTS = 5;

/**
 * The canonical empty shape. Returned by `getSmbDashboardData` for:
 *
 *   - the user has no claimed business yet
 *   - we're in Vercel's build phase (NEXT_PHASE === 'phase-production-build')
 *   - Prisma threw an error
 *
 * Every field must be present (per `.claude/rules/cache-components.md`
 * Pattern 1) so TypeScript fails at compile time if the shape drifts from
 * `SmbDashboardData`.
 */
export const EMPTY_SMB_DASHBOARD: SmbDashboardData = {
  ownedBusinessId: "",
  slug: "",
  name: "",
  category: "",
  city: null,
  province: null,
  rating: null,
  reviewCount: null,
  isClaimed: false,
  mapslyScore: null,
  msiRank: null,
  msiTotal: null,
  replyRate: null,
  velocityLast30d: null,
  reputationScore: null,
  communicationScore: null,
  profileCompletenessScore: null,
  trustScore: null,
  pricingTransparencyScore: null,
  brandPresenceScore: null,
  lastSnapshotAt: null,
  unansweredReviewCount: null,
  reviewsLast30d: null,
  brandHijackStatus: "clean",
  alerts: [],
  topFixes: [],
  marketActivity: [],
};
