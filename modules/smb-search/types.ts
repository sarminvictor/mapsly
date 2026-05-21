/**
 * SMB search visibility · payload type definitions.
 *
 * `SmbSearchData` is the flat shape the `/(smb)/search` page renders
 * from. It bundles Maria's own business identity + a list of tracked
 * keyword rows showing where she shows up in Google Maps and organic
 * search, plus a small set of plain-English hero KPIs (best local-pack
 * rank, keywords tracked, keywords in the local pack, keywords improved
 * this week).
 *
 * `EMPTY_SMB_SEARCH` is the build-phase / no-biz / error short-circuit
 * shape per `.claude/rules/cache-components.md` Pattern 1. It MUST
 * declare every field of the interface (including nullables) so
 * TypeScript catches partial shapes at literal-comparison time on
 * Vercel build (see INC-25 + INC-27).
 *
 * Callers identify the empty-business state by
 * `data.ownedBusinessId === ""` and render the onboarding empty state
 * (same convention as `modules/smb-dashboard`, `modules/smb-reviews`,
 * `modules/smb-competitors`).
 *
 * Per `.claude/rules/copy-voice.md`, Maria-facing copy NEVER says
 * "3-pack", "SERP", "MSI". These types use neutral field names
 * (`localPackRank`, `organicRank`) and the page-level i18n strings do
 * the plain-English translation ("Top 3 in maps", "Top 10 in search").
 */

/**
 * Single tracked-keyword row. Each row corresponds to one keyword the
 * business is tracked against (e.g. "med spa miami"). Numeric fields
 * are nullable — null means "no scan yet" or "didn't appear" depending
 * on the field, see field-level docs.
 */
export interface KeywordRow {
  /** Stable identifier — the Keyword.id. */
  id: string;
  /** The keyword as searched (e.g. "med spa brickell"). */
  keyword: string;
  /** Estimated monthly searches in the keyword's location.
   * Nullable until DataForSEO returns volume (monthly cron). */
  searchVolume: number | null;
  /** Latest local-pack rank (1-3, or null if not in the local pack). */
  localPackRank: number | null;
  /** Latest organic rank (1-100 typical, or null if not ranked). */
  organicRank: number | null;
  /** Previous-week local-pack rank, for delta. Nullable when there's
   * no prior scan yet (first week of tracking). */
  prevLocalPackRank: number | null;
  /** Previous-week organic rank, for delta. */
  prevOrganicRank: number | null;
  /** When the latest scan ran — used to flag stale rows. */
  scannedAt: Date | null;
}

/**
 * Top-level page payload. The page renders empty-state when
 * `ownedBusinessId === ""`, no-keywords-tracked when `keywords.length
 * === 0`, and the full visibility list otherwise.
 *
 * Hero KPIs are computed in the query helper from the keywords list so
 * the page doesn't have to re-derive them — Maria's audience principles
 * (`.claude/rules/ui-ux-smb.md`) want big single numbers, not formulas.
 */
export interface SmbSearchData {
  /** Owned business id, or `""` for empty / build-phase. */
  ownedBusinessId: string;
  /** Owned business display name. */
  name: string;
  /** Owned business city (used in copy and the hero headline). */
  city: string | null;

  /** Best (lowest) local-pack rank across all tracked keywords.
   * `null` when Maria appears in zero local packs. */
  bestLocalPackRank: number | null;
  /** Total keywords currently being tracked for this business. */
  keywordsTracked: number;
  /** How many tracked keywords show Maria in the local pack
   * (localPackRank between 1 and 3 inclusive). */
  keywordsInLocalPack: number;
  /** How many keywords improved this week vs last week — improvement
   * is defined as a smaller rank number (closer to #1) in EITHER the
   * local pack or organic. Rows with no prior scan are not counted
   * (we can't compute a delta yet). */
  keywordsImprovedThisWeek: number;

  /** The actual keyword rows the page renders in the table.
   * Sorted: in-local-pack first (best rank first), then organic-only,
   * then untracked appearances last. */
  keywords: KeywordRow[];

  /** When the underlying SERP batch last ran, used for the
   * "Refreshed weekly" footer. Nullable for new businesses. */
  lastScanAt: Date | null;
}

/**
 * The canonical empty shape. Returned by `getSmbSearchData` for:
 *
 *   - the user has no claimed business yet (post-signup / onboarding)
 *   - we're in Vercel's build phase (NEXT_PHASE === 'phase-production-build')
 *   - Prisma threw an error
 *
 * Every field must be present (per `.claude/rules/cache-components.md`
 * Pattern 1) so TypeScript fails at compile time if the shape drifts
 * from `SmbSearchData`. The page handler reads
 * `data.ownedBusinessId === ""` as the empty signal.
 */
export const EMPTY_SMB_SEARCH: SmbSearchData = {
  ownedBusinessId: "",
  name: "",
  city: null,
  bestLocalPackRank: null,
  keywordsTracked: 0,
  keywordsInLocalPack: 0,
  keywordsImprovedThisWeek: 0,
  keywords: [],
  lastScanAt: null,
};

/**
 * How many keyword rows to surface to Maria. Per
 * `.claude/rules/ui-ux-smb.md` "Below the fold for anything beyond 4
 * KPIs" — 25 keeps the table scannable on mobile without paging while
 * showing a meaningful subset of what's tracked.
 */
export const MAX_KEYWORDS = 25;
