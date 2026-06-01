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
 * (same convention as `modules/smb-home`, `modules/smb-reviews`,
 * `modules/smb-how-you-compare`).
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
  /** Estimated monthly visits Maria likely gets from this keyword at
   *  her current rank · DfS `etv` (source of truth) with a CTR-curve
   *  fallback for pre-v0.12.11 rows. */
  estVisits: number;
  /** True when the keyword came from a service-detected template
   *  (e.g. "belkyra calgary" because hasBelkyra) · drives the "your
   *  service" badge in the table per Boxly's pattern. False for core
   *  templates and legacy ranked rows. */
  isServiceKeyword: boolean;
  /** True when the keyword has any template origin (core or service)
   *  set · these are the keywords cell-aggregate-maps actually
   *  scans on Maps. Drives the "Top 3 in Maps · X of Y scanned"
   *  denominator on the State Bar (S.6.3). */
  isTemplated: boolean;
}

/**
 * One row in the "Quick wins" right rail. S.6.5 (2026-05-28) ·
 * carries i18n-resolvable keys + params rather than baked English
 * strings so we can localize and so the persistence layer
 * (QuickWinAssignment) can serialize a stable representation.
 */
export type QuickWinSurface = "maps" | "search";

export type QuickWinStateKey = "maps_fringe" | "search_fringe";

export type QuickWinActionKey = "maps_signals" | "review_request";

export interface SearchQuickWin {
  /** Stable id (keyword id). */
  id: string;
  /** The keyword Maria can win. */
  keyword: string;
  /** Which surface this opportunity targets · drives the chip on
   *  the card ("Google Maps" vs "Google Search"). */
  surface: QuickWinSurface;
  /** i18n key bucket for the "where you are now" sentence · the
   *  page resolves via t(`quick_win_state_${stateKey}`, params). */
  stateKey: QuickWinStateKey;
  stateParams: Record<string, string | number>;
  /** i18n key bucket for the action recommendation · resolved as
   *  t(`quick_win_action_${actionKey}`). */
  actionKey: QuickWinActionKey;
  /** Estimated additional customers/mo if she reaches top 3 for
   *  this keyword. Page formats with i18n plural. */
  estCustomersPerMo: number;
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
  /** Owned business country code (CA / US / …) · S.6.2 added so the
   *  cell-keyword-table query can resolve the DfS location_code. */
  country: string | null;
  /** Owned business category as stored in the DB ("Medical spa" /
   *  "Restaurant" / …). Drives the "How customers search for X in Y"
   *  table heading. */
  category: string | null;

  /** Best (lowest) local-pack rank across all tracked keywords.
   * `null` when Maria appears in zero local packs. Retained for any
   * downstream tooling that still wants the single-rank view; the
   * S.6.2 State Bar uses the count-based topThreeMapsCount instead. */
  bestLocalPackRank: number | null;
  /** Total keywords currently being tracked for this business. */
  keywordsTracked: number;
  /** How many tracked keywords show Maria in the local pack
   * (localPackRank between 1 and 3 inclusive). */
  keywordsInLocalPack: number;
  /** Count of tracked keywords where Maria's organic rank ≤ 3.
   * Powers the "Top 3 in Search" State Bar cell (S.6.2). */
  topThreeSearchCount: number;
  /** Count of tracked keywords where Maria's Maps rank ≤ 3.
   * Powers the "Top 3 in Maps" State Bar cell (S.6.2). */
  topThreeMapsCount: number;
  /** Count of keywords we ACTUALLY ran a Maps SERP query for ·
   * smaller than keywordsTracked because Maps is cell-aggregated
   * over the local-intent template set only (cost saver). Drives
   * the "of N tracked" sublabel on the Top-3-in-Maps cell so the
   * denominator is honest (S.6.3 fix · 2026-05-28). */
  mapsScannedCount: number;
  /** How many keywords improved this week vs last week — improvement
   * is defined as a smaller rank number (closer to #1) in EITHER the
   * local pack or organic. Rows with no prior scan are not counted
   * (we can't compute a delta yet). */
  keywordsImprovedThisWeek: number;

  /** The actual keyword rows the page renders in the table.
   * Sorted: in-local-pack first (best rank first), then organic-only,
   * then untracked appearances last. */
  keywords: KeywordRow[];

