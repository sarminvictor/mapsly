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
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState,
  useTransition,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
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
  type FieldFilterState,
  type FieldStateFilter,
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
  COLUMN_TYPE_GROUP_ORDER,
  CSV_HEADERS,
  columnsToAutoShow,
  defaultActiveColumnsForGoal,
  FILTER_FIELDS,
  FILTER_FIELD_DEFAULTS,
  availableNumericFields,
  availableSignalKeys,
  filterBreakdown,
  heavyFieldsForColumns,
  heavyFieldsForFilters,
  orderColumnsForGoal,
  PAGE_SIZES,
  STATUS_ORDER,
  csvLine,
  fmtDelta,
  fmtRelativeShort,
  getPageNumbers,
  groupBySignals,
  matchesSearch,
  passesFilters,
  filterLabel,
  reachabilityLabel,
  rowToCsvRecord,
  seedSignalFilters,
  serializeWbColsCookie,
  sortRows,
  WB_COLS_COOKIE,
  type CellBand,
  type ColumnDef,
  type ColumnTypeGroup,
  type HeavyRowField,
  type LeadFilter,
  type NumericLeadFilter,
  type LeadStatus,
  type NumericFilterField,
  type SignalGroup,
  type WorkbenchLeadRow,
} from "../leads-workbench";
import {
  getWorkbenchRowFieldsAction,
  type WorkbenchRowFieldValues,
} from "../workbench-row-fields-actions";
import {
  ENRICHMENT_TYPES,
  DATA_GROUPS,
  CELL_BASIS_TOKENS,
  dataGroupFor,
  deriveGroupStates,
  enrichTypesForGroups,
  groupLeadCredits,
  typeKeyForEnrichToken,
  anyLeadGroupRan,
  type EnrichmentTypeKey,
  type TypeState,
  type DataGroupKey,
} from "../family-coverage";
import { QUALIFIER_SIGNAL_KEYS } from "../goal-templates";
import { useDismiss } from "../hooks/useDismiss";
import { Popover } from "@/components/agency/Popover";
import {
  openEnrichSheet,
  subscribeEnrichFinished,
  subscribeEnrichScope,
} from "../enrich-sheet-bus";
import { THIN_MARKET_THRESHOLD, fmtCredits } from "../flow-types";
import { type EnrichmentType } from "@/modules/cost/pricing";

/** WP7-13 · a stable empty-bands object for the thin-market path (no vs-cell
 *  percentiles → the workbench renders absolute values). Module-level so the
 *  reference is stable across renders. */
const EMPTY_BANDS: Partial<Record<string, CellBand>> = {};

/** AUDIT U16 · where each DATA GROUP's data comes from — shown as a provenance
 *  tooltip on value cells so a number reads as evidence, not an assertion. */
const SOURCE_BY_GROUP: Partial<Record<DataGroupKey, string>> = {
  contacts_tech: "Website + directories",
  reviews: "Google reviews",
  site_speed: "Website scan · Lighthouse mobile",
  ai_brief: "AI research over the site + listing",
  meta_ads: "Meta Ad Library",
  google_ads: "Google Ads transparency",
  search: "Local SERP scan",
};

const MONTH_ABBR = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** AUDIT U16 · format a last-scanned ISO into the provenance tip's `{when}`. A
 *  compact UTC absolute date ("Jul 1") — DETERMINISTIC so a server-rendered cell
 *  and its client hydration produce the identical string (a `Date.now()`
 *  relative time would drift between the two and warn). Returns null when the
 *  timestamp is absent/unparseable → the tip drops the date. */
