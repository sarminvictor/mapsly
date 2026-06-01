"use client";

// S.6.4 · client-rendered cell-wide visibility table with local
// sort/filter/page state. All keywords for the cell come down once
// (capped at 500), client handles everything in-memory for smooth UX
// (no scroll-to-top, no full re-renders, no router round-trip).
//
// Boxly-pattern table (boxly_app/.../SearchVisibilityPage.tsx). Maria
// sees: Keyword · Searches/mo · Maps · Search. Color-coded rank pills
// (green ≤3, amber ≤10, gray below). "your service" badge for rows
// where her templateOrigin = "service".

import * as React from "react";

import type { CellKeywordTableRow } from "../cell-keyword-table";

export interface KeywordVisibilityTableLabels {
  /** "How customers search for {industry} in {city}" · {industry} and
   *  {city} replaced server-side. */
  heading: string;
  /** "{total} total · click headers to sort." · {total} replaced
   *  client-side as the filter toggles. */
  subtitle: string;
  colKeyword: string;
  colSearches: string;
  colMaps: string;
  colOrganic: string;
  /** "your service" pill copy. */
  serviceBadge: string;
  /** Empty state when the cell pool is empty (rare). */
  empty: string;
  /** Empty state when filter "show only when I rank" hides all rows. */
  emptyFiltered: string;
  /** "Position colors: green = top 3, amber = top 10, gray = below 10." */
  legend: string;
  /** Aria-label template "Sort by {column}". */
  sortAriaTemplate: string;
  /** Toggle label · "Showing only where I rank" (state ON). */
  filterToggleOn: string;
  /** Toggle label · "Showing all keywords" (state OFF). */
  filterToggleOff: string;
  /** "Page {page} of {total}" · both replaced client-side. */
  pageOfTotal: string;
  prev: string;
  next: string;
}

export interface KeywordVisibilityTableProps {
  rows: readonly CellKeywordTableRow[];
  labels: KeywordVisibilityTableLabels;
}

type SortField = "keyword" | "searchVolume" | "mapsRank" | "organicRank";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 10;

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US");
}

function rankColor(rank: number | null): string {
  if (rank == null) return "var(--color-text-3)";
  if (rank <= 3) return "var(--color-success, #2d8659)";
  if (rank <= 10) return "var(--color-gold, #d4a574)";
  return "var(--color-text-2)";
}

function comparePosition(
  a: number | null,
  b: number | null,
  dir: SortDir,
): number {
  // Nulls sink regardless of direction · "not ranked" always at end.
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir === "asc" ? a - b : b - a;
}

function sortRows(
  rows: readonly CellKeywordTableRow[],
  field: SortField,
  dir: SortDir,
): CellKeywordTableRow[] {
  const arr = [...rows];
  arr.sort((a, b) => {
    if (field === "keyword") {
      const c = a.keyword.localeCompare(b.keyword);
      return dir === "asc" ? c : -c;
    }
    if (field === "searchVolume") {
      const av = a.searchVolume ?? 0;
      const bv = b.searchVolume ?? 0;
      return dir === "asc" ? av - bv : bv - av;
    }
    if (field === "mapsRank") {
      return comparePosition(a.mapsRank, b.mapsRank, dir);
    }
    return comparePosition(a.organicRank, b.organicRank, dir);
  });
  return arr;
}