  /** Top 5 keywords by raw monthly search volume · Maria's "where the
   *  demand is" lens. Each row carries packSlots so the UI can show
   *  the top-3 businesses in Maps next to her own position. */
  topByVolume: KeywordRow[];
  /** Full list of every tracked keyword (up to MAX_KEYWORDS_PER_BUSINESS
   *  = 200) · powers the autosuggest finder and the expandable "show all"
   *  disclosure below the top-5 block. */
  allTrackedKeywords: KeywordRow[];

  /** When the underlying SERP batch last ran, used for the
   * "Refreshed weekly" footer. Nullable for new businesses. */
  lastScanAt: Date | null;

  /** Sum of estPatientsLost across all tracked keywords. The hero
   * KPI surfaces this so Maria sees the cost of staying invisible. */
  totalEstPatientsLost: number;

  /** Top-3 highest-impact wins, derived from the keyword list. */
  topQuickWins: SearchQuickWin[];

  /** Keywords where competitors in Maria's cell rank but she doesn't.
   * Derived from cell-aggregate BusinessKeyword data · zero extra API
   * calls. Top 5 by estimated competitor traffic value. Empty array
   * when Maria's cell has no other businesses with ranked_keywords
   * data yet (e.g., first business in a new cell). */
  searchGaps: SearchGap[];

  /** Σ search_volume across Maria's tracked keywords · the demand-side
   *  headline · "how many people search your services every month." */
  totalSearchVolume: number;
  /** Σ (volume × ctr-for-current-rank) across Maria's tracked keywords ·
   *  "how many likely land on you." Gap vs totalSearchVolume = upside. */
  totalEstimatedVisits: number;
  /** Σ DfS `estimated_paid_traffic_cost` across Maria's tracked keywords ·
   *  "what you'd pay for these visits through Google Ads at the same
   *  ranks." Free-traffic value framing per the SMB voice (see
   *  copy-voice.md · "Traffic value" stays Maria-readable as "what Google
   *  Ads would cost"). DfS-truth when populated; falls back to
   *  (sv × cpc × ctr) per discover-local-intent. */
  totalEstTrafficUsd: number;

  /** Top 3 / Top 10 / 11+ rank-bucket breakdown across Maria's tracked
   *  keywords · we pick the BEST of (Maps rank, organic rank) per
   *  keyword so the bucket reflects "did Google show me anywhere?" not
   *  the surface. */
  rankBuckets: RankBucket[];

  /** Top 10 businesses in Maria's (city, country) cell by total est
   *  traffic. Maria's row marked `kind: "you"` for UI highlighting.
   *  When Maria is outside the top 10, she's appended as a 11th row
   *  so she always sees her position. */
  competitorLeaderboard: CompetitorRow[];
  /** Maria's 1-indexed position in the full cell ranking. null when
   *  no cell-mates have search data yet. */
  competitorLeaderboardOwnRank: number | null;
  /** Total businesses in the cell with BusinessKeyword data · gives
   *  Maria the "#3 of 14" denominator. */
  competitorLeaderboardTotal: number;

  /** Count of SerpResult(kind=MAPS) rows recorded for this business.
   *  Powers the truthful "Maps not scanned yet" copy in the State Bar
   *  when no Maps SERP scan has run · separates "we checked, you're
   *  not there" from "we haven't checked Maps yet". S.6 addition. */
  mapsScanCount: number;
}

/** One row in the rank-bucket breakdown · Top 3 / Top 4-10 / 11+. */
export interface RankBucket {
  /** Stable key · matches the BUCKET_KEYS constant. */
  key: "top_3" | "top_10" | "below_10";
  /** Number of Maria's tracked keywords in this bucket. */
  keywordCount: number;
  /** Σ monthly search volume across the keywords in this bucket. */
  totalSearchVolume: number;
  /** Σ estimated visits Maria likely gets at her current rank.
   *  Always 0 for `below_10` since CTR there is effectively zero. */
  estimatedVisits: number;
}

