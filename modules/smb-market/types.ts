/**
 * SMB market-reality · payload types.
 *
 * `SmbMarketData` is the flat shape the `/(smb)/market` page renders
 * from. It bundles:
 *
 *   - Maria's headline market position (rank, total, score gap to
 *     the top)
 *   - Top 12 businesses in the same category + city, ranked by
 *     Mapsly Score; Maria's row included so the table is unified
 *   - Market medians across the FULL category+city slice (not just
 *     top 12) so Maria sees where the middle is
 *   - "Movers" · 3 fastest-growing competitors by 30-day velocity
 *
 * Per `.claude/rules/cache-components.md` Pattern 1: EMPTY shape
 * declares every field. Per `.claude/rules/ui-ux-smb.md`: no MSI /
 * jargon in the i18n-resolved labels (the field names here stay
 * neutral; the page translates).
 */

export interface MarketRankingRow {
  id: string;
  name: string;
  /** True iff this is Maria's own business. */
  isOwn: boolean;
  rank: number;
  mapslyScore: number | null;
  rating: number | null;
  reviewCount: number | null;
}

export interface MarketMedians {
  rating: number | null;
  reviewCount: number | null;
  /** 0–1 reply rate median across the market. */
  replyRate: number | null;
  photosCount: number | null;
  velocityLast30d: number | null;
  /** Total number of businesses in the slice — drives "of N". */
  total: number;
}

export interface MarketMover {
  id: string;
  name: string;
  /** Mapsly Score for context. */
  mapslyScore: number | null;
  /** Reviews in the last 30 days — the "hot streak" metric. */
  velocityLast30d: number;
}

export interface SmbMarketData {
  ownedBusinessId: string;
  businessName: string;
  category: string;
  city: string | null;

  /** Maria's rank · null when no snapshot yet. */
  ownRank: number | null;
  /** Total in market · null when no snapshot yet. */
  marketTotal: number | null;
  /** Maria's Mapsly Score 0–10 · null until snapshot. */
  ownMapslyScore: number | null;
  /** Gap to the leader's Mapsly Score · positive when behind. Null
   * when no leader is identifiable. */
  gapToLeader: number | null;

  /** Top-12 ranked rows. May INCLUDE Maria. */
  topRanked: MarketRankingRow[];

  /** Median values across the FULL same-category-+-city slice. */
  medians: MarketMedians;

  /** Top 3 hot-streak movers (by velocityLast30d desc). */
  movers: MarketMover[];

  /** When the underlying data was last refreshed. */
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

export const EMPTY_SMB_MARKET: SmbMarketData = {
  ownedBusinessId: "",
  businessName: "",
  category: "",
  city: null,
  ownRank: null,
  marketTotal: null,
  ownMapslyScore: null,
  gapToLeader: null,
  topRanked: [],
  medians: EMPTY_MARKET_MEDIANS,
  movers: [],
  lastSnapshotAt: null,
};

export const MARKET_TOP_N = 12;
export const MARKET_MOVERS_N = 3;

/**
 * Pure helper · compute medians across a list of business
 * snapshots. Pure so the unit tests can drive it with synthetic
 * fixtures without hitting Prisma.
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
