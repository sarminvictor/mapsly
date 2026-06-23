"use client";

// VsCellBar · the flagship "make a number mean something" component (Phase 9).
// Renders a value against its cell distribution: a typical (p25–p75) band, a
// p90 leaders tick, and the business's marker, with a plain-English label.
// Color is always paired with the label text (never color-only · a11y).

import {
  trackPct,
  typicalBand,
  percentileTone,
  vsCellLabel,
  toneClasses,
} from "../visual-helpers";

export interface VsCellBarProps {
  value: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  percentile: number;
  unit?: string;
  /** Override the auto label (e.g. translated copy). */
  label?: string;
}

export function VsCellBar({
  value,
  p10,
  p25,
  p50,
  p75,
  p90,
  percentile,
  unit = "",
  label,
}: VsCellBarProps) {
  const lo = Math.min(p10, value);
  const hi = Math.max(p90, value);
  const band = typicalBand(p25, p75, lo, hi);
  const markerPct = trackPct(value, lo, hi);
  const p90Pct = trackPct(p90, lo, hi);
  const tone = percentileTone(percentile);
  const text = label ?? vsCellLabel(value, p50, percentile, unit);

  const markerColor =
    tone === "green"
      ? "bg-emerald-500"
      : tone === "amber"
        ? "bg-amber-500"
        : "bg-red-500";

  return (
    <div className="w-full">
      <div
        className="relative h-2 w-full rounded-full bg-slate-100"
        role="img"
        aria-label={text}
      >
        {/* typical band */}
        <div
          className="absolute top-0 h-2 rounded-full bg-slate-300/70"
          style={{ left: `${band.startPct}%`, width: `${band.widthPct}%` }}
        />
        {/* p90 leaders tick */}
        <div
          className="absolute top-[-2px] h-3 w-px bg-slate-400"
          style={{ left: `${p90Pct}%` }}
          aria-hidden
        />
        {/* business marker */}
        <div
          className={`absolute top-[-3px] h-3.5 w-3.5 -translate-x-1/2 rounded-full ring-2 ring-white ${markerColor}`}
          style={{ left: `${markerPct}%` }}
          aria-hidden
        />
      </div>
      <p
        className={`mt-1 inline-block rounded border px-1.5 py-0.5 text-xs ${toneClasses(tone)}`}
      >
        {text}
      </p>
    </div>
  );
}
