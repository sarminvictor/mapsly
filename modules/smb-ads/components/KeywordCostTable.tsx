"use client";

// SMB /ads · GOOGLE block · "What these searches cost" table.
//
// Client component so Maria can re-sort by any column (service / searches /
// cost-per-click / competition). Defaults to searches (volume) DESC — the
// busiest searches first. Rank #1 best-value row is highlighted (★). Columns:
// Service · Searches/mo · Cost per click · Competition. No "Top bid range" and
// NO "# competitors" column (we don't have that data). Plain English, no jargon
// (ui-ux-smb). All copy arrives as plain string props — the only state is local
// sort, no function crosses a server boundary (this whole file is client).

import * as React from "react";
import type { AdKeywordCost, CompetitionBucket } from "../types";

export interface KeywordCostTableLabels {
  colService: string;
  colSearches: string;
  colCpc: string;
  colCompetition: string;
  bestBadge: string;
  compLow: string;
  compMedium: string;
  compHigh: string;
  empty: string;
  /** Aria-label template "Sort by {column}". */
  sortAriaTemplate: string;
}

type SortField = "keyword" | "searchVolume" | "cpc" | "competition";
type SortDir = "asc" | "desc";

function compText(
  b: CompetitionBucket | null,
  l: KeywordCostTableLabels,
): string {
  if (b === "LOW") return l.compLow;
  if (b === "MEDIUM") return l.compMedium;
  if (b === "HIGH") return l.compHigh;
  return "—";
}

function compTone(b: CompetitionBucket | null): { bg: string; fg: string } {
  if (b === "LOW")
    return {
      bg: "var(--color-success-bg, #e6f4ec)",
      fg: "var(--color-success, #2d8659)",
    };
  if (b === "HIGH")
    return { bg: "rgba(195,85,58,0.12)", fg: "var(--color-coral)" };
  return { bg: "var(--color-bg-3)", fg: "var(--color-text-2)" };
}

/** Rank score for competition so the sort is Low < Medium < High (asc). */
function compRank(b: CompetitionBucket | null): number {
  if (b === "LOW") return 0;
  if (b === "MEDIUM") return 1;
  if (b === "HIGH") return 2;
  return 3; // unknown sinks to the end
}

function usd(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}`;
}

/** Nulls sink to the end regardless of direction · "no data" always last. */
function compareNullable(
  a: number | null,
  b: number | null,
  dir: SortDir,
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir === "asc" ? a - b : b - a;
}

function sortRows(
  rows: readonly AdKeywordCost[],
  field: SortField,
  dir: SortDir,
): AdKeywordCost[] {
  const arr = [...rows];
  arr.sort((a, b) => {
    if (field === "keyword") {
      const c = a.keyword.localeCompare(b.keyword);
      return dir === "asc" ? c : -c;
    }
    if (field === "searchVolume") {
      return compareNullable(a.searchVolume, b.searchVolume, dir);
    }
    if (field === "cpc") {
      return compareNullable(a.cpc, b.cpc, dir);
    }
    // competition · Low → High when asc
    const ar = compRank(a.competition);
    const br = compRank(b.competition);
    return dir === "asc" ? ar - br : br - ar;
  });
  return arr;
}

export function KeywordCostTable({
  rows,
  bestKeyword,
  labels,
}: {
  rows: AdKeywordCost[];
  bestKeyword: string | null;
  labels: KeywordCostTableLabels;
}) {
  // Default · busiest searches first (volume desc), the most useful view.
  const [sort, setSort] = React.useState<SortField>("searchVolume");
  const [dir, setDir] = React.useState<SortDir>("desc");

  const sorted = React.useMemo(
    () => sortRows(rows, sort, dir),
    [rows, sort, dir],
  );

  const handleSort = (field: SortField) => {
    if (field === sort) {
      setDir(dir === "asc" ? "desc" : "asc");
    } else {
      setSort(field);
      // Competition defaults to asc (Low first); the rest default desc
      // (more searches / higher cost on top), keyword asc (A→Z).
      setDir(field === "competition" || field === "keyword" ? "asc" : "desc");
    }
  };

  if (rows.length === 0) {
    return (
      <p style={{ color: "var(--color-text-2)", fontSize: 15, margin: 0 }}>
        {labels.empty}
      </p>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}
      >
        <thead>
          <tr>
            <SortableTh
              field="keyword"
              label={labels.colService}
              currentField={sort}
              currentDir={dir}
              onSort={handleSort}
              ariaTemplate={labels.sortAriaTemplate}
            />
            <SortableTh
              field="searchVolume"
              label={labels.colSearches}
              currentField={sort}
              currentDir={dir}
              onSort={handleSort}
              ariaTemplate={labels.sortAriaTemplate}
              align="right"
            />
            <SortableTh
              field="cpc"
              label={labels.colCpc}
              currentField={sort}
              currentDir={dir}
              onSort={handleSort}
              ariaTemplate={labels.sortAriaTemplate}
              align="right"
            />
            <SortableTh
              field="competition"
              label={labels.colCompetition}
              currentField={sort}
              currentDir={dir}
              onSort={handleSort}
              ariaTemplate={labels.sortAriaTemplate}
              align="right"
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const best = r.keyword === bestKeyword;
            const tone = compTone(r.competition);
            return (
              <tr
                key={r.keyword}
                style={{
                  background: best ? "rgba(195,85,58,0.06)" : "transparent",
                }}
              >
                <td
                  style={{
                    padding: "10px 12px",
                    borderBottom: "1px solid var(--color-border)",
                    color: "var(--color-text)",
                    textTransform: "capitalize",
                    fontWeight: best ? 700 : 500,
                  }}
                >
                  {r.keyword}
                  {best ? (
                    <span
                      style={{
                        marginLeft: 8,
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: "var(--color-coral)",
                        fontFamily: "var(--font-mono)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      ★ {labels.bestBadge}
                    </span>
                  ) : null}
                </td>
                <td style={cellNum}>
                  {r.searchVolume != null
                    ? r.searchVolume.toLocaleString("en-US")
                    : "—"}
                </td>
                <td style={cellNum}>{usd(r.cpc)}</td>
                <td style={{ ...cellNum, textAlign: "right" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: tone.bg,
                      color: tone.fg,
                      fontSize: 11.5,
                      fontWeight: 600,
                    }}
                  >
                    {compText(r.competition, labels)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SortableTh({
  field,
  label,
  currentField,
  currentDir,
  onSort,
  ariaTemplate,
  align,
}: {
  field: SortField;
  label: string;
  currentField: SortField;
  currentDir: SortDir;
  onSort: (f: SortField) => void;
  ariaTemplate: string;
  align?: "left" | "right";
}) {
  const active = currentField === field;
  const indicator = active ? (currentDir === "asc" ? " ↑" : " ↓") : "";
  return (
    <th
      scope="col"
      style={{
        textAlign: align ?? "left",
        padding: "8px 12px",
        fontFamily: "var(--font-mono)",
        fontSize: 10.5,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--color-text-3)",
        borderBottom: "1px solid var(--color-border)",
        whiteSpace: "nowrap",
      }}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        aria-label={ariaTemplate.replace("{column}", label)}
        style={{
          all: "unset",
          cursor: "pointer",
          color: active ? "var(--color-text)" : "var(--color-text-3)",
          fontFamily: "inherit",
          fontSize: "inherit",
          fontWeight: 700,
          letterSpacing: "inherit",
          textTransform: "inherit",
        }}
      >
        {label}
        {indicator}
      </button>
    </th>
  );
}

const cellNum: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--color-border)",
  color: "var(--color-text)",
  textAlign: "right",
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
};
