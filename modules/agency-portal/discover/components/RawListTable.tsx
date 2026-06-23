"use client";

// RawListTable · the dense Raw List result table (Phase 9). One row per raw
// business with select checkbox, name + category, reachability chip, rating,
// reviews, website, phone, metro, a 9-dot enrichment-state strip, and an Open
// affordance. Multi-select drives a sticky bulk-action bar ("Enrich selected" +
// "Save as list"); discovery-time chips (has website / reachability / min
// rating) filter the loaded rows client-side. Opening Enrich slides in the
// `<EnrichPanel>`. Per `.claude/rules/ui-ux-agency.md`: dense, indigo accent,
// numbers over adjectives, imperative actions. Copy is English-only for now.

import { useMemo, useState } from "react";

import { Link } from "@/i18n/navigation";
import { ALL_ENRICHMENT_TYPES } from "@/modules/cost/pricing";
import {
  applyClientFilters,
  type ClientFilters,
  type ReachabilityTier,
} from "../raw-list-filter";
import { EnrichPanel } from "./EnrichPanel";

/** Serialized row the table renders — plain data only (no function props). */
export interface RawListTableRow {
  id: string;
  name: string;
  category: string | null;
  city: string | null;
  province: string | null;
  metroSlug: string | null;
  rating: number | null;
  reviewCount: number | null;
  website: string | null;
  phone: string | null;
  reachability: string | null;
  reachableChannelCount: number | null;
  /**
   * Optional per-business enrichment state (family key → present). Unknown
   * families render as hollow dots. When absent, all 9 dots render hollow.
   */
  enrichmentState?: Record<string, boolean> | null;
}

export interface RawListTableProps {
  rows: RawListTableRow[];
  /** Cells the raw list spans (passed through to the enrich panel). */
  cellKeys: string[];
  /** Cursor for the next page (null at end) — surfaced as a hint for now. */
  nextCursor?: string | null;
  /** Agency wallet balance in USD (optional — gates the enrich run). */
  walletUsd?: number;
}

const REACHABILITY_TIERS: ReachabilityTier[] = [
  "RICH",
  "MULTI",
  "PHONE_ONLY",
  "EMAIL_ONLY",
  "UNREACHABLE",
  "UNKNOWN",
];

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

