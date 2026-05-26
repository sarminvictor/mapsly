/**
 * SMB "How you compare" · payload types + pure derivations.
 *
 * Self-contained module — combines what `smb-competitors` and
 * `smb-market` used to expose separately. One Maria-facing answer to
 * "where do I stand and what's threatening me."
 *
 * Sections, in render order:
 *
 *   1. Hero · Mapsly Score + market rank + gap to leader
 *   2. Top ranked · top 12 in your category + city
 *   3. Head-to-head · 7 dimensions vs the highest-scoring competitor
 *   4. Medians · where the middle of the market is
 *   5. What needs your attention · priority-ordered threats
 *   6. On a hot streak · 3 fastest-growing competitors
 *
 * Per `.claude/rules/cache-components.md` Pattern 1, EMPTY constants
 * declare every field of the interface — TypeScript catches partial
 * shapes at literal-comparison time on Vercel build.
 */

/**
 * Single competitor row in the comparison list. The user's own business
 * is included here too (`isOwn: true`) so the page can render Maria
 * inline with everyone else.
 */
export interface CompetitorRow {
  id: string;
  name: string;
  isOwn: boolean;
  rating: number | null;
  reviewCount: number | null;
  mapslyScore: number | null;
  velocityLast30d: number | null;
  replyRate: number | null;
  profileCompletenessScore: number | null;
  photosCount: number | null;
  /** Same physical building heuristic (matching address prefix). */
  isSameBuilding: boolean;
  createdAt: Date | null;
}

export interface HeadToHeadDimension {
  key:
    | "rating"
    | "reviews"
    | "reply_rate"
    | "velocity"
    | "photos"
    | "profile"
    | "mapsly_score";
  ownValue: string;
  leaderValue: string;
  /** -1 = Maria behind, 0 = tied, +1 = Maria ahead. */
  direction: -1 | 0 | 1;
  /** 0..1 — Maria's share of the bar (drives the comparison fill). */
  ownShare: number;
}

export interface SmbCompetitorThreat {
  id: string;
  tier: "high" | "rising" | "info";
  body: string;
  meta?: string;
}

export interface MarketRankingRow {
  id: string;
  name: string;
  isOwn: boolean;
  rank: number;
  mapslyScore: number | null;
  rating: number | null;
  reviewCount: number | null;
}

export interface MarketMedians {
  rating: number | null;
  reviewCount: number | null;
  replyRate: number | null;
  photosCount: number | null;
  velocityLast30d: number | null;
  /** Total businesses in the slice — drives "of N". */
  total: number;
}

export interface MarketMover {
  id: string;
  name: string;
  mapslyScore: number | null;
  velocityLast30d: number;
}

export interface SmbHowYouCompareData {
  /**
   * Empty string when no claimed business, build phase, or query threw.
   */
  ownedBusinessId: string;
  businessName: string;
  category: string;
  city: string | null;
  province: string | null;

  ownMapslyScore: number | null;
  marketRank: number | null;
  marketTotal: number | null;
  /** Positive when Maria is behind the leader. Null when no leader. */
  gapToLeader: number | null;

  topRanked: MarketRankingRow[];

  leaderName: string | null;
  headToHead: HeadToHeadDimension[];

  medians: MarketMedians;
  threats: SmbCompetitorThreat[];
  movers: MarketMover[];

  lastSnapshotAt: Date | null;
}

export const EMPTY_MARKET_MEDIANS: MarketMedians = {
  rating: null,
  reviewCount: null,
  replyRate: null,
  photosCount: null,
  velocityLast30d: null,
  total: 0,
};

export const EMPTY_SMB_HOW_YOU_COMPARE: SmbHowYouCompareData = {
  ownedBusinessId: "",
  businessName: "",
  category: "",
  city: null,
  province: null,
  ownMapslyScore: null,
  marketRank: null,
  marketTotal: null,
  gapToLeader: null,
  topRanked: [],
  leaderName: null,
  headToHead: [],
  medians: EMPTY_MARKET_MEDIANS,
  threats: [],
  movers: [],
  lastSnapshotAt: null,
};

// ─── Constants ────────────────────────────────────────────────────────────

/** Slice cap · same-category+same-city businesses fetched per request. */
export const MARKET_SLICE_CAP = 80;
/** Top N shown in the ranking table. */
export const MARKET_TOP_N = 12;
/** Movers count · top fastest-growing competitors. */
export const MARKET_MOVERS_N = 3;
/** Max threat-rail rows surfaced. */
export const MAX_THREATS = 4;
/** Max non-own rows in the competitor comparison set. */
export const MAX_COMPETITORS = 8;

// ─── Pure derivations ─────────────────────────────────────────────────────

/**
 * Head-to-head dimensions · 7 comparable axes between Maria and the
 * highest-scoring competitor. Each row tags direction (-1 behind /
 * 0 tied / +1 ahead) and `ownShare` between 0 and 1 driving the bar
 * fill. Missing data renders "—" with direction = 0.
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
 * Threat rail · examines the competitor set and produces up to
 * MAX_THREATS rows in priority order.
 */
export function deriveThreats(input: {
  own: CompetitorRow | null;
  competitors: readonly CompetitorRow[];
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

  // Fastest-growing
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
 * Medians across the slice. Pure so unit tests can drive it without
 * Prisma.
 */
export function deriveMedians(
  rows: ReadonlyArray<{
    rating: number | null;
    reviewCount: number | null;
    replyRate: number | null;
    photosCount: number | null;
    velocityLast30d: number | null;
  }>,
): MarketMedians {
  if (rows.length === 0) return { ...EMPTY_MARKET_MEDIANS };

  function median(vals: number[]): number | null {
    if (vals.length === 0) return null;
    const sorted = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!;
  }

  return {
    rating: median(rows.map((r) => r.rating).filter(isNum)),
    reviewCount: median(rows.map((r) => r.reviewCount).filter(isNum)),
    replyRate: median(rows.map((r) => r.replyRate).filter(isNum)),
    photosCount: median(rows.map((r) => r.photosCount).filter(isNum)),
    velocityLast30d: median(rows.map((r) => r.velocityLast30d).filter(isNum)),
    total: rows.length,
  };
}

function isNum(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Address normaliser for the same-building heuristic. Returns a
 * lowercase, whitespace-collapsed prefix (first 30 chars) or null for
 * missing addresses.
 */
export function addressKey(addr: string | null | undefined): string | null {
  if (!addr || typeof addr !== "string") return null;
  const trimmed = addr.toLowerCase().replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 30);
}
