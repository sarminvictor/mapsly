// Sparkline · a tiny inline trend line (Phase 9). Pure/presentational — the
// path math lives in visual-helpers (`sparklinePoints`) so it stays testable.
// Renders as `role="img"` with an aria-label describing the trend (never relies
// on color alone — a11y). No `'use client'`: it has no interactivity, so it can
// render on the server inside any KPI tile or NextActions row.

import { sparklinePoints, seriesTrend, type Tone } from "../visual-helpers";

export interface SparklineProps {
  values: number[];
  width?: number;
  height?: number;
  /** Stroke tone — paired with the aria-label so meaning isn't color-only. */
  tone?: Tone;
  /** Plain-English label; falls back to an auto trend description. */
  label?: string;
}

function strokeFor(tone: Tone): string {
  switch (tone) {
    case "green":
      return "#10b981";
    case "amber":
      return "#f59e0b";
    case "red":
      return "#ef4444";
    case "indigo":
      return "#5b3df5";
    default:
      return "#94a3b8";
  }
}

export function Sparkline({
  values,
  width = 64,
  height = 18,
  tone = "indigo",
  label,
}: SparklineProps) {
  const trend = seriesTrend(values);
  const points = sparklinePoints(values, width, height);
  const aria =
    label ??
    (values.length === 0
      ? "No trend data"
      : `Trend ${trend}, ${values.length} points`);

  if (points === "") {
    return (
      <svg
        role="img"
        aria-label={aria}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      />
    );
  }

  return (
    <svg
      role="img"
      aria-label={aria}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "inline-block", verticalAlign: "middle" }}
    >
      <polyline
        points={points}
        fill="none"
        stroke={strokeFor(tone)}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
