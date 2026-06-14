/**
 * SMB weekly overview · payload types.
 *
 * One consolidated page (`/home`) — replaces the old dashboard + the
 * separate "how you compare" page. Maria sees, top to bottom:
 *
 *   - her Mapsly Score + market standing (rank + weekly movement)
 *   - the 5 section scores (navigable pillar tiles)
 *   - quick wins drawn from every section (right rail)
 *   - an interactive competitor table for her whole local market
 *     (sortable by Mapsly Score + each section score, with a weekly
 *     rank-movement column)
 *   - a "this week — what changed" market-events feed
 *
 * `EMPTY_SMB_OVERVIEW` is the build-phase / no-business / error shape per
 * `.claude/rules/cache-components.md` Pattern 1 — every field present so
 * TypeScript catches partial shapes at literal-comparison time on Vercel
 * build. Callers identify the empty state by `data.ownedBusinessId === ""`.
 */

/** One quick-win row — an action Maria can take, drawn from any section. */
export interface SmbOverviewFix {
  /** 1-based rank in the list. */
  rank: number;
  /** Which section it belongs to (drives the chip + the page it links to). */
  section: "reputation" | "visibility" | "profile" | "website" | "advertising";
  /** Imperative action sentence Maria can act on. */
  action: string;
  /** Optional secondary line — the trigger ("8 reviews unanswered"). */
  meta?: string;
  /** Big impact value — "+0.4", "Fast", "—". */
  impact: string;
  /** Smaller line under the impact value. */
  impactSub: string;
  tone: "good" | "warn" | "neutral";
}

/** A sortable / ranked column in the market table. */
export type RankColumn =
  | "mapsly"
  | "reputation"
  | "visibility"
  | "ads"
  | "website"
  | "profile";

/** A business's standing on one column — computed server-side across the
 * FULL cell (every page), so the table's "#" and "Δ" are authoritative no
 * matter which page is shown or which column is sorted. */
export interface ColumnRank {
  /** 1-based rank in the cell by this column (competition ranking: ties share
   * a rank, "1 2 2 4"). */
  rank: number;
  /** Weekly change in that rank — positive = moved up N spots, negative =
   * dropped, 0 = held, null = no comparable prior week yet ("new"). */
  delta: number | null;
}

/** One business row in the market competitor table. */
export interface SmbCompetitorRow {
  id: string;
  name: string;
  isOwn: boolean;
  /** Master Mapsly Score 0–10 (null → treated as 0 for ranking). */
  mapslyScore: number | null;
  reputation: number | null;
  visibility: number | null;
  profile: number | null;
  website: number | null;
  ads: number | null;
  /** Whether this business is actually advertising — so an ads 0 reads as
   * "not running ads" rather than a real low score. */
  adsApplicable: boolean | null;
  /** Rank + weekly delta for EVERY column, computed server-side across the
   * whole cell. The table shows the entry for whichever column is sorted, so
   * the "#" and "Δ" always reflect the active ranking — cell-wide, every page. */
  ranks: Record<RankColumn, ColumnRank>;
}

/** Event type — drives the feed filter chips + the source-pill colour. */
export type SmbEventType =
  | "rating"
  | "reviews"
  | "ads"
  | "search"
  | "photos"
  | "website"
  | "services";

/** One "this week — what changed" row in the market-events feed. */
export interface SmbMarketChange {
  id: string;
  type: SmbEventType;
  businessId: string;
  businessName: string;
  isOwn: boolean;
  /** Plain-English line Maria reads. */
  body: string;
  /** Short delta shown on the right ("+0.2", "+12", "▲", "Google"). */
  delta: string | null;
  /** Tone for the delta chip — good = green, bad = coral, neutral. */
  tone: "good" | "bad" | "neutral";
  /** ISO timestamp (the week's snapshot date, or a service's createdAt). */
  at: string;
}

export interface SmbOverviewData {
  /** Owned business id, or `""` for empty / build-phase. */
  ownedBusinessId: string;
  slug: string;
  name: string;
  category: string;
  city: string | null;
  province: string | null;

  /** Master Mapsly Score 0–10 (= pillarScore), null until first scored. */
  mapslyScore: number | null;
  /** Owner's standing rank in the cell (1 = best). */
  rank: number | null;
  /** Businesses ranked in the cell — the "of N" denominator. */
  total: number | null;
  /** Owner's weekly rank change (positive = up). Null = no comparable
   * prior week yet (the column warms up over the first cycles). */
  rankDelta: number | null;

  reputation: number | null;
  visibility: number | null;
  profile: number | null;
  website: number | null;
  ads: number | null;
  adsApplicable: boolean | null;

  /** When the latest snapshot was written, nullable for new businesses. */
  lastSnapshotAt: Date | null;

  /** Quick wins across every section, capped at MAX_FIXES. */
  topFixes: SmbOverviewFix[];
  /** Every business in the owner's market, ranked. */
  competitors: SmbCompetitorRow[];
  /** This-week market changes, capped at MAX_EVENTS. */
  events: SmbMarketChange[];
}

/** Max quick-win rows surfaced in the rail. */
export const MAX_FIXES = 5;
/** Max market-change events sent to the client (it filters/sorts/paginates
 * in-memory). Generous so the paginated feed covers the whole cell — one
 * review event per business + the snapshot-diff moves. */
export const MAX_EVENTS = 300;

/**
 * The canonical empty shape — returned for no-business / build-phase /
 * error. Every field present per `.claude/rules/cache-components.md`
 * Pattern 1.
 */
export const EMPTY_SMB_OVERVIEW: SmbOverviewData = {
  ownedBusinessId: "",
  slug: "",
  name: "",
  category: "",
  city: null,
  province: null,
  mapslyScore: null,
  rank: null,
  total: null,
  rankDelta: null,
  reputation: null,
  visibility: null,
  profile: null,
  website: null,
  ads: null,
  adsApplicable: null,
  lastSnapshotAt: null,
  topFixes: [],
  competitors: [],
  events: [],
};
