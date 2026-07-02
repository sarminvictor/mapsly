// modules/agency-portal/discover/leads-workbench.ts · the PURE read-model +
// column registry + filter model for the agency leads WORKBENCH (the heart of
// the agency portal). Kept React-free and DB-free so every mechanic — column
// activation, filter evaluation, vs-cell deltas, pain-chip grouping, match%
// derivation, pagination windowing — is unit-testable. The .tsx workbench is a
// thin shell over this.
//
// Mirrors the prototype's WB state + render* helpers (docs/portal-prototype.html
// renderWBHead/renderWBBody/evalFilter/fmtDelta/renderColsMenu) but typed and
// bound to REAL Lead+Business+snapshot+finding data.

// ── Row shape (plain serializable · resolved server-side) ────────────────────

/** The "vs cell" distribution band for a numeric column (null when cohort small). */
export interface CellBand {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

/** A pain-point chip derived from a flagged PlaybookFinding. */
export interface PainChip {
  /** The signal group → drives the .ppchip color modifier. */
  group: PainGroup;
  /** Short label shown in the chip. */
  label: string;
  /** Full explanation (chip title / hover). */
  title: string;
}

/** One workbench lead row — everything the table renders, pre-resolved. */
export interface WorkbenchLeadRow {
  leadId: string;
  businessId: string;
  /** Business name. */
  name: string;
  /** Address sub-line (address · cell). */
  addr: string;
  /** Cell label this lead belongs to ("Med spas · Miami"), for group-by-cell. */
  cell: string;
  /** Lead status (Prisma LeadStatus). */
  status: LeadStatus;
  /** 0–100 match %. Derived when Lead.matchScore is null (see deriveMatchPct). */
  match: number;
  /** Whether match was stored (true) or derived from finding count (false). */
  matchDerived: boolean;
  /**
   * True when `match` came from evaluating the research's persisted signals
   * (resolveMatches over the discovery's signalsJson) rather than the pain-count
   * heuristic. False for older discoveries / lists with no persisted signals.
   */
  matchFromSignals: boolean;
  /**
   * Per-signal verdict for the research's chosen signals, keyed by SIG_META key:
   * true = fired · false = didn't · null = not computable yet (data absent —
   * honest "enrich to unlock", never a fake match). Empty when no signals were
   * persisted (the match% then comes from the heuristic). Plain serializable
   * data — crosses the client boundary as-is (Pattern 4, no functions).
   */
  perSignal: Record<string, boolean | null>;
  /** Pain-point chips (flagged findings), most-confident first. */
  pains: PainChip[];
  /** Reachability tier (RICH / MULTI / PHONE_ONLY / …). */
  reachability: string;
  /** True when at least one contact channel exists. */
  reachable: boolean;
  /** CMS / site-builder ("Wix", "WordPress", …) or null. */
  builtOn: string | null;
  /** Business website URL (Business.website) — CSV export column (WP2-4). */
  website: string | null;
  /**
   * The strongest pitch angle (highest-confidence flagged finding's
   * pitchAngle) — the one-liner Tom pastes into his opener. Null when no
   * finding carries one. CSV export column (WP2-4). One short string per row
   * keeps the serialized payload bounded.
   */
  pitchAngle: string | null;
  /** Touch state for this lead's business ("None" | "Draft" | "Sent" | …). */
  touch: TouchState;
  /** Lead.contactedAt, ISO string (plain-serializable) — null until contacted. */
  lastContactedAt: string | null;
  // Raw numeric facts (null when the family isn't enriched on this lead).
  reviews: number | null;
  rating: number | null;
  perf: number | null;
  // Contact facts.
  phones: string[];
  emails: string[];
  /** Enrichment families present on this lead (for coverage + "— enrich" cells). */
  families: Record<DataFamily, boolean>;
}

export type LeadStatus =
  | "NEW"
  | "CONTACTED"
  | "REPLIED"
  | "WON"
  | "LOST"
  | "HIDDEN";

export type TouchState = "None" | "Draft" | "Queued" | "Sent" | "Replied";

export const STATUS_ORDER: readonly LeadStatus[] = [
  "NEW",
  "CONTACTED",
  "REPLIED",
  "WON",
  "LOST",
  "HIDDEN",
] as const;

// ── Pain-point group taxonomy (maps signal group → .ppchip color modifier) ───

export type PainGroup =
  | "weak-web"
  | "wasting"
  | "reputation"
  | "under"
  | "growing"
  | "more";

/**
 * Map a PlaybookFinding.group (free-form string) to a prototype .ppchip color
 * modifier. Unknown groups fall back to the neutral "more" chip so nothing
 * renders unstyled.
 */
export function painGroupClass(group: string): PainGroup {
  const g = group.toLowerCase();
  if (g.includes("web") || g.includes("site") || g.includes("speed"))
    return "weak-web";
  if (g.includes("ad") || g.includes("spend") || g.includes("wast"))
    return "wasting";
  if (g.includes("review") || g.includes("reput")) return "reputation";
  if (g.includes("search") || g.includes("seo") || g.includes("visib"))
    return "under";
  if (g.includes("grow") || g.includes("opportunit")) return "growing";
  return "more";
}

// ── Match % derivation ───────────────────────────────────────────────────────

/**
 * Resolve a 0–100 match % for a lead. When `Lead.matchScore` is stored (a 0–1
 * or 0–100 float from a future scoring engine) we surface it; otherwise we
 * DERIVE a display value from the count of flagged findings (each pain point is
 * one matched angle): 1 pain ≈ 60, 2 ≈ 75, 3 ≈ 85, 4+ ≈ 92, capped at 95 so a
 * derived value never reads as a "perfect" stored score. Pure + deterministic.
 */
export function deriveMatchPct(
  storedScore: number | null | undefined,
  painCount: number,
): { match: number; derived: boolean } {
  if (storedScore != null && Number.isFinite(storedScore)) {
    // Accept either a 0–1 fraction or an already-scaled 0–100 value.
    const scaled = storedScore <= 1 ? storedScore * 100 : storedScore;
    return {
      match: Math.max(0, Math.min(100, Math.round(scaled))),
      derived: false,
    };
  }
  const table = [40, 60, 75, 85, 92];
  const idx = Math.min(painCount, table.length - 1);
  const base = table[idx];
  return { match: Math.min(95, base), derived: true };
}

/** A signal-eval roll-up shape, mirrored here so this pure module stays free of
 *  a `signal-eval` import (it carries no DB). The page passes the real
 *  `MatchResult` from `resolveMatches`; only these fields are read. */
export interface SignalMatchResult {
  perSignal: Record<string, boolean | null>;
  matchedCount: number;
  applicableCount: number;
  matchPct: number;
}

/**
 * Resolve a lead's match for the workbench, preferring the REAL signal-eval
 * result over the pain-count heuristic (P3).
 *
 * When `evalResult` has at least one APPLICABLE (computable) signal, the match%
 * is the real `matchPct × 100` (honest: null/not-computable signals are already
 * excluded from that denominator inside resolveMatches). Otherwise — no
 * persisted signals, or every signal was not-computable for this lead — we fall
 * back to {@link deriveMatchPct} so the column never reads a misleading 0.
 *
 * Returns the display match, whether it came from signals, whether it's derived,
 * and the per-signal verdict map (empty when there were no signals). Pure.
 */
export function resolveLeadMatch(
  evalResult: SignalMatchResult | null,
  storedScore: number | null | undefined,
  painCount: number,
): {
  match: number;
  matchFromSignals: boolean;
  matchDerived: boolean;
  perSignal: Record<string, boolean | null>;
} {
  if (evalResult && evalResult.applicableCount > 0) {
    return {
      match: Math.max(0, Math.min(100, Math.round(evalResult.matchPct * 100))),
      matchFromSignals: true,
      matchDerived: false,
      perSignal: evalResult.perSignal,
    };
  }
  // No computable signals → heuristic (still surface any null verdicts so the
  // drawer/tooltip can show "enrich to unlock" honestly).
  const { match, derived } = deriveMatchPct(storedScore, painCount);
  return {
    match,
    matchFromSignals: false,
    matchDerived: derived,
    perSignal: evalResult?.perSignal ?? {},
  };
}

// ── vs-cell delta formatting ─────────────────────────────────────────────────

export type DeltaDir = "up" | "dn" | "flat";

export interface DeltaParts {
  /** The arrow + number text, e.g. "▲ +120" / "▼ −18" / "≈". */
  text: string;
  dir: DeltaDir;
}

/**
 * Format a numeric value's delta vs its cell median (p50). Mirrors the
 * prototype's fmtDelta(): above-median → green up, below → red down, within a
 * small tolerance → "≈ typical". `higherIsBetter=false` flips the color (e.g.
 * Lighthouse savings or violations: less is better). Pure.
 */
export function fmtDelta(
  value: number,
  p50: number,
  higherIsBetter = true,
): DeltaParts {
  const diff = value - p50;
  const tol = Math.max(1, Math.abs(p50) * 0.05);
  if (Math.abs(diff) <= tol) return { text: "≈", dir: "flat" };
  const above = diff > 0;
  const good = higherIsBetter ? above : !above;
  const arrow = above ? "▲" : "▼";
  const sign = above ? "+" : "−";
  const mag = Math.abs(Math.round(diff));
  return { text: `${arrow} ${sign}${mag}`, dir: good ? "up" : "dn" };
}

/** Tone bucket (g/a/r) for a percentile, matching .cellval / .gmatch / .vdot. */
export function toneForPercentile(percentile: number): "g" | "a" | "r" {
  const p = Math.max(0, Math.min(100, percentile));
  if (p >= 75) return "g";
  if (p >= 25) return "a";
  return "r";
}

// ── Column registry ──────────────────────────────────────────────────────────

export type DataFamily =
  | "identity"
  | "reviews"
  | "website"
  | "contacts"
  | "ads"
  | "search";

/** The 9-family coverage model surfaced on the coverage line. */
export const DATA_FAMILIES: readonly { key: DataFamily; label: string }[] = [
  { key: "identity", label: "Identity" },
  { key: "reviews", label: "Reviews" },
  { key: "website", label: "Website" },
  { key: "contacts", label: "Contacts" },
  { key: "ads", label: "Ads" },
  { key: "search", label: "Search" },
] as const;

export type ColumnKind =
  | "biz" // business name + addr
  | "match" // match % (sortable, mono)
  | "pains" // pain-point chips
  | "num" // numeric fact (sortable, mono, vs-cell delta capable)
  | "reach" // reachability pill
  | "text" // plain text (built-on)
  | "contact" // contact links
  | "status" // status pill
  | "touch" // touch pill
  | "cov" // per-row enrichment coverage dot-strip
  | "sig" // one goal-signal verdict (✓ fired / — didn't / needs enrichment)
  | "lastC"; // last-contacted timestamp

export interface ColumnDef {
  /** Stable key (also the WorkbenchLeadRow field for num/text columns). */
  key: string;
  /** Header label (short, full name in the th title). */
  label: string;
  /** Full label for the th title attr. */
  fullLabel?: string;
  kind: ColumnKind;
  /** Whether the column header is sortable. */
  sortable: boolean;
  /** On by default. */
  defaultOn: boolean;
  /** Which Fields-menu group it lives in. */
  group: "workflow" | "enriched";
  /** Backing data family (for "— enrich" greying + coverage). */
  family?: DataFamily;
  /** For num columns: does a higher value read as better (vs-cell color)? */
  higherIsBetter?: boolean;
  /** For num columns: the value unit shown after the number. */
  unit?: string;
  /** For "sig" columns only: the SIG_META key to read from row.perSignal. */
  sigKey?: string;
}

/**
 * The canonical workbench column registry. Order here is render order. `biz`,
 * `match`, `pains`, `built on`, `reach`, `status`, `touch` are on by default;
 * the raw numeric facts (reviews / rating / perf) are off-by-default toggles in
 * the Fields menu.
 */
export const COLUMNS: readonly ColumnDef[] = [
  {
    key: "biz",
    label: "Business",
    kind: "biz",
    sortable: false,
    defaultOn: true,
    group: "workflow",
    family: "identity",
  },
  {
    key: "match",
    label: "Match %",
    kind: "match",
    sortable: true,
    defaultOn: true,
    group: "workflow",
  },
  {
    key: "pains",
    label: "Pain points",
    fullLabel: "Pain points (pitch angles)",
    kind: "pains",
    sortable: false,
    defaultOn: true,
    group: "workflow",
  },
  {
    key: "builtOn",
    label: "Built on",
    kind: "text",
    sortable: false,
    defaultOn: true,
    group: "enriched",
    family: "website",
  },
  {
    key: "reachable",
    label: "Reachable",
    kind: "reach",
    sortable: false,
    defaultOn: true,
    group: "workflow",
    family: "contacts",
  },
  {
    key: "reviews",
    label: "Reviews",
    kind: "num",
    sortable: true,
    defaultOn: false,
    group: "enriched",
    family: "reviews",
    higherIsBetter: true,
  },
  {
    key: "rating",
    label: "Rating",
    kind: "num",
    sortable: true,
    defaultOn: false,
    group: "enriched",
    family: "reviews",
    higherIsBetter: true,
    unit: "★",
  },
  {
    key: "perf",
    label: "Lighthouse",
    fullLabel: "Lighthouse performance",
    kind: "num",
    sortable: true,
    defaultOn: false,
    group: "enriched",
    family: "website",
    higherIsBetter: true,
  },
  {
    key: "phones",
    label: "Phone",
    kind: "contact",
    sortable: false,
    defaultOn: false,
    group: "enriched",
    family: "contacts",
  },
  {
    key: "emails",
    label: "Email",
    kind: "contact",
    sortable: false,
    defaultOn: false,
    group: "enriched",
    family: "contacts",
  },
  {
    key: "cov",
    label: "Enriched",
    fullLabel: "Enrichment coverage (data families have / not yet)",
    kind: "cov",
    sortable: false,
    // Off by default per the prototype's B7 decision — this info lives in the
    // coverage line (Have/Not yet) above the table instead of repeating a dot
    // strip on every row. Still selectable via the Fields menu.
    defaultOn: false,
    group: "workflow",
  },
  {
    key: "status",
    label: "Status",
    kind: "status",
    sortable: false,
    defaultOn: true,
    group: "workflow",
  },
  {
    key: "touch",
    label: "Touch",
    kind: "touch",
    sortable: false,
    defaultOn: true,
    group: "workflow",
  },
  {
    key: "lastContactedAt",
    label: "Last contacted",
    kind: "lastC",
    sortable: true,
    defaultOn: true,
    group: "workflow",
  },
] as const;

/**
 * Build one column per active goal signal (docs/portal-prototype.html's
 * `goalCols()`/`makeSigCol` — the signals chosen on the Goal step show up as
 * columns, right after Match %, so what you searched for is visibly answered
 * per lead). Always shown — not part of the Fields-menu toggle set, since
 * they're driven by the goal itself rather than a display preference.
 */
export function buildSignalColumns(
  signals: readonly { key: string; title: string }[],
): ColumnDef[] {
  return signals.map((s) => ({
    key: `goal:${s.key}`,
    label: s.title,
    fullLabel: s.title,
    kind: "sig",
    sortable: false,
    defaultOn: true,
    group: "workflow",
    sigKey: s.key,
  }));
}

export const DEFAULT_ACTIVE_COLUMNS: string[] = COLUMNS.filter(
  (c) => c.defaultOn,
).map((c) => c.key);

// ── Filter model ─────────────────────────────────────────────────────────────

export type FilterOp = "<" | "≤" | "=" | "≥" | ">" | "between";

export interface LeadFilter {
  /** A numeric WorkbenchLeadRow field key (reviews / rating / perf / match). */
  field: NumericFilterField;
  op: FilterOp;
  value: number;
  /** Upper bound for the "between" op. */
  value2?: number;
}

export type NumericFilterField = "match" | "reviews" | "rating" | "perf";

/** Filterable numeric fields + their human label/unit, for the add-filter UI. */
export const FILTER_FIELDS: readonly {
  field: NumericFilterField;
  label: string;
  unit?: string;
}[] = [
  { field: "match", label: "Match %", unit: "%" },
  { field: "reviews", label: "Reviews" },
  { field: "rating", label: "Rating", unit: "★" },
  { field: "perf", label: "Lighthouse" },
] as const;

/** Seed filters mirroring the prototype's default workbench filters. */
export const SEED_FILTERS: LeadFilter[] = [
  { field: "perf", op: "<", value: 50 },
  { field: "reviews", op: "≥", value: 20 },
];

/**
 * The sensible starting op/value for a NEWLY ADDED filter on each field —
 * mirrors the prototype's `SIG_FILTER_DEFAULT` (each field opens with a
 * reasonable threshold, not a blind one-size-fits-all default). Used by the
 * add-filter picker: the user chooses the FIELD, this supplies the starting
 * op/value, then they can fine-tune it via the chip's inline controls.
 */
export const FILTER_FIELD_DEFAULTS: Record<
  NumericFilterField,
  { op: FilterOp; value: number }
> = {
  match: { op: "≥", value: 50 },
  reviews: { op: "≥", value: 20 },
  rating: { op: "≥", value: 4 },
  perf: { op: "<", value: 50 },
};

function fieldValue(
  row: WorkbenchLeadRow,
  field: NumericFilterField,
): number | null {
  switch (field) {
    case "match":
      return row.match;
    case "reviews":
      return row.reviews;
    case "rating":
      return row.rating;
    case "perf":
      return row.perf;
  }
}

/** Evaluate one filter against a row. A null backing value never matches. Pure. */
export function evalFilter(row: WorkbenchLeadRow, f: LeadFilter): boolean {
  const v = fieldValue(row, f.field);
  if (v == null || !Number.isFinite(v)) return false;
  switch (f.op) {
    case "<":
      return v < f.value;
    case "≤":
      return v <= f.value;
    case "=":
      return v === f.value;
    case "≥":
      return v >= f.value;
    case ">":
      return v > f.value;
    case "between":
      return v >= f.value && v <= (f.value2 ?? f.value);
  }
}

/** A row passes when it satisfies EVERY active filter (AND semantics). Pure. */
export function passesFilters(
  row: WorkbenchLeadRow,
  filters: readonly LeadFilter[],
): boolean {
  return filters.every((f) => evalFilter(row, f));
}

/** A human label for a filter chip, e.g. "Lighthouse < 50". Pure. */
export function filterLabel(f: LeadFilter): string {
  const meta = FILTER_FIELDS.find((m) => m.field === f.field);
  const name = meta?.label ?? f.field;
  if (f.op === "between") return `${name} ${f.value}–${f.value2 ?? f.value}`;
  return `${name} ${f.op} ${f.value}`;
}

// ── Search ───────────────────────────────────────────────────────────────────

/** Free-text match over name / addr / builtOn (case-insensitive). Pure. */
export function matchesSearch(row: WorkbenchLeadRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    row.name.toLowerCase().includes(needle) ||
    row.addr.toLowerCase().includes(needle) ||
    (row.builtOn ?? "").toLowerCase().includes(needle)
  );
}

