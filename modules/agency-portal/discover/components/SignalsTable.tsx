"use client";

// SignalsTable · the Discovery "Signals" view (Phase 9). One row per business
// in the Discovery's cells, each showing a few comparative signals via
// <VsCellBar> (reviews vs the cell distribution) plus the business's flagged
// expert findings as evidence chips (confidence pill + explanation). Read-only.
//
// Per `.claude/rules/ui-ux-agency.md`: dense, indigo accent, numbers over
// adjectives, jargon-OK with explanations available on the chips. No function
// props cross the boundary — rows are plain serialized data resolved server-side
// (cache-components Pattern 4). Copy is English-only for now.

import { Link } from "@/i18n/navigation";
import { VsCellBar } from "./VsCellBar";
import { confidencePillClass, type SignalRow } from "../signals";

export interface SignalsTableProps {
  rows: SignalRow[];
  /** The owning discovery — drives the per-row business-detail link. */
  discoveryId: string;
}

export function SignalsTable({ rows, discoveryId }: SignalsTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        No businesses in this discovery yet. Run discovery to populate its
        cells, then the comparative signals appear here.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-slate-50">
          <tr className="text-left text-xs font-medium text-slate-500">
            <th className="px-3 py-2">Business</th>
            <th className="px-3 py-2 w-72">Signals vs cell</th>
            <th className="px-3 py-2">Expert findings</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-slate-100 align-top">
              <td className="px-3 py-3">
                <div className="font-medium text-slate-800">{r.name}</div>
                <div className="font-mono text-xs text-slate-400">
                  {r.category ?? "—"}
                  {r.city ? ` · ${r.city}` : ""}
                </div>
              </td>
              <td className="px-3 py-3">
                {r.signals.length === 0 ? (
                  <span className="font-mono text-xs text-slate-400">
                    no comparable signal
                  </span>
                ) : (
                  <div className="flex flex-col gap-3">
                    {r.signals.map((s) => (
                      <div key={s.key}>
                        <div className="mb-0.5 font-mono text-[11px] uppercase tracking-wide text-slate-400">
                          {s.label}
                        </div>
                        {s.band ? (
                          <VsCellBar
                            value={s.value}
                            p10={s.band.p10}
                            p25={s.band.p25}
                            p50={s.band.p50}
                            p75={s.band.p75}
                            p90={s.band.p90}
                            percentile={s.percentile}
                            unit={s.unit}
                          />
                        ) : (
                          // Cohort too small for a distribution — show the raw
                          // value rather than draw a misleading bar.
                          <span className="font-mono text-sm text-slate-700">
                            {s.value.toLocaleString()}
                            {s.unit ? ` ${s.unit}` : ""}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </td>
              <td className="px-3 py-3">
                {r.findings.length === 0 ? (
                  <span className="font-mono text-xs text-slate-400">
                    no flagged findings
                  </span>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {r.findings.map((f) => (
                      <div
                        key={f.signalKey}
                        className="flex items-start gap-2 text-xs"
                      >
                        <span
                          className={`mt-0.5 inline-flex shrink-0 rounded border px-1.5 py-0.5 font-medium ${confidencePillClass(
                            f.confidence,
                          )}`}
                          title={`confidence: ${f.confidence}`}
                        >
                          {f.confidence}
                        </span>
                        <span className="text-slate-600">
                          <span className="font-mono text-[11px] text-slate-400">
                            {f.signalKey}
                          </span>
                          {f.explanation ? (
                            <span className="ml-1">{f.explanation}</span>
                          ) : null}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </td>
              <td className="px-3 py-3 text-right">
                <Link
                  href={{
                    pathname: "/discover/[discoveryId]/business/[businessId]",
                    params: { discoveryId, businessId: r.id },
                  }}
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                >
                  Open →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
