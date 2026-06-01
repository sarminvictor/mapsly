/**
 * Scoring v2 · pillar type definitions
 *
 * The Mapsly Score is being reworked from 6 abstract sub-scores into 5
 * PAGE-ALIGNED pillars (Reputation / Visibility / Profile / Website /
 * Advertising), each 0–10, rolled up by weight into the consolidated master.
 *
 * The defining mechanic is MARKET-RELATIVE scoring: a signal is graded by its
 * percentile within the business's local cell (category × city × country) — see
 * `CellReference` — instead of against a hardcoded threshold. Hygiene signals
 * (phone, claimed, schema) stay absolute; competitive signals (reviews, photos,
 * ad presence, speed) go relative; a few blend a floor with the relative.
 *
 * This file owns the vocabulary + the persisted shapes only. Weights live in
 * `pillars.ts`; the pure derivation lives there too.
 *
 * See:
 *   - .claude/memory/scoring-v2-market-relative.md — the decided direction
 *   - prisma/schema.prisma `BusinessSnapshot.{signalsJson, *Pillar}` + `CellMetric`
 */

/** The five pillars, in dashboard render order (Maria's tiles read this). */
export const PILLARS = [
  "reputation",
  "visibility",
  "profile",
  "website",
  "advertising",
] as const;

export type Pillar = (typeof PILLARS)[number];

/**
 * Per-business pillar INPUT signals. This is the exact shape persisted as
 * `BusinessSnapshot.signalsJson` by the weekly snapshot cron, so the
 * cell-aggregate + pillar-scoring passes read one row instead of re-joining
 * Serp / Lighthouse / Ads. All fields nullable — a missing signal degrades
 * gracefully (absolute fallback or 0 contribution), never throws.
 */
export interface PillarSignals {
  // ── Reputation ──
  /** Google rating 0–5. */
  readonly rating: number | null;
  readonly reviewCount: number | null;
  /** Reviews in the last 30 days. */
  readonly velocityLast30d: number | null;
  /** Fraction 0–1 of recent reviews with an owner reply. */
  readonly replyRate: number | null;

  // ── Visibility ──
  /** Best position in the Maps 3-pack across target keywords (1.. · null = absent). */
  readonly localPackRank: number | null;
  /** Best organic position across target keywords (1.. · null = absent). */
  readonly organicRankBest: number | null;
  /** % of target keywords where the business appears in the local pack (0–100). */
  readonly shareOfVoice: number | null;
  readonly keywordsRanked: number | null;

  // ── Profile (mostly hygiene) ──
  readonly hasPhone: boolean | null;
  readonly hasWebsite: boolean | null;
  readonly hasHours: boolean | null;
  readonly isClaimed: boolean | null;
  readonly photoCount: number | null;
  readonly categoryCount: number | null;

  // ── Website ──
  /** Lighthouse mobile performance 0–100. */
  readonly lighthousePerformance: number | null;
  /** Lighthouse SEO 0–100. */
  readonly lighthouseSeo: number | null;
  readonly lcpSeconds: number | null;
  readonly hasSchema: boolean | null;
  readonly hasBookingCta: boolean | null;
  readonly hasPhoneAboveFold: boolean | null;
  readonly napConsistent: boolean | null;

  // ── Advertising ──
  readonly hasActiveAds: boolean | null;
  readonly metaAdCount: number | null;
  readonly estMonthlyAdSpend: number | null;
  /** A competitor is bidding on this business's brand-name query. */
  readonly brandHijack: boolean | null;
}

/** Percentile breakpoints for one signal across a cell's businesses. */
export interface Breakpoints {
  readonly p10: number;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p90: number;
}

/**
 * The full per-signal distribution bag stored on `CellMetric.distributions`.
 * Keys are signal names; each value is the 5-point breakpoint set. Absent keys
 * mean "no usable distribution for this signal in this cell" → pillar scoring
 * falls back to an absolute heuristic for that signal.
 */
export interface CellDistributions {
  readonly rating?: Breakpoints;
  readonly reviewCount?: Breakpoints;
  readonly velocity?: Breakpoints;
  readonly photoCount?: Breakpoints;
  readonly shareOfVoice?: Breakpoints;
  readonly lighthousePerformance?: Breakpoints;
  readonly estMonthlyAdSpend?: Breakpoints;
}

/**
 * The market reference a business is graded against. Built from a `CellMetric`
 * row by the cell-metrics module. `null` (no cell yet) is valid — pillar
 * scoring degrades to absolute heuristics so a brand-new cell still scores.
 */
export interface CellReference extends CellDistributions {
  readonly sampleSize: number;
  readonly confidence: "high" | "low";
  /** Share of the cell running ads (0–1). Drives the no-penalty floor on Ads. */
  readonly adPrevalence: number | null;
}

export interface PillarBreakdown {
  readonly pillar: Pillar;
  /** 0–10, or null when the pillar has no input signals ("unmeasured"). */
  readonly score: number | null;
  /** 0–1. */
  readonly weight: number;
  /** Re-normalized contribution (over measured pillars) · sums to master. */
  readonly contribution: number;
}

export interface PillarResult {
  /** 0–10, or null when the pillar is unmeasured (no input signals). */
  readonly reputation: number | null;
  readonly visibility: number | null;
  readonly profile: number | null;
  readonly website: number | null;
  readonly advertising: number | null;
  /** 0–10 · weighted roll-up over the MEASURED pillars; null if none measured. */
  readonly master: number | null;
  /** Whether the business is actually advertising (display flag, not a weight). */
  readonly adsApplicable: boolean;
  readonly breakdown: readonly PillarBreakdown[];
}