// ── Sorting ──────────────────────────────────────────────────────────────────

export function sortRows(
  rows: WorkbenchLeadRow[],
  key: string,
  dir: 1 | -1,
): WorkbenchLeadRow[] {
  const num = (r: WorkbenchLeadRow): number => {
    switch (key) {
      case "match":
        return r.match;
      case "reviews":
        return r.reviews ?? -Infinity;
      case "rating":
        return r.rating ?? -Infinity;
      case "perf":
        return r.perf ?? -Infinity;
      case "lastC":
        return r.lastContactedAt
          ? new Date(r.lastContactedAt).getTime()
          : -Infinity;
      default:
        return 0;
    }
  };
  return [...rows].sort((a, b) => (num(a) - num(b)) * dir);
}

// ── CSV export mapping (WP2-4 / WP4-4 · ONE mapping for client + server) ─────
// The client "Export CSV" button (LeadsWorkbench.exportCsv) and the server
// full-set export route (app/api/agency/research/[discoveryId]/export) both
// render rows through THIS mapping, so the two stay column-for-column in sync.

/** The 13 export columns, in order. */
export const CSV_HEADERS = [
  "Business",
  "Address",
  "Match%",
  "Status",
  "Reachable",
  "Emails",
  "Phones",
  "Website",
  "Rating",
  "Reviews",
  "Perf score",
  "Top signals",
  "Pitch angle",
] as const;