/** A 9-dot strip — one dot per enrichment family, filled if present. */
function EnrichmentDots({ state }: { state?: Record<string, boolean> | null }) {
  return (
    <span
      className="inline-flex items-center gap-0.5"
      aria-label="Enrichment state"
    >
      {ALL_ENRICHMENT_TYPES.map((key) => {
        const filled = state?.[key] === true;
        return (
          <span
            key={key}
            title={key}
            aria-hidden
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              filled ? "bg-indigo-500" : "border border-slate-300 bg-white"
            }`}
          />
        );
      })}
    </span>
  );
}

export function RawListTable({
  rows,
  cellKeys,
  nextCursor,
  walletUsd,
}: RawListTableProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<ClientFilters>({});
  const [enrichOpen, setEnrichOpen] = useState(false);

  const visibleRows = useMemo(
    () => applyClientFilters(rows, filters),
    [rows, filters],
  );

  const allVisibleSelected =
    visibleRows.length > 0 && visibleRows.every((r) => selected.has(r.id));

  const selectedIds = useMemo(
    () => visibleRows.filter((r) => selected.has(r.id)).map((r) => r.id),
    [visibleRows, selected],
  );

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const r of visibleRows) next.delete(r.id);
      } else {
        for (const r of visibleRows) next.add(r.id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setEnrichOpen(false);
  }

  const reachActive = filters.reachability ?? [];

  function toggleReach(tier: ReachabilityTier) {
    setFilters((f) => {
      const cur = f.reachability ?? [];
      const next = cur.includes(tier)
        ? cur.filter((t) => t !== tier)
        : [...cur, tier];
      return { ...f, reachability: next };
    });
  }

  return (
    <div className="flex gap-4">
      <div className="min-w-0 flex-1">
        {/* Discovery-time filter chips */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setFilters((f) => ({ ...f, hasWebsite: !f.hasWebsite }))
            }
            className={`rounded-full border px-3 py-1 text-xs font-medium ${
              filters.hasWebsite
                ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
            }`}
          >
            Has website
          </button>

          <span className="ml-1 font-mono text-xs text-slate-400">
            rating ≥
          </span>
          {[3, 4, 4.5].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() =>
                setFilters((f) => ({
                  ...f,
                  minRating: f.minRating === r ? undefined : r,
                }))
              }
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                filters.minRating === r
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              {r}
            </button>
          ))}

          <span className="ml-1 font-mono text-xs text-slate-400">reach</span>
          {REACHABILITY_TIERS.map((tier) => (
            <button
              key={tier}
              type="button"
              onClick={() => toggleReach(tier)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
                reachActive.includes(tier)
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
              }`}
            >
              {tier.toLowerCase()}
            </button>
          ))}

          <span className="ml-auto font-mono text-xs text-slate-400">
            {visibleRows.length} / {rows.length} shown
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="text-left text-xs font-medium text-slate-500">
                <th className="w-10 px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label="Select all visible"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-500"
                  />
                </th>
                <th className="px-3 py-2">Business</th>
                <th className="px-3 py-2">Reach</th>
                <th className="px-3 py-2 text-right">Rating</th>
                <th className="px-3 py-2 text-right">Reviews</th>
                <th className="px-3 py-2">Web</th>
                <th className="px-3 py-2">Phone</th>
                <th className="px-3 py-2">Metro</th>
                <th className="px-3 py-2">Enrichment</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-3 py-8 text-center text-sm text-slate-500"
                  >
                    No businesses match these filters. Adjust the chips above.
                  </td>
                </tr>
              ) : (
                visibleRows.map((r) => {
                  const tier = r.reachability ?? "UNKNOWN";
                  const isSel = selected.has(r.id);
                  return (
                    <tr
                      key={r.id}
                      className={`border-t border-slate-100 ${
                        isSel ? "bg-indigo-50/40" : "hover:bg-slate-50"
                      }`}
                    >
                      <td className="px-3 py-2 align-top">
                        <input
                          type="checkbox"
                          aria-label={`Select ${r.name}`}
                          checked={isSel}
                          onChange={() => toggleRow(r.id)}
                          className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-500"
                        />
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium text-slate-800">
                          {r.name}
                        </div>
                        <div className="font-mono text-xs text-slate-400">
                          {r.category ?? "—"}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${reachabilityChipClass(tier)}`}
                        >
                          {tier.toLowerCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right align-top font-mono text-slate-700">
                        {r.rating != null ? r.rating.toFixed(1) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right align-top font-mono text-slate-700">
                        {r.reviewCount != null
                          ? r.reviewCount.toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {r.website ? (
                          <span
                            className="text-emerald-600"
                            title={r.website}
                            aria-label="Has website"
                          >
                            ●
                          </span>
                        ) : (
                          <span
                            className="text-slate-300"
                            aria-label="No website"
                          >
                            ○
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top font-mono text-xs text-slate-600">
                        {r.phone ?? "—"}
                      </td>
                      <td className="px-3 py-2 align-top font-mono text-xs text-slate-500">
                        {r.metroSlug ?? "—"}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <EnrichmentDots state={r.enrichmentState} />
                      </td>
                      <td className="px-3 py-2 text-right align-top">
                        <Link
                          href={{
                            pathname: "/prospect/[businessId]",
                            params: { businessId: r.id },
                          }}
                          className="text-xs font-medium text-indigo-600 hover:underline"
                        >
                          Open →
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {nextCursor ? (
          <p className="mt-2 font-mono text-xs text-slate-400">
            More rows available — pagination loads on scroll (follow-up).
          </p>
        ) : null}

        {/* Sticky bulk-action bar */}
        {selectedIds.length > 0 ? (
          <div className="sticky bottom-0 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/95 p-3 backdrop-blur">
            <span className="text-sm text-slate-700">
              <b>{selectedIds.length}</b> selected
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={clearSelection}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Clear
              </button>
              {/* Save-as-list is a stub until the list-save action lands. */}
              <button
                type="button"
                disabled
                title="Save as list — coming soon"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-400"
              >
                Save as list
              </button>
              <button
                type="button"
                onClick={() => setEnrichOpen(true)}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Enrich selected ({selectedIds.length})
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Enrich slide-over */}
      {enrichOpen && selectedIds.length > 0 ? (
        <EnrichPanel
          businessIds={selectedIds}
          cellKeys={cellKeys}
          walletUsd={walletUsd}
          onClose={() => setEnrichOpen(false)}
        />
      ) : null}
    </div>
  );
}
