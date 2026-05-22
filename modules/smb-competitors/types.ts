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
  /** Reply rate (0–1), nullable until first snapshot. */
  replyRate: number | null;
  /** Profile completeness score (0–1), nullable until first snapshot. */
  profileCompletenessScore: number | null;
  /** Photo count on Google profile, nullable until first snapshot. */
  photosCount: number | null;
  /** Same-building flag — true when this competitor sits in the same
   * physical building as Maria (e.g. shared mall / office tower).
   * Heuristic: matching street address prefix + same city. */
  isSameBuilding: boolean;
  /** When the competitor's business profile was first created in our
   * index — used to flag "new entrants" in the threat rail. */
  createdAt: Date | null;
}

/**
 * Head-to-head comparison row · 7 dimensions Maria can actually move.
 * Computed once per page request from the selected leader vs Maria.
 */
export interface HeadToHeadDimension {
  /** Stable key matching the i18n label. */
  key:
    | "rating"
    | "reviews"
    | "reply_rate"
    | "velocity"
    | "photos"
    | "profile"
    | "mapsly_score";
  /** Maria's value (preformatted, e.g. "4.4", "0%", "—"). */
  ownValue: string;
  /** Leader's value (preformatted). */
  leaderValue: string;
  /** -1 = Maria is behind, 0 = tied, +1 = Maria is ahead. */
  direction: -1 | 0 | 1;
  /** Magnitude 0–1 — for the comparison bar fill (Maria's share). */
  ownShare: number;
}

/**
 * One row in the "What needs your attention" threat rail. Priority-
 * ordered. Three tiers (`high` / `rising` / `info`) that drive both
 * sort order and visual tone.
 */
export interface SmbCompetitorThreat {
  id: string;
  tier: "high" | "rising" | "info";
  /** Plain-English body Maria reads. */
  body: string;
  /** Optional meta line under the body (source / refresh time). */
  meta?: string;
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

  /** Head-to-head dimensions vs the highest-scoring competitor
   * (`leaderName`). 7 rows. Empty when no leader is identifiable. */
  headToHead: HeadToHeadDimension[];
  /** The leader's display name for the head-to-head heading. Null
   * when no competitors are tracked. */
  leaderName: string | null;
  /** Priority-ordered threat rail rows · capped at MAX_THREATS. */
  threats: SmbCompetitorThreat[];
}

/** Max threat rail rows surfaced. */
export const MAX_THREATS = 4;

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
  headToHead: [],
  leaderName: null,
  threats: [],
};

/**
 * Pure derivation · head-to-head dimensions. Compares Maria vs the
 * highest-scoring competitor (`leader`) and produces 7 rows.
 *
 * Each row tags a direction (-1 behind / 0 tied / +1 ahead) and an
 * `ownShare` between 0 and 1 driving the comparison bar fill.
 * Missing data renders as "—" with direction = 0.
 */
export function deriveHeadToHead(
  own: CompetitorRow | null,
  leader: CompetitorRow | null,
): HeadToHeadDimension[] {
  if (!own || !leader) return [];

  function num(
    key: HeadToHeadDimension["key"],
    a: number | null,
    b: number | null,
    format: (n: number) => string,
  ): HeadToHeadDimension {
    if (a == null && b == null) {
      return {
        key,
        ownValue: "—",
        leaderValue: "—",
        direction: 0,
        ownShare: 0.5,
      };
    }
    const av = a ?? 0;
    const bv = b ?? 0;
    const total = av + bv;
    const ownShare = total > 0 ? av / total : 0.5;
    let direction: -1 | 0 | 1 = 0;
    if (av > bv) direction = 1;
    else if (av < bv) direction = -1;
    return {
      key,
      ownValue: a == null ? "—" : format(a),
      leaderValue: b == null ? "—" : format(b),
      direction,
      ownShare,
    };
  }

  return [
    num("mapsly_score", own.mapslyScore, leader.mapslyScore, (n) =>
      n.toFixed(1),
    ),
    num("rating", own.rating, leader.rating, (n) => n.toFixed(1)),
    num("reviews", own.reviewCount, leader.reviewCount, (n) => `${n}`),
    num(
      "reply_rate",
      own.replyRate,
      leader.replyRate,
      (n) => `${Math.round(n * 100)}%`,
    ),
    num("velocity", own.velocityLast30d, leader.velocityLast30d, (n) => `${n}`),
    num("photos", own.photosCount, leader.photosCount, (n) => `${n}`),
    num(
      "profile",
      own.profileCompletenessScore,
      leader.profileCompletenessScore,
      (n) => `${Math.round(n * 100)}%`,
    ),
  ];
}

