"use client";

// LeadsWorkbench · the Leads tab of the agency workbench (the heart of the
// portal). A dense, keyboard/bulk-first power table over a saved list's Lead
// rows, built on the ported prototype classes (.wb-toolbar, table.wb, .statpill,
// .bulkbar, .wbpager, .fbar/.fchip, .collapse-panel, .covline) and the adopted
// agency primitives (StatusPill, BulkActionBar).
//
// Mechanics (all client-side over plain serialized rows — Pattern 4):
//   - Search · Group (none / by cell / by signal set) · vs-cell toggle · Fields
//     menu · Filters panel (+ Signal / + Field pickers) · Coverage line ·
//     sortable columns · numbered pagination · row select (shift-range) +
//     select-all-filtered · sticky bulk bar (Set status / Export CSV / Clear).
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
  availableNumericFields,
  availableSignalKeys,
  PAGE_SIZES,
  STATUS_ORDER,
  csvLine,
  fmtDelta,
  getPageNumbers,
  groupBySignals,
  matchesSearch,
  passesFilters,
  filterLabel,
  reachabilityLabel,
  rowToCsvRecord,
  seedSignalFilters,
  sortRows,
  type CellBand,
  type ColumnDef,
  type DataFamily,
  type LeadFilter,
  type NumericLeadFilter,
  type LeadStatus,
  type NumericFilterField,
  type SignalGroup,
  type WorkbenchLeadRow,
} from "../leads-workbench";
import { enrichTypesForFamilies } from "../family-coverage";
import { useDismiss } from "../hooks/useDismiss";
import { Popover } from "@/components/agency/Popover";
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
   * Per-business FAILED families (job errored + still not covered) — drives the
   * red "failed" dot, distinct from grey "never run". Optional + defaults to {}
   * so callers that don't compute it (or older serialized props) just show no
   * failures. Same plain-map shape as `coverage` (Pattern 4).
   */
  coverageFailed?: Record<string, DataFamily[]>;
  /**
   * The signals chosen on the Goal step (SIG_META key + title). Rendered as
   * one column per signal, right after Match % (docs/portal-prototype.html's
   * goalCols/makeSigCol) — reading `row.perSignal[key]` for the verdict. We
   * do NOT use these to auto-FILTER the row set: a signal still mid-
   * enrichment would otherwise silently hide real, not-yet-enriched leads.
   */
  goalSignals?: { key: string; title: string }[];
  /**
   * #2 · the full curated signal library (SIG_META key + title) offered in the
   * "+ Signal" filter picker. Every lead carries a verdict for each (computed
   * server-side against default thresholds), so any signal with data on the
   * WHOLE cohort becomes filterable (strict gating in `availableSignalKeys`).
   * Superset of `goalSignals` (minus roadmap-only signals). Defaults to
   * `goalSignals` for callers that don't pass it (e.g. the list page), so the
   * picker still offers the goal signals there.
   */
  allSignals?: { key: string; title: string }[];
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

/** How the table groups rows: flat, by cell, or by the combination of applied
 *  signal-filter verdicts ("segment by pitch angle"). "signals" is only
 *  selectable when ≥1 signal filter is applied. */
type GroupMode = "none" | "cell" | "signals";

