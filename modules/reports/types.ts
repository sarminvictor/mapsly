/**
 * Reports module · type definitions.
 *
 * Surface: CSV export with column picker (F.7). The agency-portal
 * list-detail page (F.3) exposes a "Export" action that hands a
 * `listId` + a chosen set of `CsvColumnId`s to the server action,
 * which materialises the leads, generates a CSV via this module, and
 * uploads it to Vercel Blob.
 *
 * Column-picker discipline:
 *
 *   - The canonical list of available columns lives in `csv-export.ts`
 *     as the `CSV_COLUMNS` registry. Each column carries an id, a
 *     human label (English baseline; UI may i18n-display its own copy
 *     keyed by id), and a `derive` callback that turns a `LeadCsvRow`
 *     into the cell string.
 *   - `DEFAULT_COLUMN_IDS` is the ordered fallback used when the
 *     caller does not supply a custom selection. Stable so tests are
 *     not flaky.
 *   - The UI column picker (follow-up · not in this iteration) reads
 *     `CSV_COLUMNS` for the picker options and persists the user's
 *     selection per-list in user settings.
 *
 * Per `.claude/rules/security.md` § XSS: cell values are escaped to
 * defend against CSV-injection (Excel/Sheets formula execution when
 * a cell starts with `=`, `+`, `-`, `@`, tab, or CR). `escapeCsvField`
 * in `csv-export.ts` prefixes those with `'` so a downstream
 * spreadsheet treats them as text.
 */

import type { LeadStatusValue } from "@/modules/agency-portal/lists/types";

/** Canonical column identifiers · stable, used as React keys + URL params. */
export type CsvColumnId =
  | "businessName"
  | "category"
  | "address"
  | "city"
  | "province"
  | "country"
  | "postalCode"
  | "phone"
  | "email"
  | "website"
  | "rating"
  | "reviewCount"
  | "yearsOnGoogle"
  | "mapslyScore"
  | "matchScore"
  | "status"
  | "statusChangedAt"
  | "addedAt"
  | "lighthousePerformance"
  | "lighthouseSeo"
  | "lcp"
  | "hasLocalBusinessSchema"
  | "napConsistent";

/**
 * Flat row materialised from `Lead` + joined `Business` + latest
 * `BusinessSnapshot` + latest `LighthouseAudit`. The CSV generator
 * never touches Prisma — callers prepare this shape once and pass it
 * in, so the generator is a pure function (easy to unit test).
 */
export interface LeadCsvRow {
  /** Lead row id · stable, never displayed in the CSV body. */
  leadId: string;
  businessName: string;
  category: string;
  address: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  rating: number | null;
  reviewCount: number | null;
  yearsOnGoogle: number | null;
  /** Mapsly Score 0..10 (latest BusinessSnapshot.mapslyScore). */
  mapslyScore: number | null;
  /** Per-lead match score 0..1 (Lead.matchScore). */
  matchScore: number | null;
  status: LeadStatusValue;
  statusChangedAt: Date | null;
  addedAt: Date;
  /** LighthouseAudit (latest) */
  lighthousePerformance: number | null;
  lighthouseSeo: number | null;
  /** LCP in seconds (LighthouseAudit.lcp is `Float` seconds). */
  lcp: number | null;
  hasLocalBusinessSchema: boolean | null;
  napConsistent: boolean | null;
}

/**
 * A single column descriptor in the registry.
 *
 *   - `id` is the stable identifier used in URLs / persisted prefs.
 *   - `label` is the English baseline header. Display copy is up to
 *     the caller; this label ships verbatim into the CSV header row.
 *   - `derive` produces the raw cell string (pre-escape). Returning
 *     an empty string for a null field is intentional — CSV consumers
 *     (Excel, Google Sheets, pandas) handle empty cells consistently.
 */
export interface CsvColumn {
  id: CsvColumnId;
  label: string;
  derive: (row: LeadCsvRow) => string;
}

/** Generation options · passed to `generateLeadCsv`. */
export interface GenerateLeadCsvOptions {
  /**
   * Ordered list of column ids to emit. Unknown ids are silently
   * dropped (forward-compatible with a column being removed between
   * preference save and render). When omitted or empty, falls back to
   * `DEFAULT_COLUMN_IDS`.
   */
  columnIds?: readonly CsvColumnId[];
  /**
   * Line ending. CSV consumers across platforms tolerate `\r\n`
   * universally, while `\n` alone occasionally breaks Excel for
   * Windows. Default `\r\n` per RFC 4180.
   */
  newline?: "\r\n" | "\n";
}

/** Output of `uploadCsvToBlob` · everything the UI needs to render the link. */
export interface CsvUploadResult {
  /**
   * Public Blob URL · signed if the access tier is `private`. Survives
   * for the lifetime of the blob; cron `test-cleanup` purges expired
   * report blobs separately.
   */
  url: string;
  /** Blob pathname · `agency/<agencyId>/list-<listId>/<timestamp>.csv`. */
  pathname: string;
  /** Bytes written · so the UI can render "Export · 47 KB". */
  size: number;
  /** ISO 8601 expiry timestamp · 30 days from upload per F.7 spec. */
  expiresAt: string;
}
