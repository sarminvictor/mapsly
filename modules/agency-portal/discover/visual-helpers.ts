// modules/agency-portal/discover/visual-helpers.ts · pure helpers for the
// visual-first portal components (Phase 9). The .tsx components are thin shells
// over these; the math/mapping lives here so it's unit-testable (the repo tests
// logic, not rendered DOM).

import type { FreshnessState } from "@/lib/cell";

export type Tone = "green" | "amber" | "red" | "neutral" | "indigo";

/** Marker position (0–100%) of a value on a [lo, hi] track (clamped). */
export function trackPct(value: number, lo: number, hi: number): number {
  if (hi <= lo) return 0;
  const pct = ((value - lo) / (hi - lo)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
}

/** The shaded "typical" (p25–p75) band on a [lo, hi] track. */
export function typicalBand(
  p25: number,
  p75: number,
  lo: number,
  hi: number,
): { startPct: number; widthPct: number } {
  const startPct = trackPct(p25, lo, hi);
  const endPct = trackPct(p75, lo, hi);
  return { startPct, widthPct: Math.max(0, endPct - startPct) };
}

/** Color a percentile (0–100): bottom red, middle amber, top green. Always
 *  paired with text in the UI (never color-only — a11y). */
export function percentileTone(percentile: number): Tone {
  const p = Math.max(0, Math.min(100, percentile));
  if (p >= 75) return "green";
  if (p >= 25) return "amber";
  return "red";
}

/** A plain-English "vs cell" label, e.g. "100 reviews · typical 240 · top 30%". */
export function vsCellLabel(
  value: number,
  p50: number,
  percentile: number,
  unit = "",
): string {
  const u = unit ? ` ${unit}` : "";
  const rank =
    percentile >= 90
      ? "top 10%"
      : percentile >= 75
        ? "top quartile"
        : percentile <= 10
          ? "bottom 10%"
          : percentile <= 25
            ? "bottom quartile"
            : `${Math.round(percentile)}th pct`;
  return `${value}${u} · typical ${p50}${u} · ${rank}`;
}

export interface FreshnessChip {
  label: string;
  tone: Tone;
  dollars: string;
}

/** Freshness chip presentation for a cell. */
export function freshnessChip(state: FreshnessState): FreshnessChip {
  switch (state) {
    case "fresh":
      return { label: "Fresh", tone: "green", dollars: "$0 to serve" };
    case "aging":
      return { label: "Aging", tone: "amber", dollars: "$0 to serve" };
    case "stale":
      return { label: "Stale", tone: "red", dollars: "refetch (billed)" };
    case "never":
      return { label: "New", tone: "neutral", dollars: "fetch (billed)" };
  }
}

export interface ReachabilityCounts {
  total: number;
  reachable: number;
  phoneOnly: number;
  unreachable: number;
}

export interface DonutSegment {
  key: string;
  count: number;
  pct: number;
  tone: Tone;
}

/** Donut segments for the Raw List reachability banner. */
export function reachabilityDonut(c: ReachabilityCounts): DonutSegment[] {
  const total = Math.max(1, c.total);
  const pct = (n: number) => Math.round((n / total) * 1000) / 10;
  return [
    {
      key: "reachable",
      count: c.reachable,
      pct: pct(c.reachable),
      tone: "green",
    },
    {
      key: "phoneOnly",
      count: c.phoneOnly,
      pct: pct(c.phoneOnly),
      tone: "amber",
    },
    {
      key: "unreachable",
      count: c.unreachable,
      pct: pct(c.unreachable),
      tone: "red",
    },
  ];
}

export type PredictedTier = "high" | "medium" | "low";

export function predictedTierTone(tier: PredictedTier): Tone {
  return tier === "high" ? "green" : tier === "medium" ? "amber" : "neutral";
}

/**
 * Build an SVG polyline `points` string for a sparkline from a series of values,
 * scaled to fit a [0,width] × [0,height] box (y inverted so higher = up). Pure +
 * deterministic so the tiny `<Sparkline>` shell stays untestable-free. A flat or
 * single-point series renders a centered horizontal line.
 */
export function sparklinePoints(
  values: number[],
  width: number,
  height: number,
  pad = 1,
): string {
  if (values.length === 0) return "";
  const innerW = Math.max(0, width - pad * 2);
  const innerH = Math.max(0, height - pad * 2);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const stepX = values.length > 1 ? innerW / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const x = pad + (values.length > 1 ? i * stepX : innerW / 2);
      // Flat series → centered line; else invert so larger values sit higher.
      const norm = span === 0 ? 0.5 : (v - min) / span;
      const y = pad + (1 - norm) * innerH;
      return `${Math.round(x * 100) / 100},${Math.round(y * 100) / 100}`;
    })
    .join(" ");
}

/** Direction of a value series (last vs first), used for sparkline aria text. */
export function seriesTrend(values: number[]): "up" | "down" | "flat" {
  if (values.length < 2) return "flat";
  const delta = values[values.length - 1] - values[0];
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "flat";
}

/** A ranked next-best-action item the agency should take next. */
export interface NextActionItem {
  id: string;
  label: string;
  detail?: string;
  /** Higher = more important; the list renders in descending order. */
  weight: number;
  tone?: Tone;
  href?: string;
}

/** Sort next-actions by weight (desc), tie-broken by label for stable order. */
export function rankNextActions(items: NextActionItem[]): NextActionItem[] {
  return [...items].sort(
    (a, b) => b.weight - a.weight || a.label.localeCompare(b.label),
  );
}

/** Tailwind class fragment for a tone (cool-gray + indigo agency palette). */
export function toneClasses(tone: Tone): string {
  switch (tone) {
    case "green":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "amber":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "red":
      return "bg-red-50 text-red-700 border-red-200";
    case "indigo":
      return "bg-indigo-50 text-indigo-700 border-indigo-200";
    default:
      return "bg-slate-50 text-slate-600 border-slate-200";
  }
}
