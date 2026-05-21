/**
 * SMB competitors · payload type definitions.
 *
 * `SmbCompetitorsData` is the flat shape the `/(smb)/competitors` page
 * renders from. It bundles Maria's own business identity + her position
 * in the local market + the top N competitors in the same category and
 * city for a side-by-side comparison.
 *
 * `EMPTY_SMB_COMPETITORS` is the build-phase / no-biz / error short-
 * circuit shape per `.claude/rules/cache-components.md` Pattern 1. It
 * MUST have every field of the interface (including nullables) so
 * TypeScript catches partial shapes at literal-comparison time on
 * Vercel build.
 *
 * Callers identify the empty-business state by
 * `data.ownedBusinessId === ""` and render the onboarding empty state
 * (same convention as `modules/smb-dashboard`, `modules/smb-reviews`).
 *
 * The neighbour set is limited to a small N (default 8) — Maria's
 * audience principles in `.claude/rules/ui-ux-smb.md` cap above-the-
 * fold density and this is a Maria-facing list, not Tom's dense table.
 */

/**
 * Single competitor row in the comparison list. The user's own business
 * is included here too (`isOwn: true`) so the page can render Maria
 * inline with everyone else and visually highlight her row.
 *
 * Numeric fields are nullable to reflect "no snapshot yet" — the row
 * still renders, just with em-dashes for the missing values, matching
 * the dashboard's KPI treatment.
 */
export interface CompetitorRow {
  /** Stable identifier. Maria's business uses her real Business.id;
   * everyone else uses theirs. The page uses this as the React key. */
  id: string;
  /** Display name. */
  name: string;
  /** Whether this row represents the signed-in user's own business. */
  isOwn: boolean;
  /** Google rating 0–5, nullable until first snapshot. */
  rating: number | null;
  /** Total Google reviews, nullable until first snapshot. */
  reviewCount: number | null;
  /** Composite Mapsly Score 0–10, nullable until first snapshot. */
  mapslyScore: number | null;
  /** New reviews in the last 30 days, nullable until first snapshot. */
  velocityLast30d: number | null;
}

/**
 * Top-level page payload. The page renders empty-state when
 * `ownedBusinessId === ""`, no-competitors-found when
 * `competitors.length === 0`, and the comparison list otherwise.
 *
 * `marketRank` / `marketTotal` come from the user's latest
 * BusinessSnapshot — they're the same numbers the dashboard's "Market
 * rank" KPI uses, kept here so the competitors page can headline them.
 */
export interface SmbCompetitorsData {
  /** Owned business id, or `""` for empty / build-phase. */
  ownedBusinessId: string;
  /** Owned business display name. */
  name: string;
  /** Owned business category (also the comparison axis). */
  category: string;
  /** Owned business city (also the comparison axis), nullable for
   * businesses with no geo data yet. */
  city: string | null;
  /** Owned business state/province. */
  province: string | null;

  /** Maria's own Mapsly Score 0–10, nullable until first snapshot. */
  ownMapslyScore: number | null;
  /** Maria's market rank (1 = top in category+city), nullable. */
  marketRank: number | null;
  /** Total businesses in the same category+city slice. */
  marketTotal: number | null;

  /** Top competitors in the same category + city, ranked by
   * Mapsly Score (descending). Includes Maria's own row at the
   * appropriate position so the page can render a unified list. */
  competitors: CompetitorRow[];

  /** When the underlying snapshot batch last ran, used for the
   * "Refreshed X ago" footer. Nullable for new businesses. */
  lastSnapshotAt: Date | null;
}

/**
 * The canonical empty shape. Returned by `getSmbCompetitorsData` for:
 *
 *   - the user has no claimed business yet (post-signup / onboarding)
 *   - we're in Vercel's build phase (NEXT_PHASE === 'phase-production-build')
 *   - Prisma threw an error
 *
 * Every field must be present (per `.claude/rules/cache-components.md`
 * Pattern 1) so TypeScript fails at compile time if the shape drifts
 * from `SmbCompetitorsData`.
 */
export const EMPTY_SMB_COMPETITORS: SmbCompetitorsData = {
  ownedBusinessId: "",
  name: "",
  category: "",
  city: null,
  province: null,
  ownMapslyScore: null,
  marketRank: null,
  marketTotal: null,
  competitors: [],
  lastSnapshotAt: null,
};

/**
 * How many competitor rows to fetch (excluding the user's own row).
 * Per `.claude/rules/ui-ux-smb.md` "Below the fold for anything
 * beyond 4 KPIs" — 8 keeps the comparison scannable on mobile without
 * paging.
 */
export const MAX_COMPETITORS = 8;
