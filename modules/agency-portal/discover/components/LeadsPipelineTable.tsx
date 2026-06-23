"use client";

// LeadsPipelineTable · the saved-list pipeline view (demand flow). One row per
// lead joined to its Business, with a clickable STATUS pill that cycles the lead
// through NEW → CONTACTED → REPLIED → WON, plus an explicit WON/LOST setter, and
// a row link into the business detail. Status changes are optimistic
// (`useOptimistic` + `useTransition`) per `.claude/rules/realtime-and-optimistic.md`
// — the pill flips instantly and reverts if the server action fails.
//
// Per `.claude/rules/ui-ux-agency.md`: dense, cool-gray + indigo, numbers over
// adjectives, imperative actions. No function props cross the boundary — the
// status action is imported directly. Copy is English-only for now.

import { useMemo, useOptimistic, useState, useTransition } from "react";

import { Link } from "@/i18n/navigation";
import {
  setLeadStatusAction,
  type SaveLeadStatus,
} from "@/modules/discovery/save-list-actions";

/** A pipeline row — plain serializable data resolved server-side. */
export interface LeadPipelineRow {
  leadId: string;
  businessId: string;
  name: string;
  category: string | null;
  city: string | null;
  rating: number | null;
  reviewCount: number | null;
  website: string | null;
  phone: string | null;
  reachability: string | null;
  status: SaveLeadStatus;
}

export interface LeadsPipelineTableProps {
  rows: LeadPipelineRow[];
  discoveryId: string;
}

/** The forward "work the lead" cycle (HIDDEN is set explicitly, not cycled). */
const NEXT_STATUS: Record<SaveLeadStatus, SaveLeadStatus> = {
  NEW: "CONTACTED",
  CONTACTED: "REPLIED",
  REPLIED: "WON",
  WON: "NEW",
  LOST: "NEW",
  HIDDEN: "NEW",
};

const STATUS_ORDER: SaveLeadStatus[] = [
  "NEW",
  "CONTACTED",
  "REPLIED",
  "WON",
  "LOST",
  "HIDDEN",
];

function statusPillClass(status: SaveLeadStatus): string {
  switch (status) {
    case "NEW":
      return "bg-slate-100 text-slate-700 border-slate-200";
    case "CONTACTED":
      return "bg-indigo-50 text-indigo-700 border-indigo-200";
    case "REPLIED":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "WON":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "LOST":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-slate-50 text-slate-400 border-slate-200";
  }
}

function reachabilityChipClass(tier: string): string {
  switch (tier) {
    case "RICH":
    case "MULTI":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "PHONE_ONLY":
    case "EMAIL_ONLY":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "UNREACHABLE":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-slate-50 text-slate-500 border-slate-200";
  }
}

export function LeadsPipelineTable({
  rows,
  discoveryId,
}: LeadsPipelineTableProps) {
  // Local source-of-truth for statuses so optimistic edits survive re-renders
  // within the session (the server is the canonical store on reload).
  const [committed, setCommitted] = useState<Record<string, SaveLeadStatus>>(
    () => Object.fromEntries(rows.map((r) => [r.leadId, r.status])),
  );
  const [optimistic, applyOptimistic] = useOptimistic(
    committed,
    (state, change: { leadId: string; status: SaveLeadStatus }) => ({
      ...state,
      [change.leadId]: change.status,
    }),
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<SaveLeadStatus, number> = {
      NEW: 0,
      CONTACTED: 0,
      REPLIED: 0,
      WON: 0,
      LOST: 0,
      HIDDEN: 0,
    };
    for (const r of rows) c[optimistic[r.leadId] ?? r.status] += 1;
    return c;
  }, [rows, optimistic]);

  function setStatus(leadId: string, status: SaveLeadStatus) {
    setError(null);
    startTransition(async () => {
      applyOptimistic({ leadId, status });
      const result = await setLeadStatusAction({ leadId, status });
      if (result.status === "ok") {
        setCommitted((prev) => ({ ...prev, [leadId]: status }));
      } else {
        // Optimistic value reverts automatically when the transition ends; the
        // committed map is unchanged so the pill snaps back.
        setError("Couldn't update the lead. Try again.");
      }
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        No leads in this list yet. Add businesses from the raw list to start
        working them here.
      </div>
    );
  }

  return (
    <div>
      {/* Per-status counts */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {STATUS_ORDER.map((s) => (
          <span
            key={s}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium ${statusPillClass(s)}`}
          >
            {s.toLowerCase()}
            <b className="font-mono">{counts[s]}</b>
          </span>
        ))}
        {error ? (
          <span className="ml-auto text-xs font-medium text-red-600">
            {error}
          </span>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr className="text-left text-xs font-medium text-slate-500">
              <th className="px-3 py-2">Business</th>
              <th className="px-3 py-2">Reach</th>
              <th className="px-3 py-2 text-right">Rating</th>
              <th className="px-3 py-2 text-right">Reviews</th>
              <th className="px-3 py-2">Phone</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const status = optimistic[r.leadId] ?? r.status;
              const tier = r.reachability ?? "UNKNOWN";
              return (
                <tr
                  key={r.leadId}
                  className="border-t border-slate-100 align-top hover:bg-slate-50"
                >
                  <td className="px-3 py-2">
                    <div className="font-medium text-slate-800">{r.name}</div>
                    <div className="font-mono text-xs text-slate-400">
                      {r.category ?? "—"}
                      {r.city ? ` · ${r.city}` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${reachabilityChipClass(tier)}`}
                    >
                      {tier.toLowerCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700">
                    {r.rating != null ? r.rating.toFixed(1) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-slate-700">
                    {r.reviewCount != null
                      ? r.reviewCount.toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">
                    {r.phone ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {/* The pill advances the lead one stage on click. */}
                      <button
                        type="button"
                        onClick={() => setStatus(r.leadId, NEXT_STATUS[status])}
                        disabled={isPending}
                        title={`Advance to ${NEXT_STATUS[status].toLowerCase()}`}
                        className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-medium disabled:opacity-60 ${statusPillClass(status)}`}
                      >
                        {status.toLowerCase()}
                      </button>
                      {/* Explicit outcome setters — terminal states. */}
                      {status !== "WON" ? (
                        <button
                          type="button"
                          onClick={() => setStatus(r.leadId, "WON")}
                          disabled={isPending}
                          className="rounded border border-emerald-200 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                        >
                          won
                        </button>
                      ) : null}
                      {status !== "LOST" ? (
                        <button
                          type="button"
                          onClick={() => setStatus(r.leadId, "LOST")}
                          disabled={isPending}
                          className="rounded border border-red-200 px-1.5 py-0.5 text-[11px] font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
                        >
                          lost
                        </button>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={{
                        pathname:
                          "/discover/[discoveryId]/business/[businessId]",
                        params: { discoveryId, businessId: r.businessId },
                      }}
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-700"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