function fmtScannedWhen(iso?: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t);
  return `${MONTH_ABBR[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** B7 · data-age threshold — beyond this the provenance tip (and the B8 "as
 *  of" suffix in the Data-state list) says "stale"/"as of", never "fresh". */
const STALE_AFTER_MS = 30 * 86_400_000;

/** B1/C5 · one label map for a field-state's human word — shared by the
 *  "+ Data state" list AND the removable state-filter chips so the two always
 *  read the same. */
const FIELD_STATE_LABEL: Record<FieldFilterState, string> = {
  enriched: "have",
  empty: "none",
  failed: "failed",
  not_run: "not run",
};

/** B11g · localStorage flag for the one-time "Press ? for shortcuts" hint. */
const SHORTCUT_HINT_KEY = "mapsly:wb:hint-shortcuts";

/**
 * The statuses the workbench lets you SET (pill cycle + bulk menu). HIDDEN is
 * excluded on purpose (owner 2026-07-06): with the Hidden tab retired there is
 * no un-hide path, so hiding a lead can't be a workbench verb — it would trap a
 * paid lead out of every view. Rows already HIDDEN stay filtered by `notHidden`.
 */
const SETTABLE_STATUSES: readonly LeadStatus[] = STATUS_ORDER.filter(
  (s) => s !== "HIDDEN",
);

/** B14 · Enter commits an inline chip input by blurring it (the edit is
 *  already live — blur just closes the keyboard interaction cleanly). */
function commitOnEnter(e: ReactKeyboardEvent<HTMLInputElement>): void {
  if (e.key === "Enter") e.currentTarget.blur();
}

export interface LeadsWorkbenchProps {
  rows: WorkbenchLeadRow[];
  discoveryId: string;
  /** vs-cell distribution bands per numeric column key (null when cohort small). */
  bands: Partial<Record<string, CellBand>>;
  /**
   * AUDIT A2 · the honest per-business per-TYPE state map (the 9 purchasable
   * enrichment types: contacts/services/reviews/tech/lighthouse/meta_ads/
   * google_ads/serp/ai_research) from the shared coverage matrix. THE atom
   * every surface derives from: the "Enriched" column badge strip, the
   * per-group roll-up behind the coverage panel, per-cell affordances, and the
   * "Enriched only" view. A business missing from the map reads all-not_run
   * (honest). Plain data (Pattern 4).
   */
  coverageTypeStates: Record<string, Record<EnrichmentTypeKey, TypeState>>;
  /**
   * AUDIT U16 · per-business per-DATA-GROUP last-scanned time (ISO string) for
   * the provenance tooltip's "scanned {when}" clause. Read from the same
   * freshness cursors billing uses (`loadFreshTimestamps`): contacts_tech /
   * reviews / site_speed / ai_brief / google_ads from the Business cursors +
   * latest LighthouseAudit; meta_ads/search from the cell's newest AdMarketRun.
   * A group absent from a business's map → no timestamp (the tip falls back to
   * source + fresh/stale). Plain data (Pattern 4).
   */
  scannedAt?: Record<string, Partial<Record<DataGroupKey, string>>>;
  /**
   * The signals chosen on the Goal step (SIG_META key + title). Rendered as
   * one column per signal, right after Match % (docs/portal-prototype.html's
   * goalCols/makeSigCol) — reading `row.perSignal[key]` for the verdict. We
   * do NOT use these to auto-FILTER the row set: a signal still mid-
   * enrichment would otherwise silently hide real, not-yet-enriched leads.
   */
  goalSignals?: { key: string; title: string }[];
  /**
   * WB-COL-1 · the goal's expanded research families (lowercase research tokens,
   * plain data). Turns the goal's own data columns ON by default on the FIRST
   * visit — a site-speed hunt opens showing Lighthouse/SEO, not just contacts. A
   * saved column view still wins on revisit. Empty for discovery-only goals.
   */
  goalResearches?: string[];
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
  /**
   * Step 4 · which HEAVY row fields the server serialized into `rows` (the
   * `mapsly-wb-cols` cookie's active set → heavyFieldsForColumns). Fields
   * outside this list are ABSENT on every row until the lazy hydration
   * (getWorkbenchRowFieldsAction) fetches them — a column whose field isn't
   * loaded renders a loading cell, never the "— enrich" affordance.
   */
  serializedRowFields?: string[];
  /**
   * Step 4 · the saved-list scope for the lazy row-fields action (present on
   * the list workbench only; the market workbench scopes by discovery).
   */
  listId?: string;
}

/** How the table groups rows: flat, by cell, or by goal-signal verdict
 *  combination ("segment by pitch angle"). B18 · "signals" buckets by the
 *  VARYING goal signals (enriched on every visible lead and not pinned by an
 *  applied filter — see `signalGroupAxes`), NOT by the applied filters (an
 *  applied filter narrows to one verdict, a degenerate single bucket). With no
 *  varying signal the view derives back to flat. */
type GroupMode = "none" | "cell" | "signals";

export function LeadsWorkbench({
  rows,
  discoveryId,
  bands,
  coverageTypeStates,
  scannedAt = {},
  goalSignals = [],
  goalResearches = [],
  allSignals,
  exportSlug,
  serverPage = 1,
  serverPageCount = 1,
  totalRows = rows.length,
  exportAllUrl,
  serializedRowFields,
  listId,
}: LeadsWorkbenchProps) {
  // TRUTH UNIFICATION (2026-07-06) · the matrix is REQUIRED and covers every
  // rendered row (both pages scope loadCoverageMatrix to the rendered window).
  // The old legacy fallbacks (row `families` booleans built from GBP scalars,
  // the lossy family→type fan-out, and the whole 5-family display axis) are
  // deleted — a business genuinely absent from the matrix reads all-not_run,
  // honestly.
  /** The per-TYPE run-state map (the 9 billed types) — THE atom every surface
   *  derives from. Absent row → all not_run (honest). */
  const typeStatesFor = useCallback(
    (r: WorkbenchLeadRow): Record<EnrichmentTypeKey, TypeState> => {
      const fromMatrix = coverageTypeStates[r.businessId];
      if (fromMatrix) return fromMatrix;
      const out = {} as Record<EnrichmentTypeKey, TypeState>;
      for (const t of ENRICHMENT_TYPES) out[t.key] = "not_run";
      return out;
    },
    [coverageTypeStates],
  );
  /**
   * The honest per-DATA-GROUP run-state map (the 7 user-facing groups Tom reads
   * — the ONE coverage denominator) for one row, rolled up from its 9 per-type
   * states. THE input the row chip strip, the toolbar badge, and the coverage
   * panel all read, so `/ 7` is the same number everywhere.
   */
  const groupStatesFor = useCallback(
    (r: WorkbenchLeadRow): Record<DataGroupKey, TypeState> =>
      deriveGroupStates(typeStatesFor(r)),
    [typeStatesFor],
  );
  /** AUDIT A2/B1 · has a PER-LEAD enrichment run for this row — the ONE
   *  predicate behind the "Enriched only" view, the header count, and the stat
   *  strip (all three now share anyLeadGroupRan over the same typeStates).
   *  Per-market ads/search cell scans never count a lead as personally
   *  enriched. */
  const rowEnriched = useCallback(
    (r: WorkbenchLeadRow): boolean => anyLeadGroupRan(groupStatesFor(r)),
    [groupStatesFor],
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

  /**
   * Advance a lead one stage through the settable statuses (wraps to New).
   * HIDDEN is deliberately NOT in the cycle: the status tab-bar that used to
   * expose a Hidden tab / un-hide path is retired (owner 2026-07-06), so the
   * pill must never land a lead in HIDDEN — that would be a one-way trap (the
   * row then vanishes via `notHidden` with no in-workbench way back). Leads
   * hidden in an earlier session stay filtered out; they just can't be created
   * here anymore.
   */
  function cycleStatus(leadId: string, current: LeadStatus) {
    const i = SETTABLE_STATUSES.indexOf(current);
    const next = SETTABLE_STATUSES[(i + 1) % SETTABLE_STATUSES.length];
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
  // WB-COL-1 · seed the first-visit columns from the GOAL (defaults + the goal's
  // own data columns) once at mount. A saved column view still overrides this on
  // revisit (the localStorage-restore effect below), so user choices win.
  const [activeCols, setActiveCols] = useState<string[]>(() =>
    defaultActiveColumnsForGoal(goalResearches),
  );
  // WB-COL-2 · columns the user EXPLICITLY hid — the auto-show-after-research
  // handler never re-adds one (an explicit uncheck is permanent for this
  // research; re-checking clears it). Hydrated from the saved blob below.
  const [dismissedCols, setDismissedCols] = useState<string[]>([]);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  // F3 · the Fields picker's search box — filters visible column rows by label
  // (case-insensitive substring). Cleared when the popover closes.
  const [fieldsQuery, setFieldsQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  // THREE filter-add pickers, one per KIND (signal / field / data-state) — the
  // single "+ Filter" dropdown grew too long to scan. Each is its own short
  // Popover feeding the SAME `filters[]` / `stateFilters[]` models.
  const [signalMenuOpen, setSignalMenuOpen] = useState(false);
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false);
  const [stateMenuOpen, setStateMenuOpen] = useState(false);
  // B11c · the Group control is a quiet dropdown ("Group: none ▾"), not a
  // filled segmented control — grouping changes maybe once per session.
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  // The Fields, Group, Add-filter and Set-status menus are <Popover>s
  // (floating-ui handles portal + dismiss + focus). The Filters PANEL is an
  // inline collapse section, so it still uses the shared useDismiss for
  // outside-click. (B11b · the Coverage panel + its toolbar button are gone —
  // the have/not-yet summary is the always-on coverage strip above the table;
  // data-state filtering lives in the Filter popover's "+ Data state" list.)
  const filtersPanelRef = useRef<HTMLDivElement | null>(null);
  const filterBtnRef = useRef<HTMLButtonElement | null>(null);
  useDismiss(
    filtersOpen,
    () => setFiltersOpen(false),
    filtersPanelRef,
    filterBtnRef,
  );

  // Power-user keyboard shortcuts (Tom · .claude/rules/ui-ux-agency.md). Guarded
  // so they never fire while typing in a field or with a modifier held. Press
  // "?" for the on-screen cheat-sheet.
  useEffect(() => {
    anyOverlayOpenRef.current =
      helpOpen ||
      fieldsOpen ||
      signalMenuOpen ||
      fieldMenuOpen ||
      stateMenuOpen ||
      groupMenuOpen;
  }, [
    helpOpen,
    fieldsOpen,
    signalMenuOpen,
    fieldMenuOpen,
    stateMenuOpen,
    groupMenuOpen,
  ]);

  // The mount-once keydown effect below reads the thin-market flag via ref
  // (same stale-closure pattern as availSigKeysRef) — the 'v' shortcut must
  // see the live value. Computed from the prop directly so this can live
  // ABOVE its reader (react-compiler enforces declaration-before-effect-read)
  // — `marketIsThin` proper is derived later next to effectiveBands.
  const marketIsThinRef = useRef(false);
  useEffect(() => {
    marketIsThinRef.current = totalRows < THIN_MARKET_THRESHOLD;
  }, [totalRows]);

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
        case "F":
          // AUDIT U18 · open Filters (capital F = Filter; lowercase f = Fields).
          e.preventDefault();
          setFiltersOpen((o) => !o);
          break;
        case "g":
          e.preventDefault();
          // Cycle none → cell → signals → none. The signals stop is skipped
          // unless an ENRICHED, un-filtered goal signal can vary the buckets
          // (canGroupBySignals — cycleGroup reads it via ref); filters PIN a
          // verdict, they don't enable grouping.
          cycleGroupRef.current();
          break;
        case "v":
          e.preventDefault();
          // Thin market → vs-cell renders nothing (absolute benchmarks); a
          // toggle here would be a silent no-op key.
          if (!marketIsThinRef.current) setVsCell((v) => !v);
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
  // AUDIT C5 · field-state filters — "Contacts & site tech: have / none /
  // failed / not run", keyed by the 7 DATA GROUPS. Multiple states on the SAME
  // group are OR'd (contacts enriched OR failed); different groups are AND'd.
  // Applied client-side off the honest rolled-up group states. Declared here
  // (above the view-hydration + URL-write effects) so those effects can seed
  // from / push to it (C5 · round-trips through the goal URL).
  const [stateFilters, setStateFilters] = useState<FieldStateFilter[]>([]);
  // AUDIT §3/B1 · "Enriched only" view — isolate the leads an enrichment
  // actually ran on (what you paid for) from the whole website-having market.
  // Declared HERE (not with its toolbar button) because the view-hydration +
  // URL-write effects below reference it (eo= round-trip, code-review gap).
  const [enrichedOnly, setEnrichedOnly] = useState(false);

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
  // The shareable VIEW (sort + filters + state filters + status/not-touched)
  // has a SECOND source: the URL. B16 · when the URL carries ANY view param
  // (f=/sg=/fs=/sort/st/nt) the URL WINS WHOLESALE — a pasted link reproduces
  // the sender's view in full, never half-merging with this browser's saved
  // blob. Only a param-less URL falls back to localStorage, which also keeps
  // owning the non-shareable prefs (columns/group/density/pageSize).
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
        if (saved.dismissedCols !== undefined)
          setDismissedCols(saved.dismissedCols);
        if (saved.pageSize !== undefined) setPageSize(saved.pageSize);
      }
      // View precedence (B16 · the documented contract, WP-UX):
      //   1. a URL carrying view params wins for every dimension it ENCODES —
      //      sort, f=/sg= filters, fs= field-states, st=/nt=. The saved blob
      //      is ignored for those dimensions, so a shared link reproduces the
      //      sender's view. Filters count as encoded only when f=/sg= are
      //      PRESENT (hasFilterParams) — an st=-only URL resolves the filters
      //      dimension locally per 2/3 (seed-loss code-review fix).
      //   2. else the localStorage saved filters (signal + numeric) → the
      //      user's own choice, preserved across refresh + revisit.
      //   3. else the goal-step DEFAULT seed (goal signals ∩ enriched) — first
      //      visit only. Un-enriched goal signals are excluded (P0-B guard).
      // A restored SIGNAL filter (URL or blob) is validated against the signal
      // LIBRARY (allSignals ?? goalSignals) — an unknown key would read
      // all-null perSignal and hide every lead, so it drops. URL signal
      // filters carry sigLabel = sigKey placeholders; re-label from the
      // library here. `rows`/`goalSignals`/`allSignals` are the MOUNT-TIME
      // values (effect runs once per discoveryId) — paging must NOT re-run
      // this and clobber user edits.
      const titleByKey = new Map(
        (allSignals ?? goalSignals).map((s) => [s.key, s.title] as const),
      );
      if (urlView) {
        // Code-review fix (seed-loss) · the URL wins for every dimension it
        // ENCODES. Filters only count as encoded when f=/sg= were actually
        // present — a URL holding just st=/nt=/fs=/sort (one status-tab click,
        // then reload) says nothing about filters, so that dimension resolves
        // locally (saved blob → goal seed) exactly like a param-less URL.
        // Freezing [] + userTouched here permanently destroyed the goal seed.
        if (urlView.hasFilterParams) {
          setFilters(
            urlView.filters.flatMap((f): LeadFilter[] => {
              if (f.kind !== "signal") return [f];
              const title = titleByKey.get(f.sigKey);
              return title ? [{ ...f, sigLabel: title }] : [];
            }),
          );
          userTouchedRef.current = true;
        } else if (saved?.filters !== undefined) {
          setFilters(
            saved.filters.filter(
              (f) => f.kind !== "signal" || titleByKey.has(f.sigKey),
            ),
          );
          userTouchedRef.current = true;
        } else {
          setFilters(seedSignalFilters(rows, goalSignals));
          userTouchedRef.current = false;
        }
        setSortKey(urlView.sortKey);
        setSortDir(urlView.sortDir);
        setStateFilters(urlView.fieldStates ?? []);
        // st=/nt= (status tab · not-touched) are still parsed by the codec but
        // no longer consumed — the status tab-bar was retired (owner
        // 2026-07-06). An old shared link carrying them just ignores them.
        if (urlView.enrichedOnly) setEnrichedOnly(true);
      } else if (saved?.filters !== undefined) {
        setFilters(
          saved.filters.filter(
            (f) => f.kind !== "signal" || titleByKey.has(f.sigKey),
          ),
        );
        userTouchedRef.current = true; // a saved choice → keep persisting it
        if (saved.sortKey !== undefined) setSortKey(saved.sortKey);
        if (saved.sortDir !== undefined) setSortDir(saved.sortDir);
      } else {
        // B4 · the seed judges the mount-time window as-is: in this branch the
        // URL carried no view params, so there is no narrowing to scope by yet
        // (search/enriched-only/state filters are all at their defaults).
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
    // Step 4 · mirror the active-column set into the ONE server-readable
    // cookie so the NEXT render serializes exactly the heavy fields these
    // columns need (no lazy fetch on revisit). Defensive on both ends —
    // parseWbColsCookie drops stale keys server-side.
    document.cookie = `${WB_COLS_COOKIE}=${serializeWbColsCookie(activeCols)}; path=/; max-age=31536000; SameSite=Lax`;
    saveWorkbenchView(discoveryId, {
      vsCell,
      group,
      activeCols,
      dismissedCols,
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
    dismissedCols,
    filters,
    sortKey,
    sortDir,
    pageSize,
  ]);

  // Mirror the shareable view into the URL (WP4-13 · shareable views). SHALLOW
  // — window.history.replaceState updates the address bar without an RSC
  // round-trip (the server never reads these params; only `?page=` is
  // server-read). Debounced 300ms so typing a filter value doesn't churn
  // history. Other params (lead/page) are preserved by viewToSearchParams.
  useEffect(() => {
    if (!hydrated.current) return;
    const tid = window.setTimeout(() => {
      const params = viewToSearchParams(
        // C5 · field-state filters ride the SAME shareable-view URL writer as
        // sort + filters (one `fs=group:state` param each); B5 adds st=/nt=.
        // B16 · signal filters serialize too (sg=) — EXCEPT while the set is
        // still the pure goal-default seed (userTouched=false): materializing
        // the seed in the URL would freeze it on reload (the seed must
        // re-derive and pick up newly enriched signals). Numeric filters are
        // always user choices → always shareable.
        {
          sortKey,
          sortDir,
          filters: userTouchedRef.current
            ? filters
            : filters.filter((f) => f.kind !== "signal"),
          fieldStates: stateFilters,
          enrichedOnly: enrichedOnly || undefined,
        },
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
  }, [filters, sortKey, sortDir, stateFilters, enrichedOnly]);

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

  // ── Step 4 · lazy HEAVY-field hydration ─────────────────────────────────────
  // The server serialized only the heavy fields of the cookie's active-column
  // set (`serializedRowFields`); anything else is ABSENT from `rows`. When a
  // column needing an unshipped field becomes active (Fields toggle, a restored
  // view that outruns the cookie, an auto-shown column after a run), ONE action
  // call fetches that field for the whole window and overlays it. Cells of a
  // still-loading column render a loading state — never the "— enrich"
  // affordance (which would lie about data that exists in the DB).
  const [fetched, setFetched] = useState<{
    fields: ReadonlySet<string>;
    values: Record<string, WorkbenchRowFieldValues>;
  }>({ fields: new Set(), values: {} });
  // In-flight fields — a ref so the effect can't double-fetch mid-request.
  const pendingHeavyRef = useRef<Set<string>>(new Set());
  // REVIEW FIX 1 · window generation: bumped whenever the server payload
  // changes. A fetch captures the generation at start; a resolve from a PRIOR
  // window is DISCARDED (merging it would mark the field "loaded" with values
  // keyed to rows that no longer exist — the exact "— enrich over real data"
  // lie Step 4 exists to prevent, plus silent blank CSV columns).
  const windowGenRef = useRef(0);
  // REVIEW FIX 2 · fields whose hydration FAILED — their columns render a
  // retry cell instead of an infinite "loading…" (and are excluded from the
  // auto-refetch loop so a persistent failure can't spin).
  const [failedHeavy, setFailedHeavy] = useState<ReadonlySet<string>>(
    new Set(),
  );

  // A NEW server payload (window nav / live-run refresh) re-serializes per the
  // cookie — drop the previous overlay so stale values never mask fresh rows,
  // invalidate in-flight fetches (generation bump) and clear pending/failed so
  // the new window hydrates cleanly. Deferred write per the repo's
  // set-state-in-effect pattern.
  useEffect(() => {
    windowGenRef.current += 1;
    pendingHeavyRef.current.clear();
    const tid = window.setTimeout(() => {
      setFetched((prev) =>
        prev.fields.size === 0 && Object.keys(prev.values).length === 0
          ? prev
          : { fields: new Set(), values: {} },
      );
      setFailedHeavy((prev) => (prev.size === 0 ? prev : new Set()));
    }, 0);
    return () => window.clearTimeout(tid);
  }, [rows]);

  /** Heavy fields available on the CURRENT rows (server-shipped ∪ fetched). */
  const loadedHeavy = useMemo(
    () => new Set([...(serializedRowFields ?? []), ...fetched.fields]),
    [serializedRowFields, fetched.fields],
  );

  const mergeFetched = useCallback(
    (
      fields: readonly string[],
      values: Record<string, WorkbenchRowFieldValues>,
    ) => {
      setFetched((prev) => {
        const nextFields = new Set(prev.fields);
        for (const f of fields) nextFields.add(f);
        const nextValues: Record<string, WorkbenchRowFieldValues> = {
          ...prev.values,
        };
        for (const [id, v] of Object.entries(values)) {
          nextValues[id] = { ...nextValues[id], ...v };
        }
        return { fields: nextFields, values: nextValues };
      });
    },
    [],
  );

  /** Fetch heavy fields for the whole current window, overlay them, and
   *  return the raw values (the CSV export reads them synchronously). Null on
   *  failure (toasted — the effect retries on the next column/load change). */
  const hydrateHeavyFields = useCallback(
    async (
      needed: readonly HeavyRowField[],
    ): Promise<Record<string, WorkbenchRowFieldValues> | null> => {
      // REVIEW FIX 1 · capture the window generation; a resolve from a prior
      // window is discarded wholesale (values would be keyed to stale rows).
      const gen = windowGenRef.current;
      try {
        const res = await getWorkbenchRowFieldsAction({
          discoveryId,
          listId,
          page: serverPage,
          fields: [...needed],
        });
        if (gen !== windowGenRef.current) return null; // window moved on
        if (res.status !== "ok") {
          showToast("Couldn't load column data — try again", "error");
          setFailedHeavy((prev) => new Set([...prev, ...needed]));
          return null;
        }
        mergeFetched(needed, res.values);
        setFailedHeavy((prev) => {
          if (![...needed].some((f) => prev.has(f))) return prev;
          const next = new Set(prev);
          for (const f of needed) next.delete(f);
          return next;
        });
        return res.values;
      } catch {
        if (gen === windowGenRef.current) {
          showToast("Couldn't load column data — try again", "error");
          setFailedHeavy((prev) => new Set([...prev, ...needed]));
        }
        return null;
      } finally {
        // Only release the in-flight markers if this window still owns them —
        // a new window already cleared/re-added its own.
        if (gen === windowGenRef.current)
          for (const f of needed) pendingHeavyRef.current.delete(f);
      }
    },
    [discoveryId, listId, serverPage, mergeFetched],
  );

  // Toggle-driven hydration: any ACTIVE column whose heavy field isn't loaded
  // triggers one fetch for the missing union. AUDIT B2 · applied numeric
  // FILTERS on heavy fields (SEO / SERP rank / Meta ads / Google ads) hydrate
  // through the same path — a "SEO score < 80" filter must never silently
  // evaluate over an unshipped field (until the fetch lands the values are
  // null → the chip's visible no-data bucket, never a silent drop). Re-runs
  // as loads land (needed empties) — a failed fetch retries on the next
  // column/filter/load change.
  useEffect(() => {
    const wanted = new Set<HeavyRowField>([
      ...heavyFieldsForColumns(activeCols),
      ...heavyFieldsForFilters(filters),
    ]);
    const needed = [...wanted].filter(
      (f) =>
        !loadedHeavy.has(f) &&
        !pendingHeavyRef.current.has(f) &&
        // REVIEW FIX 2 · failed fields wait for an explicit retry click.
        !failedHeavy.has(f),
    );
    if (needed.length === 0) return;
    for (const f of needed) pendingHeavyRef.current.add(f);
    void hydrateHeavyFields(needed);
  }, [activeCols, filters, loadedHeavy, failedHeavy, hydrateHeavyFields]);

  // The render rows: the server payload overlaid with lazily-fetched fields.
  const effectiveRows = useMemo(() => {
    if (Object.keys(fetched.values).length === 0) return rows;
    return rows.map((r) => {
      const extra = fetched.values[r.businessId];
      return extra ? { ...r, ...extra } : r;
    });
  }, [rows, fetched.values]);

  // Active columns whose heavy field hasn't landed yet → their cells render a
  // loading state (renderCell gates on this before touching the value).
  const unloadedCols = useMemo(() => {
    const out = new Set<string>();
    for (const key of activeCols) {
      for (const f of heavyFieldsForColumns([key])) {
        if (!loadedHeavy.has(f) && !failedHeavy.has(f)) {
          out.add(key);
          break;
        }
      }
    }
    return out;
  }, [activeCols, loadedHeavy, failedHeavy]);

  // REVIEW FIX 2 · columns whose heavy field FAILED to hydrate → retry cell.
  const failedCols = useMemo(() => {
    const out = new Set<string>();
    for (const key of activeCols) {
      for (const f of heavyFieldsForColumns([key])) {
        if (failedHeavy.has(f)) {
          out.add(key);
          break;
        }
      }
    }
    return out;
  }, [activeCols, failedHeavy]);
  const retryHeavyCols = useCallback((colKey: string) => {
    const fields = heavyFieldsForColumns([colKey]);
    setFailedHeavy((prev) => {
      const next = new Set(prev);
      for (const f of fields) next.delete(f);
      return next;
    });
    // The hydration effect refires via the failedHeavy dep.
  }, []);

  // WB-COL-3 · the render-order registry for THIS research: the research-
  // detail span's data-group clusters are re-ordered goal-first (a site-speed
  // hunt reads perf/seo right after the contact anchors). Derived ONCE from
  // the research's PERSISTED goal (`goalResearches`), never from live filter/
  // signal state — spatial memory stays stable for the whole session.
  const renderColumns = useMemo(
    () => orderColumnsForGoal(goalResearches),
    [goalResearches],
  );
  // The active column defs in render order — the static VALUE columns selected
  // in the Fields menu. Pure-boolean signal verdicts are filter work, not
  // columns (a ✓/— cell carries no per-lead value — "Has a website" is ~always
  // ✓), so the goal-signal columns were removed: signals live as FILTERS (the
  // whole library via "+ Signal") and "which of your signals fired" shows
  // compactly in the Pain-points "why qualifies" chips.
  const cols = useMemo(
    () => renderColumns.filter((c) => activeCols.includes(c.key)),
    [renderColumns, activeCols],
  );

  // WB-COL-3 · the FIRST column of each consecutive data-group run in the
  // active set — gets the `.gstart` boundary class (th + td) so adjacent
  // group members read as one cluster. Workflow columns (no group) never
  // start a boundary.
  const groupStartKeys = useMemo(() => {
    const out = new Set<string>();
    for (let i = 0; i < cols.length; i += 1) {
      const g = cols[i]!.group;
      if (!g) continue;
      if (i === 0 || cols[i - 1]!.group !== g) out.add(cols[i]!.key);
    }
    return out;
  }, [cols]);

  // F3 · the Fields picker, grouped by ENRICHMENT TYPE + search-filtered. Every
  // toggle-able column (all except the always-on `biz` anchor) is bucketed under
  // its `typeGroup` header; the search box narrows to labels containing the
  // query (case-insensitive). Sections with no surviving column are dropped so
  // the menu never shows an empty header.
  const fieldsGroups = useMemo((): {
    group: ColumnTypeGroup;
    cols: readonly ColumnDef[];
  }[] => {
    const q = fieldsQuery.trim().toLowerCase();
    const matches = (c: ColumnDef) =>
      c.key !== "biz" &&
      (q === "" || (c.fullLabel ?? c.label).toLowerCase().includes(q));
    return COLUMN_TYPE_GROUP_ORDER.map((group) => ({
      group,
      cols: COLUMNS.filter((c) => c.typeGroup === group && matches(c)),
    })).filter((s) => s.cols.length > 0);
  }, [fieldsQuery]);

  // AUDIT C5 · field-state filter helpers (the `stateFilters` state itself is
  // declared above, near `filters`, so the view-hydration + URL-write effects
  // can round-trip it through the goal URL).
  const toggleStateFilter = useCallback(
    (group: DataGroupKey, state: FieldFilterState) => {
      setStateFilters((prev) => {
        const hit = prev.some((f) => f.group === group && f.state === state);
        return hit
          ? prev.filter((f) => !(f.group === group && f.state === state))
          : [...prev, { group, state }];
      });
      setPage(1);
    },
    [],
  );
  const stateFilterByGroup = useMemo(() => {
    // Set<TypeState> (not FieldFilterState) so `allowed.has(rowState)` type-
    // checks — a row's group state can be "running", which is never a filter
    // value, so a mid-run row matches NO state filter (transient, honest).
    const m = new Map<DataGroupKey, Set<TypeState>>();
    for (const f of stateFilters) {
      const s = m.get(f.group) ?? new Set<TypeState>();
      s.add(f.state);
      m.set(f.group, s);
    }
    return m;
  }, [stateFilters]);
  const passesStateFilters = useCallback(
    (r: WorkbenchLeadRow): boolean => {
      if (stateFilterByGroup.size === 0) return true;
      const gs = groupStatesFor(r);
      for (const [group, allowed] of stateFilterByGroup) {
        if (!allowed.has(gs[group])) return false;
      }
      return true;
    },
    [stateFilterByGroup, groupStatesFor],
  );

  // "Now" for the relative Last-contacted form — null during SSR + first
  // paint (the deterministic absolute date renders), set once after mount
  // (INC-09: no Date.now() during prerender, no hydration drift).
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const tid = window.setTimeout(() => setNowMs(Date.now()), 0);
    return () => window.clearTimeout(tid);
  }, []);

  // AUDIT U7 · row density — Compact is the default for a scan-heavy audience;
  // the choice persists per user. Default matches SSR; a saved "cozy" is applied
  // after mount (a one-frame settle, no hydration mismatch).
  const [density, setDensity] = useState<"compact" | "cozy">("compact");
  useEffect(() => {
    // Defer the write out of the effect body (same setTimeout(0) pattern the
    // view-state hydration uses) to satisfy react-hooks/set-state-in-effect.
    const tid = window.setTimeout(() => {
      const saved = window.localStorage.getItem("wb-density");
      if (saved === "cozy" || saved === "compact") setDensity(saved);
    }, 0);
    return () => window.clearTimeout(tid);
  }, []);
  function toggleDensity() {
    setDensity((d) => {
      const next = d === "compact" ? "cozy" : "compact";
      window.localStorage.setItem("wb-density", next);
      return next;
    });
  }

  // B11g · one-time "Press ? for shortcuts" hint — replaces the deleted "?"
  // toolbar button (its only job was first-week discoverability; the ? key +
  // modal are untouched). Shown on the first workbench visit, dismissed by ×
  // or by actually opening the shortcuts modal; the flag persists forever.
  const [showShortcutHint, setShowShortcutHint] = useState(false);
  useEffect(() => {
    const tid = window.setTimeout(() => {
      try {
        if (!window.localStorage.getItem(SHORTCUT_HINT_KEY))
          setShowShortcutHint(true);
      } catch {
        // storage disabled — skip the hint entirely.
      }
    }, 0);
    return () => window.clearTimeout(tid);
  }, []);
  const dismissShortcutHint = useCallback(() => {
    setShowShortcutHint(false);
    try {
      window.localStorage.setItem(SHORTCUT_HINT_KEY, "1");
    } catch {
      // best-effort — worst case the hint shows again next visit.
    }
  }, []);
  useEffect(() => {
    // Opening the shortcuts modal proves discovery — retire the hint.
    if (!helpOpen || !showShortcutHint) return;
    const tid = window.setTimeout(dismissShortcutHint, 0);
    return () => window.clearTimeout(tid);
  }, [helpOpen, showShortcutHint, dismissShortcutHint]);

  // AUDIT · the frozen Business column should read as "detached" only once the
  // grid is scrolled horizontally. Track scrollLeft on the table wrap so a
  // `data-scrolled-x` attr can gate a box-shadow edge (no always-on border that
  // reads as a table gridline at rest). box-shadow (not border) so nothing shifts.
  const tableWrapRef = useRef<HTMLDivElement | null>(null);
  const [scrolledX, setScrolledX] = useState(false);
  useEffect(() => {
    const el = tableWrapRef.current;
    if (!el) return;
    const onScroll = () => setScrolledX(el.scrollLeft > 0);
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll(); // settle the initial state (e.g. a restored scroll position)
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // AUDIT U2/D5 + ISSUE-11 · per-cell "running" state. TWO sources, OR-ed:
  //   1. the client bus — the enrich sheet announces the (business × TYPE) scope
  //      the moment a run launches (instant, optimistic; dies on reload);
  //   2. the server per-type matrix — `typeStates[T] === "running"` from
  //      QUEUED/RUNNING jobs + active cell runs (survives refresh, cross-tab).
  // The old "only when not_run" gate suppressed the loader on every
  // RE-enrichment (any prior state ≠ not_run) — the exact "ran Meta ads,
  // no loader, stale None" the owner reported. It's gone: the bus flag clears on
  // the run-finished signal from LiveRunGate (+ a 5-min backstop timeout).
  const [enriching, setEnriching] = useState<{
    ids: Set<string>;
    types: Set<string>;
    all: boolean;
  } | null>(null);
  useEffect(
    () =>
      subscribeEnrichScope((d) =>
        setEnriching({
          ids: new Set(d.businessIds),
          types: new Set(d.types),
          all: d.all === true,
        }),
      ),
    [],
  );
  // WB-COL-2 · refs keep the []-deps enrich-finished handler honest: it reads
  // the LIVE column/scope state, not the mount-time closure.
  const enrichingRef = useRef<{
    ids: Set<string>;
    types: Set<string>;
    all: boolean;
  } | null>(null);
  useEffect(() => {
    enrichingRef.current = enriching;
  }, [enriching]);
  const activeColsRef = useRef(activeCols);
  useEffect(() => {
    activeColsRef.current = activeCols;
  }, [activeCols]);
  const dismissedColsRef = useRef(dismissedCols);
  useEffect(() => {
    dismissedColsRef.current = dismissedCols;
  }, [dismissedCols]);
  // B17 · re-seed-on-enrich-finished machinery. Semantics: when a run goes
  // terminal we SNAPSHOT which goal signals were already fully computable on
  // the narrowed view (availSigKeysRef); once the refreshed rows land and the
  // availability set grows, the goal signals that JUST crossed into fully-
  // computable are auto-applied as "match" filters — exactly the mount seed,
  // continued mid-session — UNLESS the user removed that signal chip this
  // session (removedSignalsRef: an explicit deletion is never fought) or it's
  // already applied. The snapshot expires after 5 min so a much-later
  // availability change (e.g. removing a numeric filter) can't trigger a
  // phantom seed.
  const removedSignalsRef = useRef<Set<string>>(new Set());
  const availSigKeysRef = useRef<ReadonlySet<string>>(new Set());
  const preRunAvailRef = useRef<{
    avail: ReadonlySet<string>;
    at: number;
  } | null>(null);
  // WB-COL-2 · the run went terminal → (1) auto-show the columns for what was
  // just BOUGHT (append-only, dismissed-aware) with a delayed toast naming the
  // groups, then (2) clear the optimistic per-cell flags. Purchased basket:
  // server truth (LiveRunGate forwards the terminal payload's enrichments)
  // first; the same-session bus scope as fallback — read BEFORE the
  // setEnriching(null) clear (the fallback types live in the state being
  // cleared).
  useEffect(
    () =>
      subscribeEnrichFinished((serverTypes) => {
        // B17 · snapshot the PRE-run signal availability — the refreshed rows
        // haven't landed yet (LiveRunGate router.refresh()es after this), so
        // the reseed effect below compares against this once they do.
        preRunAvailRef.current = {
          avail: new Set(availSigKeysRef.current),
          at: Date.now(),
        };
        const types =
          serverTypes.length > 0
            ? serverTypes
            : [...(enrichingRef.current?.types ?? [])];
        const { cols: addCols, groups } = columnsToAutoShow(
          types,
          activeColsRef.current,
          dismissedColsRef.current,
        );
        if (addCols.length > 0) {
          // Append-only — render order derives from the render-column
          // registry (the `cols` memo filters it), so a plain append keeps
          // the on-screen order canonical.
          setActiveCols((prev) => [
            ...prev,
            ...addCols.filter((c) => !prev.includes(c)),
          ]);
          const names = groups.map((g) => dataGroupFor(g).label).join(", ");
          // Delayed ~1.5s: the single-slot ToastHost would otherwise clobber
          // LiveRunGate's "Enriched N · M failed" toast (the count Tom trusts).
          window.setTimeout(
            () =>
              showToast(`New data: ${names} — columns added`, "info", {
                label: "Undo",
                onClick: () => {
                  // Undo removes the added columns AND dismisses them, so the
                  // next re-run stays quiet.
                  setActiveCols((p) => p.filter((c) => !addCols.includes(c)));
                  setDismissedCols((p) => [...new Set([...p, ...addCols])]);
                },
              }),
            1500,
          );
        }
        setEnriching(null); // existing behavior — AFTER reading the fallback
      }),
    [],
  );
  useEffect(() => {
    if (!enriching) return;
    const t = window.setTimeout(() => setEnriching(null), 5 * 60_000);
    return () => window.clearTimeout(t);
  }, [enriching]);
  /**
   * Is any of these enrichment-type tokens in flight for this row? Core of the
   * per-field loaders. Cell-basis tokens (meta_ads/serp) run once per MARKET
   * cell and update every lead in it — they match regardless of the per-lead id
   * scope. The server fallback reads the honest per-type `running` state.
   */
  const isTokensEnriching = useCallback(
    (r: WorkbenchLeadRow, tokens: readonly string[]): boolean => {
      if (tokens.length === 0) return false;
      if (enriching) {
        for (const t of tokens) {
          if (!enriching.types.has(t)) continue;
          if (
            CELL_BASIS_TOKENS.has(t) ||
            enriching.all ||
            enriching.ids.has(r.businessId)
          )
            return true;
        }
      }
      // Server truth (refresh-surviving): the type is QUEUED/RUNNING, or an
      // active run covers this row's cell for a cell-basis type.
      const ts = typeStatesFor(r);
      for (const t of tokens) {
        const key = typeKeyForEnrichToken(t);
        if (key && ts[key] === "running") return true;
      }
      return false;
    },
    [enriching, typeStatesFor],
  );
  /** The enrichment-type tokens behind ONE column — its explicit `enrichTypes`
   *  override, else its data group's default set. */
  const colTokens = useCallback(
    (col: ColumnDef): readonly string[] =>
      col.enrichTypes ?? (col.group ? enrichTypesForGroups([col.group]) : []),
    [],
  );
  const isColEnriching = useCallback(
    (col: ColumnDef, r: WorkbenchLeadRow): boolean =>
      isTokensEnriching(r, colTokens(col)),
    [isTokensEnriching, colTokens],
  );
  /**
   * AUDIT C5 · wrap ONE value cell's `<td>` in the loading state when its types
   * are in flight for this lead: dim the value + block interaction
   * (`pointer-events:none` via `.cell-loading` + `aria-busy`) WITHOUT changing
   * the cell content (so the column width never shifts). ISSUE-4 · no second
   * sweep bar appended — the double bar is what wrapped the loader onto two
   * lines. Cells with no enrich types (biz/match/status/…) return unchanged.
   */
  const withCellLoading = useCallback(
    (col: ColumnDef, r: WorkbenchLeadRow, td: ReactElement): ReactElement => {
      if (!isColEnriching(col, r) || !isValidElement(td)) return td;
      const prev = (td.props as { className?: string }).className;
      return cloneElement(
        td as ReactElement<{
          className?: string;
          "aria-busy"?: boolean;
        }>,
        {
          className: `${prev ? `${prev} ` : ""}cell-loading`,
          "aria-busy": true,
        },
      );
    },
    [isColEnriching],
  );

  /**
   * WB-COL-3 · append the `.gstart` data-group boundary class to a body cell
   * when its column starts a group cluster (same cloneElement discipline as
   * withCellLoading — the cell content never changes, so widths never shift).
   */
  const withGroupStart = useCallback(
    (col: ColumnDef, td: ReactElement): ReactElement => {
      if (!groupStartKeys.has(col.key) || !isValidElement(td)) return td;
      const prev = (td.props as { className?: string }).className;
      return cloneElement(td as ReactElement<{ className?: string }>, {
        className: `${prev ? `${prev} ` : ""}gstart`,
      });
    },
    [groupStartKeys],
  );

  // AUDIT U16 + B7 · the per-cell provenance tooltip for a numeric enriched
  // value: `{source} · scanned {when} · {age}[ · stale]`. The source names
  // WHERE the number came from (SOURCE_BY_GROUP); `{when}`/`{age}` are the
  // REAL last-scanned date + age from the same freshness cursors billing uses
  // (threaded via `scannedAt`). B7 · the old version FABRICATED "fresh" from
  // the run state (a February score read "fresh" in July) — now "stale" only
  // appears when the scan is genuinely > 30 days old, and with no timestamp
  // we say nothing about freshness at all (never fabricate). The age clause
  // needs a client "now" (nowMs — null during SSR/first paint, the INC-09
  // pattern), so pre-mount tips carry just the date.
  const cellProvenance = useCallback(
    (r: WorkbenchLeadRow, group?: DataGroupKey): string | undefined => {
      if (!group) return undefined;
      const source = SOURCE_BY_GROUP[group];
      if (!source) return undefined;
      const iso = scannedAt[r.businessId]?.[group];
      const when = fmtScannedWhen(iso);
      if (!iso || !when) return source; // no timestamp → no freshness claim
      const t = Date.parse(iso);
      if (nowMs == null || Number.isNaN(t))
        return `${source} · scanned ${when}`;
      const ageMs = Math.max(0, nowMs - t);
      const days = Math.floor(ageMs / 86_400_000);
      const age = days === 0 ? "today" : `${days}d ago`;
      return ageMs > STALE_AFTER_MS
        ? `${source} · scanned ${when} · ${age} · stale`
        : `${source} · scanned ${when} · ${age}`;
    },
    [scannedAt, nowMs],
  );

  // ── Filtered + sorted rows ────────────────────────────────────────────────
  // Over effectiveRows (Step 4): the server payload + the lazily-hydrated
  // heavy fields — so a freshly-toggled column sorts/exports real values.
  //
  // Hidden leads stay out of the default view — they were hidden deliberately.
  // The status tab-bar that used to expose a "Hidden" tab is retired (owner
  // 2026-07-06), so hiding a lead now simply removes it from the workbench.
  // Reads the optimistic status so a just-hidden pill leaves immediately.
  const notHidden = useCallback(
    (r: WorkbenchLeadRow): boolean =>
      (optimistic[r.leadId] ?? r.status) !== "HIDDEN",
    [optimistic],
  );

  const filtered = useMemo(() => {
    const f = effectiveRows.filter(
      (r) =>
        notHidden(r) &&
        matchesSearch(r, search) &&
        passesFilters(r, filters) &&
        (!enrichedOnly || rowEnriched(r)) &&
        passesStateFilters(r),
    );
    return sortRows(f, sortKey, sortDir);
  }, [
    effectiveRows,
    notHidden,
    search,
    filters,
    enrichedOnly,
    rowEnriched,
    passesStateFilters,
    sortKey,
    sortDir,
  ]);

  // B10 · is ANY narrowing active? Drives the honest "X of N" count suffix,
  // the cross-window hint (B9), and the "Filters hide all N leads" empty
  // state (B1d) — the old logic keyed off filters[]+search only, so a
  // state-filter/Enriched-only narrowing showed a bare "8 leads".
  const anyNarrowing =
    filters.length > 0 ||
    search.trim() !== "" ||
    stateFilters.length > 0 ||
    enrichedOnly;

  // Count of enriched leads in the current window (for the toggle label).
  const enrichedCount = useMemo(
    () => rows.filter((r) => rowEnriched(r)).length,
    [rows, rowEnriched],
  );

  // Signal availability (hoisted — both the grouping axes and the "+ Signal"
  // picker read it). `signalLibrary` = the whole curated library the page
  // supplied (falls back to the goal signals for the list page).
  const signalLibrary = useMemo(
    () => allSignals ?? goalSignals,
    [allSignals, goalSignals],
  );
  const goalKeySet = useMemo(
    () => new Set(goalSignals.map((s) => s.key)),
    [goalSignals],
  );
  // AUDIT B4 · the signal gate judges the FILTERED VIEW, not the whole window:
  // rows passing state filters + enriched-only + search + NUMERIC filters —
  // never the signal filters themselves (circular: an applied signal filter
  // would gate its own availability). Enrich the best 50 of 1,000 and narrow
  // to "Reviews: have" → the paid signals unlock for that slice instead of
  // staying hostage to the 950 unbought leads.
  const numericFilters = useMemo(
    () => filters.filter((f) => f.kind !== "signal"),
    [filters],
  );
  const gatingRows = useMemo(
    () =>
      effectiveRows.filter(
        (r) =>
          matchesSearch(r, search) &&
          passesFilters(r, numericFilters) &&
          (!enrichedOnly || rowEnriched(r)) &&
          passesStateFilters(r),
      ),
    [
      effectiveRows,
      search,
      numericFilters,
      enrichedOnly,
      rowEnriched,
      passesStateFilters,
    ],
  );
  const availSigKeys = useMemo(
    () => availableSignalKeys(gatingRows, signalLibrary),
    [gatingRows, signalLibrary],
  );
  // Numeric-field availability stays WINDOW-scoped (stable option list while
  // filtering); B2 · un-hydrated heavy fields count as available (unknown ≠
  // absent — adding the filter triggers the hydration).
  const availNumFields = useMemo(
    () => availableNumericFields(rows, loadedHeavy),
    [rows, loadedHeavy],
  );

  // AUDIT B3 · per-chip honest breakdown ("42 match · 31 no data") over the
  // CURRENT VIEW minus the chip itself — each chip describes what it acts on,
  // not the post-filter survivors. Indexed like `filters`.
  const filterBreakdowns = useMemo(
    () =>
      filters.map((f, i) => {
        const others = filters.filter((_, j) => j !== i);
        const view = effectiveRows.filter(
          (r) =>
            notHidden(r) &&
            matchesSearch(r, search) &&
            (!enrichedOnly || rowEnriched(r)) &&
            passesStateFilters(r) &&
            passesFilters(r, others),
        );
        return filterBreakdown(view, f);
      }),
    [
      filters,
      effectiveRows,
      search,
      enrichedOnly,
      rowEnriched,
      passesStateFilters,
      notHidden,
    ],
  );

  // B2 · is a numeric filter's heavy backing field still hydrating? The chip
  // shows a subtle loading state instead of a misleading "0 match" while the
  // one-shot fetch is in flight.
  const filterFieldLoading = useCallback(
    (field: NumericFilterField): boolean =>
      [...heavyFieldsForColumns([field])].some(
        (hf) => !loadedHeavy.has(hf) && !failedHeavy.has(hf),
      ),
    [loadedHeavy, failedHeavy],
  );

  // B17 · keep the []-deps enrich-finished handler's availability snapshot
  // honest (it reads the LIVE set via ref, not a mount-time closure)…
  useEffect(() => {
    availSigKeysRef.current = availSigKeys;
  }, [availSigKeys]);
  // …then, once the refreshed rows land and availability grows, auto-apply
  // the goal signals that JUST became fully computable on the narrowed view
  // (see the removedSignalsRef/preRunAvailRef doc above for the semantics).
  // Not marked userTouched: like the mount seed, a pure default is never
  // frozen into the blob/URL until the user takes control.
  useEffect(() => {
    const snap = preRunAvailRef.current;
    if (!snap) return;
    if (Date.now() - snap.at > 5 * 60_000) {
      preRunAvailRef.current = null;
      return;
    }
    const newly = goalSignals.filter(
      (s) =>
        availSigKeys.has(s.key) &&
        !snap.avail.has(s.key) &&
        !removedSignalsRef.current.has(s.key) &&
        !filters.some((f) => f.kind === "signal" && f.sigKey === s.key),
    );
    if (newly.length === 0) return; // keep waiting for the refreshed rows
    preRunAvailRef.current = null;
    // Deferred write per the repo's set-state-in-effect pattern.
    const tid = window.setTimeout(() => {
      setFilters((prev) => [
        ...prev,
        ...newly
          .filter(
            (s) => !prev.some((f) => f.kind === "signal" && f.sigKey === s.key),
          )
          .map((s) => ({
            kind: "signal" as const,
            sigKey: s.key,
            sigLabel: s.title,
            want: "match" as const,
          })),
      ]);
    }, 0);
    return () => window.clearTimeout(tid);
  }, [availSigKeys, goalSignals, filters]);

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

  /**
   * U18 · restore a set of leads to their captured PRIOR statuses (the Undo of a
   * bulk status change). Since the bulk action takes ONE target status, we group
   * the restore by prior status and issue one bulk call per distinct prior value
   * (usually exactly one — a bulk change most often sweeps same-status leads).
   * Only the status/label bulk mutation is reversible; credit SPEND (bulk
   * enrich) is NOT undoable, so no undo is offered there.
   */
  function restoreStatuses(prior: Record<string, LeadStatus>) {
    const entries = Object.entries(prior);
    if (entries.length === 0) return;
    startTransition(async () => {
      for (const [id, s] of entries) applyOptimistic({ leadId: id, status: s });
      // Bucket ids by the status to restore them to (one bulk call per bucket).
      const byStatus = new Map<LeadStatus, string[]>();
      for (const [id, s] of entries) {
        const arr = byStatus.get(s);
        if (arr) arr.push(id);
        else byStatus.set(s, [id]);
      }
      const restored: Record<string, LeadStatus> = {};
      const failed: string[] = [];
      for (const [s, ids] of byStatus) {
        const r = await setLeadStatusBulkAction({
          leadIds: ids,
          status: s,
          discoveryId,
        });
        const failedSet = new Set(r.status === "ok" ? r.failedIds : ids);
        for (const id of ids) {
          if (failedSet.has(id)) failed.push(id);
          else restored[id] = s;
        }
      }
      if (Object.keys(restored).length) {
        setCommitted((p) => ({ ...p, ...restored }));
      }
      if (failed.length > 0)
        showToast(
          `Couldn't undo ${failed.length} lead${failed.length === 1 ? "" : "s"}`,
          "error",
        );
    });
  }

  function bulkSetStatus(status: LeadStatus) {
    const ids = [...selected];
    // U18 · snapshot each lead's CURRENT committed status BEFORE the change, so
    // the Undo can restore the exact prior value (not a blanket reset).
    const priorByLead: Record<string, LeadStatus> = {};
    for (const id of ids) priorByLead[id] = committed[id] ?? status;
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
        // U18 · offer an Undo restoring the ok'd leads to their prior statuses.
        // Only leads whose status actually changed are worth reverting.
        const changed: Record<string, LeadStatus> = {};
        for (const id of okIds) {
          if (priorByLead[id] !== status) changed[id] = priorByLead[id]!;
        }
        const n = Object.keys(changed).length;
        if (n > 0) {
          showToast(`${n} lead${n === 1 ? "" : "s"} set to ${status}`, "info", {
            label: "Undo",
            onClick: () => restoreStatuses(changed),
          });
        }
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
   *
   * Step 4 · `pitchAngle` is a CSV-only field, never serialized eagerly — the
   * export hydrates it on demand (one action call for the window) so the CSV
   * columns stay identical to before the payload split. A failed fetch still
   * exports (with empty pitch-angle cells) rather than blocking the download.
   */
  async function exportCsv() {
    let exportRows = filtered;
    if (!loadedHeavy.has("pitchAngle")) {
      // One action call — the merge also lands in state so a second export
      // (and any pitch-angle consumer) skips the fetch.
      const values = await hydrateHeavyFields(["pitchAngle"]);
      if (values) {
        exportRows = filtered.map((r) => {
          const extra = values[r.businessId];
          return extra ? { ...r, ...extra } : r;
        });
      }
    }
    const lines = exportRows
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

  // ── Coverage summary (set-wide) + the missing groups to enrich ────────────
  // C3 · the ONE coverage denominator: over the 7 user-facing DATA GROUPS (the
  // same axis the row chip strip + toolbar badge use), sourced from the honest
  // rolled-up run-state map (never presence):
  //   - "have"        · EVERY visible lead is `enriched` for the group (has it)
  //   - "notYet"      · not fully covered → shown in the "Not yet" line
  //   - missingGroups · groups with ≥1 NOT-YET-RUN lead → the enrich target.
  //     A group that ran everywhere but found nothing (empty) is NOT a target:
  //     re-enriching a verified-empty group just re-charges for a known 0 (A5).
  const coverageSummary = useMemo(() => {
    const have: string[] = [];
    const notYet: string[] = [];
    const missingGroups: DataGroupKey[] = [];
    for (const g of DATA_GROUPS) {
      const states = filtered.map((r) => groupStatesFor(r)[g.key]);
      const allEnriched =
        filtered.length > 0 && states.every((s) => s === "enriched");
      if (allEnriched) have.push(g.label);
      else notYet.push(g.label);
      if (states.some((s) => s === "not_run")) missingGroups.push(g.key);
    }
    return { have, notYet, missingGroups };
  }, [filtered, groupStatesFor]);

  // AUDIT C5 · per-DATA-GROUP state histogram over the loaded window — powers
  // the clickable "Contacts & site tech: have 11 · none 30 · failed 5" state
  // filters. Same 7-group axis as the have/not-yet SUMMARY above, the chip
  // strip, and the toolbar badge — ONE vocabulary everywhere (the field-state
  // filter round-trips through the shareable-view URL by DataGroupKey).
  // `running` is counted for display but is NOT filterable (transient).
  const groupStateCounts = useMemo(() => {
    const out = new Map<DataGroupKey, Record<TypeState, number>>();
    for (const g of DATA_GROUPS)
      out.set(g.key, {
        enriched: 0,
        empty: 0,
        failed: 0,
        not_run: 0,
        running: 0,
      });
    for (const r of rows) {
      const gs = groupStatesFor(r);
      for (const g of DATA_GROUPS) out.get(g.key)![gs[g.key]] += 1;
    }
    return out;
  }, [rows, groupStatesFor]);

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

  // AUDIT U10/U17 + ISSUE-2 · "enrichable in this view" + its credit estimate,
  // computed on the SAME 7-group axis the enrich sheet's rows use (the old
  // 5-family version under-counted four ways: no AI brief, no cell fees, no
  // partially-run groups, no failed retries — the button said "~10 cr" while
  // the sheet's rows totalled 30+). A group is TO-GET when its rolled-up state
  // is not_run OR failed (the sheet's exact predicate). Cell-basis groups
  // (Meta/SERP) stay out of the per-row number (they're per-market, not
  // per-lead); the sheet quotes them on their own rows.
  const rowToGetGroups = useCallback(
    (r: WorkbenchLeadRow): DataGroupKey[] => {
      const gs = groupStatesFor(r);
      return DATA_GROUPS.filter(
        (g) =>
          g.basis === "lead" &&
          (gs[g.key] === "not_run" || gs[g.key] === "failed"),
      ).map((g) => g.key);
    },
    [groupStatesFor],
  );
  const rowIsEnrichable = useCallback(
    (r: WorkbenchLeadRow): boolean => rowToGetGroups(r).length > 0,
    [rowToGetGroups],
  );
  /** Credit estimate for a set of rows: each row contributes the per-lead price
   *  of every to-get group — the same groupLeadCredits the sheet prices with,
   *  so button and sheet can never disagree again. */
  const grossCreditsForRows = useCallback(
    (rowsIn: readonly WorkbenchLeadRow[]): number => {
      let credits = 0;
      for (const r of rowsIn) {
        for (const key of rowToGetGroups(r)) {
          const group = DATA_GROUPS.find((g) => g.key === key);
          if (group) credits += groupLeadCredits(group);
        }
      }
      return credits;
    },
    [rowToGetGroups],
  );
  /** The union of to-get groups across a row set — pre-selected in the sheet so
   *  the sheet opens showing EXACTLY the basket the button priced (ISSUE-2: the
   *  old flow advertised a number, then opened an empty selection). */
  const toGetGroupsForRows = useCallback(
    (rowsIn: readonly WorkbenchLeadRow[]): DataGroupKey[] => {
      const out = new Set<DataGroupKey>();
      for (const r of rowsIn) for (const k of rowToGetGroups(r)) out.add(k);
      return [...out];
    },
    [rowToGetGroups],
  );

  // The scope for the toolbar's one primary enrich action: the selected rows if
  // any are selected, else the filtered rows that still have a to-get group.
  const enrichTargetRows = useMemo(() => {
    const base =
      selected.size > 0
        ? filtered.filter((r) => selected.has(r.leadId))
        : filtered;
    return base.filter(rowIsEnrichable);
  }, [filtered, selected, rowIsEnrichable]);
  const enrichTargetCount = enrichTargetRows.length;
  const enrichTargetCredits = useMemo(
    () => grossCreditsForRows(enrichTargetRows),
    [enrichTargetRows, grossCreditsForRows],
  );
  // U17 · credits for the bulk-bar selection (the selected rows only).
  const bulkEnrichCredits = useMemo(
    () => grossCreditsForRows(filtered.filter((r) => selected.has(r.leadId))),
    [filtered, selected, grossCreditsForRows],
  );
  /** Open the enrich sheet for the toolbar's primary action — scoped to the
   *  enrichable target rows (selected-if-any, else the filtered set), with the
   *  advertised to-get groups PRE-SELECTED so the sheet's net matches the
   *  button's number. */
  function openToolbarEnrichSheet() {
    const ids = enrichTargetRows.map((r) => r.businessId);
    openEnrichSheet({
      enrichments: enrichTypesForGroups(
        toGetGroupsForRows(enrichTargetRows),
      ) as EnrichmentType[],
      preselect: true,
      scope: {
        selectedBusinessIds: ids,
        visibleBusinessIds: filtered.map((r) => r.businessId),
      },
    });
  }

  /** Coverage CTA → open the sheet pre-seeded with every missing data group. */
  function openMissingGroupsSheet() {
    openEnrichSheet({
      enrichments: enrichTypesForGroups(
        coverageSummary.missingGroups,
      ) as EnrichmentType[],
      scope: enrichScope,
    });
  }

  /** Click an empty "— enrich" cell → open the sheet scoped to THAT lead,
   *  pre-seeded with the cell's data group (so a Lighthouse cell offers a
   *  Lighthouse enrich, a Phone cell offers contacts, etc.). Closes the
   *  founder's "I can't enrich by clicking the field" complaint. */
  function enrichCell(
    r: WorkbenchLeadRow,
    group?: DataGroupKey,
    enrichTypes?: readonly string[],
  ) {
    // AUDIT · prefer the column's explicit enrichTypes when given. An
    // `ai_brief`-group cell (AI summary) wants the ai_research job only — the
    // raw group default would wrongly drag the services sub-scan in.
    const types =
      enrichTypes ?? (group ? enrichTypesForGroups([group]) : undefined);
    openEnrichSheet({
      enrichments: types ? (types as EnrichmentType[]) : undefined,
      // AUDIT D1 · a single-field click pre-selects that enrichment in the sheet.
      preselect: !!types,
      scope: {
        selectedBusinessIds: [r.businessId],
        visibleBusinessIds: [r.businessId],
      },
    });
  }
  /**
   * AUDIT §3/A4 · the STATE-AWARE empty-cell affordance. Reads the column's
   * data group's real rolled-up run state so a cell never lies:
   *   - not_run → the clickable "— enrich" action (never scanned)
   *   - empty   → a calm muted "none" (scanned, verified nothing) — NOT clickable
   *               so a retry can't re-charge for a known-empty result (A5)
   *   - failed  → a red "failed · retry" action (errored — retryable)
   *   - running → the pulsing "enriching…" word (in flight)
   * `enriched` never reaches here (the cell renders the value instead).
   */
  const NeedsEnrich = ({
    r,
    group,
    enrichTypes,
    ranButEmpty,
  }: {
    r: WorkbenchLeadRow;
    group?: DataGroupKey;
    /** AUDIT · the column's explicit enrichment types — overrides the
     *  group→types default so an AI-summary click enriches ai_research only
     *  (not the services sub-scan). Threaded down to enrichCell. */
    enrichTypes?: readonly string[];
    /** WB-CELL-2 · the group RAN but THIS sub-field is empty (e.g. contacts
     *  enriched, found a phone but no email). Treat an 'enriched' group-state as
     *  verified-empty here so the cell reads a calm 'none', not the actionable
     *  '— enrich' (which a retry can't fill and would re-charge). Only pass this
     *  for a multi-field group's sub-field (contacts_tech → email/phone/socials). */
    ranButEmpty?: boolean;
  }) => {
    const state: TypeState = group ? groupStatesFor(r)[group] : "not_run";
    const label = group ? dataGroupFor(group).label : "data";

    // AUDIT U2/D5 + ISSUE-4 · this cell is in the active enrich run → ONE word
    // with a smooth pulse, never a multi-line skeleton (the old word+sweep pair
    // wrapped to two lines in narrow columns). Matched on the group's rolled-up
    // `running` state (server truth) OR the column's TYPE tokens (client bus)
    // so re-runs show it too (the old not_run gate hid every re-run).
    if (
      state === "running" ||
      isTokensEnriching(
        r,
        enrichTypes ?? (group ? enrichTypesForGroups([group]) : []),
      )
    ) {
      return (
        // Tooltip names the pull instead of echoing the cell text.
        <span
          className="cell-none cell-enriching"
          data-tip={`Pulling ${label}`}
        >
          enriching…
        </span>
      );
    }

    // WB-CELL-2 · verified-empty when the group reports 'empty', OR when the
    // group ran ('enriched') but this sub-field came back empty (ranButEmpty).
    // ISSUE-10 · styled as a DONE state (check + normal type), not the faint
    // italic that read as failed/missing — "none" IS the data.
    if (state === "empty" || (ranButEmpty && state === "enriched")) {
      return (
        <span
          className="cell-none verified"
          data-tip={`Scanned · no ${label} found`}
        >
          none
        </span>
      );
    }
    const failed = state === "failed";
    // AUDIT U13 · styling lives in `.needsenr` (+ `.failed`) so a row-hover CSS
    // rule can enlarge the hit target from a faint sliver into a real pill —
    // impossible while the reset was inline.
    return (
      <button
        type="button"
        className={`needsenr${failed ? " failed" : ""}`}
        data-tip={failed ? "Enrichment failed — retry" : "Enrich this lead"}
        // Stop the click bubbling to the row's onClick (which opens the lead
        // drawer) — clicking must open the enrich sheet, not the drawer.
        onClick={(e) => {
          e.stopPropagation();
          enrichCell(r, group, enrichTypes);
        }}
      >
        {failed ? "failed · retry" : "— enrich"}
      </button>
    );
  };

  // ── Fields menu helpers ───────────────────────────────────────────────────
  // WB-COL-2 · one rule, no special cases: ANY explicit uncheck also DISMISSES
  // the column (auto-show-after-research never re-adds it for this research);
  // a re-check clears the dismissal.
  function toggleCol(key: string) {
    const on = activeCols.includes(key);
    if (on) {
      setActiveCols((prev) => prev.filter((k) => k !== key));
      setDismissedCols((prev) => (prev.includes(key) ? prev : [...prev, key]));
    } else {
      setActiveCols((prev) => (prev.includes(key) ? prev : [...prev, key]));
      setDismissedCols((prev) => prev.filter((k) => k !== key));
    }
  }

  // ── Filter editor ─────────────────────────────────────────────────────────
  function removeFilter(idx: number) {
    userTouchedRef.current = true;
    // B17 · an explicitly removed SIGNAL is remembered for this session so the
    // enrich-finished re-seed never re-applies it against the user's intent.
    const removed = filters[idx];
    if (removed?.kind === "signal")
      removedSignalsRef.current.add(removed.sigKey);
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
    // AUDIT B2 · surface the column being filtered on (respecting an explicit
    // dismissal — an auto-show never fights an uncheck): filtering a hidden
    // field would otherwise read as rows vanishing for no visible reason. For
    // heavy fields this also rides the same hydration the column path uses.
    if (
      COLUMNS.some((c) => c.key === field) &&
      !activeCols.includes(field) &&
      !dismissedCols.includes(field)
    ) {
      setActiveCols((prev) => (prev.includes(field) ? prev : [...prev, field]));
    }
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
  // C2 · one filtering home — the "By data state" section of the merged
  // "+ Filter" picker. Per DATA GROUP (labels from DATA_GROUPS — the one
  // vocabulary), the have/none/failed/not-run toggles present in the loaded
  // window (ordered by actionability). These drive the SAME `stateFilters`
  // model via `toggleStateFilter` — no second filter model — so they
  // round-trip through the shareable-view URL and the active-count badge on
  // the Filter + Coverage toolbar buttons stays honest. An in-flight `running`
  // count renders as a non-clickable chip (transient — not filterable).
  // B8 · each group's NEWEST scan across the loaded window (same scope as the
  // state counts beside it) — a > 30d-old newest scan earns a quiet "as of"
  // suffix on the Data-state entry, so an old verdict never reads as current.
  const newestScanByGroup = useMemo(() => {
    const out = new Map<DataGroupKey, number>();
    for (const r of rows) {
      const m = scannedAt[r.businessId];
      if (!m) continue;
      for (const g of DATA_GROUPS) {
        const iso = m[g.key];
        if (!iso) continue;
        const t = Date.parse(iso);
        if (!Number.isNaN(t) && t > (out.get(g.key) ?? 0)) out.set(g.key, t);
      }
    }
    return out;
  }, [rows, scannedAt]);

  const stateFilterRows = useMemo(() => {
    // Actionability order (failed → none → have), default-population last.
    const STATE_ORDER: FieldFilterState[] = [
      "failed",
      "empty",
      "enriched",
      "not_run",
    ];
    return DATA_GROUPS.flatMap((g) => {
      const counts = groupStateCounts.get(g.key);
      if (!counts) return [];
      const applied = stateFilterByGroup.get(g.key);
      // B1b · an APPLIED state stays listed even at count 0 (greyed via the
      // `zero` flag) so it can always be untoggled — the old count>0 gate made
      // a zero-count state filter invisible AND unremovable (the phantom-
      // filter P0: enrich the "not run" leads and the toggle vanished while
      // the filter kept hiding everything).
      const states = STATE_ORDER.filter(
        (s) => counts[s] > 0 || applied?.has(s),
      );
      const running = counts.running;
      if (states.length === 0 && running === 0) return [];
      const newest = newestScanByGroup.get(g.key);
      const asOf =
        nowMs != null && newest != null && nowMs - newest > STALE_AFTER_MS
          ? fmtScannedWhen(new Date(newest).toISOString())
          : null;
      return [
        {
          group: g.key,
          label: g.label,
          running,
          asOf,
          states: states.map((s) => ({
            state: s,
            stateLabel: FIELD_STATE_LABEL[s],
            count: counts[s],
          })),
        },
      ];
    });
  }, [groupStateCounts, stateFilterByGroup, newestScanByGroup, nowMs]);

  // Each add-picker is a <Popover> (floating-ui handles portal + dismiss + Esc +
  // focus + ↑/↓ nav). A single-add pick closes its own menu; data-state toggles
  // keep theirs open so states can be stacked in one visit.
  function pickAddSignal(key: string, title: string) {
    addSignalFilter(key, title);
    setSignalMenuOpen(false);
  }
  function pickAddNumeric(field: NumericFilterField) {
    addFilter(field);
    setFieldMenuOpen(false);
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
  /** B1c · clear EVERY narrowing in one move (WP4-15 · actionable empty
   *  state): numeric + signal filters, data-state filters, Enriched-only and
   *  search — so the "Clear filters" button in the "Filters hide all N leads"
   *  empty state ALWAYS restores the full set (a partial clear that leaves the
   *  view empty is a lie). The ONE path every "Clear all"/"Clear filters"
   *  button shares. */
  function clearAllFilters() {
    userTouchedRef.current = true;
    setFilters([]);
    setStateFilters([]);
    setEnrichedOnly(false);
    setSearch("");
    setPage(1);
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  function renderCell(col: ColumnDef, r: WorkbenchLeadRow): ReactElement {
    const status = optimistic[r.leadId] ?? r.status;
    // Step 4 · this column's heavy field hasn't landed yet (fresh toggle / a
    // restored view outrunning the cookie) — render a loading cell while the
    // one-shot hydration action fills it. NEVER the "— enrich" affordance:
    // absent means "not shipped", not "no data" (the honesty rule).
    // REVIEW FIX 2 · hydration failed for this column → an honest retry cell,
    // never an endless "loading…" (and never a lying "— enrich").
    if (failedCols.has(col.key)) {
      return (
        <td key={col.key}>
          <button
            type="button"
            className="needsenr failed"
            data-tip="Couldn't load this column — retry"
            onClick={(e) => {
              e.stopPropagation();
              retryHeavyCols(col.key);
            }}
          >
            failed · retry
          </button>
        </td>
      );
    }
    if (unloadedCols.has(col.key)) {
      return (
        <td key={col.key} className="cell-loading" aria-busy="true">
          <span
            className="cell-none cell-enriching"
            data-tip="Loading column data"
          >
            loading…
          </span>
        </td>
      );
    }
    switch (col.kind) {
      case "biz":
        return (
          <td className="biz" key={col.key}>
            <span className="bizname" data-tip={r.name}>
              {r.name}
            </span>
            {/* Closed on Google → a small red/amber tag beside the name (not a
                column) so a 100-row scan never burns a touch on a closed
                business. Absent field (older row builders) reads open. */}
            {r.closed ? (
              <span
                className={`bizclosed${r.closed === "temporary" ? " temp" : ""}`}
                data-tip={
                  r.closed === "temporary"
                    ? "Temporarily closed on Google — verify before a touch"
                    : "Permanently closed on Google"
                }
              >
                Closed
              </span>
            ) : null}
            <div className="addr" data-tip={r.addr}>
              {r.addr}
            </div>
          </td>
        );
      case "match": {
        // Derived-match honesty: a heuristic match% (pain-count table, not
        // signal-eval) renders MUTED with an "estimated" tooltip so 60/75/85
        // never read as measured at 100-row scan speed. No tone band — a
        // color-banded estimate would double down on false precision.
        if (r.matchDerived) {
          return (
            <td className="num" key={col.key}>
              <span
                className="cellval matchest"
                data-tip="Estimated from pain-point count — enrich to compute from your signals"
              >
                {r.match}%
              </span>
            </td>
          );
        }
        const band = effectiveBands[col.key];
        // AUDIT U11 · color-band the BASE match% across ALL three bands so the
        // eye can scan lead strength by color. Match% is higher-is-better:
        // at/above the cell's p75 → green (strong), below p25 → red (weak),
        // in between → amber. Neutral when the cell is too small for bands.
        const tone = band
          ? r.match >= band.p75
            ? " g"
            : r.match < band.p25
              ? " r"
              : " a"
          : "";
        return (
          <td className="num" key={col.key}>
            {/* 2026-07-06 · NO vs-cell delta on Match — Match % is already a
                composite relative score; a second "vs cell median" arrow on it
                read as noise (owner: "remove delta"). renderDelta stays for the
                raw numeric fact columns. */}
            <span className={`cellval${tone}`}>{r.match}%</span>
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
        // Show the MATCHED signals as the "why this qualifies" chips — reusing
        // the per-signal verdict every row already carries. AUDIT C4 · exclude
        // QUALIFIER signals ("Operating business", "Has a website") — they
        // describe WHO you're targeting, not a pain/pitch angle.
        const matched = goalSignals.filter(
          (s) =>
            r.perSignal[s.key] === true && !QUALIFIER_SIGNAL_KEYS.has(s.key),
        );
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
      case "text": {
        // Step 5 · the cell's value comes from the REGISTRY accessor (was a
        // hardcoded key switch — the class of mapping that shipped the lastC
        // dead sort). Render styling below stays key-aware where it must be.
        const val = col.textValue?.(r) ?? null;
        if (val == null) {
          // AUDIT · a null builtOn/bookingTool doesn't always mean "not scanned":
          // the tech scan may have RUN and simply found a custom/unknown CMS (or
          // no booking tool). Read the honest per-type TECH state — when it's
          // enriched/empty the scan ran, so show the scanned marker (mirroring the
          // drawer's `cms ?? "Custom / unknown"`), NOT a "— enrich" CTA that would
          // re-charge for a known result. Only a genuinely not_run/failed TECH
          // state falls through to the enrich affordance.
          if (col.key === "builtOn" || col.key === "bookingTool") {
            // ISSUE-9 · read the derived per-type map (typeStatesFor), not the
            // raw matrix prop: TECH now folds the CONTACTS job signals (tech
            // rides the contacts DOM fetch — no TECH job row ever exists), so
            // this branch is finally LIVE and the cell agrees with the drawer's
            // "Custom / unknown" / "Phone only" instead of lying "— enrich".
            const tech = typeStatesFor(r).TECH;
            if (tech === "enriched" || tech === "empty") {
              return (
                <td key={col.key}>
                  {/* Owner 2026-07-06 · the CELL shows the SHORT form ("Custom"
                      — one line, never wraps); the drawer keeps the full
                      "Custom / unknown". The tip carries the honest long read
                      so Tom can hover-confirm it's scanned truth. Booking:
                      "No online booking" (owner — "Phone only" read as if
                      phone WERE a booking tool). */}
                  <span
                    className="cell-none verified"
                    style={{ whiteSpace: "nowrap" }}
                    data-tip={
                      col.key === "builtOn"
                        ? "Tech scan ran · no known CMS — custom or unknown builder"
                        : "Tech scan ran · no booking tool found"
                    }
                  >
                    {col.key === "builtOn" ? "Custom" : "No online booking"}
                  </span>
                </td>
              );
            }
          }
          return (
            <td key={col.key}>
              <NeedsEnrich
                r={r}
                group={col.group}
                enrichTypes={col.enrichTypes}
              />
            </td>
          );
        }
        // AUDIT F2 · the AI summary can be a full paragraph — truncate it in the
        // cell (CSS ellipsis via .aisum) and carry the full text in the tooltip,
        // so a long read never blows out the row height.
        if (col.key === "aiSummary") {
          return (
            <td key={col.key}>
              <span className="aisum" data-tip={val}>
                {val}
              </span>
            </td>
          );
        }
        return <td key={col.key}>{val}</td>;
      }
      case "site": {
        if (!r.website) {
          return (
            <td key={col.key}>
              <NeedsEnrich
                r={r}
                group={col.group}
                enrichTypes={col.enrichTypes}
              />
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
              <NeedsEnrich
                r={r}
                group={col.group}
                enrichTypes={col.enrichTypes}
              />
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
        // Step 5 · registry accessor, not a key switch — a num column without
        // a numValue can't exist silently (it would render "— enrich" forever
        // in dev, not ship a dead column).
        const v = col.numValue?.(r) ?? null;
        if (v == null)
          return (
            <td className="num" key={col.key}>
              <NeedsEnrich
                r={r}
                group={col.group}
                enrichTypes={col.enrichTypes}
              />
            </td>
          );
        const band = effectiveBands[col.key];
        const display = col.unit === "★" ? v.toFixed(1) : v.toLocaleString();
        return (
          <td className="num" key={col.key}>
            <span className="cellval" data-tip={cellProvenance(r, col.group)}>
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
              <NeedsEnrich
                r={r}
                group={col.group}
                enrichTypes={col.enrichTypes}
                // WB-CELL-2 · contacts ran but THIS channel is empty → 'none'.
                ranButEmpty={groupStatesFor(r).contacts_tech === "enriched"}
              />
            </td>
          );
        const scheme = col.key === "phones" ? "tel" : "mailto";
        return (
          // `ctd` keeps the value + "+N" chip on ONE line (the primary value
          // already truncates with an ellipsis) — a phone like "250-763-0004 +1"
          // must never wrap to a second row.
          <td key={col.key} className="ctd">
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
      case "socials": {
        // AUDIT E6 · social handles as compact linked chips (data was stored but
        // never shown). No socials → the state-aware enrich affordance.
        // (Heavy field — absent is gated above; the ?? [] is belt-and-braces.)
        const socials = r.socials ?? [];
        if (socials.length === 0)
          return (
            <td key={col.key}>
              <NeedsEnrich
                r={r}
                group={col.group}
                enrichTypes={col.enrichTypes}
                // WB-CELL-2 · contacts ran but no social handles → 'none'.
                ranButEmpty={groupStatesFor(r).contacts_tech === "enriched"}
              />
            </td>
          );
        const LBL: Record<string, string> = {
          INSTAGRAM: "IG",
          FACEBOOK: "FB",
          TIKTOK: "TT",
          YOUTUBE: "YT",
          X: "X",
          LINKEDIN: "IN",
        };
        return (
          // ISSUE-7 · social chips never wrap: the unclassed td had no min-width
          // so the table squeezed it and "FB IG / FB" broke onto two rows.
          // td.socials reserves the width (CSS) + nowrap keeps one line.
          <td key={col.key} className="socials">
            <span
              style={{ display: "inline-flex", gap: 4, flexWrap: "nowrap" }}
            >
              {socials.slice(0, 5).map((s, i) => {
                const href = /^https?:\/\//.test(s.value) ? s.value : undefined;
                // AUDIT UX-review #7 · a mapped short tag, else a title-cased
                // channel name (never an ugly 2-char enum slice like "WH").
                const lbl =
                  LBL[s.channel] ??
                  s.channel.charAt(0) + s.channel.slice(1).toLowerCase();
                const tip = `${s.channel}: ${s.value}`;
                return href ? (
                  <a
                    key={i}
                    className="social-chip"
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-tip={tip}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {lbl}
                  </a>
                ) : (
                  <span key={i} className="social-chip" data-tip={tip}>
                    {lbl}
                  </span>
                );
              })}
            </span>
          </td>
        );
      }
      case "cov": {
        // C3 + TRUTH UNIFICATION (2026-07-06) · per-row badge strip over the 7
        // DATA GROUPS. The FRACTION now counts groups that RAN (scanned) — the
        // same semantic as the enrich popup's "already done" — so the two
        // surfaces can never read "all done" vs "3/7" for one row (the Boise
        // ticket). The chips split ran into WITH DATA (green) vs NONE FOUND
        // (grey ✓); failed red; running pulse; never-scanned faint. The tooltip
        // carries both numbers.
        const gs = groupStatesFor(r);
        const groups = DATA_GROUPS;
        const total = groups.length;
        const enrichedN = groups.filter((g) => gs[g.key] === "enriched").length;
        const failedN = groups.filter((g) => gs[g.key] === "failed").length;
        const runningN = groups.filter((g) => gs[g.key] === "running").length;
        const ranN = groups.filter((g) => gs[g.key] !== "not_run").length;
        return (
          <td key={col.key}>
            <span
              className="covstrip"
              data-tip={
                failedN > 0
                  ? `${ranN} of ${total} scanned · ${enrichedN} with data · ${failedN} failed — re-enrich`
                  : runningN > 0
                    ? `${ranN} of ${total} scanned · ${enrichedN} with data · ${runningN} running`
                    : `${ranN} of ${total} scanned · ${enrichedN} with data`
              }
            >
              <span className="covfrac">
                {ranN}/{total}
              </span>
              <span
                className="covtypes"
                aria-label={`${ranN} of ${total} data groups scanned, ${enrichedN} with data${
                  failedN > 0 ? `, ${failedN} failed` : ""
                }${runningN > 0 ? `, ${runningN} running` : ""}`}
              >
                {groups.map((g) => {
                  const s = gs[g.key];
                  const desc =
                    s === "enriched"
                      ? "have it"
                      : s === "failed"
                        ? "failed — re-enrich"
                        : s === "running"
                          ? "running"
                          : s === "empty"
                            ? "ran · none found"
                            : "not yet";
                  return (
                    <span
                      key={g.key}
                      className={`covchip ${s}`}
                      data-tip={`${g.label} · ${desc}`}
                      aria-hidden="true"
                    >
                      {g.chip}
                    </span>
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
              // Shortest honest form ("3d", "2w", "Jan 5" beyond 30d) — full
              // date in the tip. SSR + first paint render the deterministic
              // absolute form (nowMs is null until mount — the INC-09 pattern,
              // no Date.now() during prerender / no hydration drift).
              <span
                className="cellval"
                data-tip={new Date(r.lastContactedAt).toLocaleDateString(
                  "en-US",
                  { month: "short", day: "numeric", year: "numeric" },
                )}
              >
                {fmtRelativeShort(r.lastContactedAt, nowMs)}
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
    // AUDIT G1 · a within-tolerance ("flat") value renders NOTHING — the "≈"
    // glyph read as noise. Only a real above/below delta shows an arrow.
    if (d.dir === "flat") return null;
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
        {cols.map((c) =>
          withGroupStart(c, withCellLoading(c, r, renderCell(c, r))),
        )}
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

        {/* AUDIT U8 · the primary narrowing action sits LEFT, right after search —
            with the live filtered count beside it — so the most-used control is
            first in the reading order, not buried on the far right.
            B1 · ONE badge story: with the coverage button deleted (B11b) the
            Filter popover is the single filtering home, so its badge counts
            EVERY applied chip — numeric + signal filters AND data-state
            filters — never a second, separate count elsewhere. */}
        <button
          ref={filterBtnRef}
          type="button"
          className={`btn sm${filters.length + stateFilters.length ? " active" : ""}`}
          aria-haspopup="true"
          aria-expanded={filtersOpen}
          aria-label="Filters"
          data-tip="Filter these leads"
          onClick={() => setFiltersOpen((o) => !o)}
        >
          <Icon name="filter" />
          {" Filter"}
          {filters.length + stateFilters.length ? (
            <span className="cbadge">
              {filters.length + stateFilters.length}
            </span>
          ) : null}
        </button>

        {/* #1 · live filtered count — updates as any narrowing changes so the
            match total is visible up here by the Filter control, not only down
            in the pager. When server-paginated it counts the loaded window
            (the tooltip states the whole-set total). B9 · when narrowing is
            active across a multi-window set, the count carries a "+" — matches
            are counted within the loaded window and other windows may hold
            more (the tooltip says so). B10 · the "of N" suffix shows for ANY
            narrowing (filters, search, data-state, Enriched-only), not just
            filters+search. */}
        <span
          className="wb-count"
          aria-live="polite"
          data-tip={
            serverPageCount > 1
              ? anyNarrowing
                ? `Matches are counted within the loaded window of ${rows.length.toLocaleString()} — other windows may hold more · ${totalRows.toLocaleString()} rows total`
                : `Matches in the loaded window of ${rows.length.toLocaleString()} · ${totalRows.toLocaleString()} total`
              : undefined
          }
        >
          <strong>
            {filtered.length.toLocaleString()}
            {serverPageCount > 1 && anyNarrowing ? "+" : ""}
          </strong>
          {anyNarrowing ? ` of ${rows.length.toLocaleString()}` : ""}{" "}
          {/* "loaded" (not "leads") when server-paginated so the number never
              reads as the whole-set total — that's in the tooltip. */}
          {serverPageCount > 1
            ? "loaded"
            : filtered.length === 1
              ? "lead"
              : "leads"}
        </span>

        {/* B11a · "Enriched only" joins the NARROWING zone, left of the spacer
            and right after the count it changes (it IS a filter — the 4th AND
            layer). AUDIT §3/B1 · isolates the leads an enrichment actually ran
            on (what the agency paid for) from the whole website-having market. */}
        <button
          type="button"
          className={`btn sm${enrichedOnly ? " active" : ""}`}
          aria-pressed={enrichedOnly}
          data-tip={`Show only the ${enrichedCount.toLocaleString()} lead${
            enrichedCount === 1 ? "" : "s"
          } an enrichment has run on`}
          onClick={() => {
            setEnrichedOnly((v) => !v);
            setPage(1);
          }}
        >
          Enriched only
          {enrichedCount ? ` · ${enrichedCount.toLocaleString()}` : ""}
        </button>

        <span className="tb-spacer" />

        {/* B11c · Group segmented control → quiet ghost dropdown. Grouping
            changes maybe once per session; a ghost "Group: none ▾" spends
            attention proportional to use. The "By signals" gating note lives
            inside the menu (aria-disabled row, NOT `disabled` — a disabled
            button fires no hover/focus, so its explanatory tooltip would never
            show; click is guarded to a no-op instead). */}
        <Popover
          open={groupMenuOpen}
          onOpenChange={setGroupMenuOpen}
          className="popmenu"
          label="Group rows"
          trigger={
            <button
              type="button"
              className="btn sm ghosty"
              aria-haspopup="true"
              aria-expanded={groupMenuOpen}
              data-tip="Group the rows"
            >
              Group:{" "}
              {group === "signals" && canGroupBySignals
                ? "signals"
                : group === "cell"
                  ? "cell"
                  : "none"}{" "}
              ▾
            </button>
          }
        >
          {(
            [
              { v: "none", label: "No groups", tip: undefined },
              {
                v: "cell",
                label: "By cell",
                tip: "One collapsible section per market cell",
              },
              {
                v: "signals",
                label: "By signals",
                // #5 · segment leads by the verdict combination of your VARYING
                // goal signals (enriched on every lead, not pinned by a filter).
                tip: canGroupBySignals
                  ? "Segment by your goal-signal combination"
                  : "Needs an enriched goal signal that isn't filtered",
              },
            ] as const
          ).map((o) => {
            const disabled = o.v === "signals" && !canGroupBySignals;
            const on =
              o.v === group && (o.v !== "signals" || canGroupBySignals);
            return (
              // Plain aria-pressed buttons (not menuitemradio — that role
              // requires a role="menu" parent the shared Popover doesn't set).
              <button
                key={o.v}
                type="button"
                aria-pressed={on}
                className={`grp-opt${on ? " on" : ""}`}
                aria-disabled={disabled || undefined}
                data-tip={o.tip}
                onClick={() => {
                  if (disabled) return;
                  setGroup(o.v);
                  setGroupMenuOpen(false);
                }}
              >
                {o.label}
              </button>
            );
          })}
        </Popover>

        <Popover
          open={fieldsOpen}
          onOpenChange={(o) => {
            setFieldsOpen(o);
            // Reset the search on close so the next open starts clean.
            if (!o) setFieldsQuery("");
          }}
          className="popmenu cols"
          label="Fields"
          trigger={
            <button type="button" className="btn sm">
              Fields ▾
            </button>
          }
        >
          {/* B11d · vs-cell moved INTO Fields as the top toggle row — it's a
              display mode for how the numbers render, same family as column
              visibility. WP7-13 · a THIN market disables it (too few
              businesses for an honest percentile); the explanation that used
              to burn a permanent toolbar slot is now the disabled row's tip. */}
          <label
            className={`vscell-row${vsCell && !marketIsThin ? " on" : ""}${marketIsThin ? " disabled" : ""}`}
            data-tip={
              marketIsThin
                ? `Small market (under ${THIN_MARKET_THRESHOLD}) — showing absolute benchmarks, no market percentile`
                : "Show each number's delta vs the cell median"
            }
          >
            <input
              type="checkbox"
              checked={vsCell && !marketIsThin}
              disabled={marketIsThin}
              onChange={(e) => setVsCell(e.target.checked)}
            />
            vs cell benchmarks
          </label>
          {/* F3 · search box — narrows the visible column rows by label. */}
          <div className="cols-search">
            <Icon name="search" className="si" size={13} />
            <input
              type="search"
              value={fieldsQuery}
              onChange={(e) => setFieldsQuery(e.target.value)}
              placeholder="Search fields…"
              aria-label="Search fields"
            />
          </div>
          {/* U15 · the Fields menu is column-visibility ONLY — a single
              filtering home. Columns grouped by enrichment TYPE (Identity /
              Contacts / Reviews / Site audit / Tech / Ads / Search / AI); the
              checkbox toggle re-adds a hidden/enriched column (F1). Filters are
              added exclusively from the merged "+ Filter" picker in the Filters
              panel — no per-row funnel here. */}
          {fieldsGroups.length === 0 ? (
            <div className="cols-empty note">
              No fields match “{fieldsQuery}”.
            </div>
          ) : (
            // Rendered as flat siblings (fragments, not wrapping divs) so the
            // `.cgrp:first-of-type` divider rule keeps working — only the very
            // first section header drops its top border.
            fieldsGroups.flatMap((section) => [
              <div className="cgrp" key={`h-${section.group}`}>
                {section.group}
              </div>,
              ...section.cols.map((c) => (
                <label key={c.key}>
                  <input
                    type="checkbox"
                    checked={activeCols.includes(c.key)}
                    onChange={() => toggleCol(c.key)}
                  />
                  {c.fullLabel ?? c.label}
                </label>
              )),
            ])
          )}
          {/* U-fields · the Fields dropdown shows/hides COLUMNS only — it never
              launches a research. Enrichment stays reachable via cell-click, the
              toolbar Enrich button, and the coverage strip's Enrich CTA. */}
        </Popover>

        {/* AUDIT U7 + B11e · row density as an icon toggle (an action glyph,
            not the ambiguous "Cozy" state text). Compact is the default;
            click toggles; the choice persists per user. */}
        <button
          type="button"
          className="iconbtn"
          data-tip="Row density"
          aria-label={`Row density: ${density} — click to toggle`}
          onClick={toggleDensity}
        >
          <span aria-hidden="true">{density === "compact" ? "☰" : "▦"}</span>
        </button>

        {/* AUDIT U10 + B11f · the ONE primary action, at the FAR RIGHT edge
            (terminal position — after you've shaped the view, act): enrich
            the enrichable leads in the current view (selected rows if any,
            else the filtered rows with a to-get data group), gross credit
            estimate inline. The only filled-indigo control in the bar (B12).
            Hidden when nothing in view is enrichable. */}
        {enrichTargetCount > 0 ? (
          <button
            type="button"
            className="btn primary sm"
            data-tip={
              selected.size > 0
                ? "Enrich the selected leads that still have data to pull"
                : "Enrich the filtered leads that still have data to pull"
            }
            onClick={openToolbarEnrichSheet}
          >
            {`Enrich ${enrichTargetCount.toLocaleString()}`}
            {enrichTargetCredits > 0
              ? ` · ~${fmtCredits(enrichTargetCredits)} cr`
              : ""}
            {" →"}
          </button>
        ) : null}
      </div>

      {/* B11g · one-time replacement for the deleted "?" button — a
          dismissible hint on the first workbench visit. The ? key and the
          shortcuts modal are unchanged. */}
      {showShortcutHint ? (
        <div className="wb-hintchip" role="status">
          Press <kbd>?</kbd> for keyboard shortcuts
          <button
            type="button"
            className="x"
            aria-label="Dismiss shortcuts hint"
            onClick={dismissShortcutHint}
          >
            ×
          </button>
        </div>
      ) : null}

      {/* Owner 2026-07-06 · the locked-context strip, the status tab-bar and
          the coverage strip were RETIRED from the stack above the table.
          Context (market · websites-only · closed/hidden · data-as-of) was
          duplicating the header title + freshness — it's absorbed into the
          WorkspaceHeader counts + tooltips. Status tabs (Contacted/Replied/
          Won/Lost) are outreach tracking, outside Mapsly's v1 scope (CLAUDE.md
          rule 4 — Mapsly stops at the qualified lead). Coverage's have/not-yet
          lives per-lead in the drawer + the "+ Data state" filter, and its
          enrich CTA is the toolbar's primary Enrich button. Net: 5 rows above
          the table → 2 (toolbar + filters). */}

      {/* Keyboard-shortcut cheat-sheet (press ?). */}
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
                  ["F", "Filters (Shift+F)"],
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

      {/* AUDIT U9 · Filters + Coverage panels float OVER the grid (position:
          absolute inside .wb-body-rel) instead of pushing the chips row + table
          down and forcing a second page scroll — the panel overlays the top few
          rows while open, the grid keeps its full height. At most one panel is
          open at a time (the toolbar toggles are mutually exclusive). The nested
          add-filter <Popover> still portals to #agency-overlays above this. */}
      <div className="wb-body-rel">
        {/* ── Filters panel ─────────────────────────────────────────────────── */}
        {filtersOpen ? (
          <div className="collapse-panel" ref={filtersPanelRef}>
            <div className="cp-head">
              <span className="cp-title">Filters</span>
              <button
                type="button"
                className="cp-clear"
                onClick={clearAllFilters}
              >
                Clear all
              </button>
            </div>
            <div className="cp-body">
              {filters.map((f, i) => {
                // B3 · the chip's honest breakdown over the current view.
                const bd = filterBreakdowns[i];
                if (f.kind === "signal") {
                  return (
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
                      {/* B3 · signal chips get the same honesty annotation —
                          "no data" names the leads whose verdict isn't
                          computed yet (the filter never matches those). */}
                      {bd ? (
                        <span className="fann">
                          {bd.match} match
                          {bd.noData > 0 ? ` · ${bd.noData} no data` : ""}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        className="x"
                        aria-label={`Remove ${filterLabel(f)}`}
                        onClick={() => removeFilter(i)}
                      >
                        ×
                      </button>
                    </span>
                  );
                }
                // B14 · the numeric chip speaks the signal-chip pill language:
                // a bold FIELD NAME (changing field = remove + re-add — no
                // field <select>), a borderless op select (.opword) + inline
                // value input(s) (.vinline — the Phase 3 styled-select pattern),
                // the B3 breakdown, one consistent × remove. Edits stay LIVE
                // (each keystroke re-filters); Enter blurs to commit cleanly.
                const loading = filterFieldLoading(f.field);
                return (
                  <span
                    key={i}
                    className={`fchip data${loading ? " loading" : ""}`}
                  >
                    <span className="fname">
                      {FILTER_FIELDS.find((m) => m.field === f.field)?.label ??
                        f.field}
                    </span>
                    <select
                      className="opword"
                      aria-label="Operator"
                      value={f.op}
                      onChange={(e) => {
                        const op = e.target.value as NumericLeadFilter["op"];
                        // B14 · switching to "between" seeds the upper bound
                        // from the current value so the chip never renders a
                        // half-defined range.
                        editFilter(
                          i,
                          op === "between"
                            ? { op, value2: f.value2 ?? f.value }
                            : { op },
                        );
                      }}
                    >
                      {(["<", "≤", "=", "≥", ">", "between"] as const).map(
                        (o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ),
                      )}
                    </select>
                    <input
                      className="vinline"
                      aria-label={f.op === "between" ? "Lower bound" : "Value"}
                      type="number"
                      value={f.value}
                      onChange={(e) =>
                        editFilter(i, { value: Number(e.target.value) || 0 })
                      }
                      onKeyDown={commitOnEnter}
                    />
                    {/* B14 · the "between" op renders its second bound — a
                        URL-restored between chip is fully editable. */}
                    {f.op === "between" ? (
                      <>
                        <span className="frange" aria-hidden="true">
                          –
                        </span>
                        <input
                          className="vinline"
                          aria-label="Upper bound"
                          type="number"
                          value={f.value2 ?? f.value}
                          onChange={(e) =>
                            editFilter(i, {
                              value2: Number(e.target.value) || 0,
                            })
                          }
                          onKeyDown={commitOnEnter}
                        />
                      </>
                    ) : null}
                    {/* B3 · "42 match · 31 no data" — the no-data segment is
                        the click-to-include toggle. While the field's heavy
                        data hydrates, an honest loading word instead. */}
                    {loading ? (
                      <span className="fann">loading…</span>
                    ) : bd ? (
                      <span className="fann">
                        {bd.match} match
                        {bd.noData > 0 ? (
                          <>
                            {" · "}
                            <button
                              type="button"
                              className={`fnodata${f.includeNoData ? " on" : ""}`}
                              aria-pressed={f.includeNoData === true}
                              data-tip={
                                f.includeNoData
                                  ? "Leads with no value for this field are included — click to exclude them"
                                  : "Leads with no value for this field are excluded — click to include them"
                              }
                              onClick={() =>
                                editFilter(i, {
                                  includeNoData: !f.includeNoData,
                                })
                              }
                            >
                              {bd.noData} no data
                            </button>
                          </>
                        ) : null}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="x"
                      aria-label={`Remove ${filterLabel(f)}`}
                      onClick={() => removeFilter(i)}
                    >
                      ×
                    </button>
                  </span>
                );
              })}
              {/* B1a · applied DATA-STATE filters render as removable chips
                  like everything else — the fix for the phantom-filter P0
                  (a state filter used to render NO chip; once its count hit 0
                  its only removal UI vanished while it kept hiding leads). */}
              {stateFilters.map((sf) => (
                <span
                  key={`fs-${sf.group}-${sf.state}`}
                  className="fchip state"
                  data-tip="Data-state filter"
                >
                  {dataGroupFor(sf.group).label}: {FIELD_STATE_LABEL[sf.state]}
                  <button
                    type="button"
                    className="x"
                    aria-label={`Remove ${dataGroupFor(sf.group).label}: ${FIELD_STATE_LABEL[sf.state]} filter`}
                    onClick={() => toggleStateFilter(sf.group, sf.state)}
                  >
                    ×
                  </button>
                </span>
              ))}
              {/* U15 · ONE "+ Filter" attribute picker — the single filtering
                home. Two labelled sections inside the one <Popover>: addable
                signals (the curated library, gated to signals with data on
                every lead) and addable numeric fields (fields with data).
                Selecting a signal adds a signal filter; selecting a field adds
                a numeric filter — both feed the same filters[] array. */}
              {/* THREE add-pickers by KIND — one short dropdown each, all
                feeding the same filters[]/stateFilters[] models. Splits the old
                single "+ Filter" menu that grew too long to scan. */}
              {/* ── ＋ Signal ─────────────────────────────────────────────── */}
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
                    data-tip="Filter by a signal verdict"
                  >
                    ＋ Signal
                  </button>
                }
              >
                {/* B15 · empty-menu honesty: "everything available is already
                    applied" is NOT "no data" — only the latter earns the
                    enrich CTA (the old copy upsold enrichment to users who had
                    simply applied every unlocked signal). */}
                {signalOptionCount === 0 ? (
                  availSigKeys.size > 0 ? (
                    <div className="filter-add-empty">
                      All available signals are applied.
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="filter-add-empty"
                      style={{
                        cursor: "pointer",
                        width: "100%",
                        textAlign: "left",
                        background: "none",
                        border: "none",
                        font: "inherit",
                      }}
                      onClick={openMissingGroupsSheet}
                    >
                      No signal covers the current view yet · enrich to unlock →
                    </button>
                  )
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
                    <div className="filter-list-eyebrow">Signals</div>
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
              {/* ── ＋ Field ──────────────────────────────────────────────── */}
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
                    data-tip="Filter by a field value"
                  >
                    ＋ Field
                  </button>
                }
              >
                {addNumericOptions.length > 0 ? (
                  <div
                    className="filter-list-section"
                    role="group"
                    aria-label="Fields with data"
                  >
                    <div className="filter-list-eyebrow">Fields</div>
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
                ) : availNumFields.size > 0 ? (
                  // B15 · all fields with data are already applied — say so,
                  // never a misleading enrich upsell.
                  <div className="filter-add-empty">
                    All available fields are applied.
                  </div>
                ) : (
                  <button
                    type="button"
                    className="filter-add-empty"
                    style={{
                      cursor: "pointer",
                      width: "100%",
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      font: "inherit",
                    }}
                    onClick={openMissingGroupsSheet}
                  >
                    No fields with data yet · enrich to unlock →
                  </button>
                )}
              </Popover>
              {/* ── ＋ Data state ─────────────────────────────────────────── */}
              {/* Filter by whether each data domain has run (have / none / not
                run / failed). Multi-select toggles feeding the SAME `stateFilters`
                model; the popover stays open on toggle so states can be stacked. */}
              <Popover
                open={stateMenuOpen}
                onOpenChange={setStateMenuOpen}
                className="filter-add-popover"
                role="dialog"
                label="Filter by data state"
                trigger={
                  <button
                    type="button"
                    className="add"
                    data-tip="Filter by whether a data type has run"
                  >
                    ＋ Data state
                  </button>
                }
              >
                {stateFilterRows.length > 0 ? (
                  <div
                    className="filter-list-section"
                    role="group"
                    aria-label="Filter by data state"
                  >
                    <div className="filter-list-eyebrow">By data state</div>
                    {stateFilterRows.map((grpRow) => {
                      const active = stateFilterByGroup.get(grpRow.group);
                      return (
                        <div key={grpRow.group} className="filter-state-row">
                          <span className="filter-state-fam">
                            {grpRow.label}
                            {/* B8 · the group's newest scan is > 30d old —
                                quiet "as of" so old truth reads as old. */}
                            {grpRow.asOf ? (
                              <span className="fs-asof">
                                {" "}
                                · as of {grpRow.asOf}
                              </span>
                            ) : null}
                          </span>
                          <span className="filter-state-toggles">
                            {grpRow.states.map((s) => (
                              <button
                                key={s.state}
                                type="button"
                                // B1b · a zero-count APPLIED state stays
                                // rendered (greyed) so it can be untoggled.
                                className={`cov-state${
                                  active?.has(s.state) ? " on" : ""
                                }${s.count === 0 ? " zero" : ""}`}
                                aria-pressed={active?.has(s.state) ?? false}
                                data-tip={
                                  s.count === 0
                                    ? `No leads currently in this state — the filter is still applied · click to remove`
                                    : `Show leads where ${grpRow.label} = ${s.stateLabel}`
                                }
                                onClick={() =>
                                  toggleStateFilter(grpRow.group, s.state)
                                }
                              >
                                {s.stateLabel} {s.count}
                              </button>
                            ))}
                            {/* In flight — a transient count, never a filter. */}
                            {grpRow.running > 0 ? (
                              <span
                                className="cov-state"
                                aria-disabled="true"
                                data-tip={`${grpRow.label} · enriching now — not filterable`}
                              >
                                running {grpRow.running}
                              </span>
                            ) : null}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="filter-add-empty"
                    style={{
                      cursor: "pointer",
                      width: "100%",
                      textAlign: "left",
                      background: "none",
                      border: "none",
                      font: "inherit",
                    }}
                    onClick={openMissingGroupsSheet}
                  >
                    Nothing enriched yet · enrich to unlock →
                  </button>
                )}
              </Popover>
            </div>
          </div>
        ) : filters.length || stateFilters.length ? (
          <div className="chipsbar">
            <span className="cb-lbl">Filters</span>
            {filters.map((f, i) => {
              const bd = filterBreakdowns[i];
              return (
                // Signal chips (your goal defaults) read distinct from numeric ones.
                <span
                  key={i}
                  className={`fchip ${f.kind === "signal" ? "sig" : "data"}`}
                >
                  {filterLabel(f)}
                  {/* B3 · the honesty annotation rides the compact chips too. */}
                  {bd ? (
                    <span className="fann">
                      {bd.match} match
                      {bd.noData > 0
                        ? ` · ${bd.noData} no data${f.kind !== "signal" && f.includeNoData ? " (incl.)" : ""}`
                        : ""}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="x"
                    aria-label={`Remove ${filterLabel(f)}`}
                    onClick={() => removeFilter(i)}
                  >
                    ×
                  </button>
                </span>
              );
            })}
            {/* B1a · data-state filters are first-class chips here too. */}
            {stateFilters.map((sf) => (
              <span key={`fs-${sf.group}-${sf.state}`} className="fchip state">
                {dataGroupFor(sf.group).label}: {FIELD_STATE_LABEL[sf.state]}
                <button
                  type="button"
                  className="x"
                  aria-label={`Remove ${dataGroupFor(sf.group).label}: ${FIELD_STATE_LABEL[sf.state]} filter`}
                  onClick={() => toggleStateFilter(sf.group, sf.state)}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              className="cb-clear"
              onClick={clearAllFilters}
            >
              Clear all
            </button>
          </div>
        ) : null}

        {/* Owner 2026-07-06 · the always-on Coverage strip is retired (see the
            note above the shortcuts modal). Per-lead coverage lives in the
            drawer; set-level "what's not enriched" is the "+ Data state" filter
            (with counts); the enrich CTA is the toolbar's primary Enrich
            button. `coverageSummary` / `openMissingGroupsSheet` stay — they
            still power the "+ Data state" panel's per-group enrich CTAs. */}

        {/* WP7-10 · sort-state announcement for screen readers. A polite live
          region names the active column + direction whenever the sort changes,
          so a non-visual user hears "Sorted by Reviews, descending" instead of
          only seeing the ▲/▼ glyph. Visually hidden (.sr-only). */}
        <div className="sr-only" aria-live="polite" role="status">
          {sortAnnouncement}
        </div>

        {/* ── The power table ───────────────────────────────────────────────── */}
        <div
          className="wbtable-wrap"
          ref={tableWrapRef}
          data-scrolled-x={scrolledX || undefined}
        >
          <table className={`wb ${density}`}>
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
                      // U23 · tag the identity name header so the sticky-left
                      // pin rule can target it (matches td.biz on the body).
                      c.kind === "biz" ? "biz" : "",
                      // WB-COL-3 · data-group boundary on the cluster's first
                      // column (matches the body cells' .gstart).
                      groupStartKeys.has(c.key) ? "gstart" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    // A group-starting header names its DATA GROUP in the tip
                    // ("Site speed & SEO · Lighthouse performance") so the
                    // boundary rule reads as a labelled cluster, not a stray line.
                    data-tip={
                      groupStartKeys.has(c.key) && c.group
                        ? `${dataGroupFor(c.group).label} · ${c.fullLabel ?? c.label}`
                        : (c.fullLabel ?? c.label)
                    }
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
                      {/* B1d · empty-state honesty: when rows EXIST but the
                          narrowing (filters / search / data-state / Enriched-
                          only) hides them all, say so — "No leads in this set
                          yet." was a lie that sent users re-paying for leads
                          they already had. */}
                      {rows.length > 0 && anyNarrowing ? (
                        <>
                          {rows.length === 1
                            ? "Filters hide the only lead."
                            : `Filters hide all ${rows.length.toLocaleString()} leads.`}{" "}
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
      </div>
      {/* /.wb-body-rel — end of the panel-overlay + grid group (AUDIT U9) */}

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
        {/* AUDIT U17 · bulk enrich the selection — the gross credit total for the
            selection's not-run data groups rides the button so the cost is visible
            before the sheet opens (the sheet then quotes the honest net at run,
            D2). Same gross estimate the toolbar action + sheet use. */}
        <button
          type="button"
          className="bb"
          onClick={() => {
            const rowsSel = filtered.filter((r) => selected.has(r.leadId));
            // ISSUE-2 · pre-select the exact to-get groups the button priced,
            // so the sheet opens matching its advertised number.
            openEnrichSheet({
              enrichments: enrichTypesForGroups(
                toGetGroupsForRows(rowsSel),
              ) as EnrichmentType[],
              preselect: true,
              scope: {
                selectedBusinessIds: rowsSel.map((r) => r.businessId),
                visibleBusinessIds: filtered.map((r) => r.businessId),
              },
            });
          }}
        >
          Enrich {selected.size}
          {bulkEnrichCredits > 0
            ? ` · ~${fmtCredits(bulkEnrichCredits)} cr`
            : ""}
        </button>
        <button type="button" className="bb" onClick={() => void exportCsv()}>
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

/** A "Set status ▾" bulk button with a small popover over the SETTABLE
 *  statuses (HIDDEN is excluded — hide is no longer a workbench verb, see
 *  {@link SETTABLE_STATUSES}). */
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
      {SETTABLE_STATUSES.map((s) => (
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
