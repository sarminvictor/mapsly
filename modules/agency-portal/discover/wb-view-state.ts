// wb-view-state · persist the leads workbench view preferences per research
// (WP4-13). Density / vs-cell / active columns / filters / sort / page size /
// group survive a reload, keyed by discoveryId (mapsly:wb:<id>) in
// localStorage. Search + selection stay ephemeral (they're about "right now",
// not a saved view).
//
// SHAREABLE VIEWS (WP4-13 · URL half, B16 contract): sort + numeric filters +
// SIGNAL filters + field-state filters + the status tab / not-touched toggle
// ALL serialize into the URL (`?sort=<col>&dir=asc|desc`,
// `f=<field>:<op>:<value>[:<value2>]` repeated, `sg=<sigKey>:<want>` repeated,
// `vf=<sigKey>:<mode>[:<value>]` repeated (value filters · Built on / Booking
// tool), `fs=<group>:<state>` repeated, `st=<status>`, `nt=1`) so a pasted
// link reproduces the view. On mount the URL WINS WHOLESALE — when the URL
// carries ANY view param, {@link parseViewFromSearchParams} returns a COMPLETE
// view (absent params = the defaults) and the workbench applies it — with ONE
// carve-out: the FILTERS dimension only comes from the URL when f=/sg=/vf=
// were actually present (`hasFilterParams`); an st=-only URL resolves filters
// locally (saved blob → goal seed), because "no f= param" means "the sender
// said nothing about filters", not "the sender chose zero filters". Only a
// param-less URL falls back to localStorage wholesale. (The blob keeps owning
// the non-shareable prefs: columns / group / density / page size.)
//
// Reads are DEFENSIVE: localStorage is user-writable and can hold stale shapes
// from an older column set, so every field is validated against the current
// vocabulary and anything unrecognized is dropped (falls back to the default).
// A bad blob never throws — it just yields `null` and the caller keeps defaults.

import {
  COLUMNS,
  FILTER_FIELDS,
  PAGE_SIZES,
  SIGNAL_VALUE_FIELDS,
  STATUS_ORDER,
  type LeadFilter,
  type LeadStatus,
  type NumericLeadFilter,
  type NumericFilterField,
  type SignalLeadFilter,
  type ValueLeadFilter,
} from "./leads-workbench";
import {
  DATA_GROUP_KEYS,
  type DataGroupKey,
  type TypeState,
} from "./family-coverage";

export interface WorkbenchViewState {
  vsCell: boolean;
  group: "none" | "cell" | "signals";
  activeCols: string[];
  /**
   * WB-COL-2 · columns the user EXPLICITLY hid (unchecked in the Fields menu
   * or removed via the auto-show toast's Undo). The auto-show-after-research
   * mechanism never re-adds a dismissed column — an explicit uncheck is
   * permanent for this research until the user re-checks it (which clears the
   * dismissal). Persisted alongside activeCols; legacy blobs without the key
   * simply omit it (the Partial load contract).
   */
  dismissedCols: string[];
  filters: LeadFilter[];
  sortKey: string;
  sortDir: 1 | -1;
  pageSize: number;
}

/**
 * C5 · the run states a field-state filter can name — the settled subset of
 * {@link TypeState}. `running` is transient (in flight) and deliberately NOT
 * filterable: a row mid-run matches no state filter.
 */
export type FieldFilterState = Exclude<TypeState, "running">;

const KEY_PREFIX = "mapsly:wb:";
const FILTER_OPS = new Set(["<", "≤", "=", "≥", ">", "between"]);
const VALID_COLS = new Set(COLUMNS.map((c) => c.key));
const VALID_FIELDS = new Set<string>(FILTER_FIELDS.map((f) => f.field));
const VALID_PAGE_SIZES = new Set<number>(PAGE_SIZES);
// C5 · the data groups + run states that a field-state filter can name.
const VALID_STATE_GROUPS = new Set<string>(DATA_GROUP_KEYS);
const VALID_STATES = new Set<FieldFilterState>([
  "enriched",
  "empty",
  "failed",
  "not_run",
]);

