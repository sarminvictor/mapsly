"use client";

// LeadsWorkbench · the Leads tab of the agency workbench (the heart of the
// portal). A dense, keyboard/bulk-first power table over a saved list's Lead
// rows, built on the ported prototype classes (.wb-toolbar, table.wb, .statpill,
// .bulkbar, .wbpager, .fbar/.fchip, .collapse-panel, .covline) and the adopted
// agency primitives (StatusPill, BulkActionBar).
//
// Mechanics (all client-side over plain serialized rows — Pattern 4):
//   - Search · Group-by-cell · Comfortable/Compact density · vs-cell toggle ·
//     Fields menu · Filters panel · Coverage line · sortable columns · numbered
//     pagination · row select (shift-range) + select-all-filtered · sticky bulk
//     bar (Set status / Export CSV / Clear).
//   - Status is optimistic (useOptimistic + useTransition) via setLeadStatusAction.
//
// Per .claude/rules/ui-ux-agency.md: dense, jargon-OK, numbers over adjectives,
// bulk actions mandatory. English-only copy.

import {
  useMemo,
  useOptimistic,
  useState,
  useTransition,
  type CSSProperties,
} from "react";

import { Link } from "@/i18n/navigation";
import { setLeadStatusAction } from "@/modules/discovery/save-list-actions";
import { StatusPill } from "@/modules/agency-portal/components/StatusPill";
import { BulkActionBar } from "@/modules/agency-portal/components/BulkActionBar";
import {
  COLUMNS,
  DATA_FAMILIES,
  DEFAULT_ACTIVE_COLUMNS,
  FILTER_FIELDS,
  PAGE_SIZES,
  STATUS_ORDER,
  fmtDelta,
  getPageNumbers,
  matchesSearch,
  passesFilters,
  filterLabel,
  sortRows,
  type CellBand,
  type ColumnDef,
  type LeadFilter,
  type LeadStatus,
  type NumericFilterField,
  type WorkbenchLeadRow,
} from "../leads-workbench";

export interface LeadsWorkbenchProps {
  rows: WorkbenchLeadRow[];
  discoveryId: string;
  /** vs-cell distribution bands per numeric column key (null when cohort small). */
  bands: Partial<Record<string, CellBand>>;
}

type Density = "comfortable" | "compact";