/**
 * Pure derivation · threat rail. Examines the competitor set and
 * Maria's own row, producing up to MAX_THREATS rows in priority
 * order. Tiers:
 *
 *   - `high`    · same-building, leader-pulling-away
 *   - `rising`  · new entrant, fastest-growing
 *   - `info`    · pack tightening (multiple at similar Mapsly Scores)
 */
export function deriveThreats(input: {
  own: CompetitorRow | null;
  competitors: readonly CompetitorRow[];
  /** "Now" for new-entrant cutoff — defaults to Date.now(). */
  now?: Date;
}): SmbCompetitorThreat[] {
  const { own, competitors } = input;
  if (!own) return [];

  const now = input.now ?? new Date();
  const NEW_WINDOW_DAYS = 90;
  const newCutoff = now.getTime() - NEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const threats: Array<SmbCompetitorThreat & { priority: number }> = [];

  // Same-building competitor
  const sameBuilding = competitors.filter((c) => !c.isOwn && c.isSameBuilding);
  for (const c of sameBuilding) {
    threats.push({
      id: `sb-${c.id}`,
      tier: "high",
      priority: 1,
      body: `${c.name} is in your building — when patients search nearby, Google sometimes shows them first.`,
      meta: "Same address proximity check",
    });
  }

  // Leader pulling away · gap ≥ 1.5 score points
  if (own.mapslyScore != null && competitors.length > 0) {
    const leader = competitors
      .filter((c) => !c.isOwn && c.mapslyScore != null)
      .sort((a, b) => (b.mapslyScore ?? 0) - (a.mapslyScore ?? 0))[0];
    if (leader && (leader.mapslyScore ?? 0) - own.mapslyScore >= 1.5) {
      threats.push({
        id: `lead-${leader.id}`,
        tier: "high",
        priority: 2,
        body: `${leader.name} is pulling ahead — their Mapsly score is more than a point higher than yours.`,
        meta: "Vs you · latest snapshot",
      });
    }
  }

  // New entrant
  const newcomer = competitors.find(
    (c) => !c.isOwn && c.createdAt != null && c.createdAt.getTime() > newCutoff,
  );
  if (newcomer) {
    threats.push({
      id: `new-${newcomer.id}`,
      tier: "rising",
      priority: 3,
      body: `${newcomer.name} opened nearby in the last 3 months — worth a look at what they offer.`,
      meta: "New entrant in your category",
    });
  }

  // Fastest-growing · highest velocity not own
  const fastest = competitors
    .filter((c) => !c.isOwn && (c.velocityLast30d ?? 0) > 0)
    .sort((a, b) => (b.velocityLast30d ?? 0) - (a.velocityLast30d ?? 0))[0];
  if (
    fastest &&
    (fastest.velocityLast30d ?? 0) > (own.velocityLast30d ?? 0) * 1.5
  ) {
    threats.push({
      id: `vel-${fastest.id}`,
      tier: "rising",
      priority: 4,
      body: `${fastest.name} got ${fastest.velocityLast30d} new reviews this month — about ${Math.round(
        (fastest.velocityLast30d ?? 0) / Math.max(1, own.velocityLast30d ?? 1),
      )}× your pace.`,
      meta: "Last 30 days",
    });
  }

  threats.sort((a, b) => a.priority - b.priority);
  return threats.slice(0, MAX_THREATS).map((t) => ({
    id: t.id,
    tier: t.tier,
    body: t.body,
    meta: t.meta,
  }));
}

/**
 * How many competitor rows to fetch (excluding the user's own row).
 * Per `.claude/rules/ui-ux-smb.md` "Below the fold for anything
 * beyond 4 KPIs" — 8 keeps the comparison scannable on mobile without
 * paging.
 */
export const MAX_COMPETITORS = 8;
