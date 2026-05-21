/**
 * Reports module · public surface.
 *
 * Import from here, not from internal files. The agency-portal
 * list-detail page (F.3), the column-picker UI (follow-up), the
 * export server action (follow-up), and the one-pager PDF route
 * (F.6) all import from this barrel.
 */

export type {
  CsvColumn,
  CsvColumnId,
  CsvUploadResult,
  GenerateLeadCsvOptions,
  LeadCsvRow,
} from "./types";

export {
  CSV_COLUMNS,
  DEFAULT_COLUMN_IDS,
  byteLength,
  escapeCsvField,
  formatCsvDate,
  generateLeadCsv,
  resolveColumns,
} from "./csv-export";

export { uploadCsvToBlob } from "./blob-upload";
export type { UploadCsvOptions } from "./blob-upload";

/* ------------------------------------------------- F.6 one-pager */

export type {
  DeriveFixesInputs,
  DerivePitchWedgesInputs,
  GetOnePagerDataOptions,
  OnePagerData,
  OnePagerFix,
  OnePagerPitchWedge,
} from "./one-pager-data";
export {
  EMPTY_ONE_PAGER_DATA,
  applyOnePagerCacheTags,
  deriveFixes,
  derivePitchWedges,
  formatCityLine,
  formatMapslyScore,
  formatMsiLine,
  formatPerformanceLine,
  formatRatingLine,
  formatReplyRateLine,
  getOnePagerData,
  toFilenameSlug,
} from "./one-pager-data";

export type { OnePagerDocumentProps } from "./one-pager";
export { OnePagerDocument } from "./one-pager";