export function LeadsWorkbench({
  rows,
  discoveryId,
  bands,
}: LeadsWorkbenchProps) {
  // ── Status (optimistic) ──────────────────────────────────────────────────
  const [committed, setCommitted] = useState<Record<string, LeadStatus>>(() =>
    Object.fromEntries(rows.map((r) => [r.leadId, r.status])),
  );
  const [optimistic, applyOptimistic] = useOptimistic(
    committed,
    (state, change: { leadId: string; status: LeadStatus }) => ({
      ...state,
      [change.leadId]: change.status,
    }),
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function setStatus(leadId: string, status: LeadStatus) {
    setError(null);
    startTransition(async () => {
      applyOptimistic({ leadId, status });
      const result = await setLeadStatusAction({ leadId, status });
      if (result.status === "ok") {
        setCommitted((p) => ({ ...p, [leadId]: status }));
      } else {
        setError("Couldn't update the lead. Try again.");
      }
    });
  }

  /** Advance a lead one stage in STATUS_ORDER (wraps NEW after HIDDEN). */
  function cycleStatus(leadId: string, current: LeadStatus) {
    const i = STATUS_ORDER.indexOf(current);
    const next = STATUS_ORDER[(i + 1) % STATUS_ORDER.length];
    setStatus(leadId, next);
  }

  // ── Toolbar / view state ──────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<"none" | "cell">("none");
  const [density, setDensity] = useState<Density>("comfortable");
  const [vsCell, setVsCell] = useState(true);
  const [activeCols, setActiveCols] = useState<string[]>(
    DEFAULT_ACTIVE_COLUMNS,
  );
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);
  // Open with NO filters so the workbench shows every discovered/enriched lead
  // by default — the user adds filters from the rail. (Previously seeded with
  // the prototype's demo filters, which hid all real leads on first open,
  // especially before a signal like Lighthouse had finished enriching.)
  const [filters, setFilters] = useState<LeadFilter[]>([]);

  // ── Sort ──────────────────────────────────────────────────────────────────
  const [sortKey, setSortKey] = useState<string>("match");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(-1);
    }
  }

  // ── Pagination ──────────────────────────────────────────────────────────
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);

  // ── Selection ──────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastIdx, setLastIdx] = useState<number | null>(null);

  // The active column defs in render order.
  const cols = useMemo(
    () => COLUMNS.filter((c) => activeCols.includes(c.key)),
    [activeCols],
  );

  // ── Filtered + sorted rows ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const f = rows.filter(
      (r) => matchesSearch(r, search) && passesFilters(r, filters),
    );
    return sortRows(f, sortKey, sortDir);
  }, [rows, search, filters, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const pageRows =
    group === "cell"
      ? filtered // grouped view shows all (pagination disabled)
      : filtered.slice((curPage - 1) * pageSize, curPage * pageSize);

  // Group rows by cell (only when grouping).
  const grouped = useMemo(() => {
    if (group !== "cell") return null;
    const map = new Map<string, WorkbenchLeadRow[]>();
    for (const r of pageRows) {
      const arr = map.get(r.cell);
      if (arr) arr.push(r);
      else map.set(r.cell, [r]);
    }
    return [...map.entries()];
  }, [group, pageRows]);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );

  // ── Selection helpers ─────────────────────────────────────────────────────
  function toggleRow(leadId: string, rowIndex: number, shiftKey: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (shiftKey && lastIdx != null) {
        const [a, b] = [lastIdx, rowIndex].sort((x, y) => x - y);
        for (let i = a; i <= b; i += 1) {
          const id = pageRows[i]?.leadId;
          if (id) next.add(id);
        }
      } else if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
    setLastIdx(rowIndex);
  }

  function togglePageSelect(checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of pageRows) {
        if (checked) next.add(r.leadId);
        else next.delete(r.leadId);
      }
      return next;
    });
  }

  function selectAllFiltered() {
    setSelected(new Set(filtered.map((r) => r.leadId)));
  }

  function clearSelection() {
    setSelected(new Set());
    setLastIdx(null);
  }

  function bulkSetStatus(status: LeadStatus) {
    const ids = [...selected];
    setError(null);
    startTransition(async () => {
      for (const id of ids) applyOptimistic({ leadId: id, status });
      const results = await Promise.all(
        ids.map((id) => setLeadStatusAction({ leadId: id, status })),
      );
      const okIds = ids.filter((_, i) => results[i]?.status === "ok");
      if (okIds.length) {
        setCommitted((p) => {
          const next = { ...p };
          for (const id of okIds) next[id] = status;
          return next;
        });
      }
      if (okIds.length !== ids.length)
        setError("Some leads couldn't be updated. Try again.");
    });
  }

  function exportCsv() {
    const head = ["Business", "Address", "Match%", "Status", "Reachable"];
    const lines = filtered
      .filter((r) => selected.size === 0 || selected.has(r.leadId))
      .map((r) =>
        [
          r.name,
          r.addr,
          r.match,
          optimistic[r.leadId] ?? r.status,
          r.reachable ? "Yes" : "No",
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      );
    const csv = [head.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "leads.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Coverage (families "have" only when every visible lead has it) ─────────
  const coverage = useMemo(() => {
    const have: string[] = [];
    const notYet: string[] = [];
    for (const fam of DATA_FAMILIES) {
      const all =
        filtered.length > 0 && filtered.every((r) => r.families[fam.key]);
      if (all) have.push(fam.label);
      else notYet.push(fam.label);
    }
    return { have, notYet };
  }, [filtered]);

  // ── Fields menu helpers ───────────────────────────────────────────────────
  function toggleCol(key: string) {
    setActiveCols((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  // ── Filter editor ─────────────────────────────────────────────────────────
  function removeFilter(idx: number) {
    setFilters((prev) => prev.filter((_, i) => i !== idx));
    setPage(1);
  }
  function addFilter() {
    setFilters((prev) => [
      ...prev,
      { field: "match" as NumericFilterField, op: "≥", value: 50 },
    ]);
    setPage(1);
  }
  function editFilter(idx: number, patch: Partial<LeadFilter>) {
    setFilters((prev) =>
      prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)),
    );
    setPage(1);
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  function renderCell(col: ColumnDef, r: WorkbenchLeadRow) {
    const status = optimistic[r.leadId] ?? r.status;
    switch (col.kind) {
      case "biz":
        return (
          <td className="biz" key={col.key}>
            <span className="bizname" title={r.name}>
              {r.name}
            </span>
            <div className="addr" title={r.addr}>
              {r.addr}
            </div>
          </td>
        );
      case "match": {
        const band = bands[col.key];
        return (
          <td className="num" key={col.key}>
            <span className="cellval">{r.match}%</span>
            {vsCell && band ? renderDelta(r.match, band, true) : null}
          </td>
        );
      }
      case "pains":
        return (
          <td key={col.key}>
            {r.pains.length === 0 ? (
              <span className="ppnone">—</span>
            ) : (
              <span
                style={{ display: "inline-flex", gap: 5, flexWrap: "wrap" }}
              >
                {r.pains.slice(0, 2).map((p, i) => (
                  <span key={i} className={`ppchip ${p.group}`} title={p.title}>
                    {p.label}
                  </span>
                ))}
                {r.pains.length > 2 ? (
                  <span
                    className="ppchip more"
                    title={r.pains.map((p) => p.label).join(" · ")}
                  >
                    +{r.pains.length - 2}
                  </span>
                ) : null}
              </span>
            )}
          </td>
        );
      case "text":
        return (
          <td key={col.key}>
            {r.builtOn ?? <span className="needsenr">— enrich</span>}
          </td>
        );
      case "reach":
        return (
          <td key={col.key}>
            <span
              className={`pill ${r.reachable ? "green" : "red"} dot`}
              style={{ fontSize: "10.5px" }}
            >
              {r.reachable ? "Yes" : "No"}
            </span>
          </td>
        );
      case "num": {
        const v = numField(r, col.key);
        if (v == null)
          return (
            <td className="num" key={col.key}>
              <span className="needsenr">— enrich</span>
            </td>
          );
        const band = bands[col.key];
        const display = col.unit === "★" ? v.toFixed(1) : v.toLocaleString();
        return (
          <td className="num" key={col.key}>
            <span className="cellval">
              {display}
              {col.unit === "★" ? "★" : ""}
            </span>
            {vsCell && band
              ? renderDelta(v, band, col.higherIsBetter ?? true)
              : null}
          </td>
        );
      }
      case "contact": {
        const arr = col.key === "phones" ? r.phones : r.emails;
        if (arr.length === 0)
          return (
            <td key={col.key}>
              <span className="needsenr">— enrich</span>
            </td>
          );
        const scheme = col.key === "phones" ? "tel" : "mailto";
        return (
          <td key={col.key}>
            <a
              className="clink"
              href={`${scheme}:${arr[0]}`}
              onClick={(e) => e.stopPropagation()}
            >
              {arr[0]}
            </a>
            {arr.length > 1 ? (
              <span className="cmore" title={arr.join(" · ")}>
                +{arr.length - 1}
              </span>
            ) : null}
          </td>
        );
      }
      case "status":
        return (
          <td key={col.key} onClick={(e) => e.stopPropagation()}>
            <StatusPill
              status={status}
              disabled={isPending}
              title="Click to advance · status"
              onClick={() => cycleStatus(r.leadId, status)}
            />
          </td>
        );
      case "touch":
        return (
          <td key={col.key}>
            {r.touch === "None" ? (
              <span className="ppnone">—</span>
            ) : (
              <span className="psig">{r.touch}</span>
            )}
          </td>
        );
      default:
        return <td key={col.key} />;
    }
  }

  function renderDelta(value: number, band: CellBand, higherIsBetter: boolean) {
    const d = fmtDelta(value, band.p50, higherIsBetter);
    return <span className={`delta ${d.dir}`}>{d.text}</span>;
  }

  const colSpan = cols.length + 1; // +1 for the select column

  // The body rows (flat or grouped).
  function renderRow(r: WorkbenchLeadRow, idx: number) {
    const isSel = selected.has(r.leadId);
    return (
      <tr
        key={r.leadId}
        className={isSel ? "selrow" : undefined}
        style={
          isSel
            ? ({ background: "var(--indigo-50)" } as CSSProperties)
            : undefined
        }
      >
        <td className="sel" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            className="ck rowck"
            checked={isSel}
            aria-label={`Select ${r.name}`}
            // Toggle on CLICK only (its MouseEvent carries shiftKey for
            // range-select). onChange is a no-op required for a controlled
            // checkbox — having BOTH call toggleRow double-fired it, so every
            // click toggled then un-toggled and the box never changed.
            onChange={() => {}}
            onClick={(e) => toggleRow(r.leadId, idx, e.shiftKey)}
          />
        </td>
        {cols.map((c) => renderCell(c, r))}
      </tr>
    );
  }

  return (
    <div>
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="wb-toolbar">
        <div className="wb-search">
          <span className="si" aria-hidden="true">
            🔎
          </span>
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search leads in this set…"
            aria-label="Search leads"
          />
        </div>

        <div className="seg sm" role="group" aria-label="Group by">
          <button
            type="button"
            className={group === "cell" ? "on" : undefined}
            onClick={() => setGroup("cell")}
          >
            Group by cell
          </button>
          <button
            type="button"
            className={group === "none" ? "on" : undefined}
            onClick={() => setGroup("none")}
          >
            No groups
          </button>
        </div>

        <div className="seg sm" role="group" aria-label="Row density">
          <button
            type="button"
            className={density === "comfortable" ? "on" : undefined}
            onClick={() => setDensity("comfortable")}
          >
            Comfortable
          </button>
          <button
            type="button"
            className={density === "compact" ? "on" : undefined}
            onClick={() => setDensity("compact")}
          >
            Compact
          </button>
        </div>

        <label className={`cmptoggle${vsCell ? " on" : ""}`}>
          <input
            type="checkbox"
            checked={vsCell}
            onChange={(e) => setVsCell(e.target.checked)}
          />
          vs cell
        </label>

        <div className="pop" style={{ position: "relative" }}>
          <button
            type="button"
            className="btn sm"
            aria-haspopup="true"
            aria-expanded={fieldsOpen}
            onClick={() => setFieldsOpen((o) => !o)}
          >
            Fields ▾
          </button>
          {fieldsOpen ? (
            <div className="popmenu cols" role="menu">
              <div className="cgrp">Workflow</div>
              {COLUMNS.filter(
                (c) => c.group === "workflow" && c.key !== "biz",
              ).map((c) => (
                <label key={c.key}>
                  <input
                    type="checkbox"
                    checked={activeCols.includes(c.key)}
                    onChange={() => toggleCol(c.key)}
                  />
                  {c.label}
                </label>
              ))}
              <div className="cgrp">Already enriched — add for free</div>
              {COLUMNS.filter((c) => c.group === "enriched").map((c) => (
                <label key={c.key}>
                  <input
                    type="checkbox"
                    checked={activeCols.includes(c.key)}
                    onChange={() => toggleCol(c.key)}
                  />
                  {c.fullLabel ?? c.label}
                </label>
              ))}
            </div>
          ) : null}
        </div>

        <span className="tb-spacer" />

        <button
          type="button"
          className={`iconbtn${filters.length ? " active" : ""}`}
          aria-haspopup="true"
          aria-expanded={filtersOpen}
          aria-label="Filters"
          title="Filters"
          onClick={() => {
            setFiltersOpen((o) => !o);
            setCoverageOpen(false);
          }}
        >
          ⛛
          {filters.length ? (
            <span className="cbadge">{filters.length}</span>
          ) : null}
        </button>

        <button
          type="button"
          className="iconbtn"
          aria-haspopup="true"
          aria-expanded={coverageOpen}
          aria-label="Coverage"
          title="Coverage layers"
          onClick={() => {
            setCoverageOpen((o) => !o);
            setFiltersOpen(false);
          }}
        >
          ▤
          <span className="cbadge alt">
            {coverage.have.length}/{DATA_FAMILIES.length}
          </span>
        </button>
      </div>

      {/* ── Filters panel ─────────────────────────────────────────────────── */}
      {filtersOpen ? (
        <div className="collapse-panel">
          <div className="cp-head">
            <span className="cp-title">Filters</span>
            <button
              type="button"
              className="cp-clear"
              onClick={() => {
                setFilters([]);
                setPage(1);
              }}
            >
              Clear all
            </button>
          </div>
          <div className="cp-body">
            {filters.map((f, i) => (
              <span key={i} className="fchip data" title="Edit filter">
                <select
                  aria-label="Field"
                  value={f.field}
                  onChange={(e) =>
                    editFilter(i, {
                      field: e.target.value as NumericFilterField,
                    })
                  }
                  style={{
                    border: "none",
                    background: "transparent",
                    font: "inherit",
                  }}
                >
                  {FILTER_FIELDS.map((m) => (
                    <option key={m.field} value={m.field}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Operator"
                  value={f.op}
                  onChange={(e) =>
                    editFilter(i, { op: e.target.value as LeadFilter["op"] })
                  }
                  style={{
                    border: "none",
                    background: "transparent",
                    font: "inherit",
                  }}
                >
                  {["<", "≤", "=", "≥", ">"].map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Value"
                  type="number"
                  value={f.value}
                  onChange={(e) =>
                    editFilter(i, { value: Number(e.target.value) || 0 })
                  }
                  style={{
                    width: 56,
                    border: "none",
                    background: "transparent",
                    font: "inherit",
                  }}
                />
                <button
                  type="button"
                  className="x"
                  aria-label={`Remove ${filterLabel(f)}`}
                  onClick={() => removeFilter(i)}
                >
                  ×
                </button>
              </span>
            ))}
            <button type="button" className="add" onClick={addFilter}>
              ＋ Add filter
            </button>
          </div>
        </div>
      ) : filters.length ? (
        <div className="chipsbar">
          <span className="cb-lbl">Filters</span>
          {filters.map((f, i) => (
            <span key={i} className="fchip data">
              {filterLabel(f)}
              <button
                type="button"
                className="x"
                aria-label={`Remove ${filterLabel(f)}`}
                onClick={() => removeFilter(i)}
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            className="cb-clear"
            onClick={() => {
              setFilters([]);
              setPage(1);
            }}
          >
            Clear all
          </button>
        </div>
      ) : null}

      {/* ── Coverage panel ────────────────────────────────────────────────── */}
      {coverageOpen ? (
        <div className="collapse-panel">
          <div className="covline" aria-live="polite">
            <span className="cl-lbl">Coverage</span>
            <span className="cl-lbl" style={{ color: "var(--green)" }}>
              Have:
            </span>
            {coverage.have.length === 0 ? (
              <span className="note">—</span>
            ) : (
              coverage.have.map((label) => (
                <span key={label} className="covtag done">
                  <span className="cv">✓</span>
                  {label}
                </span>
              ))
            )}
            {coverage.notYet.length > 0 ? (
              <>
                <span className="cl-lbl" style={{ marginLeft: 6 }}>
                  Not yet:
                </span>
                {coverage.notYet.map((label) => (
                  <span key={label} className="covtag todo">
                    {label}
                  </span>
                ))}
                <Link
                  href={{
                    pathname: "/discover/[discoveryId]",
                    params: { discoveryId },
                  }}
                  className="clenrich"
                >
                  Enrich →
                </Link>
              </>
            ) : (
              <span className="note" style={{ marginLeft: "auto" }}>
                All families enriched on this set
              </span>
            )}
          </div>
        </div>
      ) : null}

      {error ? (
        <p
          role="alert"
          style={{ color: "var(--red)", fontSize: 12, margin: "4px 0" }}
        >
          {error}
        </p>
      ) : null}

      {/* ── The power table ───────────────────────────────────────────────── */}
      <div className="wbtable-wrap">
        <table className={`wb${density === "compact" ? " compact" : ""}`}>
          <thead>
            <tr>
              <th className="sel" style={{ width: 34 }}>
                <input
                  type="checkbox"
                  className="ck"
                  aria-label="Select all on this page"
                  checked={
                    pageRows.length > 0 &&
                    pageRows.every((r) => selected.has(r.leadId))
                  }
                  onChange={(e) => togglePageSelect(e.target.checked)}
                />
              </th>
              {cols.map((c) => (
                <th
                  key={c.key}
                  className={[
                    c.kind === "num" || c.kind === "match" ? "num" : "",
                    !c.sortable ? "plain" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  title={c.fullLabel ?? c.label}
                  onClick={c.sortable ? () => toggleSort(c.key) : undefined}
                  style={{ cursor: c.sortable ? "pointer" : undefined }}
                  aria-sort={
                    c.sortable && sortKey === c.key
                      ? sortDir === 1
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  {c.label}
                  {c.sortable && sortKey === c.key ? (
                    <span className="arr">{sortDir === 1 ? "▲" : "▼"}</span>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={colSpan}>
                  <div
                    className="empty"
                    style={{
                      textAlign: "center",
                      padding: "32px 0",
                      color: "var(--faint)",
                    }}
                  >
                    No leads match. Clear a filter or widen your search.
                  </div>
                </td>
              </tr>
            ) : group === "cell" && grouped ? (
              grouped.flatMap(([cell, cellRows]) => {
                const collapsed = collapsedGroups.has(cell);
                const head = (
                  <tr
                    key={`grp-${cell}`}
                    className={`grphead${collapsed ? " collapsed" : ""}`}
                    onClick={() =>
                      setCollapsedGroups((prev) => {
                        const next = new Set(prev);
                        if (next.has(cell)) next.delete(cell);
                        else next.add(cell);
                        return next;
                      })
                    }
                  >
                    <td colSpan={colSpan}>
                      <span className="gchev" aria-hidden="true">
                        ▾
                      </span>
                      {cell}
                      <span className="gc">{cellRows.length} leads</span>
                    </td>
                  </tr>
                );
                if (collapsed) return [head];
                return [
                  head,
                  ...cellRows.map((r) =>
                    renderRow(
                      r,
                      pageRows.findIndex((x) => x.leadId === r.leadId),
                    ),
                  ),
                ];
              })
            ) : (
              pageRows.map((r, i) => renderRow(r, i))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination (hidden when grouped) ───────────────────────────────── */}
      {group === "none" && filtered.length > 0 ? (
        <div
          className="wbpager"
          role="navigation"
          aria-label="Table pagination"
        >
          <div className="pg-left">
            <span>Show</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              aria-label="Rows per page"
            >
              {PAGE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <span>of {filtered.length}</span>
            <span className="pg-range">
              {(curPage - 1) * pageSize + 1}–
              {Math.min(curPage * pageSize, filtered.length)} of{" "}
              {filtered.length}
            </span>
          </div>
          {totalPages > 1 ? (
            <div className="pg-pages">
              <button
                type="button"
                className="pgnav"
                onClick={() => setPage(curPage - 1)}
                disabled={curPage <= 1}
                aria-label="Previous page"
              >
                ‹
              </button>
              {getPageNumbers(curPage, totalPages).map((p, i) =>
                p === "ellipsis" ? (
                  <span key={`e${i}`} className="pgnum ell" aria-hidden="true">
                    …
                  </span>
                ) : (
                  <button
                    key={p}
                    type="button"
                    className={`pgnum${p === curPage ? " on" : ""}`}
                    onClick={() => setPage(p)}
                    aria-current={p === curPage ? "page" : undefined}
                  >
                    {p}
                  </button>
                ),
              )}
              <button
                type="button"
                className="pgnav"
                onClick={() => setPage(curPage + 1)}
                disabled={curPage >= totalPages}
                aria-label="Next page"
              >
                ›
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Bulk bar ──────────────────────────────────────────────────────── */}
      <BulkActionBar
        selectedCount={selected.size}
        selectAll={
          selected.size < filtered.length
            ? {
                label: `Select all ${filtered.length} filtered`,
                onClick: selectAllFiltered,
              }
            : null
        }
      >
        <BulkStatusButton onPick={bulkSetStatus} />
        <button type="button" className="bb" onClick={exportCsv}>
          Export CSV
        </button>
        <button type="button" className="bb" onClick={clearSelection}>
          Clear
        </button>
      </BulkActionBar>
    </div>
  );
}

function numField(r: WorkbenchLeadRow, key: string): number | null {
  switch (key) {
    case "reviews":
      return r.reviews;
    case "rating":
      return r.rating;
    case "perf":
      return r.perf;
    default:
      return null;
  }
}

/** A "Set status ▾" bulk button with a small popover over STATUS_ORDER. */
function BulkStatusButton({ onPick }: { onPick: (s: LeadStatus) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative" }}>
      <button
        type="button"
        className="bb primary"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Set status ▾
      </button>
      {open ? (
        <div
          className="popmenu"
          role="menu"
          style={{ position: "absolute", bottom: "calc(100% + 6px)", right: 0 }}
        >
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              role="menuitem"
              className="statpill"
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                margin: "2px 0",
              }}
              onClick={() => {
                onPick(s);
                setOpen(false);
              }}
            >
              <span className={`statpill st-${s}`}>{s}</span>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
