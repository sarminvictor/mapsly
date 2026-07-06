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
  type ReactElement,
  type ReactNode,
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
  COLUMN_TYPE_GROUP_ORDER,
  CSV_HEADERS,
  DATA_FAMILIES,
  DEFAULT_ACTIVE_COLUMNS,
  defaultActiveColumnsForGoal,
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
  type ColumnTypeGroup,
  type DataFamily,
  type LeadFilter,
  type NumericLeadFilter,
  type LeadStatus,
  type NumericFilterField,
  type SignalGroup,
  type WorkbenchLeadRow,
} from "../leads-workbench";
import {
  enrichTypesForFamilies,
  ENRICHMENT_FAMILIES,
  ENRICHMENT_TYPES,
  DATA_GROUPS,
  deriveGroupStates,
  enrichTypesForGroups,
  anyLeadEnrichmentRan,
  anyLeadGroupRan,
  type FamilyState,
  type EnrichmentTypeKey,
  type TypeState,
  type DataGroupKey,
} from "../family-coverage";
import { QUALIFIER_SIGNAL_KEYS } from "../goal-templates";
import { useDismiss } from "../hooks/useDismiss";
import { Popover } from "@/components/agency/Popover";
import { openEnrichSheet, subscribeEnrichScope } from "../enrich-sheet-bus";
import { THIN_MARKET_THRESHOLD, fmtCredits } from "../flow-types";
import { resolveResearches } from "../researches";
import {
  ENRICHMENT_PRICES,
  CREDIT_PRICES,
  type EnrichmentType,
} from "@/modules/cost/pricing";

/** WP7-13 · a stable empty-bands object for the thin-market path (no vs-cell
 *  percentiles → the workbench renders absolute values). Module-level so the
 *  reference is stable across renders. */
const EMPTY_BANDS: Partial<Record<string, CellBand>> = {};

/** AUDIT U16 · where each family's data comes from — shown as a provenance
 *  tooltip on value cells so a number reads as evidence, not an assertion. */
const SOURCE_BY_FAMILY: Partial<Record<DataFamily, string>> = {
  reviews: "Google reviews",
  website: "Website scan · Lighthouse mobile",
  contacts: "Website + directories",
  ads: "Meta Ad Library",
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
   * AUDIT §3 · the honest per-business per-family RUN-STATE map (enriched /
   * empty / failed / not_run) from the coverage matrix. The single source of
   * truth for the dot-strip, per-cell affordances, the coverage panel, and the
   * "Enriched only" view. A business missing from the map falls back to a
   * state derived from its own `families` (enriched vs not_run). Plain data
   * (Pattern 4).
   */
  coverageStates?: Record<string, Record<DataFamily, FamilyState>>;
  /**
   * AUDIT A2 · the honest per-business per-TYPE state map (the 9 purchasable
   * enrichment types: contacts/services/reviews/tech/lighthouse/meta_ads/
   * google_ads/serp/ai_research). Drives the "Enriched" column badge strip —
   * one chip per type, colored by run state (enriched/empty/failed/running/
   * not_run). A business missing from the map falls back to a state derived
   * from its 5-family states (best-effort per-type approximation). Plain data
   * (Pattern 4).
   */
  coverageTypeStates?: Record<string, Record<EnrichmentTypeKey, TypeState>>;
  /**
   * AUDIT U16 · per-business per-family last-scanned time (ISO string) for the
   * provenance tooltip's "scanned {when}" clause. Read from the same freshness
   * cursors billing uses (`loadFreshTimestamps`): contacts/website/reviews from
   * the Business cursors + latest LighthouseAudit; ads/search from the cell's
   * newest AdMarketRun. A family absent from a business's map → no timestamp
   * (the tip falls back to source + fresh/stale). Plain data (Pattern 4).
   */
  scannedAt?: Record<string, Partial<Record<DataFamily, string>>>;
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
}

/** How the table groups rows: flat, by cell, or by the combination of applied
 *  signal-filter verdicts ("segment by pitch angle"). "signals" is only
 *  selectable when ≥1 signal filter is applied. */
type GroupMode = "none" | "cell" | "signals";

