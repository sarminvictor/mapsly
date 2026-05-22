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
/**
 * One slot in the local 3-pack visualisation per keyword. Always
 * exactly 3 slots per KeywordRow.
 *
 *   - `name` is the competitor's business name OR "You" OR an empty
 *     marker ("—"). The renderer styles by `kind`.
 *   - `kind` distinguishes Maria from competitors so the slot can
 *     highlight in coral.
 */
export type PackSlotKind = "you" | "competitor" | "empty";

export interface PackSlot {
  rank: 1 | 2 | 3;
  name: string;
  kind: PackSlotKind;
}

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
  /** Local-pack occupants — exactly 3 slots. When the SERP scan
   * captures < 3 named slots, the gaps fill with `kind: 'empty'`. */
  packSlots: PackSlot[];
  /** Estimated monthly patients Maria loses by not being in the
   * top 3 for this keyword. Heuristic: volume × CTR gap × conv. */
  estPatientsLost: number;
}

/**
 * One row in the "Top 3 quick wins" panel. Surfaces high-volume
 * keywords where Maria is close-but-not-quite — fringe rank in
 * either local pack (4-10) or organic search (4-20).
 */
export interface SearchQuickWin {
  /** Stable id (keyword id). */
  id: string;
  /** The keyword Maria can win. */
  keyword: string;
  /** Plain-English current-state line ("You're 4th in maps — one
   * spot away from the top 3"). */
  currentState: string;
  /** Imperative action sentence ("Add Sunday hours and 3 photos —
   * Google reads both as 'open spa' signals"). */
  action: string;
  /** Big impact value formatted ("+8 patients/mo"). */
  impact: string;
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

  /** Sum of estPatientsLost across all tracked keywords. The hero
   * KPI surfaces this so Maria sees the cost of staying invisible. */
  totalEstPatientsLost: number;

  /** Top-3 highest-impact wins, derived from the keyword list. */
  topQuickWins: SearchQuickWin[];
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
  totalEstPatientsLost: 0,
  topQuickWins: [],
};

/**
 * Per-keyword est-patients-lost heuristic.
 *   - In-pack CTR ≈ 30%, out-of-pack ≈ 5% (industry baseline for
 *     local Maps results)
 *   - Local conversion-rate ≈ 2% (visit → booking)
 *   - When Maria is already in the pack, lost = 0
 *
 * Pure. Used by both the query layer and the unit tests.
 */
export function estimatePatientsLost(input: {
  searchVolume: number | null;
  localPackRank: number | null;
}): number {
  if (!input.searchVolume || input.searchVolume <= 0) return 0;
  if (input.localPackRank != null && input.localPackRank <= 3) return 0;
  const CTR_GAP = 0.3 - 0.05;
  const CONVERSION = 0.02;
  return Math.round(input.searchVolume * CTR_GAP * CONVERSION);
}

/**
 * Pick the 3 highest-impact quick wins from a keyword list. A row
 * qualifies when:
 *   - searchVolume ≥ 50/mo (meaningful traffic), AND
 *   - Maria is fringe — local-pack rank 4-10 OR organic rank 4-20
 *     (i.e. close enough to break into top 3 with one fix)
 *
 * Sorted by estPatientsLost descending so the biggest opportunity
 * surfaces first. Returns at most 3.
 */
export function deriveSearchQuickWins(
  keywords: readonly KeywordRow[],
): SearchQuickWin[] {
  const candidates: Array<{ row: KeywordRow; impact: number }> = [];

  for (const row of keywords) {
    if (!row.searchVolume || row.searchVolume < 50) continue;
    const inPack = row.localPackRank != null && row.localPackRank <= 3;
    if (inPack) continue;
    const fringeLocal =
      row.localPackRank != null &&
      row.localPackRank > 3 &&
      row.localPackRank <= 10;
    const fringeOrganic =
      row.organicRank != null && row.organicRank > 3 && row.organicRank <= 20;
    if (!fringeLocal && !fringeOrganic) continue;
    candidates.push({ row, impact: row.estPatientsLost });
  }

  candidates.sort((a, b) => b.impact - a.impact);

  return candidates.slice(0, 3).map(({ row }) => {
    const inPackZone = row.localPackRank != null;
    const currentState = inPackZone
      ? `You're ${ordinal(row.localPackRank!)} in maps — ${row.localPackRank! - 3} spot${
          row.localPackRank! - 3 === 1 ? "" : "s"
        } away from the top 3.`
      : `You show up further down on Google for this — most people stop reading after the first 10 results.`;
    const action = inPackZone
      ? "Add Sunday hours, 3 new photos, and a Google post this week. All three are 'we're really open' signals."
      : "Ask 5 happy customers to mention this exact phrase in a review this week.";
    return {
      id: row.id,
      keyword: row.keyword,
      currentState,
      action,
      impact:
        row.estPatientsLost > 0 ? `+${row.estPatientsLost} patients/mo` : "—",
    };
  });
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/**
 * How many keyword rows to surface to Maria. Per
 * `.claude/rules/ui-ux-smb.md` "Below the fold for anything beyond 4
 * KPIs" — 25 keeps the table scannable on mobile without paging while
 * showing a meaningful subset of what's tracked.
 */
export const MAX_KEYWORDS = 25;
