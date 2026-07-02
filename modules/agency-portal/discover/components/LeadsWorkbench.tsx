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
  useCallback,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Icon } from "@/components/agency/Icon";
import { showToast } from "@/components/agency/Toast";
import {
  DEFAULT_SORT_DIR,
  DEFAULT_SORT_KEY,
  loadWorkbenchView,
  parseViewFromSearchParams,
  saveWorkbenchView,
  viewToSearchParams,
} from "../wb-view-state";
import {
  setLeadStatusAction,
  setLeadStatusBulkAction,
} from "@/modules/discovery/save-list-actions";
import { StatusPill } from "@/modules/agency-portal/components/StatusPill";
import { BulkActionBar } from "@/modules/agency-portal/components/BulkActionBar";
import { BulkGenerateTouchesButton } from "./BulkGenerateTouchesButton";
import { LeadDrawer } from "./LeadDrawer";
import {
  COLUMNS,
  CSV_HEADERS,
  DATA_FAMILIES,
  DEFAULT_ACTIVE_COLUMNS,
  FILTER_FIELDS,
  FILTER_FIELD_DEFAULTS,
  PAGE_SIZES,
  STATUS_ORDER,
  buildSignalColumns,
  csvLine,
  fmtDelta,
  getPageNumbers,
  matchesSearch,
  passesFilters,
  filterLabel,
  rowToCsvRecord,
  sortRows,
  type CellBand,
  type ColumnDef,
  type DataFamily,
  type LeadFilter,
  type NumericLeadFilter,
  type LeadStatus,
  type NumericFilterField,
  type WorkbenchLeadRow,
} from "../leads-workbench";
import { enrichTypesForFamilies } from "../family-coverage";
import { openEnrichSheet } from "../enrich-sheet-bus";
import { THIN_MARKET_THRESHOLD } from "../flow-types";
import type { EnrichmentType } from "@/modules/cost/pricing";
import { FieldFunnel, FieldsMenuLockedRows } from "./FieldsMenuExtras";

/** WP7-13 · a stable empty-bands object for the thin-market path (no vs-cell
 *  percentiles → the workbench renders absolute values). Module-level so the
 *  reference is stable across renders. */
const EMPTY_BANDS: Partial<Record<string, CellBand>> = {};

export interface LeadsWorkbenchProps {
  rows: WorkbenchLeadRow[];
  discoveryId: string;
  /** vs-cell distribution bands per numeric column key (null when cohort small). */
  bands: Partial<Record<string, CellBand>>;
  /**
   * Per-business COVERED families from the batched coverage matrix
   * (GET /research/:id/coverage), fetched server-side and passed as a plain map
   * (Pattern 4 — no functions cross the boundary). Drives the per-row dot-strip.
   * A business missing from the map falls back to its row's own `families`
   * (both derive from the same `deriveFamilyCoverage` source of truth).
   */
  coverage: Record<string, DataFamily[]>;
  /**
   * The signals chosen on the Goal step (SIG_META key + title). Rendered as
   * one column per signal, right after Match % (docs/portal-prototype.html's
   * goalCols/makeSigCol) — reading `row.perSignal[key]` for the verdict. We
   * do NOT use these to auto-FILTER the row set: a signal still mid-
   * enrichment would otherwise silently hide real, not-yet-enriched leads.
   */
  goalSignals?: { key: string; title: string }[];
  /**
   * CSV filename base "{categorySlug}-{metroSlug}" resolved server-side from
   * the discovery's first cell (WP2-4). The export appends the date:
   * "med_spa-miami-2026-07-01.csv". Falls back to "leads-{date}.csv".
   */
  exportSlug?: string;
  /**
   * Server pagination (WP4-4). `rows` is ONE window of the whole set
   * (WORKBENCH_WINDOW rows, ordered server-side); the pager crosses window
   * boundaries via `router.replace("?page=N", { scroll: false })` so the
   * server re-renders with the next window while in-window paging stays
   * in-memory. Defaults (1/1/rows.length) keep single-window sets unchanged.
   */
  serverPage?: number;
  serverPageCount?: number;
  /** Whole-set row count across ALL windows (the honest total). */
  totalRows?: number;
  /**
   * The server export endpoint streaming the FULL set as CSV (same 13 columns
   * as the client export — both go through rowToCsvRecord). Renders an
   * "Export all N" action next to the client "Export CSV" button so every
   * paid lead is exportable even beyond the fetched window.
   */
  exportAllUrl?: string;
}