export function LeadsWorkbench({
  rows,
  discoveryId,
  bands,
  coverage,
  coverageFailed = {},
  goalSignals = [],
  allSignals,
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
  /** FAILED families for one row (job errored + still not covered). Empty when
   *  the caller didn't compute failures. Drives the red dot + its tooltip. */
  const failedFamiliesFor = useCallback(
    (r: WorkbenchLeadRow): Set<DataFamily> =>
      new Set(coverageFailed[r.businessId] ?? []),
    [coverageFailed],
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
  const [group, setGroup] = useState<GroupMode>("none");
  const [vsCell, setVsCell] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const helpModalRef = useRef<HTMLDivElement | null>(null);
  // Whether ANY overlay (help modal / Fields / Add-filter menu) is open — the
  // keyboard-shortcut effect ([] deps) reads this via ref so single-letter keys
  // never mutate the table from behind an open overlay.
  const anyOverlayOpenRef = useRef(false);
  // The `g` shortcut cycles group modes; the effect has [] deps so it invokes
  // the latest cycler via this ref (kept current by an effect below, once
  // `filters`/`setGroup` are in scope — a signal-set group needs a signal
  // filter, which the cycler checks live).
  const cycleGroupRef = useRef<() => void>(() => {});
  const [activeCols, setActiveCols] = useState<string[]>(
    DEFAULT_ACTIVE_COLUMNS,
  );
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // #3 · the single "+ Add filter" split into two pickers: "+ Signal" (the
  // signal library) and "+ Field" (numeric fields). Independent open state.
  const [signalMenuOpen, setSignalMenuOpen] = useState(false);
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);
  const [coverageOpen, setCoverageOpen] = useState(false);
  // The Fields, Add-filter and Set-status menus are <Popover>s (floating-ui
  // handles portal + dismiss + focus). The Filters/Coverage PANELS are inline
  // collapse sections, so they still use the shared useDismiss for outside-click.
  const filtersPanelRef = useRef<HTMLDivElement | null>(null);
  const filterBtnRef = useRef<HTMLButtonElement | null>(null);
  const coveragePanelRef = useRef<HTMLDivElement | null>(null);
  const coverageBtnRef = useRef<HTMLButtonElement | null>(null);
  useDismiss(
    filtersOpen,
    () => setFiltersOpen(false),
    filtersPanelRef,
    filterBtnRef,
  );
  useDismiss(
    coverageOpen,
    () => setCoverageOpen(false),
    coveragePanelRef,
    coverageBtnRef,
  );

  // Power-user keyboard shortcuts (Tom · .claude/rules/ui-ux-agency.md). Guarded
  // so they never fire while typing in a field or with a modifier held. Press
  // "?" for the on-screen cheat-sheet.
  useEffect(() => {
    anyOverlayOpenRef.current =
      helpOpen || fieldsOpen || signalMenuOpen || fieldMenuOpen;
  }, [helpOpen, fieldsOpen, signalMenuOpen, fieldMenuOpen]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Never fire a shortcut behind an open overlay (a modal/menu owns the
      // keyboard until it's dismissed via Esc / click-out / ×).
      if (anyOverlayOpenRef.current) return;
      const t = e.target as HTMLElement | null;
      const typing =
        !!t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (typing) return;
      switch (e.key) {
        case "f":
          e.preventDefault();
          setFieldsOpen((o) => !o);
          break;
        case "g":
          e.preventDefault();
          // Cycle none → cell → signals (signals only when a signal filter is
          // applied — cycleGroup reads the live filters via ref) → none.
          cycleGroupRef.current();
          break;
        case "v":
          e.preventDefault();
          setVsCell((v) => !v);
          break;
        case "?":
          e.preventDefault();
          setHelpOpen((o) => !o);
          break;
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Help dialog · Esc close + Tab focus-trap + focus-return (a11y: a
  // role=dialog aria-modal must not leak focus behind the scrim).
  useEffect(() => {
    if (!helpOpen) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    // Lock body scroll while open (parity with the confirm dialog).
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusables = () =>
      Array.from(
        helpModalRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    window.setTimeout(() => focusables()[0]?.focus(), 10);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setHelpOpen(false);
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (active && !helpModalRef.current?.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [helpOpen]);
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
  // Hydrate saved vsCell/columns/filters/sort/pageSize/group from
  // localStorage AFTER mount (not a lazy initializer) so server + first client
  // render match — no hydration mismatch. `hydrated` gates the save effect so
  // the initial defaults don't overwrite the saved blob before we've read it.
  //
  // Sort + filters have a SECOND source: the URL (shareable views). When the
  // URL carries any view param the URL WINS wholesale for sort+filters — a
  // pasted link must reproduce the sender's view, never half-merge with this
  // browser's saved blob. localStorage stays the fallback (no URL params) and
  // keeps owning the non-shareable prefs (columns/group/…).
  const hydrated = useRef(false);
  // Whether the user has an actual filter CHOICE to persist (vs the pure goal
  // default seed). The seed alone is never saved — so a barely-enriched first
  // visit doesn't freeze an empty set; it re-seeds next time until the user
  // takes control, after which their choice persists across refresh/revisit.
  const userTouchedRef = useRef(false);
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
        if (saved.vsCell !== undefined) setVsCell(saved.vsCell);
        if (saved.group !== undefined) setGroup(saved.group);
        if (saved.activeCols !== undefined) setActiveCols(saved.activeCols);
        if (saved.pageSize !== undefined) setPageSize(saved.pageSize);
      }
      // Filter precedence (the user's saved choice is preserved across refresh +
      // revisit — WP-UX):
      //   1. localStorage saved filters (signal + numeric) → the user's choice.
      //   2. else a shared-link URL view (numeric only) for a fresh recipient.
      //   3. else the goal-step DEFAULT seed (goal signals ∩ enriched) — first
      //      visit only. Un-enriched goal signals are excluded (P0-B guard).
      // A restored SIGNAL filter is dropped if its signal is no longer in the
      // goal (its perSignal would be null → would hide every lead).
      // `rows`/`goalSignals` are the MOUNT-TIME values (effect runs once per
      // discoveryId) — paging must NOT re-run this and clobber user edits.
      const validSig = new Set(goalSignals.map((s) => s.key));
      if (saved?.filters !== undefined) {
        setFilters(
          saved.filters.filter(
            (f) => f.kind !== "signal" || validSig.has(f.sigKey),
          ),
        );
        userTouchedRef.current = true; // a saved choice → keep persisting it
        if (saved.sortKey !== undefined) setSortKey(saved.sortKey);
        if (saved.sortDir !== undefined) setSortDir(saved.sortDir);
      } else if (urlView) {
        setFilters(urlView.filters);
        userTouchedRef.current = true;
        setSortKey(urlView.sortKey);
        setSortDir(urlView.sortDir);
      } else {
        setFilters(seedSignalFilters(rows, goalSignals));
        userTouchedRef.current = false; // a pure default → don't persist it yet
      }
      hydrated.current = true;
    }, 0);
    return () => window.clearTimeout(tid);
    // Seed ONCE per research (mount) — intentionally NOT re-running on rows/
    // goalSignals changes (paging) so user filter edits survive soft nav.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discoveryId]);

  useEffect(() => {
    if (!hydrated.current) return;
    saveWorkbenchView(discoveryId, {
      vsCell,
      group,
      activeCols,
      // Persist the user's full filter choice (signal + numeric) so it survives
      // refresh + revisit — BUT only once they've actually chosen (userTouched).
      // Before that, `undefined` writes the blob with NO filters key (JSON omits
      // it), so on reload the goal-default seed re-derives (picking up newly
      // enriched signals) instead of freezing an empty/default set. Safe because
      // userTouched is only false on a first visit with nothing yet to lose.
      filters: userTouchedRef.current ? filters : undefined,
      sortKey,
      sortDir,
      pageSize,
    });
  }, [
    discoveryId,
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

  // The active column defs in render order — the static VALUE columns selected
  // in the Fields menu. Pure-boolean signal verdicts are filter work, not
  // columns (a ✓/— cell carries no per-lead value — "Has a website" is ~always
  // ✓), so the goal-signal columns were removed: signals live as FILTERS (the
  // whole library via "+ Signal") and "which of your signals fired" shows
  // compactly in the Pain-points "why qualifies" chips.
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

  // Signal availability (hoisted — both the grouping axes and the "+ Signal"
  // picker read it). `signalLibrary` = the whole curated library the page
  // supplied (falls back to the goal signals for the list page). `availSigKeys`
  // = signals with data on EVERY loaded lead (#2 · strict gating). Computed over
  // the whole `rows` window so the option list stays stable while filtering.
  const signalLibrary = useMemo(
    () => allSignals ?? goalSignals,
    [allSignals, goalSignals],
  );
  const goalKeySet = useMemo(
    () => new Set(goalSignals.map((s) => s.key)),
    [goalSignals],
  );
  const availSigKeys = useMemo(
    () => availableSignalKeys(rows, signalLibrary),
    [rows, signalLibrary],
  );
  const availNumFields = useMemo(() => availableNumericFields(rows), [rows]);

  // #5 · "Group by signals" axes. Grouping by the APPLIED signal filters is
  // degenerate — a filter narrows the set to one verdict, so every surviving row
  // shares it (a single bucket). The valuable axes are your GOAL signals that
  // still VARY across the visible leads: enriched on every lead (verdicts ✓/✗,
  // never —) and NOT themselves pinned by a filter. That segments Tom's filtered
  // leads by his other pitch angles ("weak-SEO leads split by booking / ads").
  const appliedSignalKeys = useMemo(
    () =>
      new Set(filters.flatMap((f) => (f.kind === "signal" ? [f.sigKey] : []))),
    [filters],
  );
  const signalGroupAxes = useMemo(
    () =>
      goalSignals
        .filter((s) => availSigKeys.has(s.key) && !appliedSignalKeys.has(s.key))
        // Cap the axes so the bucket count stays scannable (2^4 worst case).
        .slice(0, 4)
        .map((s) => ({ sigKey: s.key, sigLabel: s.title })),
    [goalSignals, availSigKeys, appliedSignalKeys],
  );
  const canGroupBySignals = signalGroupAxes.length > 0;
  // Whether the table is in a grouped (paginate-off) view. Signal grouping needs
  // ≥1 varying goal signal; without one it degrades to a flat view.
  const isGrouped =
    group === "cell" || (group === "signals" && canGroupBySignals);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const curPage = Math.min(page, totalPages);
  const pageRows = isGrouped
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

  // Grouped view rows — by cell, or by the goal-signal verdict combination (#5).
  // A uniform `{ id, label, rows }[]` so the render + collapse machinery is
  // shared. null in flat mode (or "signals" with no varying goal signal, which
  // derives to a flat view — see the `isGrouped`/`canGroupBySignals` note below).
  const grouped = useMemo(():
    | {
        id: string;
        label: string;
        rows: WorkbenchLeadRow[];
      }[]
    | null => {
    if (group === "cell") {
      const map = new Map<string, WorkbenchLeadRow[]>();
      for (const r of pageRows) {
        const arr = map.get(r.cell);
        if (arr) arr.push(r);
        else map.set(r.cell, [r]);
      }
      return [...map.entries()].map(([cell, cellRows]) => ({
        id: cell,
        label: cell,
        rows: cellRows,
      }));
    }
    if (group === "signals" && canGroupBySignals) {
      return groupBySignals(pageRows, signalGroupAxes).map(
        (g: SignalGroup) => ({
          id: g.key,
          label: g.label,
          rows: g.rows,
        }),
      );
    }
    return null;
  }, [group, pageRows, canGroupBySignals, signalGroupAxes]);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );

  // The drawer's prev/next walk the VISIBLE order: the grouped sequence when
  // grouping, else the filtered+sorted page sequence. We step across the whole
  // filtered set (not just the current page) so next/prev keep working past a
  // page boundary in flat mode.
  const orderedIds = useMemo(() => {
    if (grouped) {
      return grouped.flatMap((g) => g.rows.map((r) => r.businessId));
    }
    return filtered.map((r) => r.businessId);
  }, [grouped, filtered]);

  // Keep the `g` shortcut's cycler current (none → cell → signals when signal
  // grouping is possible → none) — the keyboard effect has [] deps + reads via ref.
  useEffect(() => {
    cycleGroupRef.current = () =>
      setGroup((g) =>
        g === "none"
          ? "cell"
          : g === "cell" && canGroupBySignals
            ? "signals"
            : "none",
      );
  }, [canGroupBySignals]);
  // NB: we DON'T reset `group` to "none" when signal grouping stops being
  // possible (that would be a setState-in-effect). Instead the view DERIVES from
  // `isGrouped` (which requires `canGroupBySignals` for "signals"), so the view
  // degrades to flat and restores automatically as the axes come and go. The
  // "By signals" seg lights only while it's actually grouping.

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

  /** Click an empty "— enrich" cell → open the sheet scoped to THAT lead,
   *  pre-seeded with the cell's data family (so a Lighthouse cell offers a
   *  Lighthouse enrich, a Phone cell offers contacts, etc.). Closes the
   *  founder's "I can't enrich by clicking the field" complaint. */
  function enrichCell(r: WorkbenchLeadRow, family?: DataFamily) {
    openEnrichSheet({
      enrichments: family
        ? (enrichTypesForFamilies([family]) as EnrichmentType[])
        : undefined,
      scope: {
        selectedBusinessIds: [r.businessId],
        visibleBusinessIds: [r.businessId],
      },
    });
  }
  /** The clickable empty-cell affordance shared by every "— enrich" cell. */
  const NeedsEnrich = ({
    r,
    family,
  }: {
    r: WorkbenchLeadRow;
    family?: DataFamily;
  }) => (
    <button
      type="button"
      className="needsenr"
      data-tip="Enrich this lead"
      // Stop the click bubbling to the row's onClick (which opens the lead
      // drawer) — clicking "— enrich" must open the enrich sheet, not the drawer.
      onClick={(e) => {
        e.stopPropagation();
        enrichCell(r, family);
      }}
      style={{
        border: "none",
        background: "transparent",
        cursor: "pointer",
        font: "inherit",
        padding: 0,
        color: "inherit",
        textDecoration: "underline dotted",
      }}
    >
      — enrich
    </button>
  );

  // ── Fields menu helpers ───────────────────────────────────────────────────
  function toggleCol(key: string) {
    setActiveCols((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  }

  // ── Filter editor ─────────────────────────────────────────────────────────
  function removeFilter(idx: number) {
    userTouchedRef.current = true;
    setFilters((prev) => prev.filter((_, i) => i !== idx));
    setPage(1);
  }
  /** Add a filter for a CHOSEN field, seeded with that field's sensible
   *  default op/value (never a one-size-fits-all blind default — the picker
   *  UI below lets the user choose the field before anything is added). */
  function addFilter(field: NumericFilterField) {
    userTouchedRef.current = true;
    const d = FILTER_FIELD_DEFAULTS[field];
    setFilters((prev) => [...prev, { field, op: d.op, value: d.value }]);
    setPage(1);
  }
  /** Add a goal-signal verdict filter ("matched" by default) unless one for the
   *  same signal is already applied — the personalisation unlock. */
  function addSignalFilter(sigKey: string, sigLabel: string) {
    userTouchedRef.current = true;
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
    userTouchedRef.current = true;
    setFilters((prev) =>
      prev.map((f, i) => {
        if (i !== idx || f.kind !== "signal") return f;
        const want: "match" | "miss" = f.want === "match" ? "miss" : "match";
        return { ...f, want };
      }),
    );
    setPage(1);
  }

  // ── Add-filter pickers · data-gated (#2 + #3 · split Signal / Field) ────────
  // The "+ Signal" picker offers the WHOLE curated library (`signalLibrary`,
  // hoisted above), gated to signals with data on every lead (`availSigKeys`),
  // minus any already applied. Split into the personalised goal signals (shown
  // first) and the rest of the library (alphabetised).
  const addSignalOptions = useMemo(() => {
    const active = new Set(
      filters.flatMap((f) => (f.kind === "signal" ? [f.sigKey] : [])),
    );
    const avail = signalLibrary.filter(
      (s) => availSigKeys.has(s.key) && !active.has(s.key),
    );
    return {
      goal: avail.filter((s) => goalKeySet.has(s.key)),
      rest: avail
        .filter((s) => !goalKeySet.has(s.key))
        .sort((a, b) => a.title.localeCompare(b.title)),
    };
  }, [signalLibrary, availSigKeys, filters, goalKeySet]);
  const signalOptionCount =
    addSignalOptions.goal.length + addSignalOptions.rest.length;
  const addNumericOptions = useMemo(() => {
    const active = new Set(
      filters.flatMap((f) => (f.kind !== "signal" ? [f.field] : [])),
    );
    return FILTER_FIELDS.filter(
      (m) => availNumFields.has(m.field) && !active.has(m.field),
    );
  }, [availNumFields, filters]);

  // The add-filter pickers are <Popover>s (floating-ui handles portal + dismiss
  // + Esc + focus + ↑/↓ nav), so no hand-rolled listeners here.
  function pickAddSignal(key: string, title: string) {
    addSignalFilter(key, title);
    setSignalMenuOpen(false);
  }
  function pickAddNumeric(field: NumericFilterField) {
    addFilter(field);
    setFieldMenuOpen(false);
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
    userTouchedRef.current = true;
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
    userTouchedRef.current = true;
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
            <span className="bizname" data-tip={r.name}>
              {r.name}
            </span>
            <div className="addr" data-tip={r.addr}>
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
      case "pains": {
        if (r.pains.length > 0) {
          return (
            <td key={col.key}>
              <span
                style={{ display: "inline-flex", gap: 5, flexWrap: "wrap" }}
              >
                {r.pains.slice(0, 2).map((p, i) => (
                  <span
                    key={i}
                    className={`ppchip ${p.group}`}
                    data-tip={p.title}
                  >
                    {p.label}
                  </span>
                ))}
                {r.pains.length > 2 ? (
                  <span
                    className="ppchip more"
                    data-tip={r.pains.map((p) => p.label).join(" · ")}
                  >
                    +{r.pains.length - 2}
                  </span>
                ) : null}
              </span>
            </td>
          );
        }
        // Fallback: no playbook-derived pains, but the lead fired goal signals.
        // Show the MATCHED signals as the "why this qualifies" chips — closes
        // the "Pain points column is always empty" complaint by reusing the
        // per-signal verdict every row already carries.
        const matched = goalSignals.filter((s) => r.perSignal[s.key] === true);
        if (matched.length === 0) {
          return (
            <td key={col.key}>
              <span className="ppnone">—</span>
            </td>
          );
        }
        return (
          <td key={col.key}>
            <span style={{ display: "inline-flex", gap: 5, flexWrap: "wrap" }}>
              {matched.slice(0, 2).map((s) => (
                <span
                  key={s.key}
                  className="ppchip weak-web"
                  data-tip={`Matched your signal: ${s.title}`}
                >
                  {s.title}
                </span>
              ))}
              {matched.length > 2 ? (
                <span
                  className="ppchip more"
                  data-tip={matched.map((s) => s.title).join(" · ")}
                >
                  +{matched.length - 2}
                </span>
              ) : null}
            </span>
          </td>
        );
      }
      case "text":
        return (
          <td key={col.key}>
            {r.builtOn ?? <NeedsEnrich r={r} family={col.family} />}
          </td>
        );
      case "site": {
        if (!r.website) {
          return (
            <td key={col.key}>
              <NeedsEnrich r={r} family={col.family} />
            </td>
          );
        }
        // Show the bare host (no scheme/path) — the dense, scannable form Tom
        // wants; the full URL is the link target + title.
        let host = r.website;
        try {
          host = new URL(r.website).hostname.replace(/^www\./, "");
        } catch {
          host = r.website.replace(/^https?:\/\//, "").replace(/^www\./, "");
        }
        return (
          <td key={col.key}>
            <a
              className="clink"
              href={r.website}
              target="_blank"
              rel="noopener noreferrer"
              data-tip={r.website}
              onClick={(e) => e.stopPropagation()}
            >
              {host}
            </a>
          </td>
        );
      }
      case "reach": {
        // Surface the reachability TIER (Rich / Multi / Email only / …), not a
        // bare Yes/No — the row already carries it; the table used to discard it.
        const rl = reachabilityLabel(r.reachability);
        if (rl.tone === "muted") {
          return (
            <td key={col.key}>
              <NeedsEnrich r={r} family={col.family} />
            </td>
          );
        }
        const cls =
          rl.tone === "green" ? "green" : rl.tone === "amber" ? "amber" : "red";
        return (
          <td key={col.key}>
            <span
              className={`pill ${cls} dot`}
              style={{ fontSize: "10.5px" }}
              data-tip={`Reachability: ${rl.text}`}
            >
              {rl.text}
            </span>
          </td>
        );
      }
      case "num": {
        const v = numField(r, col.key);
        if (v == null)
          return (
            <td className="num" key={col.key}>
              <NeedsEnrich r={r} family={col.family} />
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
              <NeedsEnrich r={r} family={col.family} />
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
              <span className="cmore" data-tip={arr.join(" · ")}>
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
        const failed = failedFamiliesFor(r);
        const have = DATA_FAMILIES.filter((f) => cov[f.key]).length;
        const failedCount = DATA_FAMILIES.filter((f) =>
          failed.has(f.key),
        ).length;
        return (
          <td key={col.key}>
            <span
              className="covstrip"
              data-tip={
                failedCount > 0
                  ? `${have} of ${DATA_FAMILIES.length} enriched · ${failedCount} failed — re-enrich`
                  : `${have} of ${DATA_FAMILIES.length} data families enriched`
              }
            >
              <span className="covfrac">
                {have}/{DATA_FAMILIES.length}
              </span>
              <span
                className="covdots"
                aria-label={`${have} of ${DATA_FAMILIES.length} data families enriched${
                  failedCount > 0 ? `, ${failedCount} failed` : ""
                }`}
              >
                {DATA_FAMILIES.map((f) => {
                  // done (green) > failed (red) > never-run (grey). A failed
                  // family is one that errored AND is still not covered.
                  const state = cov[f.key]
                    ? "done"
                    : failed.has(f.key)
                      ? "failed"
                      : undefined;
                  return (
                    <i
                      key={f.key}
                      className={state}
                      data-tip={`${f.label}: ${
                        state === "done"
                          ? "have"
                          : state === "failed"
                            ? "failed — re-enrich"
                            : "not yet"
                      }`}
                    />
                  );
                })}
              </span>
            </span>
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
            ref={searchRef}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search leads in this set…  ( / )"
            aria-label="Search leads"
          />
        </div>

        <div className="seg sm" role="group" aria-label="Group by">
          <button
            type="button"
            className={group === "none" ? "on" : undefined}
            onClick={() => setGroup("none")}
          >
            No groups
          </button>
          <button
            type="button"
            className={group === "cell" ? "on" : undefined}
            onClick={() => setGroup("cell")}
          >
            By cell
          </button>
          {/* #5 · segment leads by the verdict combination of your VARYING goal
              signals (enriched on every lead, not pinned by a filter). We use
              aria-disabled (NOT the `disabled` attribute) so the control stays
              focusable + emits pointer events — a `disabled` button fires no
              hover/focus, so its explanatory tooltip would never show. Click is
              guarded to a no-op instead. */}
          <button
            type="button"
            className={
              group === "signals" && canGroupBySignals ? "on" : undefined
            }
            aria-disabled={!canGroupBySignals || undefined}
            data-tip={
              canGroupBySignals
                ? "Segment by your goal-signal combination"
                : "Needs an enriched goal signal that isn't filtered"
            }
            onClick={() => {
              if (canGroupBySignals) setGroup("signals");
            }}
          >
            By signals
          </button>
        </div>

        {/* WP7-13 · in a THIN market the vs-cell percentile is disabled (too
            few businesses for an honest distribution) — the toggle is off +
            explains why, and a note says the numbers are absolute benchmarks. */}
        <label
          className={`cmptoggle${vsCell && !marketIsThin ? " on" : ""}`}
          data-tip={
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

        <Popover
          open={fieldsOpen}
          onOpenChange={setFieldsOpen}
          className="popmenu cols"
          label="Fields"
          trigger={
            <button type="button" className="btn sm">
              Fields ▾
            </button>
          }
        >
          <div className="cgrp">Workflow</div>
          {COLUMNS.filter((c) => c.group === "workflow" && c.key !== "biz").map(
            (c) => (
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
            ),
          )}
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
        </Popover>

        <span className="tb-spacer" />

        {/* #1 · live filtered count — updates as filters/search change so the
            match total is visible up here by the Filters control, not only down
            in the pager. When server-paginated it counts the loaded window
            (the tooltip states the whole-set total). */}
        <span
          className="wb-count"
          aria-live="polite"
          data-tip={
            serverPageCount > 1
              ? `Matches in the loaded window of ${rows.length.toLocaleString()} · ${totalRows.toLocaleString()} total`
              : undefined
          }
        >
          <strong>{filtered.length.toLocaleString()}</strong>
          {filters.length > 0 || search.trim() !== ""
            ? ` of ${rows.length.toLocaleString()}`
            : ""}{" "}
          {/* "loaded" (not "leads") when server-paginated so the number never
              reads as the whole-set total — that's in the tooltip. */}
          {serverPageCount > 1
            ? "loaded"
            : filtered.length === 1
              ? "lead"
              : "leads"}
        </span>

        <button
          ref={filterBtnRef}
          type="button"
          className={`iconbtn${filters.length ? " active" : ""}`}
          aria-haspopup="true"
          aria-expanded={filtersOpen}
          aria-label="Filters"
          data-tip="Filters"
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
          ref={coverageBtnRef}
          type="button"
          className="iconbtn"
          aria-haspopup="true"
          aria-expanded={coverageOpen}
          aria-label="Coverage"
          data-tip="Coverage layers"
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

        <button
          type="button"
          className="iconbtn"
          aria-label="Keyboard shortcuts"
          data-tip="Keyboard shortcuts  ( ? )"
          onClick={() => setHelpOpen(true)}
        >
          ?
        </button>
      </div>

      {/* Keyboard-shortcut cheat-sheet (press ? or the ? button). */}
      {helpOpen ? (
        <div
          className="overlay center"
          role="dialog"
          aria-modal="true"
          aria-label="Keyboard shortcuts"
          onClick={(e) => {
            if (e.target === e.currentTarget) setHelpOpen(false);
          }}
        >
          <div className="modal confirm-modal" ref={helpModalRef}>
            <div className="mhead">
              <h2 className="confirm-title" style={{ flex: 1 }}>
                Keyboard shortcuts
              </h2>
              <button
                type="button"
                className="x"
                aria-label="Close"
                onClick={() => setHelpOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="mbody">
              <dl className="wb-shortcuts">
                {[
                  ["/", "Focus search"],
                  ["f", "Fields menu"],
                  ["g", "Group (none → cell → signals)"],
                  ["v", "vs-cell benchmarks (toggle)"],
                  ["?", "This help"],
                  ["Esc", "Close any menu / dialog"],
                ].map(([k, label]) => (
                  <div key={k} className="wb-shortcut-row">
                    <kbd>{k}</kbd>
                    <span>{label}</span>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      ) : null}

      {/* ── Filters panel ─────────────────────────────────────────────────── */}
      {filtersOpen ? (
        <div className="collapse-panel" ref={filtersPanelRef}>
          <div className="cp-head">
            <span className="cp-title">Filters</span>
            <button
              type="button"
              className="cp-clear"
              onClick={() => {
                userTouchedRef.current = true;
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
                <span
                  key={i}
                  className="fchip sig"
                  data-tip="Goal-signal filter"
                >
                  <span style={{ fontWeight: 600 }}>{f.sigLabel}</span>
                  <button
                    type="button"
                    onClick={() => toggleSignalWant(i)}
                    aria-pressed={f.want === "match"}
                    aria-label={`${f.sigLabel}: ${
                      f.want === "match" ? "matched" : "not matched"
                    } — press to flip`}
                    style={{
                      border: "none",
                      background: "transparent",
                      font: "inherit",
                      cursor: "pointer",
                      // Darker green/red on the tinted .fchip.sig bg clear
                      // 4.5:1 (plain --green is 2.97:1, plain --red 4.13:1 on
                      // --indigo-50 — both fail; the -700 tokens pass).
                      color:
                        f.want === "match"
                          ? "var(--green-700)"
                          : "var(--red-700)",
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
                <span key={i} className="fchip data" data-tip="Edit filter">
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
            {/* #3 · two pickers — "+ Signal" (the curated library, gated to
                signals with data on every lead) and "+ Field" (numeric fields
                with data). Each is its own <Popover> (floating-ui portal +
                dismiss + ↑/↓ nav). */}
            <Popover
              open={signalMenuOpen}
              onOpenChange={setSignalMenuOpen}
              className="filter-add-popover"
              role="dialog"
              label="Add a signal filter"
              trigger={
                <button
                  type="button"
                  className="add"
                  data-tip="Filter by a signal"
                >
                  ＋ Signal
                </button>
              }
            >
              {signalOptionCount === 0 ? (
                <div className="filter-add-empty">
                  No signal covers all leads yet · enrich to unlock.
                </div>
              ) : null}
              {addSignalOptions.goal.length > 0 ? (
                <div
                  className="filter-list-section"
                  role="group"
                  aria-label="Your goal signals"
                >
                  <div className="filter-list-eyebrow">Your goal signals</div>
                  {addSignalOptions.goal.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      className="filter-list-item"
                      onClick={() => pickAddSignal(s.key, s.title)}
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
              ) : null}
              {addSignalOptions.rest.length > 0 ? (
                <div
                  className="filter-list-section"
                  role="group"
                  aria-label="All signals"
                >
                  <div className="filter-list-eyebrow">All signals</div>
                  {addSignalOptions.rest.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      className="filter-list-item"
                      onClick={() => pickAddSignal(s.key, s.title)}
                    >
                      {s.title}
                    </button>
                  ))}
                </div>
              ) : null}
            </Popover>
            <Popover
              open={fieldMenuOpen}
              onOpenChange={setFieldMenuOpen}
              className="filter-add-popover"
              role="dialog"
              label="Add a field filter"
              trigger={
                <button
                  type="button"
                  className="add"
                  data-tip="Filter by a field"
                >
                  ＋ Field
                </button>
              }
            >
              {addNumericOptions.length === 0 ? (
                <div className="filter-add-empty">
                  No fields with data yet · enrich to unlock.
                </div>
              ) : (
                <div
                  className="filter-list-section"
                  role="group"
                  aria-label="Fields with data"
                >
                  <div className="filter-list-eyebrow">Fields with data</div>
                  {addNumericOptions.map((m) => (
                    <button
                      key={m.field}
                      type="button"
                      className="filter-list-item"
                      onClick={() => pickAddNumeric(m.field)}
                    >
                      <span>{m.label}</span>
                      {m.unit ? (
                        <span className="filter-item-unit">{m.unit}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              )}
            </Popover>
          </div>
        </div>
      ) : filters.length ? (
        <div className="chipsbar">
          <span className="cb-lbl">Filters</span>
          {filters.map((f, i) => (
            // Signal chips (your goal defaults) read distinct from numeric ones.
            <span
              key={i}
              className={`fchip ${f.kind === "signal" ? "sig" : "data"}`}
            >
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
              userTouchedRef.current = true;
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
        <div className="collapse-panel" ref={coveragePanelRef}>
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
        <table className="wb">
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
                  data-tip={c.fullLabel ?? c.label}
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
                      ) : (
                        // Faint idle chevron so an inactive column reads as
                        // sortable (was invisible → looked non-interactive).
                        <span className="arr arr-idle" aria-hidden="true">
                          ↕
                        </span>
                      )}
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
            ) : grouped ? (
              grouped.flatMap((g) => {
                const collapsed = collapsedGroups.has(g.id);
                const toggle = () =>
                  setCollapsedGroups((prev) => {
                    const next = new Set(prev);
                    if (next.has(g.id)) next.delete(g.id);
                    else next.add(g.id);
                    return next;
                  });
                const head = (
                  <tr
                    key={`grp-${g.id}`}
                    className={`grphead${collapsed ? " collapsed" : ""}`}
                  >
                    <td colSpan={colSpan}>
                      {/* A real <button> so collapse/expand is keyboard-operable
                          + announced (aria-expanded), not a mouse-only <tr>. The
                          signal-group legend rides its tooltip. */}
                      <button
                        type="button"
                        className="grphead-btn"
                        aria-expanded={!collapsed}
                        aria-label={`${g.label}, ${g.rows.length} leads — ${
                          collapsed ? "expand" : "collapse"
                        }`}
                        data-tip={
                          group === "signals"
                            ? "✓ matched · ✗ not matched"
                            : undefined
                        }
                        onClick={toggle}
                      >
                        <span className="gchev" aria-hidden="true">
                          ▾
                        </span>
                        {g.label}
                        <span className="gc">{g.rows.length} leads</span>
                      </button>
                    </td>
                  </tr>
                );
                if (collapsed) return [head];
                return [
                  head,
                  ...g.rows.map((r) =>
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
      {!isGrouped && (filtered.length > 0 || serverPageCount > 1) ? (
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
      {isGrouped && serverPageCount > 1 ? (
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
    <Popover
      open={open}
      onOpenChange={setOpen}
      className="popmenu"
      placement="top-end"
      label="Set status"
      trigger={
        <button type="button" className="bb primary">
          Set status ▾
        </button>
      }
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
    </Popover>
  );
}
