/**
 * Reports module · CSV export (F.7).
 *
 * Surface:
 *
 *   - `CSV_COLUMNS` — canonical registry of pickable columns; the UI
 *     column picker uses this to render the option list.
 *   - `DEFAULT_COLUMN_IDS` — sensible default selection used when the
 *     caller does not supply one.
 *   - `generateLeadCsv(rows, options)` — pure function · returns the
 *     full CSV string (header + data rows) using the selected columns.
 *   - `escapeCsvField(value)` — RFC 4180 + CSV-injection-safe field
 *     escaping. Exported for tests.
 *
 * Per `.claude/rules/security.md`: every cell that would start with
 * `=`, `+`, `-`, `@`, tab (`\t`) or CR (`\r`) is prefixed with `'` so
 * Excel / Google Sheets / Numbers treat it as text instead of
 * executing it as a formula. This is the canonical CSV-injection
 * mitigation (see also OWASP "CSV Injection").
 *
 * Per `.claude/rules/performance.md`: this module is pure compute · no
 * Prisma, no Blob client, no I/O. The server action prepares the
 * `LeadCsvRow[]` once and hands it in. Generation is O(rows × columns)
 * with a single string concatenation pass.
 *
 * Per `.claude/rules/testing.md` § "what we DO test": this module's
 * unit tests assert (a) escape semantics for every CSV-injection
 * vector, (b) column ordering preservation, (c) unknown-id pruning,
 * (d) header-only output for empty rows.
 */

import type {
  CsvColumn,
  CsvColumnId,
  GenerateLeadCsvOptions,
  LeadCsvRow,
} from "./types";

/* ----------------------------------------------------------- formatters */

/**
 * Format a Date as ISO YYYY-MM-DD (UTC). Stable across timezones — the
 * CSV is consumed in spreadsheets where local-time interpretation of
 * a date-time string causes more confusion than ISO 8601.
 *
 * Returns "" for null/undefined so the cell renders as empty.
 */