type Density = "comfortable" | "compact";

export function LeadsWorkbench({
  rows,
  discoveryId,
  bands,
  coverage,
  goalSignals = [],
  exportSlug,
  serverPage = 1,
  serverPageCount = 1,
  totalRows = rows.length,
  exportAllUrl,
}: LeadsWorkbenchProps) {
  /**
   * Covered families for one row: prefer the batched matrix (keyed by
   * businessId), fall back to the row's own `families` map. Returns the ordered
   * `Record<DataFamily, boolean>` the dot-strip + missing-family math consume.
   */
  const coveredFamilies = useCallback(
    (r: WorkbenchLeadRow): Record<DataFamily, boolean> => {
      const fromMatrix = coverage[r.businessId];
      if (fromMatrix) {
        const set = new Set(fromMatrix);
        return Object.fromEntries(
          DATA_FAMILIES.map((f) => [f.key, set.has(f.key)]),
        ) as Record<DataFamily, boolean>;
      }
      return r.families;
    },
    [coverage],
  );
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

  function setStatus(leadId: string, status: LeadStatus) {
    startTransition(async () => {
      applyOptimistic({ leadId, status });
      // discoveryId lets the action lazily create a Lead when `leadId` is
      // actually a raw Business id (a discovered row that was never saved
      // into a list) — see setLeadStatusAction's fallback doc.
      const result = await setLeadStatusAction({ leadId, status, discoveryId });
      if (result.status === "ok") {
        setCommitted((p) => ({ ...p, [leadId]: status }));
      } else {
        // The optimistic value reverts automatically (useOptimistic re-runs
        // from `committed`). Surface the revert through the shared toast so a
        // failed status write isn't silently swallowed (WP4-11).
        showToast("Couldn't update — reverted", "error");
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
  const [sortKey, setSortKey] = useState<string>(DEFAULT_SORT_KEY);
  const [sortDir, setSortDir] = useState<1 | -1>(DEFAULT_SORT_DIR);

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

  // ── Persisted view-state per research (WP4-13) ────────────────────────────
  // Hydrate saved density/vsCell/columns/filters/sort/pageSize/group from
  // localStorage AFTER mount (not a lazy initializer) so server + first client
  // render match — no hydration mismatch. `hydrated` gates the save effect so
  // the initial defaults don't overwrite the saved blob before we've read it.
  //
  // Sort + filters have a SECOND source: the URL (shareable views). When the
  // URL carries any view param the URL WINS wholesale for sort+filters — a
  // pasted link must reproduce the sender's view, never half-merge with this
  // browser's saved blob. localStorage stays the fallback (no URL params) and
  // keeps owning the non-shareable prefs (density/columns/…).
  const hydrated = useRef(false);
  useEffect(() => {
    // Defer the state writes out of the effect body (setTimeout(0)) so we don't
    // set state synchronously during the effect — same pattern CommandK uses to
    // satisfy react-hooks/set-state-in-effect. The save effect stays gated on
    // `hydrated` until this lands, so defaults never overwrite the saved blob.
    const tid = window.setTimeout(() => {
      const saved = loadWorkbenchView(discoveryId);
      const urlView = parseViewFromSearchParams(
        new URLSearchParams(window.location.search),
      );
      if (saved) {
        if (saved.density !== undefined) setDensity(saved.density);
        if (saved.vsCell !== undefined) setVsCell(saved.vsCell);
        if (saved.group !== undefined) setGroup(saved.group);
        if (saved.activeCols !== undefined) setActiveCols(saved.activeCols);
        if (saved.pageSize !== undefined) setPageSize(saved.pageSize);
      }
      if (urlView) {
        setFilters(urlView.filters);
        setSortKey(urlView.sortKey);
        setSortDir(urlView.sortDir);
      } else if (saved) {
        if (saved.filters !== undefined) setFilters(saved.filters);
        if (saved.sortKey !== undefined) setSortKey(saved.sortKey);
        if (saved.sortDir !== undefined) setSortDir(saved.sortDir);
      }
      hydrated.current = true;
    }, 0);
    return () => window.clearTimeout(tid);
    // Only re-hydrate if the research changes (a new workbench instance).
  }, [discoveryId]);

  useEffect(() => {
    if (!hydrated.current) return;
    saveWorkbenchView(discoveryId, {
      density,
      vsCell,
      group,
      activeCols,
      filters,
      sortKey,
      sortDir,
      pageSize,
    });
  }, [
    discoveryId,
    density,
    vsCell,
    group,
    activeCols,
    filters,
    sortKey,
    sortDir,
    pageSize,
  ]);

  // Mirror sort + filters into the URL (WP4-13 · shareable views). SHALLOW —
  // window.history.replaceState updates the address bar without an RSC
  // round-trip (the server never reads these params; only `?page=` is
  // server-read). Debounced 300ms so typing a filter value doesn't churn
  // history. Other params (lead/page) are preserved by viewToSearchParams.
  useEffect(() => {
    if (!hydrated.current) return;
    const tid = window.setTimeout(() => {
      const params = viewToSearchParams(
        { sortKey, sortDir, filters },
        new URLSearchParams(window.location.search),
      );
      const qs = params.toString();
      const next = qs
        ? `${window.location.pathname}?${qs}`
        : window.location.pathname;
      if (next !== `${window.location.pathname}${window.location.search}`) {
        window.history.replaceState(null, "", next);
      }
    }, 300);
    return () => window.clearTimeout(tid);
  }, [filters, sortKey, sortDir]);

  // ── Selection ──────────────────────────────────────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastIdx, setLastIdx] = useState<number | null>(null);

  // ── Lead drawer (URL-driven · ?lead=<businessId>) ─────────────────────────
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const openLead = sp.get("lead");

  /** Open a lead in the drawer, preserving any other existing query params. */
  const setLead = useCallback(
    (businessId: string) => {
      const params = new URLSearchParams(sp.toString());
      params.set("lead", businessId);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [sp, router, pathname],
  );

  /** Close the drawer — clears ?lead while keeping every other param. */
  const clearLead = useCallback(() => {
    const params = new URLSearchParams(sp.toString());
    params.delete("lead");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [sp, router, pathname]);

  /**
   * Jump to another SERVER window (WP4-4): set `?page=N` (dropped when N=1 —
   * the canonical first-window URL stays clean) and router.replace WITHOUT
   * scroll so the server re-renders this page with the next window of rows.
   * Selection is cleared (it referenced rows that are no longer loaded);
   * in-window page resets to the start — or the END when walking backwards
   * (`landAtEnd`), so ‹ from window 2 lands on window 1's last page.
   */
  const goWindow = useCallback(
    (w: number, landAtEnd = false) => {
      const params = new URLSearchParams(sp.toString());
      if (w <= 1) params.delete("page");
      else params.set("page", String(w));
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      setSelected(new Set());
      setLastIdx(null);
      // curPage clamps via Math.min(page, totalPages), so MAX_SAFE_INTEGER
      // reads as "the new window's last in-window page".
      setPage(landAtEnd ? Number.MAX_SAFE_INTEGER : 1);
    },
    [sp, router, pathname],
  );

  // One column per active goal signal (always shown, not part of the Fields
  // toggle set — see LeadsWorkbenchProps.goalSignals doc).
  const signalCols = useMemo(
    () => buildSignalColumns(goalSignals),
    [goalSignals],
  );

  // The active column defs in render order: static columns filtered by the
  // Fields-menu selection, with the goal-signal columns spliced in right
  // after Match % (docs/portal-prototype.html's activeCols insertion point).
  const cols = useMemo(() => {
    const base = COLUMNS.filter((c) => activeCols.includes(c.key));
    if (signalCols.length === 0) return base;
    const matchIdx = base.findIndex((c) => c.key === "match");
    if (matchIdx === -1) return [...base, ...signalCols];
    return [
      ...base.slice(0, matchIdx + 1),
      ...signalCols,
      ...base.slice(matchIdx + 1),
    ];
  }, [activeCols, signalCols]);

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

  // WP7-13 · a THIN market (< 25 businesses total across the research) can't
  // support an honest percentile distribution, so vs-cell bands are suppressed
  // and the workbench shows ABSOLUTE values with a note. This is the workbench
  // half of the Preview "small market — showing absolute benchmarks" message,
  // so the two never disagree. `effectiveBands` is what the render reads.
  const marketIsThin = totalRows < THIN_MARKET_THRESHOLD;
  const effectiveBands = marketIsThin ? EMPTY_BANDS : bands;

  // WP7-10 · accessible sort + caption text. The label of the active sort column
  // (falls back to the raw key for signal columns that aren't in the base set),
  // announced politely on change; the caption names what the table holds.
  const sortLabel =
    cols.find((c) => c.key === sortKey)?.fullLabel ??
    cols.find((c) => c.key === sortKey)?.label ??
    sortKey;
  const sortAnnouncement = `Sorted by ${sortLabel}, ${
    sortDir === 1 ? "ascending" : "descending"
  }`;
  const captionText = `Leads for this research — ${filtered.length.toLocaleString()} ${
    filtered.length === 1 ? "lead" : "leads"
  } shown, sortable by column. ${sortAnnouncement}.`;

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

  // The drawer's prev/next walk the VISIBLE order: the grouped (cell-ordered)
  // sequence when grouping, else the filtered+sorted page sequence. We step
  // across the whole filtered set (not just the current page) so next/prev keep
  // working past a page boundary in flat mode.
  const orderedIds = useMemo(() => {
    if (group === "cell" && grouped) {
      return grouped.flatMap(([, cellRows]) =>
        cellRows.map((r) => r.businessId),
      );
    }
    return filtered.map((r) => r.businessId);
  }, [group, grouped, filtered]);

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
    startTransition(async () => {
      for (const id of ids) applyOptimistic({ leadId: id, status });
      // WP5-9 · one transactional server action for the whole sweep (was one
      // setLeadStatusAction round-trip per id). Per-id failures come back so
      // only the pills that didn't land revert.
      const r = await setLeadStatusBulkAction({
        leadIds: ids,
        status,
        discoveryId,
      });
      const failedSet = new Set(r.status === "ok" ? r.failedIds : ids);
      const okIds = ids.filter((id) => !failedSet.has(id));
      if (okIds.length) {
        setCommitted((p) => {
          const next = { ...p };
          for (const id of okIds) next[id] = status;
          return next;
        });
      }
      const failed = ids.length - okIds.length;
      if (failed > 0)
        showToast(
          `Couldn't update ${failed} lead${failed === 1 ? "" : "s"} — reverted`,
          "error",
        );
    });
  }

  /**
   * WP2-4 · rich CSV export — the contacts Tom paid for reach his outreach
   * tool. Cell escaping + the 13-column mapping live in the pure
   * rowToCsvRecord/csvLine helpers (leads-workbench.ts), SHARED with the
   * server full-set export route so the two can never drift. This client
   * export covers the loaded window (filtered/selected); "Export all N"
   * streams the whole set from the server.
   */
  function exportCsv() {
    const lines = filtered
      .filter((r) => selected.size === 0 || selected.has(r.leadId))
      .map((r) =>
        csvLine(
          rowToCsvRecord(
            { ...r, status: optimistic[r.leadId] ?? r.status },
            goalSignals,
          ),
        ),
      );
    const csv = [CSV_HEADERS.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    // "{categorySlug}-{metroSlug}-{yyyy-mm-dd}.csv" (server-resolved base,
    // safe fallback). Date in the user's local time, ISO-style.
    const d = new Date();
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    a.download = `${exportSlug ?? "leads"}-${ymd}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Coverage summary (set-wide) + the missing families to enrich ──────────
  // A family is "have" (set-wide) only when EVERY visible lead has it — same
  // honest rule as before, but now sourced from the batched coverage matrix via
  // coveredFamilies (so ads/search are real, not faked). `missingKeys` are the
  // families NOT covered across the whole visible set — the enrich-more target.
  const coverageSummary = useMemo(() => {
    const have: string[] = [];
    const notYet: string[] = [];
    const missingKeys: DataFamily[] = [];
    for (const fam of DATA_FAMILIES) {
      const all =
        filtered.length > 0 &&
        filtered.every((r) => coveredFamilies(r)[fam.key]);
      if (all) have.push(fam.label);
      else {
        notYet.push(fam.label);
        missingKeys.push(fam.key);
      }
    }
    return { have, notYet, missingKeys };
  }, [filtered, coveredFamilies]);

  /**
   * WP5-3 · the scope every "enrich to unlock" surface hands the
   * EnrichMoreSheet: the explicitly-selected leads (bulk selection) and the
   * currently-visible (filtered) set, as businessIds. The sheet also offers
   * "whole research" itself (cellKeys resolved server-side).
   */
  const enrichScope = useMemo(
    () => ({
      selectedBusinessIds: filtered
        .filter((r) => selected.has(r.leadId))
        .map((r) => r.businessId),
      visibleBusinessIds: filtered.map((r) => r.businessId),
    }),
    [filtered, selected],
  );

  /** Coverage CTA → open the sheet pre-seeded with every missing family. */
  function openMissingFamiliesSheet() {
    openEnrichSheet({
      enrichments: enrichTypesForFamilies(
        coverageSummary.missingKeys,
      ) as EnrichmentType[],
      scope: enrichScope,
    });
  }

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
  /** Add a filter for a CHOSEN field, seeded with that field's sensible
   *  default op/value (never a one-size-fits-all blind default — the picker
   *  UI below lets the user choose the field before anything is added). */
  function addFilter(field: NumericFilterField) {
    const d = FILTER_FIELD_DEFAULTS[field];
    setFilters((prev) => [...prev, { field, op: d.op, value: d.value }]);
    setPage(1);
  }
  /** Add a goal-signal verdict filter ("matched" by default) unless one for the
   *  same signal is already applied — the personalisation unlock. */
  function addSignalFilter(sigKey: string, sigLabel: string) {
    const nf: LeadFilter = {
      kind: "signal",
      sigKey,
      sigLabel,
      want: "match",
    };
    setFilters((prev) =>
      prev.some((f) => f.kind === "signal" && f.sigKey === sigKey)
        ? prev
        : [...prev, nf],
    );
    setPage(1);
  }
  /** Flip a signal filter between "matched" and "not matched". */
  function toggleSignalWant(idx: number) {
    setFilters((prev) =>
      prev.map((f, i) => {
        if (i !== idx || f.kind !== "signal") return f;
        const want: "match" | "miss" = f.want === "match" ? "miss" : "match";
        return { ...f, want };
      }),
    );
    setPage(1);
  }
  /** WP5-13 · Fields-menu funnel — open the filter editor pre-set to this
   *  field (adds the field's default filter unless one is already applied). */
  function openFieldFilter(field: NumericFilterField) {
    if (!filters.some((f) => f.kind !== "signal" && f.field === field))
      addFilter(field);
    setFieldsOpen(false);
    setCoverageOpen(false);
    setFiltersOpen(true);
  }
  function editFilter(idx: number, patch: Partial<NumericLeadFilter>) {
    setFilters((prev) =>
      prev.map((f, i) =>
        i === idx && f.kind !== "signal" ? { ...f, ...patch } : f,
      ),
    );
    setPage(1);
  }
  /** Clear every applied filter + the search (WP4-15 · actionable empty state).
   *  The one path the "Clear filters" button in the empty row + the panel share. */
  function clearAllFilters() {
    setFilters([]);
    setSearch("");
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
        const band = effectiveBands[col.key];
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
        const band = effectiveBands[col.key];
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
      case "cov": {
        // Per-row enrichment dot-strip (prototype .covstrip / .covfrac /
        // .covdots): one dot per data family, filled when covered. Source =
        // the batched coverage matrix, falling back to the row's families.
        const cov = coveredFamilies(r);
        const have = DATA_FAMILIES.filter((f) => cov[f.key]).length;
        return (
          <td key={col.key}>
            <span
              className="covstrip"
              title={`${have} of ${DATA_FAMILIES.length} data families enriched`}
            >
              <span className="covfrac">
                {have}/{DATA_FAMILIES.length}
              </span>
              <span
                className="covdots"
                aria-label={`${have} of ${DATA_FAMILIES.length} data families enriched`}
              >
                {DATA_FAMILIES.map((f) => (
                  <i
                    key={f.key}
                    className={cov[f.key] ? "done" : undefined}
                    title={`${f.label}: ${cov[f.key] ? "have" : "not yet"}`}
                  />
                ))}
              </span>
            </span>
          </td>
        );
      }
      case "sig": {
        // One goal-signal verdict per column (docs/portal-prototype.html's
        // goalMatchCell): true = fired, false = evaluated + didn't match,
        // null = not yet computable (honest "enrich to unlock", never a
        // fake match — the same null-handling every other cell here uses).
        const verdict = col.sigKey ? r.perSignal[col.sigKey] : undefined;
        if (verdict == null) {
          return (
            <td key={col.key}>
              <span className="needsenr">— enrich</span>
            </td>
          );
        }
        return (
          <td key={col.key}>
            {verdict ? (
              <span className="gmatch g">
                <span className="gk">✓</span>match
              </span>
            ) : (
              <span className="gmatch miss">—</span>
            )}
          </td>
        );
      }
      case "lastC":
        return (
          <td key={col.key} className="num">
            {r.lastContactedAt ? (
              <span className="cellval">
                {new Date(r.lastContactedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            ) : (
              <span className="ppnone">—</span>
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
    const isActive = r.businessId === openLead;
    // activerow (the open lead) wins visually over selrow; both share the
    // indigo-50 wash but activerow adds the left accent rule.
    const cls = [isActive ? "activerow" : "", isSel ? "selrow" : ""]
      .filter(Boolean)
      .join(" ");
    return (
      <tr
        key={r.leadId}
        className={cls || undefined}
        onClick={() => setLead(r.businessId)}
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
          <Icon name="search" className="si" size={14} />
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

        {/* WP7-13 · in a THIN market the vs-cell percentile is disabled (too
            few businesses for an honest distribution) — the toggle is off +
            explains why, and a note says the numbers are absolute benchmarks. */}
        <label
          className={`cmptoggle${vsCell && !marketIsThin ? " on" : ""}`}
          title={
            marketIsThin
              ? `Small market (under ${THIN_MARKET_THRESHOLD}) — showing absolute benchmarks, no market percentile`
              : undefined
          }
        >
          <input
            type="checkbox"
            checked={vsCell && !marketIsThin}
            disabled={marketIsThin}
            onChange={(e) => setVsCell(e.target.checked)}
          />
          vs cell
        </label>
        {marketIsThin ? (
          <span className="note" style={{ fontSize: 11 }}>
            Small market — absolute benchmarks
          </span>
        ) : null}

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
                  {/* WP5-13 · per-field funnel — add/edit a filter from the
                      same row (columns + filters in one mental model). */}
                  {isFilterField(c.key) ? (
                    <FieldFunnel
                      field={c.key as NumericFilterField}
                      label={c.label}
                      active={filters.some(
                        (f) => f.kind !== "signal" && f.field === c.key,
                      )}
                      onOpen={openFieldFilter}
                    />
                  ) : null}
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
                  {isFilterField(c.key) ? (
                    <FieldFunnel
                      field={c.key as NumericFilterField}
                      label={c.label}
                      active={filters.some(
                        (f) => f.kind !== "signal" && f.field === c.key,
                      )}
                      onOpen={openFieldFilter}
                    />
                  ) : null}
                </label>
              ))}
              {/* WP5-13 · locked buy-rows: families still missing across the
                  visible set — click opens the WP5-3 enrich sheet. */}
              <FieldsMenuLockedRows
                missing={coverageSummary.missingKeys}
                scope={enrichScope}
              />
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
          <Icon name="filter" />
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
          <Icon name="coverage" />
          <span className="cbadge alt">
            {coverageSummary.have.length}/{DATA_FAMILIES.length}
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
            {filters.map((f, i) =>
              f.kind === "signal" ? (
                <span key={i} className="fchip sig" title="Goal-signal filter">
                  <span style={{ fontWeight: 600 }}>{f.sigLabel}</span>
                  <button
                    type="button"
                    onClick={() => toggleSignalWant(i)}
                    aria-label="Toggle matched / not matched"
                    style={{
                      border: "none",
                      background: "transparent",
                      font: "inherit",
                      cursor: "pointer",
                      color: f.want === "match" ? "var(--green)" : "var(--red)",
                    }}
                  >
                    {f.want === "match" ? "matched" : "not matched"}
                  </button>
                  <button
                    type="button"
                    className="x"
                    aria-label={`Remove ${filterLabel(f)}`}
                    onClick={() => removeFilter(i)}
                  >
                    ×
                  </button>
                </span>
              ) : (
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
                      editFilter(i, {
                        op: e.target.value as NumericLeadFilter["op"],
                      })
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
              ),
            )}
            <select
              className="add"
              aria-label="Add filter"
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                if (v.startsWith("sig:")) {
                  const key = v.slice(4);
                  const sig = goalSignals.find((s) => s.key === key);
                  if (sig) addSignalFilter(sig.key, sig.title);
                } else {
                  addFilter(v as NumericFilterField);
                }
                e.target.value = "";
              }}
            >
              <option value="" disabled>
                ＋ Add filter
              </option>
              {goalSignals.length > 0 ? (
                <optgroup label="Narrow by your goal signals">
                  {goalSignals.map((s) => (
                    <option key={s.key} value={`sig:${s.key}`}>
                      {s.title}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <optgroup label="Metrics">
                {FILTER_FIELDS.map((m) => (
                  <option key={m.field} value={m.field}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            </select>
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
            {coverageSummary.have.length === 0 ? (
              <span className="note">—</span>
            ) : (
              coverageSummary.have.map((label) => (
                <span key={label} className="covtag done">
                  <span className="cv">✓</span>
                  {label}
                </span>
              ))
            )}
            {coverageSummary.notYet.length > 0 ? (
              <>
                <span className="cl-lbl" style={{ marginLeft: 6 }}>
                  Not yet:
                </span>
                {coverageSummary.notYet.map((label) => (
                  <span key={label} className="covtag todo">
                    {label}
                  </span>
                ))}
                {/* WP5-3 · opens the in-workbench enrich sheet (pre-seeded
                    with the missing families + the current scope) — a real
                    one-click buy surface, not a deep-link away. */}
                <button
                  type="button"
                  className="clenrich"
                  style={{ cursor: "pointer", font: "inherit" }}
                  onClick={openMissingFamiliesSheet}
                >
                  Enrich {coverageSummary.notYet.join(" · ")} →
                </button>
              </>
            ) : (
              <span className="note" style={{ marginLeft: "auto" }}>
                All families enriched on this set
              </span>
            )}
          </div>
        </div>
      ) : null}

      {/* WP7-10 · sort-state announcement for screen readers. A polite live
          region names the active column + direction whenever the sort changes,
          so a non-visual user hears "Sorted by Reviews, descending" instead of
          only seeing the ▲/▼ glyph. Visually hidden (.sr-only). */}
      <div className="sr-only" aria-live="polite" role="status">
        {sortAnnouncement}
      </div>

      {/* ── The power table ───────────────────────────────────────────────── */}
      <div className="wbtable-wrap">
        <table className={`wb${density === "compact" ? " compact" : ""}`}>
          {/* WP7-10 · a screen-reader caption naming what the table holds +
              how many rows are shown. Visually hidden — the WorkspaceHeader
              carries the visible narrative count. */}
          <caption className="sr-only">{captionText}</caption>
          <thead>
            <tr>
              <th scope="col" className="sel" style={{ width: 34 }}>
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
                  scope="col"
                  className={[
                    c.kind === "num" || c.kind === "match" ? "num" : "",
                    !c.sortable ? "plain" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  title={c.fullLabel ?? c.label}
                  aria-sort={
                    c.sortable && sortKey === c.key
                      ? sortDir === 1
                        ? "ascending"
                        : "descending"
                      : c.sortable
                        ? "none"
                        : undefined
                  }
                >
                  {c.sortable ? (
                    // A real <button> so the sort control is keyboard-focusable
                    // and announced as a button (WP7-10 · keyboard-first).
                    <button
                      type="button"
                      className="wb-sortbtn"
                      onClick={() => toggleSort(c.key)}
                      aria-label={`Sort by ${c.fullLabel ?? c.label}${
                        sortKey === c.key
                          ? sortDir === 1
                            ? ", currently ascending"
                            : ", currently descending"
                          : ""
                      }`}
                    >
                      {c.label}
                      {sortKey === c.key ? (
                        <span className="arr" aria-hidden="true">
                          {sortDir === 1 ? "▲" : "▼"}
                        </span>
                      ) : null}
                    </button>
                  ) : (
                    c.label
                  )}
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
                    {filters.length > 0 || search.trim() !== "" ? (
                      <>
                        No leads match these filters ·{" "}
                        <button
                          type="button"
                          className="rflink"
                          onClick={clearAllFilters}
                        >
                          Clear filters
                        </button>
                      </>
                    ) : (
                      "No leads in this set yet."
                    )}
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

      {/* ── Pagination (in-window pages + server-window crossing · WP4-4) ──── */}
      {group === "none" && (filtered.length > 0 || serverPageCount > 1) ? (
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
            {filtered.length > 0 ? (
              <span className="pg-range">
                {(curPage - 1) * pageSize + 1}–
                {Math.min(curPage * pageSize, filtered.length)} of{" "}
                {filtered.length}
              </span>
            ) : null}
            {serverPageCount > 1 ? (
              <span className="pg-range">
                · window {serverPage} of {serverPageCount} ·{" "}
                {totalRows.toLocaleString()} rows total
              </span>
            ) : null}
          </div>
          {totalPages > 1 || serverPageCount > 1 ? (
            <div className="pg-pages">
              {/* ‹/› continue across window boundaries: at the in-window edge
                  they load the previous/next server window (?page=N). */}
              <button
                type="button"
                className="pgnav"
                onClick={() =>
                  curPage > 1
                    ? setPage(curPage - 1)
                    : goWindow(serverPage - 1, true)
                }
                disabled={curPage <= 1 && serverPage <= 1}
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
                onClick={() =>
                  curPage < totalPages
                    ? setPage(curPage + 1)
                    : goWindow(serverPage + 1)
                }
                disabled={
                  curPage >= totalPages && serverPage >= serverPageCount
                }
                aria-label="Next page"
              >
                ›
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Grouped view shows the whole window — keep the server windows
          reachable with a slim window pager (every row stays reachable). */}
      {group === "cell" && serverPageCount > 1 ? (
        <div
          className="wbpager"
          role="navigation"
          aria-label="Window pagination"
        >
          <div className="pg-left">
            <span className="pg-range">
              Window {serverPage} of {serverPageCount} ·{" "}
              {totalRows.toLocaleString()} rows total
            </span>
          </div>
          <div className="pg-pages">
            <button
              type="button"
              className="pgnav"
              onClick={() => goWindow(serverPage - 1)}
              disabled={serverPage <= 1}
              aria-label="Previous window"
            >
              ‹
            </button>
            <button
              type="button"
              className="pgnav"
              onClick={() => goWindow(serverPage + 1)}
              disabled={serverPage >= serverPageCount}
              aria-label="Next window"
            >
              ›
            </button>
          </div>
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
        {/* WP5-1 · selection-scoped touch generation (self-contained child). */}
        <BulkGenerateTouchesButton
          businessIds={filtered
            .filter((r) => selected.has(r.leadId))
            .map((r) => r.businessId)}
          discoveryId={discoveryId}
        />
        <button type="button" className="bb" onClick={exportCsv}>
          Export CSV
        </button>
        {exportAllUrl ? (
          // Server-streamed FULL set (WP4-4) — every paid lead, not just the
          // loaded window. Plain <a>: the route answers with a Content-
          // Disposition attachment, so this downloads without navigating.
          <a className="bb" href={exportAllUrl}>
            Export all {totalRows.toLocaleString()}
          </a>
        ) : null}
        <button type="button" className="bb" onClick={clearSelection}>
          Clear
        </button>
      </BulkActionBar>

      {/* ── Lead detail drawer (URL-driven · ?lead=<businessId>) ───────────── */}
      <LeadDrawer
        businessId={openLead}
        discoveryId={discoveryId}
        orderedIds={orderedIds}
        bands={effectiveBands}
        onClose={clearLead}
        onNav={setLead}
      />
    </div>
  );
}

/** Whether a column key is one of the numeric filterable fields (WP5-13). */
const FILTERABLE_FIELDS = new Set<string>(FILTER_FIELDS.map((f) => f.field));
function isFilterField(key: string): boolean {
  return FILTERABLE_FIELDS.has(key);
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
