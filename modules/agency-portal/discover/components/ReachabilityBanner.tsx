"use client";

// ReachabilityBanner · the Raw List header showing the reachability split
// (Phase 9). Unreachable businesses are hidden by default; the banner explains
// the split and links to the "why hidden" filter.

import { reachabilityDonut, type ReachabilityCounts } from "../visual-helpers";

function segClass(tone: string): string {
  return tone === "green"
    ? "bg-emerald-400"
    : tone === "amber"
      ? "bg-amber-400"
      : "bg-red-400";
}

export function ReachabilityBanner({
  counts,
  onShowHidden,
}: {
  counts: ReachabilityCounts;
  onShowHidden?: () => void;
}) {
  const segs = reachabilityDonut(counts);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-700">
        <b>{counts.total.toLocaleString()}</b> businesses ·{" "}
        <b>{counts.reachable.toLocaleString()}</b> reachable ·{" "}
        {counts.phoneOnly.toLocaleString()} phone-only ·{" "}
        {counts.unreachable.toLocaleString()} unreachable (hidden)
      </p>
      <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
        {segs.map((s) => (
          <div
            key={s.key}
            title={`${s.key}: ${s.pct}%`}
            style={{ width: `${s.pct}%` }}
            className={segClass(s.tone)}
          />
        ))}
      </div>
      {counts.unreachable > 0 && onShowHidden ? (
        <button
          onClick={onShowHidden}
          className="mt-2 text-xs font-medium text-indigo-600 hover:underline"
        >
          Show {counts.unreachable} hidden — why?
        </button>
      ) : null}
    </div>
  );
}
