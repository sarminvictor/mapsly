/**
 * Agency list-analytics page · payload type definitions (F.5).
 *
 * `ListAnalyticsData` is the flat shape the `/(agency)/list-analytics`
 * page renders from. The query layer aggregates ACROSS all of an
 * agency's lists — Tom uses this surface to see which lists are
 * converting and which are stalling.
 *
 * Per `.claude/rules/cache-components.md` Pattern 1 the EMPTY shape is
 * the FULL shape of the interface so the build-phase short-circuit and
 * the catch-block return values type-check at literal-comparison time
 * (INC-25). Every nullable / list field is present.
 *
 * Per `.claude/rules/conventions.md` we keep enum literal unions local
 * rather than depending on Prisma type imports — matches the F.3 / F.4
 * pattern in `agency-portal/lists/types.ts`.
 */

/** Mirror of Prisma `LeadStatus` enum. */
export type LeadStatusValue =
  | "NEW"
  | "CONTACTED"
  | "REPLIED"
  | "WON"
  | "LOST"
  | "HIDDEN";

/**
 * Top-of-page 4-stat header. All rates are 0..1 floats (the component
 * formats to "12%" with locale-aware percentage formatting).
 *
 *   - `surfaced90d` · COUNT(Lead) where listId IN agency lists AND
 *     createdAt > now-90d. Drives "X leads surfaced in 90 days".
 *   - `contactRate` · (CONTACTED+REPLIED+WON+LOST) / total leads in the
 *     90-day window. How aggressively Tom's team is working the queue.
 *   - `replyRate` · (REPLIED+WON+LOST) / (CONTACTED+REPLIED+WON+LOST).
 *     Of the leads we touched, how many talked back.
 *   - `closedWon` · WON / (CONTACTED+REPLIED+WON+LOST). Conversion of
 *     engaged leads.
 *
 * All rates fall back to 0 when the denominator is 0 — never NaN, never
 * "—" through the wire.
 */
export interface ListAnalyticsStats {
  surfaced90d: number;
  contactRate: number;
  replyRate: number;
  closedWon: number;
}

/**
 * Per-list funnel row · one row in the analytics table.
 *
 * `totals` is the full status breakdown (HIDDEN excluded — Tom hides
 * out-of-scope leads so we don't count them as part of the funnel
 * denominator). The mini-funnel SVG is computed client-side from these
 * five numbers.
 */
export interface ListFunnelRow {
  listId: string;
  listName: string;
  /** True when the list is still being refreshed (drives a "paused" hint). */
  isActive: boolean;
  totals: {
    new: number;
    contacted: number;
    replied: number;
    won: number;
    lost: number;
  };
  /** Sum of the 5 totals · used as the funnel denominator. */
  totalLeads: number;
}

/**
 * Signal correlation row · "which signals predict reply".
 *
 * STUB FOR F.5 · the heavy compute (per-signal odds-ratio against the
 * REPLIED outcome) is a follow-up task in the D.x signal-engineering
 * group. We ship the shape + an empty array so the component contract
 * is stable; the panel renders a "coming soon" empty state until the
 * D.x task lands. Once that task ships, the query layer will populate
 * `correlations` with real numbers and the panel will render a sorted
 * bar list.
 */
export interface SignalCorrelation {
  /** Signal registry key (see `modules/signals/registry.ts`). */
  signalKey: string;
  /** Plain-English label for display. */
  label: string;
  /** Lift on reply rate · 1.0 = no effect, >1 = positive, <1 = negative. */
  lift: number;
  /** Sample size · drives confidence / visual weight. */
  sampleSize: number;
}

export interface ListAnalyticsData {
  /** Agency the signed-in user belongs to · `""` for build/empty/no-membership. */
  agencyId: string;
  agencyName: string;
  /** 4-stat hero row · rolled up across the 90-day window. */
  stats: ListAnalyticsStats;
  /** Per-list funnel rows · sorted by `totalLeads DESC`. */
  lists: ListFunnelRow[];
  /** Signal correlations · stub at F.5; populated in D.x. */
  signalCorrelations: SignalCorrelation[];
}

/**
 * The canonical empty shape. Returned by `getListAnalyticsForAgency`
 * for:
 *
 *   - the user has no AgencyMember row (SMB-only user landed here)
 *   - we're in Vercel's build phase (NEXT_PHASE === 'phase-production-build')
 *     · INC-27
 *   - Prisma threw an error
 *
 * Per `.claude/rules/cache-components.md` Pattern 1 + INC-25 — every
 * field of `ListAnalyticsData` must be present so TypeScript catches
 * partial shapes at literal-comparison time on Vercel build.
 *
 * Callers identify the no-membership case by `data.agencyId === ""`.
 */
export const EMPTY_LIST_ANALYTICS: ListAnalyticsData = {
  agencyId: "",
  agencyName: "",
  stats: {
    surfaced90d: 0,
    contactRate: 0,
    replyRate: 0,
    closedWon: 0,
  },
  lists: [],
  signalCorrelations: [],
};