/**
 * The row fields the CSV mapping reads. A full {@link WorkbenchLeadRow}
 * satisfies this structurally; the server export route builds just this subset
 * (it never needs coverage/touch/builtOn, so it skips those side-loads).
 */
export type CsvExportRow = Pick<
  WorkbenchLeadRow,
  | "name"
  | "addr"
  | "match"
  | "status"
  | "reachable"
  | "emails"
  | "phones"
  | "website"
  | "rating"
  | "reviews"
  | "perf"
  | "perSignal"
  | "pains"
  | "pitchAngle"
>;

/**
 * Quote-wrap a CSV cell with `""`-doubled quotes, so commas, quotes AND
 * newlines inside values stay intact. null/undefined → empty cell. Pure.
 */
export function csvEscape(v: string | number | null | undefined): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

/**
 * Top-3 fired signals: the goal signals whose verdict is true (the exact
 * columns the workbench shows), falling back to the flagged-finding pain
 * labels when the research persisted no signals. Semicolon-joined. Pure.
 */
export function topCsvSignals(
  r: CsvExportRow,
  goalSignals: readonly { key: string; title: string }[],
): string {
  const fired = goalSignals
    .filter((s) => r.perSignal[s.key] === true)
    .map((s) => s.title);
  const src = fired.length > 0 ? fired : r.pains.map((p) => p.label);
  return src.slice(0, 3).join("; ");
}