/** One row in the competitor leaderboard · Maria's row OR a cell-mate. */
export interface CompetitorRow {
  /** Stable id · businessId. */
  id: string;
  /** Business display name. "You" when kind === "you". */
  name: string;
  /** 1-indexed rank in the cell. Always set. */
  rank: number;
  /** Whether this row is Maria's business · the UI highlights it. */
  kind: "you" | "competitor";
  /** Σ search_volume across this business's tracked keywords. */
  totalSearchVolume: number;
  /** Σ estimated monthly clicks (visits) across this business's
   *  tracked keywords · DfS `etv` from ranked_keywords or
   *  fallback (sv × CTR). Leaderboard sort key. */
  monthlyVisitors: number;
  /** Count of keywords this business ranks in Maps top 3. */
  topThreeMaps: number;
  /** Count of keywords this business ranks in organic search top 3. */
  topThreeSearch: number;
  /** Normalized domain (host only) for the Domain column. null when
   *  the business has no website on file. */
  domain: string | null;
}

/**
 * One row in the "Where you're not ranking" section. Pulled from
 * keywords other paid businesses in Maria's cell rank for · she
 * doesn't yet · sorted by competitor traffic value desc.
 */
export interface SearchGap {
  /** Keyword id · stable for keys. */
  id: string;
  /** The keyword text Maria isn't ranking for. */
  keyword: string;
  /** Monthly searches in Maria's city · nullable when DfS hasn't
   * surfaced a volume number yet. */
  searchVolume: number | null;
  /** How many competitor businesses in Maria's cell rank for this
   * keyword today. Higher count = more competitive opportunity. */
  competitorsRanking: number;
  /** Best rank across all competitors (lowest rank number). Tells
   * Maria how high the bar is. */
  bestCompetitorRank: number | null;
  /** Sum of estimated traffic value across competitors · proxies
   * "how much this keyword is worth in your market." */
  estCompetitorTrafficUsd: number;
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
  country: null,
  category: null,
  bestLocalPackRank: null,
  keywordsTracked: 0,
  keywordsInLocalPack: 0,
  topThreeSearchCount: 0,
  topThreeMapsCount: 0,
  mapsScannedCount: 0,
  keywordsImprovedThisWeek: 0,
  keywords: [],
  topByVolume: [],
  allTrackedKeywords: [],
  searchGaps: [],
  lastScanAt: null,
  totalEstPatientsLost: 0,
  topQuickWins: [],
  totalSearchVolume: 0,
  totalEstimatedVisits: 0,
  totalEstTrafficUsd: 0,
  rankBuckets: [
    { key: "top_3", keywordCount: 0, totalSearchVolume: 0, estimatedVisits: 0 },
    {
      key: "top_10",
      keywordCount: 0,
      totalSearchVolume: 0,
      estimatedVisits: 0,
    },
    {
      key: "below_10",
      keywordCount: 0,
      totalSearchVolume: 0,
      estimatedVisits: 0,
    },
  ],
  competitorLeaderboard: [],
  competitorLeaderboardOwnRank: null,
  competitorLeaderboardTotal: 0,
  mapsScanCount: 0,
};

/**
 * CTR by best Google rank (Maps OR organic, whichever is better).
 * Used to estimate visits per keyword from search volume. Same curve
 * as `discover-keywords.ts:ctrForRank` so the totals + per-keyword
 * estimates are consistent.
 */
export function ctrForBestRank(rank: number | null): number {
  if (rank == null) return 0;
  if (rank === 1) return 0.39;
  if (rank === 2) return 0.18;
  if (rank === 3) return 0.1;
  if (rank === 4) return 0.07;
  if (rank === 5) return 0.05;
  if (rank <= 10) return 0.025;
  if (rank <= 20) return 0.008;
  if (rank <= 50) return 0.002;
  return 0.0005;
}

/** Pick the best (lowest, closest to #1) of Maps + organic rank.
 *  null when neither is set. */
export function bestRank(
  mapsRank: number | null,
  organicRank: number | null,
): number | null {
  if (mapsRank == null) return organicRank ?? null;
  if (organicRank == null) return mapsRank;
  return Math.min(mapsRank, organicRank);
}

/**
 * Per-keyword est-customers-missed (S.6.2 · function name kept for
 * back-compat; concept is "missed customers", not "patients").
 *
 * Formula per Viktor's 2026-05-28 spec:
 *   "Calculate volume for relevant keywords to services. From them
 *    calculate missed opportunity where they are not in top 3."
 *
 *   missed = volume × TOP_3_CTR × CONVERSION
 *
 *   - `TOP_3_CTR` = (CTR(1) + CTR(2) + CTR(3)) / 3 ≈ 22% · the
 *     fraction of clicks Maria would capture IF she reached top 3
 *     (weighted average across positions 1-3 of the public CTR curve).
 *     Honest framing: this is potential gain, not "you'd be #1".
 *   - `CONVERSION` = 2% · industry-baseline visit→customer rate for
 *     local services.
 *   - Returns 0 when she's already top 3 (Maps OR organic). Being #1
 *     organic for "med spa miami" already means her customers find
 *     her, even if the Maps Pack is empty.
 *
 * The keyword set passed in is filtered by the caller to
 * source="template" so it IS the relevant-to-her-services set by
 * construction (industry-templated · core + service buckets).
 *
 * Pure. Used by both the query layer and the unit tests.
 */
