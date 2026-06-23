// CohortCard · summarizes a qualified cohort (Phase 9): the pitch wedge, the
// matched count, and a tone-coded confidence. Pure/presentational — no I/O, no
// state — so it renders on the server. Tone is always paired with the count +
// text (never color-only · a11y).
//
// Agency voice: numbers over adjectives ("142 matches · 118 reachable"), the
// pitch is a tight imperative line, jargon allowed.

import { toneClasses, type Tone } from "../visual-helpers";

export interface CohortCardProps {
  /** The pitch line — why this cohort is worth working. */
  pitch: string;
  /** Number of businesses in the cohort. */
  count: number;
  /** Optional reachable subset (renders "· N reachable"). */
  reachableCount?: number;
  /** Tone-coded confidence badge. */
  tone?: Tone;
  /** Badge label (e.g. "High intent"). Required to render the badge. */
  toneLabel?: string;
  /** Optional small print under the count (e.g. cell summary). */
  footnote?: string;
}

export function CohortCard({
  pitch,
  count,
  reachableCount,
  tone = "indigo",
  toneLabel,
  footnote,
}: CohortCardProps) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium leading-snug text-slate-800">
          {pitch}
        </p>
        {toneLabel ? (
          <span
            className={`shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium ${toneClasses(tone)}`}
          >
            {toneLabel}
          </span>
        ) : null}
      </div>
      <p className="mt-3 font-mono text-2xl font-semibold text-slate-900">
        {count.toLocaleString()}
        <span className="ml-1 text-sm font-normal text-slate-500">matches</span>
        {typeof reachableCount === "number" ? (
          <span className="ml-2 text-sm font-normal text-slate-400">
            · {reachableCount.toLocaleString()} reachable
          </span>
        ) : null}
      </p>
      {footnote ? (
        <p className="mt-1 font-mono text-xs text-slate-400">{footnote}</p>
      ) : null}
    </article>
  );
}
