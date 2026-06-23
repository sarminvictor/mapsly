"use client";

// CellStandardsPanel · "what's typical in this cell" (Phase 9). Stacks a row of
// VsCellBar distributions for a cell's headline metrics (rating, reviews, reply
// rate, …) so the agency can see where a prospect sits vs its market. Each row
// is a metric label + a VsCellBar showing the business value against the cell's
// percentile band.
//
// `'use client'` because VsCellBar is a client component (it imports it). Pure
// otherwise — all data comes in as props.

import { VsCellBar } from "./VsCellBar";
import { InfoTip } from "./InfoTip";

/** One headline distribution row for a cell. */
export interface CellStandardRow {
  /** Metric label, e.g. "Reviews". */
  label: string;
  /** The business's value for this metric. */
  value: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  /** The business's percentile within the cell (0–100). */
  percentile: number;
  unit?: string;
  /** Optional glossary text for an InfoTip next to the label. */
  help?: string;
}

export interface CellStandardsPanelProps {
  /** Human cell name, e.g. "Med-spa · Miami". */
  cellLabel: string;
  rows: CellStandardRow[];
  /** Sample size the distributions are computed from. */
  sampleSize?: number;
}

export function CellStandardsPanel({
  cellLabel,
  rows,
  sampleSize,
}: CellStandardsPanelProps) {
  // Degrade gracefully: if there are no distributions, hide the panel rather
  // than render an empty shell (per the build-green directive).
  if (rows.length === 0) return null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900">
          Cell standards · {cellLabel}
        </h2>
        {typeof sampleSize === "number" ? (
          <span className="font-mono text-xs text-slate-400">
            n = {sampleSize.toLocaleString()}
          </span>
        ) : null}
      </header>

      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.label}>
            <div className="mb-1 flex items-center gap-1.5">
              <span className="text-xs font-medium text-slate-600">
                {r.label}
              </span>
              {r.help ? (
                <InfoTip text={r.help} triggerLabel={`About ${r.label}`} />
              ) : null}
            </div>
            <VsCellBar
              value={r.value}
              p10={r.p10}
              p25={r.p25}
              p50={r.p50}
              p75={r.p75}
              p90={r.p90}
              percentile={r.percentile}
              unit={r.unit}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