export function LeadsWorkbench({
  rows,
  discoveryId,
  bands,
  coverageStates = {},
  coverageTypeStates = {},
  scannedAt = {},
  goalSignals = [],
  goalResearches = [],
  allSignals,
  exportSlug,
  serverPage = 1,
  serverPageCount = 1,
  totalRows = rows.length,
  exportAllUrl,
}: LeadsWorkbenchProps) {
  /**
   * AUDIT §3 · the honest per-family RUN-STATE map for one row: prefer the
   * batched matrix (keyed by businessId), else derive from the row's own
   * `families` boolean map (enriched vs not_run — the fallback has no
   * empty/failed nuance). This ONE map drives the dot-strip, the per-cell
   * affordances, the coverage panel, and the "Enriched only" view, so they
   * can never disagree.
   */
  const statesFor = useCallback(
    (r: WorkbenchLeadRow): Record<DataFamily, FamilyState> => {
      const fromMatrix = coverageStates[r.businessId];
      if (fromMatrix) return fromMatrix;
      // Fallback: the row's boolean families → enriched / not_run only.
      const out = {} as Record<DataFamily, FamilyState>;
      for (const f of DATA_FAMILIES)
        out[f.key] = r.families[f.key] ? "enriched" : "not_run";
      return out;
    },
    [coverageStates],
  );
  /**
   * AUDIT A2 · the honest per-TYPE run-state map (the 9 billed types) for one
   * row: prefer the batched matrix (keyed by businessId), else APPROXIMATE from
   * the row's 5-family states so an older serialized prop still renders a strip.
   * The family→types fallback fans a family's state out to the types it covers
   * (website → tech + lighthouse, ads → meta_ads + google_ads); it has no
   * running/empty nuance the family model lacks, but keeps the column honest.
   */
  const typeStatesFor = useCallback(
    (r: WorkbenchLeadRow): Record<EnrichmentTypeKey, TypeState> => {
      const fromMatrix = coverageTypeStates[r.businessId];
      if (fromMatrix) return fromMatrix;
      const fam = statesFor(r);
      // Map each family state onto the types it spans (best-effort fallback).
      const famOf: Record<EnrichmentTypeKey, DataFamily> = {
        CONTACTS: "contacts",
        SERVICES: "contacts", // no 5-family "services" — nearest is contacts
        TECH: "website",
        REVIEWS: "reviews",
        LIGHTHOUSE: "website",
        META_ADS: "ads",
        GOOGLE_ADS: "ads",
        SERP: "search",
        AI_RESEARCH: "identity", // no family maps AI research → treat as not-run
      };
      const out = {} as Record<EnrichmentTypeKey, TypeState>;
      for (const t of ENRICHMENT_TYPES) {
        const df = famOf[t.key];
        // identity is always "enriched" but is not a real type — force not_run
        // so the fallback never fakes an AI-research chip as done.
        out[t.key] = df === "identity" ? "not_run" : fam[df];
      }
      return out;
    },
    [coverageTypeStates, statesFor],
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
  /** AUDIT A2/B1 · has a PER-LEAD enrichment run for this row — the predicate
   *  behind the "Enriched only" view. Uses the per-lead variants that EXCLUDE the
   *  per-market ads/search scans, so a per-cell ads/SERP scan no longer counts a
   *  lead as personally enriched. Prefers the per-type map (rolled to groups);
   *  falls back to the 5-family predicate when it's absent. NOTE the deliberate
   *  asymmetry: the primary path counts `google_ads` (basis:lead), but the
   *  fallback drops the whole `ads` family (the merged 5-family model can't tell
   *  Google from Meta) — the conservative choice on the rare legacy-props path.
   *  The primary (per-type) path is authoritative. */
  const rowEnriched = useCallback(
    (r: WorkbenchLeadRow): boolean =>
      coverageTypeStates[r.businessId]
        ? anyLeadGroupRan(groupStatesFor(r))
        : anyLeadEnrichmentRan(statesFor(r)),
    [coverageTypeStates, groupStatesFor, statesFor],
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
  // WB-COL-1 · seed the first-visit columns from the GOAL (defaults + the goal's
  // own data columns) once at mount. A saved column view still overrides this on
  // revisit (the localStorage-restore effect below), so user choices win.
  const [activeCols, setActiveCols] = useState<string[]>(() =>
    defaultActiveColumnsForGoal(goalResearches),
  );
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
      helpOpen ||
      fieldsOpen ||
      signalMenuOpen ||
      fieldMenuOpen ||
      stateMenuOpen;
  }, [helpOpen, fieldsOpen, signalMenuOpen, fieldMenuOpen, stateMenuOpen]);

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
          setCoverageOpen(false);
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
  // AUDIT C5 · field-state filters — "Email: enriched / none / failed / not run".
  // Multiple states on the SAME family are OR'd (email enriched OR failed);
  // different families are AND'd. Applied client-side off the honest state map.
  // Declared here (above the view-hydration + URL-write effects) so those
  // effects can seed from / push to it (C5 · round-trips through the goal URL).
  const [stateFilters, setStateFilters] = useState<
    { family: DataFamily; state: FamilyState }[]
  >([]);

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
      // C5 · seed the field-state filters from the URL (they live only in the
      // shareable-view URL, not localStorage), so an applied "contacts · none"
      // survives a manual refresh + a pasted link reproduces it.
      if (urlView?.fieldStates && urlView.fieldStates.length > 0) {
        setStateFilters(urlView.fieldStates);
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
        // C5 · field-state filters ride the SAME shareable-view URL writer as
        // sort + filters (one `fs=family:state` param each), so an applied
        // "contacts · none" state survives refresh + is shareable.
        { sortKey, sortDir, filters, fieldStates: stateFilters },
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
  }, [filters, sortKey, sortDir, stateFilters]);

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

  // F3 · the Fields picker, grouped by ENRICHMENT TYPE + search-filtered. Every
  // toggle-able column (all except the always-on `biz` anchor) is bucketed under
  // its `typeGroup` header; the search box narrows to labels containing the
  // query (case-insensitive). Sections with no surviving column are dropped so
  // the menu never shows an empty header. Preserves each column's `group`
  // (workflow vs enriched) so the render keeps the per-field funnel + the
  // free-add semantics.
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

  // AUDIT §3/B1 · "Enriched only" view — isolate the leads an enrichment
  // actually ran on (what you paid for) from the whole website-having market.
  const [enrichedOnly, setEnrichedOnly] = useState(false);

  // AUDIT C5 · field-state filter helpers (the `stateFilters` state itself is
  // declared above, near `filters`, so the view-hydration + URL-write effects
  // can round-trip it through the goal URL).
  const toggleStateFilter = useCallback(
    (family: DataFamily, state: FamilyState) => {
      setStateFilters((prev) => {
        const hit = prev.some((f) => f.family === family && f.state === state);
        return hit
          ? prev.filter((f) => !(f.family === family && f.state === state))
          : [...prev, { family, state }];
      });
      setPage(1);
    },
    [],
  );
  const stateFilterByFamily = useMemo(() => {
    const m = new Map<DataFamily, Set<FamilyState>>();
    for (const f of stateFilters) {
      const s = m.get(f.family) ?? new Set<FamilyState>();
      s.add(f.state);
      m.set(f.family, s);
    }
    return m;
  }, [stateFilters]);
  const passesStateFilters = useCallback(
    (r: WorkbenchLeadRow): boolean => {
      if (stateFilterByFamily.size === 0) return true;
      const st = statesFor(r);
      for (const [fam, allowed] of stateFilterByFamily) {
        if (!allowed.has(st[fam])) return false;
      }
      return true;
    },
    [stateFilterByFamily, statesFor],
  );

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

  // AUDIT U2/D5 · per-cell "running" state — the enrich sheet announces the
  // (business × family) scope it just launched; those cells show "running…"
  // until their real state refreshes in (LiveRunGate's poll → router.refresh
  // flips them to enriched/empty/failed, so `isCellRunning` self-clears once a
  // cell is no longer not_run). A safety timeout clears any stragglers.
  const [enriching, setEnriching] = useState<{
    ids: Set<string>;
    families: Set<string>;
  } | null>(null);
  useEffect(
    () =>
      subscribeEnrichScope((d) =>
        setEnriching({
          ids: new Set(d.businessIds),
          families: new Set(d.families),
        }),
      ),
    [],
  );
  useEffect(() => {
    if (!enriching) return;
    const t = window.setTimeout(() => setEnriching(null), 5 * 60_000);
    return () => window.clearTimeout(t);
  }, [enriching]);
  const isCellRunning = useCallback(
    (r: WorkbenchLeadRow, family?: DataFamily): boolean =>
      !!family &&
      !!enriching &&
      enriching.ids.has(r.businessId) &&
      enriching.families.has(family) &&
      statesFor(r)[family] === "not_run",
    [enriching, statesFor],
  );
  // AUDIT C5 · is this (business × family) currently in an enrich run. The
  // optimistic flag (`enriching`) is set the moment a run launches, but it must
  // CLEAR the instant the run's data lands — not only on a manual page refresh.
  // LiveRunGate already fires router.refresh() on run completion, which re-serves
  // the honest `statesFor` map with the family flipped OUT of `not_run` (to
  // enriched/empty/failed). So we gate the optimistic flag on that settled state:
  // the loader shows only while the family is BOTH flagged AND still not_run, and
  // self-clears the moment the terminal refresh settles it. The 5-min timeout on
  // `enriching` stays as a backstop for a run that never reports back.
  const isFamilyEnriching = useCallback(
    (r: WorkbenchLeadRow, family?: DataFamily): boolean =>
      !!family &&
      !!enriching &&
      enriching.ids.has(r.businessId) &&
      enriching.families.has(family) &&
      statesFor(r)[family] === "not_run",
    [enriching, statesFor],
  );
  /**
   * AUDIT C5 · wrap ONE value cell's `<td>` in the loading state when its family
   * is in flight for this lead: dim the value, block interaction
   * (`pointer-events:none` via `.cell-loading` + `aria-busy`), and overlay a
   * small spinner — WITHOUT changing the cell content (so the column width never
   * shifts). Only the field cell is inerted; the row's own click is untouched.
   * A not_run cell already renders `NeedsEnrich`'s "running…" state, so wrapping
   * it here is harmless (it just gains the dim + aria-busy). Cells with no
   * `col.family` (biz/match/status/…) are returned unchanged.
   */
  const withCellLoading = useCallback(
    (col: ColumnDef, r: WorkbenchLeadRow, td: ReactElement): ReactElement => {
      if (!isFamilyEnriching(r, col.family) || !isValidElement(td)) return td;
      const prev = (td.props as { className?: string }).className;
      const children = (td.props as { children?: ReactNode }).children;
      return cloneElement(
        td as ReactElement<{
          className?: string;
          "aria-busy"?: boolean;
          children?: ReactNode;
        }>,
        {
          className: `${prev ? `${prev} ` : ""}cell-loading`,
          "aria-busy": true,
        },
        children,
        // AUDIT · a horizontal sweep beside the (dimmed) value, NOT a round
        // spinner replacing it — the loader reads as "refreshing this value".
        <span
          key="__cellspin"
          className="cell-loading-sweep"
          aria-hidden="true"
        />,
      );
    },
    [isFamilyEnriching],
  );

  // AUDIT U16 · the per-cell provenance tooltip for a numeric enriched value:
  // `{source} · scanned {when} · {fresh|stale}`. The source names WHERE the
  // number came from (SOURCE_BY_FAMILY); `{when}` is the real last-scanned date
  // from the same freshness cursors billing uses (threaded via `scannedAt`);
  // freshness is read from the family's honest run state (an `enriched` family
  // reads "fresh", a re-scan-worthy `failed`/`empty` reads "stale"). When no
  // timestamp exists for the family we drop the date; the source alone is the
  // fallback when a cell has no family.
  const cellProvenance = useCallback(
    (r: WorkbenchLeadRow, family?: DataFamily): string | undefined => {
      if (!family) return undefined;
      const source = SOURCE_BY_FAMILY[family];
      if (!source) return undefined;
      const state = statesFor(r)[family];
      const fresh = state === "enriched" ? "fresh" : "stale";
      const when = fmtScannedWhen(scannedAt[r.businessId]?.[family]);
      return when
        ? `${source} · scanned ${when} · ${fresh}`
        : `${source} · scanned · ${fresh}`;
    },
    [statesFor, scannedAt],
  );

  // ── Filtered + sorted rows ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const f = rows.filter(
      (r) =>
        matchesSearch(r, search) &&
        passesFilters(r, filters) &&
        (!enrichedOnly || rowEnriched(r)) &&
        passesStateFilters(r),
    );
    return sortRows(f, sortKey, sortDir);
  }, [
    rows,
    search,
    filters,
    sortKey,
    sortDir,
    enrichedOnly,
    rowEnriched,
    passesStateFilters,
  ]);

  // Count of enriched leads in the current window (for the toggle label).
  const enrichedCount = useMemo(
    () => rows.filter((r) => rowEnriched(r)).length,
    [rows, rowEnriched],
  );

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

  // AUDIT C5 · per-family state histogram over the loaded window — powers the
  // clickable "Site audit: have 11 · none 30 · failed 5" coverage-panel filters.
  // These stay on the 5-ENRICHMENT-FAMILY axis (reviews/website/contacts/ads/
  // search) because the field-state filter round-trips through the shareable-view
  // URL by DataFamily key (wb-view-state `fieldStates`); the panel presents them
  // under the data-group labels the family already carries (DATA_FAMILIES labels
  // were renamed — "Site audit" etc.). The have/not-yet SUMMARY above is the
  // 7-group denominator that the chip strip + toolbar badge share.
  const familyStateCounts = useMemo(() => {
    const out = new Map<DataFamily, Record<FamilyState, number>>();
    for (const fam of ENRICHMENT_FAMILIES)
      out.set(fam, { enriched: 0, empty: 0, failed: 0, not_run: 0 });
    for (const r of rows) {
      const st = statesFor(r);
      for (const fam of ENRICHMENT_FAMILIES) out.get(fam)![st[fam]] += 1;
    }
    return out;
  }, [rows, statesFor]);

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

  // AUDIT U10/U17 · "enrichable in this view" + its gross credit estimate.
  // A row is enrichable when it has ≥1 ENRICHMENT family that hasn't run yet
  // (not_run) — those are the only families an enrich run would actually charge
  // for and produce data on. `rowNotRunFamilies` yields that per-row set; the
  // gross-credit estimate sums each row's not-run BUSINESS-basis families
  // (CREDIT_PRICES), dependency-resolved like EnrichMoreSheet's grossCredits so
  // the toolbar/bulk numbers stay consistent with the sheet. Cell-basis families
  // (ads/serp) need the per-cell count the sheet resolves server-side, so they're
  // excluded from this at-a-glance estimate (the sheet quotes the honest net).
  const rowNotRunFamilies = useCallback(
    (r: WorkbenchLeadRow): DataFamily[] => {
      const st = statesFor(r);
      return ENRICHMENT_FAMILIES.filter((f) => st[f] === "not_run");
    },
    [statesFor],
  );
  const rowIsEnrichable = useCallback(
    (r: WorkbenchLeadRow): boolean => rowNotRunFamilies(r).length > 0,
    [rowNotRunFamilies],
  );
  /** Gross per-lead credit estimate for a set of rows: each row contributes the
   *  credits of its not-run business-basis families (dependency-resolved). */
  const grossCreditsForRows = useCallback(
    (rowsIn: readonly WorkbenchLeadRow[]): number => {
      let credits = 0;
      for (const r of rowsIn) {
        const fams = rowNotRunFamilies(r);
        if (fams.length === 0) continue;
        const types = resolveResearches(
          enrichTypesForFamilies(fams) as EnrichmentType[],
        );
        for (const t of types) {
          if (ENRICHMENT_PRICES[t].unit === "business")
            credits += CREDIT_PRICES[t];
        }
      }
      return credits;
    },
    [rowNotRunFamilies],
  );

  // The scope for the toolbar's one primary enrich action: the selected rows if
  // any are selected, else the filtered rows that still have a not-run family.
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
  // U17 · gross credits for the bulk-bar selection (the selected rows only).
  const bulkEnrichCredits = useMemo(
    () => grossCreditsForRows(filtered.filter((r) => selected.has(r.leadId))),
    [filtered, selected, grossCreditsForRows],
  );
  /** Open the enrich sheet for the toolbar's primary action — scoped to the
   *  enrichable target rows (selected-if-any, else the filtered set). */
  function openToolbarEnrichSheet() {
    const ids = enrichTargetRows.map((r) => r.businessId);
    openEnrichSheet({
      scope: {
        selectedBusinessIds: ids,
        visibleBusinessIds: filtered.map((r) => r.businessId),
      },
    });
  }

  /** Coverage CTA → open the sheet pre-seeded with every missing data group. */
  function openMissingFamiliesSheet() {
    openEnrichSheet({
      enrichments: enrichTypesForGroups(
        coverageSummary.missingGroups,
      ) as EnrichmentType[],
      scope: enrichScope,
    });
  }

  /** Click an empty "— enrich" cell → open the sheet scoped to THAT lead,
   *  pre-seeded with the cell's data family (so a Lighthouse cell offers a
   *  Lighthouse enrich, a Phone cell offers contacts, etc.). Closes the
   *  founder's "I can't enrich by clicking the field" complaint. */
  function enrichCell(
    r: WorkbenchLeadRow,
    family?: DataFamily,
    enrichTypes?: readonly string[],
  ) {
    // AUDIT · prefer the column's explicit enrichTypes when given. A `website`-
    // family cell (Built on / Booking tool) maps to contacts+tech only — the raw
    // `enrichTypesForFamilies(["website"])` would wrongly drag Lighthouse in.
    const types =
      enrichTypes ?? (family ? enrichTypesForFamilies([family]) : undefined);
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
   * AUDIT §3/A4 · the STATE-AWARE empty-cell affordance. Reads the family's real
   * run state so a cell never lies:
   *   - not_run → the clickable "— enrich" action (never scanned)
   *   - empty   → a calm muted "none" (scanned, verified nothing) — NOT clickable
   *               so a retry can't re-charge for a known-empty result (A5)
   *   - failed  → a red "failed · retry" action (errored — retryable)
   * `enriched` never reaches here (the cell renders the value instead).
   */
  const NeedsEnrich = ({
    r,
    family,
    enrichTypes,
    ranButEmpty,
  }: {
    r: WorkbenchLeadRow;
    family?: DataFamily;
    /** AUDIT · the column's explicit enrichment types — overrides the
     *  family→types default so a Built-on / Booking-tool click enriches
     *  contacts+tech (not Lighthouse). Threaded down to enrichCell. */
    enrichTypes?: readonly string[];
    /** WB-CELL-2 · the family RAN but THIS sub-field is empty (e.g. contacts
     *  enriched, found a phone but no email). Treat an 'enriched' family-state as
     *  verified-empty here so the cell reads a calm 'none', not the actionable
     *  '— enrich' (which a retry can't fill and would re-charge). Only pass this
     *  for a multi-field family's sub-field (contacts → email/phone/socials). */
    ranButEmpty?: boolean;
  }) => {
    const state: FamilyState = family ? statesFor(r)[family] : "not_run";
    const label = family
      ? (DATA_FAMILIES.find((f) => f.key === family)?.label ?? "data")
      : "data";

    // AUDIT U2/D5 · this cell is in the active enrich run → show it working, with
    // the loader BESIDE the affordance (dimmed "enriching…" copy + a horizontal
    // sweep), not a round spinner REPLACING it. The point: the loader renders
    // alongside content, never instead of it.
    if (isCellRunning(r, family)) {
      return (
        <span className="cell-loading-beside" data-tip="Enriching…">
          <span className="cell-none">enriching…</span>
          <span className="cell-loading-sweep" aria-hidden="true" />
        </span>
      );
    }

    // WB-CELL-2 · verified-empty when the family reports 'empty', OR when the
    // family ran ('enriched') but this sub-field came back empty (ranButEmpty).
    if (state === "empty" || (ranButEmpty && state === "enriched")) {
      return (
        <span className="cell-none" data-tip={`Scanned · no ${label} found`}>
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
          enrichCell(r, family, enrichTypes);
        }}
      >
        {failed ? "failed · retry" : "— enrich"}
      </button>
    );
  };

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
  // C2 · one filtering home — the "By data state" section of the merged
  // "+ Filter" picker. Per family, the have/none/failed/not-run toggles present
  // in the loaded window (ordered by actionability, matching the coverage
  // panel's read-only summary). These drive the SAME `stateFilters` model via
  // `toggleStateFilter` — no second filter model — so they round-trip through
  // the shareable-view URL exactly as before and the active-count badge on the
  // Filter + Coverage toolbar buttons stays honest.
  const stateFilterRows = useMemo(() => {
    const STATE_LABEL: Record<FamilyState, string> = {
      enriched: "have",
      empty: "none",
      failed: "failed",
      not_run: "not run",
    };
    // Actionability order (failed → none → have), default-population last.
    const STATE_ORDER: FamilyState[] = [
      "failed",
      "empty",
      "enriched",
      "not_run",
    ];
    return ENRICHMENT_FAMILIES.flatMap((fam) => {
      const counts = familyStateCounts.get(fam);
      if (!counts) return [];
      const states = STATE_ORDER.filter((s) => counts[s] > 0);
      if (states.length === 0) return [];
      const label = DATA_FAMILIES.find((f) => f.key === fam)?.label ?? fam;
      return [
        {
          family: fam,
          label,
          states: states.map((s) => ({
            state: s,
            stateLabel: STATE_LABEL[s],
            count: counts[s],
          })),
        },
      ];
    });
  }, [familyStateCounts]);
  const stateOptionCount = stateFilterRows.length;

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
  /** Clear every applied filter + the search (WP4-15 · actionable empty state).
   *  The one path the "Clear filters" button in the empty row + the panel share. */
  function clearAllFilters() {
    userTouchedRef.current = true;
    setFilters([]);
    setSearch("");
    setPage(1);
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  function renderCell(col: ColumnDef, r: WorkbenchLeadRow): ReactElement {
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
            <span className={`cellval${tone}`}>{r.match}%</span>
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
        // AUDIT C3/F2 · key-aware text cell (was hardcoded to builtOn) so the
        // Booking-tool + AI-summary columns render their own value.
        const val =
          col.key === "bookingTool"
            ? r.bookingTool
            : col.key === "aiSummary"
              ? r.aiSummary
              : r.builtOn;
        if (val == null) {
          // AUDIT · a null builtOn/bookingTool doesn't always mean "not scanned":
          // the tech scan may have RUN and simply found a custom/unknown CMS (or
          // no booking tool). Read the honest per-type TECH state — when it's
          // enriched/empty the scan ran, so show the scanned marker (mirroring the
          // drawer's `cms ?? "Custom / unknown"`), NOT a "— enrich" CTA that would
          // re-charge for a known result. Only a genuinely not_run/failed TECH
          // state falls through to the enrich affordance.
          if (col.key === "builtOn" || col.key === "bookingTool") {
            const tech = coverageTypeStates[r.businessId]?.TECH;
            if (tech === "enriched" || tech === "empty") {
              return (
                <td key={col.key}>
                  <span className="cell-none">
                    {col.key === "builtOn" ? "Custom / unknown" : "—"}
                  </span>
                </td>
              );
            }
          }
          return (
            <td key={col.key}>
              <NeedsEnrich
                r={r}
                family={col.family}
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
                family={col.family}
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
                family={col.family}
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
        const v = numField(r, col.key);
        if (v == null)
          return (
            <td className="num" key={col.key}>
              <NeedsEnrich
                r={r}
                family={col.family}
                enrichTypes={col.enrichTypes}
              />
            </td>
          );
        const band = effectiveBands[col.key];
        const display = col.unit === "★" ? v.toFixed(1) : v.toLocaleString();
        return (
          <td className="num" key={col.key}>
            <span className="cellval" data-tip={cellProvenance(r, col.family)}>
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
                family={col.family}
                enrichTypes={col.enrichTypes}
                // WB-CELL-2 · contacts ran but THIS channel is empty → 'none'.
                ranButEmpty={statesFor(r).contacts === "enriched"}
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
        if (r.socials.length === 0)
          return (
            <td key={col.key}>
              <NeedsEnrich
                r={r}
                family={col.family}
                enrichTypes={col.enrichTypes}
                // WB-CELL-2 · contacts ran but no social handles → 'none'.
                ranButEmpty={statesFor(r).contacts === "enriched"}
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
          <td key={col.key}>
            <span style={{ display: "inline-flex", gap: 4, flexWrap: "wrap" }}>
              {r.socials.slice(0, 5).map((s, i) => {
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
        // C3 · per-row badge strip over the 7 DATA GROUPS the user gets
        // (contacts & site tech / reviews / site speed & SEO / services /
        // AI brief / ad activity / search rank), each a chip colored by its
        // honest rolled-up RUN state: enriched (green · every type has data) ·
        // empty (grey · ran but not fully) · failed (red · errored) · running
        // (pulse · in flight) · not_run (faint outline · never scanned). This is
        // the SAME 7-group denominator the toolbar badge + coverage panel use,
        // so "N / 7" is one number everywhere. "N/7" counts groups with data.
        const gs = groupStatesFor(r);
        const groups = DATA_GROUPS;
        const total = groups.length;
        const enrichedN = groups.filter((g) => gs[g.key] === "enriched").length;
        const failedN = groups.filter((g) => gs[g.key] === "failed").length;
        const runningN = groups.filter((g) => gs[g.key] === "running").length;
        return (
          <td key={col.key}>
            <span
              className="covstrip"
              data-tip={
                failedN > 0
                  ? `${enrichedN} of ${total} data groups · ${failedN} failed — re-enrich`
                  : runningN > 0
                    ? `${enrichedN} of ${total} data groups · ${runningN} running`
                    : `${enrichedN} of ${total} data groups have data`
              }
            >
              <span className="covfrac">
                {enrichedN}/{total}
              </span>
              <span
                className="covtypes"
                aria-label={`${enrichedN} of ${total} data groups have data${
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
        {cols.map((c) => withCellLoading(c, r, renderCell(c, r)))}
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
            first in the reading order, not buried on the far right. */}
        <button
          ref={filterBtnRef}
          type="button"
          className={`btn sm${filters.length ? " active" : ""}`}
          aria-haspopup="true"
          aria-expanded={filtersOpen}
          aria-label="Filters"
          data-tip="Filter these leads"
          onClick={() => {
            setFiltersOpen((o) => !o);
            setCoverageOpen(false);
          }}
        >
          <Icon name="filter" />
          {" Filter"}
          {filters.length ? (
            <span className="cbadge">{filters.length}</span>
          ) : null}
        </button>

        {/* #1 · live filtered count — updates as filters/search change so the
            match total is visible up here by the Filter control, not only down
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

        {/* AUDIT U10 · the ONE primary action in the toolbar — enrich the
            enrichable leads in the current view (selected rows if any are
            selected, else the filtered rows with a not-run family), with the
            gross credit estimate inline. Everything else in the toolbar stays
            secondary. Hidden when nothing in view is enrichable. */}
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
              toolbar Enrich button, and the coverage Enrich CTA. */}
        </Popover>

        <span className="tb-spacer" />

        {/* AUDIT §3/B1 · isolate the leads an enrichment actually ran on (what
            the agency paid for) from the whole website-having market. */}
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

        {/* AUDIT U7 · row density — Compact default; click toggles. */}
        <button
          type="button"
          className="btn sm"
          data-tip="Row density — click to toggle compact / cozy"
          aria-label={`Row density: ${density}`}
          onClick={toggleDensity}
        >
          {density === "compact" ? "Compact" : "Cozy"}
        </button>

        <button
          ref={coverageBtnRef}
          type="button"
          // Highlight when a coverage field-state filter is active (parity with
          // the Filter button) — otherwise the user can't tell the grid is being
          // narrowed by the Coverage layer.
          className={`iconbtn${stateFilters.length ? " active" : ""}`}
          aria-haspopup="true"
          aria-expanded={coverageOpen}
          aria-pressed={stateFilters.length > 0}
          aria-label="Coverage"
          data-tip="Coverage layers"
          onClick={() => {
            setCoverageOpen((o) => !o);
            setFiltersOpen(false);
          }}
        >
          <Icon name="coverage" />
          {/* C3 · the SAME 7-data-group denominator the row chip strip + the
              coverage panel use — "4/7", never /5 or /6. */}
          <span className="cbadge alt">
            {stateFilters.length
              ? stateFilters.length
              : `${coverageSummary.have.length}/${DATA_GROUPS.length}`}
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
                {signalOptionCount === 0 ? (
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
                    onClick={openMissingFamiliesSheet}
                  >
                    No signal covers all leads yet · enrich to unlock →
                  </button>
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
                    onClick={openMissingFamiliesSheet}
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
                    {stateFilterRows.map((famRow) => {
                      const active = stateFilterByFamily.get(famRow.family);
                      return (
                        <div key={famRow.family} className="filter-state-row">
                          <span className="filter-state-fam">
                            {famRow.label}
                          </span>
                          <span className="filter-state-toggles">
                            {famRow.states.map((s) => (
                              <button
                                key={s.state}
                                type="button"
                                className={`cov-state${
                                  active?.has(s.state) ? " on" : ""
                                }`}
                                aria-pressed={active?.has(s.state) ?? false}
                                data-tip={`Show leads where ${famRow.label} = ${s.stateLabel}`}
                                onClick={() =>
                                  toggleStateFilter(famRow.family, s.state)
                                }
                              >
                                {s.stateLabel} {s.count}
                              </button>
                            ))}
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
                    onClick={openMissingFamiliesSheet}
                  >
                    Nothing enriched yet · enrich to unlock →
                  </button>
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
                    with the missing data groups + the current scope) — a real
                    one-click buy surface, not a deep-link away. */}
                  <button
                    type="button"
                    className="clenrich"
                    style={{ cursor: "pointer", font: "inherit" }}
                    data-tip={`Enrich: ${coverageSummary.notYet.join(" · ")}`}
                    onClick={openMissingFamiliesSheet}
                  >
                    Enrich missing · {coverageSummary.notYet.length} →
                  </button>
                </>
              ) : (
                <span className="note" style={{ marginLeft: "auto" }}>
                  All data groups enriched on this set
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
            selection's not-run families rides the button so the cost is visible
            before the sheet opens (the sheet then quotes the honest net at run,
            D2). Same gross estimate the toolbar action + sheet use. */}
        <button
          type="button"
          className="bb"
          onClick={() =>
            openEnrichSheet({
              scope: {
                selectedBusinessIds: filtered
                  .filter((r) => selected.has(r.leadId))
                  .map((r) => r.businessId),
                visibleBusinessIds: filtered.map((r) => r.businessId),
              },
            })
          }
        >
          Enrich {selected.size}
          {bulkEnrichCredits > 0
            ? ` · ~${fmtCredits(bulkEnrichCredits)} cr`
            : ""}
        </button>
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

function numField(r: WorkbenchLeadRow, key: string): number | null {
  switch (key) {
    case "reviews":
      return r.reviews;
    case "rating":
      return r.rating;
    case "perf":
      return r.perf;
    case "seo":
      return r.seo;
    case "metaAdCount":
      return r.metaAdCount;
    case "googleAdCount":
      return r.googleAdCount;
    case "serpRank":
      return r.serpRank;
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