/**
 * One row → the 13 raw cell values, in {@link CSV_HEADERS} order. Multi-value
 * columns (emails/phones) are semicolon-joined — the near-universal "multiple
 * values in one CSV cell" convention outreach tools import cleanly. Pure.
 */
export function rowToCsvRecord(
  r: CsvExportRow,
  goalSignals: readonly { key: string; title: string }[],
): (string | number | null)[] {
  return [
    r.name,
    r.addr,
    r.match,
    r.status,
    r.reachable ? "Yes" : "No",
    r.emails.join("; "),
    r.phones.join("; "),
    r.website,
    r.rating,
    r.reviews,
    r.perf,
    topCsvSignals(r, goalSignals),
    r.pitchAngle,
  ];
}

/** Escape + join one record into a CSV line. Pure. */
export function csvLine(record: readonly (string | number | null)[]): string {
  return record.map(csvEscape).join(",");
}

// ── Pagination windowing (Boxly pattern · ellipsis) ──────────────────────────

/**
 * Server fetch-window size (WP4-4). Both workbench pages fetch ONE window of
 * this many rows per request, at the offset the awaited `?page=` searchParam
 * selects (Pattern 3 — awaited inside the Suspense boundary). 1000 keeps the
 * page-1 experience byte-identical to the old MAX_BUSINESSES cap (client-side
 * sort/filter/vs-cell over the same first 1000 rows) while making EVERY row
 * beyond it reachable via `?page=2+` — the client pager crosses window
 * boundaries with router.replace so the server re-renders the next window.
 */
export const WORKBENCH_WINDOW = 1000;

export const PAGE_SIZES = [10, 20, 50, 100] as const;

/**
 * Numbered-page window with ellipses: always show first + last + a window
 * around the current page. Returns numbers and "ellipsis" sentinels. Pure.
 */
export function getPageNumbers(
  current: number,
  total: number,
): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "ellipsis")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) out.push("ellipsis");
  for (let p = start; p <= end; p += 1) out.push(p);
  if (end < total - 1) out.push("ellipsis");
  out.push(total);
  return out;
}