export function KeywordVisibilityTable({
  rows,
  labels,
}: KeywordVisibilityTableProps) {
  // Default state · filter ON (show only where Maria ranks), sort by
  // volume desc, page 1.
  const [sort, setSort] = React.useState<SortField>("searchVolume");
  const [dir, setDir] = React.useState<SortDir>("desc");
  const [showAll, setShowAll] = React.useState(false);
  const [page, setPage] = React.useState(1);

  // Reset to page 1 when the filter/sort changes — adjusted during render
  // (not in an effect) so we never land on an empty page and never trigger a
  // cascading-render effect.
  const filterKey = `${showAll}|${sort}|${dir}`;
  const [prevFilterKey, setPrevFilterKey] = React.useState(filterKey);
  if (prevFilterKey !== filterKey) {
    setPrevFilterKey(filterKey);
    setPage(1);
  }

  // Derived state · filter then sort then paginate.
  const filtered = React.useMemo(
    () =>
      showAll
        ? rows
        : rows.filter((r) => r.mapsRank != null || r.organicRank != null),
    [rows, showAll],
  );
  const sorted = React.useMemo(
    () => sortRows(filtered, sort, dir),
    [filtered, sort, dir],
  );
  const totalRows = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const visible = React.useMemo(
    () => sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [sorted, safePage],
  );

  const handleSort = (field: SortField) => {
    if (field === sort) {
      setDir(dir === "asc" ? "desc" : "asc");
    } else {
      setSort(field);
      // Rank columns default asc (rank 1 is best); volume/keyword desc.
      setDir(field === "mapsRank" || field === "organicRank" ? "asc" : "desc");
    }
  };

  // Empty states · differentiate "no cell pool" from "filter hid all".
  if (rows.length === 0) {
    return (
      <Shell labels={labels}>
        <p style={mutedParagraphStyle}>{labels.empty}</p>
      </Shell>
    );
  }
  if (totalRows === 0) {
    return (
      <Shell labels={labels}>
        <p style={mutedParagraphStyle}>{labels.emptyFiltered}</p>
        <div style={{ padding: "0 24px 14px" }}>
          <FilterSwitch
            showAll={showAll}
            onChange={setShowAll}
            labels={labels}
          />
        </div>
      </Shell>
    );
  }

  return (
    <Shell
      labels={labels}
      subtitleOverride={labels.subtitle.replace("{total}", fmt(totalRows))}
    >
      {/* Toolbar above table · filter toggle left, pagination right.
          Same row so the user's eye finds both controls together. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px 12px",
          gap: 12,
        }}
      >
        <FilterSwitch showAll={showAll} onChange={setShowAll} labels={labels} />
        {totalPages > 1 ? (
          <Pagination
            page={safePage}
            totalPages={totalPages}
            onPrev={() => setPage(safePage - 1)}
            onNext={() => setPage(safePage + 1)}
            labels={labels}
          />
        ) : null}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
        >
          <thead>
            <tr style={{ background: "var(--color-bg-3, #ece3d6)" }}>
              <SortableTh
                field="keyword"
                label={labels.colKeyword}
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
                field="mapsRank"
                label={labels.colMaps}
                currentField={sort}
                currentDir={dir}
                onSort={handleSort}
                ariaTemplate={labels.sortAriaTemplate}
                align="center"
              />
              <SortableTh
                field="organicRank"
                label={labels.colOrganic}
                currentField={sort}
                currentDir={dir}
                onSort={handleSort}
                ariaTemplate={labels.sortAriaTemplate}
                align="center"
              />
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={row.id}
                style={{
                  borderTop: "1px solid var(--color-border)",
                  background: row.isServiceKeyword
                    ? "rgba(45, 134, 89, 0.04)"
                    : "transparent",
                }}
              >
                <Td>
                  <span style={{ color: "var(--color-text)" }}>
                    {row.keyword}
                  </span>
                  {row.isServiceKeyword ? (
                    <span style={serviceBadgeStyle}>{labels.serviceBadge}</span>
                  ) : null}
                </Td>
                <Td align="right">
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      color: "var(--color-text-2)",
                    }}
                  >
                    {fmt(row.searchVolume)}
                  </span>
                </Td>
                <Td align="center">
                  <RankPill rank={row.mapsRank} />
                </Td>
                <Td align="center">
                  <RankPill rank={row.organicRank} />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <footer
        style={{
          padding: "10px 24px 6px",
          borderTop: "1px solid var(--color-border)",
        }}
      >
        <p
          style={{
            margin: 0,
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--color-text-3)",
            lineHeight: 1.5,
          }}
        >
          {labels.legend}
        </p>
      </footer>
    </Shell>
  );
}

// ---- sub-components -------------------------------------------------------

function Shell({
  labels,
  subtitleOverride,
  children,
}: {
  labels: KeywordVisibilityTableLabels;
  subtitleOverride?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby="visibility-table-heading" style={tableShellStyle}>
      <header style={{ padding: "0 24px 12px" }}>
        <h2 id="visibility-table-heading" style={headingStyle}>
          {labels.heading}
        </h2>
        <p style={subtitleStyle}>
          {subtitleOverride ?? labels.subtitle.replace("{total}", "—")}
        </p>
      </header>
      {children}
    </section>
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
  align?: "left" | "right" | "center";
}) {
  const active = currentField === field;
  // Arrow convention: keyword + searchVolume use the standard
  // "asc = ↑ (low to high)". Maps + Search rank columns INVERT
  // because rank #1 is the BEST · "best at top" reads as ↓ (going
  // down into worse) like Search Console / Ahrefs / SEMRush.
  const isRankCol = field === "mapsRank" || field === "organicRank";
  let indicator = "";
  if (active) {
    if (isRankCol) {
      indicator = currentDir === "asc" ? " ↓" : " ↑";
    } else {
      indicator = currentDir === "asc" ? " ↑" : " ↓";
    }
  }
  return (
    <th
      style={{
        padding: "10px 14px",
        textAlign: align ?? "left",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--color-text-3)",
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
          fontWeight: "inherit",
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

function PageBtn({
  disabled,
  onClick,
  label,
}: {
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      style={{
        padding: "4px 10px",
        borderRadius: 8,
        border: "1px solid var(--color-border)",
        fontSize: 12,
        fontFamily: "inherit",
        cursor: disabled ? "default" : "pointer",
        color: disabled ? "var(--color-text-3)" : "var(--color-text)",
        background: disabled ? "var(--color-bg-3)" : "var(--color-bg-2)",
      }}
    >
      {label}
    </button>
  );
}

function FilterSwitch({
  showAll,
  onChange,
  labels,
}: {
  showAll: boolean;
  onChange: (next: boolean) => void;
  labels: KeywordVisibilityTableLabels;
}) {
  // Switch state: ON = filtering = showing only where I rank.
  // (showAll prop is the URL state · we invert for display.)
  const on = !showAll;
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <input
        type="checkbox"
        checked={on}
        onChange={(e) => onChange(!e.currentTarget.checked)}
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0,0,0,0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
        aria-label={on ? labels.filterToggleOn : labels.filterToggleOff}
      />
      <span
        aria-hidden="true"
        style={{
          position: "relative",
          display: "inline-block",
          width: 34,
          height: 20,
          borderRadius: 999,
          background: on
            ? "var(--color-success, #2d8659)"
            : "var(--color-bg-3, #ece3d6)",
          border: `1px solid ${on ? "var(--color-success, #2d8659)" : "var(--color-border)"}`,
          transition: "background 150ms ease, border-color 150ms ease",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 1,
            left: on ? 15 : 1,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "#ffffff",
            boxShadow: "0 1px 2px rgba(28, 25, 22, 0.2)",
            transition: "left 150ms ease",
          }}
        />
      </span>
      <span
        style={{
          fontSize: 12.5,
          fontFamily: "var(--font-mono)",
          color: on ? "var(--color-text)" : "var(--color-text-2)",
          fontWeight: 600,
        }}
      >
        {on ? labels.filterToggleOn : labels.filterToggleOff}
      </span>
    </label>
  );
}

function Pagination({
  page,
  totalPages,
  onPrev,
  onNext,
  labels,
}: {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
  labels: KeywordVisibilityTableLabels;
}) {
  return (
    <nav
      aria-label="pagination"
      style={{ display: "flex", alignItems: "center", gap: 8 }}
    >
      <PageBtn disabled={page <= 1} onClick={onPrev} label={labels.prev} />
      <span
        style={{
          fontSize: 11.5,
          fontFamily: "var(--font-mono)",
          color: "var(--color-text-2)",
          whiteSpace: "nowrap",
        }}
      >
        {labels.pageOfTotal
          .replace("{page}", fmt(page))
          .replace("{total}", fmt(totalPages))}
      </span>
      <PageBtn
        disabled={page >= totalPages}
        onClick={onNext}
        label={labels.next}
      />
    </nav>
  );
}

function Td({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "left" | "right" | "center";
}) {
  return (
    <td
      style={{
        padding: "10px 14px",
        textAlign: align ?? "left",
        verticalAlign: "middle",
      }}
    >
      {children}
    </td>
  );
}

function RankPill({ rank }: { rank: number | null }) {
  const color = rankColor(rank);
  if (rank == null) {
    return <span style={{ color, fontFamily: "var(--font-mono)" }}>—</span>;
  }
  return (
    <span
      style={{
        display: "inline-block",
        minWidth: 32,
        padding: "2px 8px",
        borderRadius: 999,
        background:
          rank <= 3
            ? "rgba(45, 134, 89, 0.1)"
            : rank <= 10
              ? "rgba(212, 165, 116, 0.15)"
              : "var(--color-bg-3, #ece3d6)",
        color,
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      #{rank}
    </span>
  );
}

// ---- shared styles --------------------------------------------------------

const tableShellStyle: React.CSSProperties = {
  background: "var(--color-bg-2)",
  border: "1px solid var(--color-border)",
  borderRadius: 14,
  padding: "16px 0 12px",
  marginBottom: 24,
  boxShadow: "0 2px 8px rgba(28, 25, 22, 0.04)",
  overflow: "hidden",
};

const headingStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: "var(--font-serif)",
  fontSize: 18,
  letterSpacing: "-0.01em",
  color: "var(--color-text)",
};

const subtitleStyle: React.CSSProperties = {
  margin: "4px 0 0",
  fontSize: 12.5,
  color: "var(--color-text-2)",
};

const mutedParagraphStyle: React.CSSProperties = {
  margin: "10px 24px",
  color: "var(--color-text-2)",
  fontSize: 13,
  lineHeight: 1.5,
};

const serviceBadgeStyle: React.CSSProperties = {
  marginLeft: 8,
  padding: "2px 7px",
  borderRadius: 999,
  background: "rgba(45, 134, 89, 0.1)",
  color: "var(--color-success, #2d8659)",
  fontFamily: "var(--font-mono)",
  fontSize: 10,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};
