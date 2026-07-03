// wb-view-state · persist the leads workbench view preferences per research
// (WP4-13). Density / vs-cell / active columns / filters / sort / page size /
// group survive a reload, keyed by discoveryId (mapsly:wb:<id>) in
// localStorage. Search + selection stay ephemeral (they're about "right now",
// not a saved view).
//
// SHAREABLE VIEWS (WP4-13 · URL half): sort + filters ALSO serialize into the
// URL (`?sort=<col>&dir=asc|desc&f=<field>:<op>:<value>[:<value2>]`, `f`
// repeated per filter) so a pasted link reproduces the view. On mount the URL
// WINS over the localStorage blob for sort+filters — when the URL carries ANY
// view param, {@link parseViewFromSearchParams} returns a COMPLETE
// sort+filters view (absent params = the defaults) so a shared link never
// half-merges with the receiver's own saved blob. localStorage remains the
// fallback when the URL carries no view params.
//
// Reads are DEFENSIVE: localStorage is user-writable and can hold stale shapes
// from an older column set, so every field is validated against the current
// vocabulary and anything unrecognized is dropped (falls back to the default).
// A bad blob never throws — it just yields `null` and the caller keeps defaults.

import {
  COLUMNS,
  FILTER_FIELDS,
  PAGE_SIZES,
  type LeadFilter,
  type NumericLeadFilter,
  type NumericFilterField,
} from "./leads-workbench";

export interface WorkbenchViewState {
  vsCell: boolean;
  group: "none" | "cell" | "signals";
  activeCols: string[];
  filters: LeadFilter[];
  sortKey: string;
  sortDir: 1 | -1;
  pageSize: number;
}

const KEY_PREFIX = "mapsly:wb:";
const FILTER_OPS = new Set(["<", "≤", "=", "≥", ">", "between"]);
const VALID_COLS = new Set(COLUMNS.map((c) => c.key));
const VALID_FIELDS = new Set<string>(FILTER_FIELDS.map((f) => f.field));
const VALID_PAGE_SIZES = new Set<number>(PAGE_SIZES);

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

/** The URL-shareable subset of the view: sort + filters. */
export interface WorkbenchViewParams {
  sortKey: string;
  sortDir: 1 | -1;
  filters: LeadFilter[];
}

/** The workbench's default sort (Match % descending). */
export const DEFAULT_SORT_KEY = "match";
export const DEFAULT_SORT_DIR: 1 | -1 = -1;

// Filter ops use ASCII tokens in the URL (`≤`/`≥` are non-URL-friendly).
// Only NUMERIC filters serialize to the URL; goal-signal filters are in-session
// only for now (they'd need the goal signal set to re-hydrate a shared link).
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

/** One numeric filter → its `f` param value: `field:op:value[:value2]`. Pure. */
export function serializeFilterParam(f: NumericLeadFilter): string {
  const parts = [f.field, OP_TO_TOKEN[f.op], String(f.value)];
  if (f.op === "between") parts.push(String(f.value2 ?? f.value));
  return parts.join(":");
}

/** Parse one `f` param value back into a numeric filter. null when malformed. */
export function parseFilterParam(raw: string): NumericLeadFilter | null {
  const [field, opToken, valueRaw, value2Raw] = raw.split(":");
  if (!field || !VALID_FIELDS.has(field)) return null;
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
  return out;
}

/**
 * Write the view into `params` (mutates + returns it): `sort`/`dir` only when
 * non-default, one `f` per filter. Existing view params are cleared first, so
 * clearing the last filter also cleans the URL. Other params (`lead`, `page`)
 * are untouched. Pure w.r.t. everything but `params`.
 */
export function viewToSearchParams(
  view: WorkbenchViewParams,
  params: URLSearchParams,
): URLSearchParams {
  params.delete("sort");
  params.delete("dir");
  params.delete("f");
  if (view.sortKey !== DEFAULT_SORT_KEY || view.sortDir !== DEFAULT_SORT_DIR) {
    params.set("sort", view.sortKey);
    params.set("dir", view.sortDir === 1 ? "asc" : "desc");
  }
  for (const f of view.filters) {
    if (f.kind === "signal") continue; // signal filters are in-session only
    params.append("f", serializeFilterParam(f));
  }
  return params;
}

/**
 * Read the shareable view out of the URL. Returns `null` when the URL carries
 * NO view params (caller falls back to localStorage); otherwise a COMPLETE
 * view — absent/invalid pieces resolve to the defaults — so a shared link
 * reproduces the sender's view exactly instead of half-merging with the
 * receiver's saved blob. Defensive: unknown fields/ops/NaNs are dropped. Pure.
 */
export function parseViewFromSearchParams(
  params: URLSearchParams,
): WorkbenchViewParams | null {
  const sort = params.get("sort");
  const dir = params.get("dir");
  const fs = params.getAll("f");
  if (sort === null && dir === null && fs.length === 0) return null;
  const sortKey = sort && VALID_COLS.has(sort) ? sort : DEFAULT_SORT_KEY;
  const sortDir: 1 | -1 =
    dir === "asc" ? 1 : dir === "desc" ? -1 : DEFAULT_SORT_DIR;
  const filters: LeadFilter[] = [];
  for (const raw of fs) {
    const parsed = parseFilterParam(raw);
    if (parsed) filters.push(parsed);
  }
  return { sortKey, sortDir, filters };
}