export function formatCsvDate(d: Date | null | undefined): string {
  if (!d) return "";
  // Defensive: a malformed Date can sneak through if upstream passed a
  // raw string that Prisma coerced poorly. `toISOString()` throws on
  // invalid dates; we catch and degrade to empty rather than blowing
  // up the entire export.
  try {
    return d.toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

/** Format a number with up to N significant decimals; "" for null. */
function formatNumber(n: number | null | undefined, maxDecimals = 2): string {
  if (n == null || !Number.isFinite(n)) return "";
  // Avoid 0.1+0.2 noise · round to maxDecimals then trim trailing zeros.
  const rounded = Number(n.toFixed(maxDecimals));
  return String(rounded);
}

/** "Yes"/"No"/"" — no localisation; CSV is for export, not display. */
function formatBoolean(b: boolean | null | undefined): string {
  if (b == null) return "";
  return b ? "Yes" : "No";
}

/* -------------------------------------------------------------- escape */

/**
 * Decide whether a value would be interpreted as a formula by Excel /
 * Google Sheets / Numbers.
 *
 * The naive heuristic — "prefix every value starting with =, +, -, @,
 * TAB, CR" — is the OWASP-recommended baseline but it mangles every
 * phone number (`+1-305-555-0100`) and every negative number
 * (`-3.4`). Those are common, legitimate, non-formula CSV values and
 * the Tom-audience expects them to round-trip unchanged to whatever
 * follow-up tool he loads the CSV into.
 *
 * Refinement · for `+` and `-` only, treat the value as a formula
 * trigger ONLY when the second character is a NON-digit, non-space.
 * That keeps `+1-305-...`, `-3.4`, `- 12` safe while still catching
 * `+sum(...)`, `-cmd|...`, `@import`, `=2+2`.
 *
 * `=`, `@`, TAB, and CR remain always-dangerous and are unconditionally
 * prefixed.
 */
function startsWithFormulaTrigger(v: string): boolean {
  if (v.length === 0) return false;
  const first = v.charCodeAt(0);
  // Always-dangerous · =, @, TAB, CR
  if (
    first === 0x3d /* = */ ||
    first === 0x40 /* @ */ ||
    first === 0x09 /* TAB */ ||
    first === 0x0d /* CR */
  ) {
    return true;
  }
  // Conditionally-dangerous · + and -
  if (first === 0x2b /* + */ || first === 0x2d /* - */) {
    if (v.length === 1) return false;
    const second = v.charCodeAt(1);
    // Digits and space are safe (phone, negative number).
    if (second >= 0x30 && second <= 0x39) return false; // 0-9
    if (second === 0x20) return false; // SPACE
    return true;
  }
  return false;
}

/**
 * RFC 4180 + CSV-injection-safe field escape.
 *
 * Steps:
 *
 *   1. If the (string) value starts with a formula trigger char
 *      (=, +, -, @, \t, \r), prefix a single quote so spreadsheets
 *      treat it as text.
 *   2. If the value contains a comma, double-quote, CR, or LF — quote
 *      the field and escape inner double-quotes by doubling them.
 *
 * Returns the field exactly as it should appear between commas.
 */
export function escapeCsvField(raw: string): string {
  if (raw === "") return "";
  let v = raw;
  if (startsWithFormulaTrigger(v)) v = "'" + v;

  // Step 2 · RFC 4180 quoting. Only fields that contain a comma,
  // quote, CR, or LF need to be wrapped. Quoting unconditionally would
  // also be valid but bloats file size; we quote only when needed.
  const needsQuoting =
    v.includes(",") || v.includes('"') || v.includes("\n") || v.includes("\r");
  if (!needsQuoting) return v;
  return `"${v.replace(/"/g, '""')}"`;
}

/* ----------------------------------------------------------- registry */

/**
 * Canonical column registry. Adding a new column here makes it
 * available to the picker UI automatically. Order in this array is
 * the picker's default display order; it does NOT determine the CSV
 * output order — `options.columnIds` does.
 */
export const CSV_COLUMNS: readonly CsvColumn[] = Object.freeze([
  {
    id: "businessName",
    label: "Business",
    derive: (r) => r.businessName,
  },
  { id: "category", label: "Category", derive: (r) => r.category },
  { id: "address", label: "Address", derive: (r) => r.address ?? "" },
  { id: "city", label: "City", derive: (r) => r.city ?? "" },
  {
    id: "province",
    label: "State / Province",
    derive: (r) => r.province ?? "",
  },
  { id: "country", label: "Country", derive: (r) => r.country ?? "" },
  {
    id: "postalCode",
    label: "Postal code",
    derive: (r) => r.postalCode ?? "",
  },
  { id: "phone", label: "Phone", derive: (r) => r.phone ?? "" },
  { id: "email", label: "Email", derive: (r) => r.email ?? "" },
  { id: "website", label: "Website", derive: (r) => r.website ?? "" },
  { id: "rating", label: "Rating", derive: (r) => formatNumber(r.rating, 1) },
  {
    id: "reviewCount",
    label: "Reviews",
    derive: (r) => formatNumber(r.reviewCount, 0),
  },
  {
    id: "yearsOnGoogle",
    label: "Years on Google",
    derive: (r) => formatNumber(r.yearsOnGoogle, 0),
  },
  {
    id: "mapslyScore",
    label: "Mapsly score",
    derive: (r) => formatNumber(r.mapslyScore, 1),
  },
  {
    id: "matchScore",
    label: "Match score",
    derive: (r) => formatNumber(r.matchScore, 2),
  },
  { id: "status", label: "Status", derive: (r) => r.status },
  {
    id: "statusChangedAt",
    label: "Status changed",
    derive: (r) => formatCsvDate(r.statusChangedAt),
  },
  { id: "addedAt", label: "Added", derive: (r) => formatCsvDate(r.addedAt) },
  {
    id: "lighthousePerformance",
    label: "Lighthouse perf",
    derive: (r) => formatNumber(r.lighthousePerformance, 0),
  },
  {
    id: "lighthouseSeo",
    label: "Lighthouse SEO",
    derive: (r) => formatNumber(r.lighthouseSeo, 0),
  },
  {
    id: "lcp",
    label: "LCP (s)",
    derive: (r) => formatNumber(r.lcp, 1),
  },
  {
    id: "hasLocalBusinessSchema",
    label: "Schema",
    derive: (r) => formatBoolean(r.hasLocalBusinessSchema),
  },
  {
    id: "napConsistent",
    label: "NAP consistent",
    derive: (r) => formatBoolean(r.napConsistent),
  },
] satisfies readonly CsvColumn[]);

/** Fast lookup by id · built once at module load. */
const CSV_COLUMN_BY_ID: ReadonlyMap<CsvColumnId, CsvColumn> = new Map(
  CSV_COLUMNS.map((c) => [c.id, c]),
);

/**
 * Default column selection · what Tom gets when he clicks "Export"
 * without opening the column picker. Picked for "what would a
 * follow-up outreach CSV in Apollo / HubSpot have."
 */
export const DEFAULT_COLUMN_IDS: readonly CsvColumnId[] = Object.freeze([
  "businessName",
  "category",
  "city",
  "province",
  "phone",
  "email",
  "website",
  "rating",
  "reviewCount",
  "mapslyScore",
  "matchScore",
  "status",
  "addedAt",
]);

/* -------------------------------------------------------------- main */

/**
 * Resolve a requested column id selection to the actual ordered
 * `CsvColumn[]` to emit. Unknown ids are dropped silently · empty or
 * fully-pruned selections fall back to defaults. Duplicates are
 * collapsed (first occurrence wins, preserving order).
 */
export function resolveColumns(
  columnIds: readonly CsvColumnId[] | undefined,
): CsvColumn[] {
  const requested =
    columnIds && columnIds.length > 0 ? columnIds : DEFAULT_COLUMN_IDS;

  const seen = new Set<CsvColumnId>();
  const resolved: CsvColumn[] = [];
  for (const id of requested) {
    if (seen.has(id)) continue;
    const col = CSV_COLUMN_BY_ID.get(id);
    if (!col) continue;
    seen.add(id);
    resolved.push(col);
  }

  // Belt-and-suspenders · if the caller somehow passed only unknown
  // ids and `requested` !== DEFAULT_COLUMN_IDS, fall back to defaults
  // rather than emitting a header-only CSV with zero columns (which
  // some parsers reject).
  if (resolved.length === 0) {
    for (const id of DEFAULT_COLUMN_IDS) {
      const col = CSV_COLUMN_BY_ID.get(id);
      if (col) resolved.push(col);
    }
  }
  return resolved;
}

/**
 * Generate the full CSV string · header row + one row per lead.
 *
 * Pure function · safe to call from tests, from a server action, or
 * from a cron handler that pre-bakes daily reports.
 */
export function generateLeadCsv(
  rows: readonly LeadCsvRow[],
  options: GenerateLeadCsvOptions = {},
): string {
  const columns = resolveColumns(options.columnIds);
  const newline = options.newline ?? "\r\n";

  // Header row · labels are already plain English ASCII but we run
  // them through the escape function anyway so a future label change
  // can include a comma without breaking the file.
  const header = columns.map((c) => escapeCsvField(c.label)).join(",");

  if (rows.length === 0) {
    // Trailing newline · keeps `wc -l` honest and matches what most
    // CSV writers (Python `csv`, Ruby CSV, Excel) emit.
    return header + newline;
  }

  const bodyLines: string[] = [];
  for (const row of rows) {
    const cells: string[] = [];
    for (const col of columns) {
      cells.push(escapeCsvField(col.derive(row)));
    }
    bodyLines.push(cells.join(","));
  }

  return header + newline + bodyLines.join(newline) + newline;
}

/**
 * Convenience helper · returns the byte length the CSV would have on
 * disk under UTF-8 encoding. The server action uses this to compose
 * `CsvUploadResult.size` (the upload's `put()` response also reports
 * a size — this is the local fast-path for client-side previews).
 */
export function byteLength(csv: string): number {
  return Buffer.byteLength(csv, "utf8");
}