function storageKey(discoveryId: string): string {
  return `${KEY_PREFIX}${discoveryId}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function sanitizeFilters(raw: unknown): LeadFilter[] | null {
  if (!Array.isArray(raw)) return null;
  const out: LeadFilter[] = [];
  for (const f of raw) {
    if (!isRecord(f)) continue;
    // Signal filters are self-contained (sigKey/sigLabel/want) — persist them so
    // the user's signal-filter choices survive refresh + revisit. (The caller
    // re-validates sigKey against the current goal on restore, so a signal that
    // left the goal can't hide every lead.)
    if (f.kind === "signal") {
      if (
        typeof f.sigKey === "string" &&
        typeof f.sigLabel === "string" &&
        (f.want === "match" || f.want === "miss")
      ) {
        out.push({
          kind: "signal",
          sigKey: f.sigKey,
          sigLabel: f.sigLabel,
          want: f.want,
        });
      }
      continue;
    }
    // Value filters (Built on / Booking tool · Any / specific / none) —
    // validated against the SIGNAL_VALUE_FIELDS registry, which also SELF-HEALS
    // field + label (the registry owns them; a stale blob can't point a sigKey
    // at the wrong row field). Mode "is" without a usable value drops.
    if (f.kind === "value") {
      const spec =
        typeof f.sigKey === "string" ? SIGNAL_VALUE_FIELDS[f.sigKey] : null;
      if (!spec) continue;
      if (f.mode === "any" || f.mode === "none") {
        out.push({
          kind: "value",
          sigKey: f.sigKey as string,
          field: spec.field,
          label: spec.label,
          mode: f.mode,
        });
      } else if (
        f.mode === "is" &&
        typeof f.value === "string" &&
        f.value.trim() !== ""
      ) {
        out.push({
          kind: "value",
          sigKey: f.sigKey as string,
          field: spec.field,
          label: spec.label,
          mode: "is",
          value: f.value,
        });
      }
      continue;
    }
    const { field, op, value, value2 } = f;
    if (typeof field !== "string" || !VALID_FIELDS.has(field)) continue;
    if (typeof op !== "string" || !FILTER_OPS.has(op)) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const clean: NumericLeadFilter = {
      field: field as NumericFilterField,
      op: op as NumericLeadFilter["op"],
      value,
    };
    if (typeof value2 === "number" && Number.isFinite(value2))
      clean.value2 = value2;
    // AUDIT B3 · the include-no-data toggle round-trips the blob (absent in
    // legacy blobs → undefined → excluded, the old behavior).
    if (f.includeNoData === true) clean.includeNoData = true;
    out.push(clean);
  }
  return out;
}

/**
 * Read + validate the saved view for a research. Returns a partial that only
 * includes fields present + valid in the blob; missing/invalid fields are
 * omitted so the caller keeps its own defaults for them. Never throws.
 */
export function loadWorkbenchView(
  discoveryId: string,
): Partial<WorkbenchViewState> | null {
  if (typeof window === "undefined") return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(storageKey(discoveryId));
  } catch {
    return null; // storage disabled (private mode / quota) — keep defaults.
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const out: Partial<WorkbenchViewState> = {};
  if (typeof parsed.vsCell === "boolean") out.vsCell = parsed.vsCell;
  if (
    parsed.group === "none" ||
    parsed.group === "cell" ||
    parsed.group === "signals"
  )
    out.group = parsed.group;
  if (Array.isArray(parsed.activeCols)) {
    const cols = parsed.activeCols.filter(
      (c): c is string => typeof c === "string" && VALID_COLS.has(c),
    );
    // "biz" is the always-on anchor column; keep it even if a stale blob dropped it.
    if (!cols.includes("biz")) cols.unshift("biz");
    out.activeCols = cols;
  }
  // WB-COL-2 · dismissed columns — validated exactly like activeCols (filter
  // to the current column vocabulary, drop anything stale/unknown). Absent in
  // legacy blobs → omitted (caller keeps its default empty set).
  if (Array.isArray(parsed.dismissedCols)) {
    out.dismissedCols = parsed.dismissedCols.filter(
      (c): c is string => typeof c === "string" && VALID_COLS.has(c),
    );
  }
  const filters = sanitizeFilters(parsed.filters);
  if (filters) out.filters = filters;
  if (typeof parsed.sortKey === "string" && VALID_COLS.has(parsed.sortKey))
    out.sortKey = parsed.sortKey;
  if (parsed.sortDir === 1 || parsed.sortDir === -1)
    out.sortDir = parsed.sortDir;
  if (
    typeof parsed.pageSize === "number" &&
    VALID_PAGE_SIZES.has(parsed.pageSize)
  )
    out.pageSize = parsed.pageSize;
  return out;
}

/**
 * Persist the current view. Never throws (storage may be full/disabled).
 * `filters` is optional: pass `undefined` to persist the display prefs WITHOUT
 * writing a filters set (JSON.stringify omits it), so the goal-default seed is
 * never frozen into storage before the user has made a real filter choice.
 */
export function saveWorkbenchView(
  discoveryId: string,
  view: Omit<WorkbenchViewState, "filters"> & { filters?: LeadFilter[] },
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(discoveryId), JSON.stringify(view));
  } catch {
    // Quota exceeded / storage disabled — a lost preference is not worth a crash.
  }
}

// ── Shareable view URL params (WP4-13 · URL half) ────────────────────────────

/** C5 · one field-state filter — "this DATA GROUP is in this run state"
 *  ("Contacts & site tech · none", "Reviews · failed"). Mirrors the
 *  workbench's `stateFilters` entry shape. Keyed by the 7-group vocabulary
 *  (the 2026-07-06 truth unification retired the 5-family axis; old
 *  `fs=family:state` URLs simply parse to nothing). */
export interface FieldStateFilter {
  group: DataGroupKey;
  state: FieldFilterState;
}

/** The URL-shareable subset of the view: sort + filters (numeric AND signal) +
 *  field-state filters + the status tab / not-touched narrowing (B5/B16). */
export interface WorkbenchViewParams {
  sortKey: string;
  sortDir: 1 | -1;
  filters: LeadFilter[];
  /** C5 · the per-group run-state filters (optional for back-compat: an older
   *  URL carrying no `fs` param parses to `[]`). */
  fieldStates?: FieldStateFilter[];
  /** B5 · the status tab (`st=` param). Absent/undefined = "All". */
  statusTab?: LeadStatus;
  /** B5 · the "Not touched" quick toggle (`nt=1`). Absent = off. */
  notTouched?: boolean;
  /** Code-review gap · the "Enriched only" toggle (`eo=1`). Absent = off —
   *  without it a shared link under-reproduced the sender's narrowed view. */
  enrichedOnly?: boolean;
  /**
   * Code-review fix (seed-loss) · TRUE only when the URL actually carried a
   * filter param (`f=` or `sg=`). A URL with only `st=`/`nt=`/`fs=`/sort must
   * NOT read as "the sender chose zero filters" — the filters dimension then
   * resolves locally (saved blob → goal seed) instead of being frozen to []
   * with userTouched, which permanently destroyed the goal-default seed after
   * one status-tab click + reload.
   */
  hasFilterParams?: boolean;
}

/** The workbench's default sort (Match % descending). */
export const DEFAULT_SORT_KEY = "match";
export const DEFAULT_SORT_DIR: 1 | -1 = -1;

// Filter ops use ASCII tokens in the URL (`≤`/`≥` are non-URL-friendly).
// B16 · SIGNAL filters serialize too (`sg=<sigKey>:<want>`) — the parse
// returns them with sigLabel = sigKey; the workbench re-labels + validates
// against its signal library on mount (a key outside the library drops).
const OP_TO_TOKEN: Record<NumericLeadFilter["op"], string> = {
  "<": "lt",
  "≤": "lte",
  "=": "eq",
  "≥": "gte",
  ">": "gt",
  between: "between",
};
const TOKEN_TO_OP: Record<string, NumericLeadFilter["op"]> = {
  lt: "<",
  lte: "≤",
  eq: "=",
  gte: "≥",
  gt: ">",
  between: "between",
};

// AUDIT B3 · includeNoData rides the op token as a `-n` suffix ("perf:lt-n:50")
// — backward-compatible: old URLs carry bare tokens and decode with
// includeNoData unset; old CLIENTS reading a new URL drop the whole filter
// (unknown op token → null), never misread it.
const NO_DATA_SUFFIX = "-n";

/** One numeric filter → its `f` param value: `field:op[-n]:value[:value2]`. Pure. */
export function serializeFilterParam(f: NumericLeadFilter): string {
  const op = `${OP_TO_TOKEN[f.op]}${f.includeNoData ? NO_DATA_SUFFIX : ""}`;
  const parts = [f.field, op, String(f.value)];
  if (f.op === "between") parts.push(String(f.value2 ?? f.value));
  return parts.join(":");
}

/** Parse one `f` param value back into a numeric filter. null when malformed. */
export function parseFilterParam(raw: string): NumericLeadFilter | null {
  const [field, opTokenRaw, valueRaw, value2Raw] = raw.split(":");
  if (!field || !VALID_FIELDS.has(field)) return null;
  const includeNoData = opTokenRaw?.endsWith(NO_DATA_SUFFIX) ?? false;
  const opToken = includeNoData
    ? opTokenRaw!.slice(0, -NO_DATA_SUFFIX.length)
    : opTokenRaw;
  const op = opToken ? TOKEN_TO_OP[opToken] : undefined;
  if (!op) return null;
  const value = Number(valueRaw);
  if (!Number.isFinite(value)) return null;
  const out: NumericLeadFilter = {
    field: field as NumericFilterField,
    op,
    value,
  };
  if (op === "between") {
    const value2 = Number(value2Raw);
    if (!Number.isFinite(value2)) return null;
    out.value2 = value2;
  }
  if (includeNoData) out.includeNoData = true;
  return out;
}

/** B16 · one signal filter → its `sg` param value: `sigKey:want`. Pure. */
export function serializeSignalParam(f: SignalLeadFilter): string {
  return `${f.sigKey}:${f.want}`;
}

/**
 * Parse one `sg` param value back into a signal filter. `sigLabel` is set to
 * the key as a PLACEHOLDER — the workbench re-labels from its signal library
 * on mount and DROPS keys the library doesn't know (a stale/foreign key would
 * otherwise read all-null and hide every lead). null when malformed.
 */
export function parseSignalParam(raw: string): SignalLeadFilter | null {
  const [sigKey, want] = raw.split(":");
  if (!sigKey) return null;
  if (want !== "match" && want !== "miss") return null;
  return { kind: "signal", sigKey, sigLabel: sigKey, want };
}

/** One value filter → its `vf` param value: `sigKey:mode[:value]`. The
 *  specific value is URI-encoded so tool names with `:`/spaces round-trip
 *  (e.g. "Square Appointments"). Pure. */
export function serializeValueParam(f: ValueLeadFilter): string {
  return f.mode === "is"
    ? `${f.sigKey}:is:${encodeURIComponent(f.value ?? "")}`
    : `${f.sigKey}:${f.mode}`;
}

/**
 * Parse one `vf` param value back into a value filter. Validated against the
 * SIGNAL_VALUE_FIELDS registry (which owns field + label — a foreign sigKey
 * drops, so a crafted URL can't point a filter at an arbitrary row field).
 * null when malformed.
 */
export function parseValueParam(raw: string): ValueLeadFilter | null {
  const [sigKey, mode, ...rest] = raw.split(":");
  if (!sigKey) return null;
  const spec = SIGNAL_VALUE_FIELDS[sigKey];
  if (!spec) return null;
  if (mode === "any" || mode === "none") {
    return {
      kind: "value",
      sigKey,
      field: spec.field,
      label: spec.label,
      mode,
    };
  }
  if (mode === "is") {
    let value: string;
    try {
      value = decodeURIComponent(rest.join(":"));
    } catch {
      return null; // malformed percent-encoding
    }
    if (value.trim() === "") return null;
    return {
      kind: "value",
      sigKey,
      field: spec.field,
      label: spec.label,
      mode: "is",
      value,
    };
  }
  return null;
}

// B5 · the status tab round-trips as a lowercase `st=` value ("st=new").
const VALID_STATUSES = new Set<string>(STATUS_ORDER);

/** Parse the `st` param → a LeadStatus, or null when absent/unknown. */
export function parseStatusParam(raw: string | null): LeadStatus | null {
  if (!raw) return null;
  const up = raw.toUpperCase();
  return VALID_STATUSES.has(up) ? (up as LeadStatus) : null;
}

/** C5 · one field-state filter → its `fs` param value: `group:state`
 *  (e.g. `contacts_tech:enriched`). Pure. */
export function serializeFieldStateParam(f: FieldStateFilter): string {
  return `${f.group}:${f.state}`;
}

/** Parse one `fs` param value back into a field-state filter. null when
 *  malformed / references an unknown group or state — including every legacy
 *  5-family value (`contacts:…`, `website:…`, `ads:…`), which drops silently. */
export function parseFieldStateParam(raw: string): FieldStateFilter | null {
  const [group, state] = raw.split(":");
  if (!group || !VALID_STATE_GROUPS.has(group)) return null;
  if (!state || !VALID_STATES.has(state as FieldFilterState)) return null;
  return { group: group as DataGroupKey, state: state as FieldFilterState };
}

/**
 * Write the view into `params` (mutates + returns it): `sort`/`dir` only when
 * non-default, one `f` per numeric filter, one `sg` per signal filter (B16),
 * one `fs` per field-state filter, `st` only when a status tab is active,
 * `nt=1` only when Not-touched is on. Existing view params are cleared first,
 * so clearing the last filter also cleans the URL. Other params (`lead`,
 * `page`) are untouched. Pure w.r.t. everything but `params`.
 */
export function viewToSearchParams(
  view: WorkbenchViewParams,
  params: URLSearchParams,
): URLSearchParams {
  params.delete("sort");
  params.delete("dir");
  params.delete("f");
  params.delete("sg");
  params.delete("vf");
  params.delete("fs");
  params.delete("st");
  params.delete("nt");
  params.delete("eo");
  if (view.sortKey !== DEFAULT_SORT_KEY || view.sortDir !== DEFAULT_SORT_DIR) {
    params.set("sort", view.sortKey);
    params.set("dir", view.sortDir === 1 ? "asc" : "desc");
  }
  for (const f of view.filters) {
    if (f.kind === "signal") params.append("sg", serializeSignalParam(f));
    else if (f.kind === "value") params.append("vf", serializeValueParam(f));
    else params.append("f", serializeFilterParam(f));
  }
  for (const fs of view.fieldStates ?? []) {
    params.append("fs", serializeFieldStateParam(fs));
  }
  if (view.statusTab) params.set("st", view.statusTab.toLowerCase());
  if (view.notTouched) params.set("nt", "1");
  if (view.enrichedOnly) params.set("eo", "1");
  return params;
}

/**
 * Read the shareable view out of the URL. Returns `null` when the URL carries
 * NO view params (caller falls back to localStorage); otherwise a COMPLETE
 * view — absent/invalid pieces resolve to the defaults — so a shared link
 * reproduces the sender's view exactly instead of half-merging with the
 * receiver's saved blob (B16 · the URL wins WHOLESALE). Defensive: unknown
 * fields/ops/keys/NaNs are dropped. Signal filters come back with
 * sigLabel = sigKey (placeholder) — the workbench re-labels + validates
 * against its signal library. Pure.
 */
export function parseViewFromSearchParams(
  params: URLSearchParams,
): WorkbenchViewParams | null {
  const sort = params.get("sort");
  const dir = params.get("dir");
  const fParams = params.getAll("f");
  const sgParams = params.getAll("sg");
  const vfParams = params.getAll("vf");
  const fsParams = params.getAll("fs");
  const stParam = params.get("st");
  const ntParam = params.get("nt");
  const eoParam = params.get("eo");
  if (
    sort === null &&
    dir === null &&
    fParams.length === 0 &&
    sgParams.length === 0 &&
    vfParams.length === 0 &&
    fsParams.length === 0 &&
    stParam === null &&
    ntParam === null &&
    eoParam === null
  )
    return null;
  const sortKey = sort && VALID_COLS.has(sort) ? sort : DEFAULT_SORT_KEY;
  const sortDir: 1 | -1 =
    dir === "asc" ? 1 : dir === "desc" ? -1 : DEFAULT_SORT_DIR;
  const filters: LeadFilter[] = [];
  for (const raw of fParams) {
    const parsed = parseFilterParam(raw);
    if (parsed) filters.push(parsed);
  }
  for (const raw of sgParams) {
    const parsed = parseSignalParam(raw);
    if (parsed) filters.push(parsed);
  }
  for (const raw of vfParams) {
    const parsed = parseValueParam(raw);
    if (parsed) filters.push(parsed);
  }
  const fieldStates: FieldStateFilter[] = [];
  for (const raw of fsParams) {
    const parsed = parseFieldStateParam(raw);
    if (parsed) fieldStates.push(parsed);
  }
  const out: WorkbenchViewParams = { sortKey, sortDir, filters, fieldStates };
  const statusTab = parseStatusParam(stParam);
  if (statusTab) out.statusTab = statusTab;
  if (ntParam === "1") out.notTouched = true;
  if (eoParam === "1") out.enrichedOnly = true;
  // Presence of the RAW params, not the parsed count — a URL whose every f=
  // token is invalid still expressed "the sender chose these filters" (they
  // drop to none), while a URL with no f=/sg=/vf= at all expressed nothing
  // about filters and must not clobber the receiver's saved/seeded set.
  if (fParams.length > 0 || sgParams.length > 0 || vfParams.length > 0)
    out.hasFilterParams = true;
  return out;
}