export function estimatePatientsLost(input: {
  searchVolume: number | null;
  /** Best of (Maps rank, organic rank) — lowest is best. null when not
   *  ranked anywhere. */
  bestRank: number | null;
}): number {
  if (!input.searchVolume || input.searchVolume <= 0) return 0;
  if (input.bestRank != null && input.bestRank <= 3) return 0;
  const TOP_3_CTR = (0.39 + 0.18 + 0.1) / 3; // ≈ 0.2233
  const CONVERSION = 0.02;
  return Math.round(input.searchVolume * TOP_3_CTR * CONVERSION);
}

/**
 * Pick quick-win CANDIDATES from a keyword list. Pure · returns
 * everything that qualifies sorted by impact desc · the weekly-
 * assignment layer (`quick-wins.ts`) handles dedup + slicing.
 *
 * S.6.5 rules (2026-05-28):
 *   - **Templated only** (`isTemplated = true`) — local-intent
 *     relevant-to-services keywords. Skips informational long-tail
 *     like "how long do lip injections last" that would otherwise
 *     pollute the recommendation list.
 *   - `searchVolume ≥ 50/mo` — qualifying volume floor.
 *   - NOT already in top 3 (Maps OR organic) — no opportunity gap.
 *   - **Fringe** — Maps rank 4-10 OR organic rank 4-10 (tighter than
 *     the v0.13.x 4-20 organic which was too loose).
 *
 * Surface tag · "maps" when she's fringe in Maps Pack, "search"
 * when only fringe in organic. Drives chip + action template.
 */
export function pickQuickWinCandidates(
  keywords: readonly KeywordRow[],
): SearchQuickWin[] {
  const candidates: Array<{ win: SearchQuickWin; impact: number }> = [];

  for (const row of keywords) {
    if (!row.isTemplated) continue;
    if (!row.searchVolume || row.searchVolume < 50) continue;

    const inMapsTop3 = row.localPackRank != null && row.localPackRank <= 3;
    const inOrgTop3 = row.organicRank != null && row.organicRank <= 3;
    if (inMapsTop3 || inOrgTop3) continue;

    const fringeMaps =
      row.localPackRank != null &&
      row.localPackRank > 3 &&
      row.localPackRank <= 10;
    const fringeOrganic =
      row.organicRank != null && row.organicRank > 3 && row.organicRank <= 10;
    if (!fringeMaps && !fringeOrganic) continue;

    // Surface · Maps wins when she's close in the Pack (more leverage
    // for local biz); organic when she's only close in blue links.
    const surface: QuickWinSurface = fringeMaps ? "maps" : "search";
    const stateKey: QuickWinStateKey =
      surface === "maps" ? "maps_fringe" : "search_fringe";
    const actionKey: QuickWinActionKey =
      surface === "maps" ? "maps_signals" : "review_request";

    const stateParams: Record<string, string | number> =
      surface === "maps"
        ? {
            rank: row.localPackRank ?? 0,
            ordinal: ordinal(row.localPackRank ?? 0),
            gap: Math.max(1, (row.localPackRank ?? 4) - 3),
          }
        : {
            rank: row.organicRank ?? 0,
            ordinal: ordinal(row.organicRank ?? 0),
          };

    candidates.push({
      impact: row.estPatientsLost,
      win: {
        id: row.id,
        keyword: row.keyword,
        surface,
        stateKey,
        stateParams,
        actionKey,
        estCustomersPerMo: row.estPatientsLost,
      },
    });
  }

  candidates.sort((a, b) => b.impact - a.impact);
  return candidates.map((c) => c.win);
}

/** Legacy alias · keep for back-compat with anything still calling
 *  the old name. Same return shape now that we refactored.
 *  TODO(S.6.6): remove all callers + delete this alias. */
export const deriveSearchQuickWins = pickQuickWinCandidates;

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
