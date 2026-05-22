/**
 * Agency reports hub · payload type definitions.
 *
 * Surface: `/(agency)/reports`. Tom drops in to see every report he's
 * ever generated for his agency: one-pagers (PDF), CSV list exports,
 * and shareable HTML links. The hub is read-only — generation entry
 * points live on the prospect detail (one-pager + share-link) and
 * list detail (CSV export).
 *
 * Source-of-truth row: `Report` (per the existing schema · type
 * discriminator is `PDF_ONE_PAGER` / `CSV_LIST` / `SHARE_LINK`).
 *
 * Per `.claude/rules/cache-components.md` Pattern 1 + INC-25 — the
 * EMPTY shape is the FULL shape so TypeScript catches partial shapes
 * at literal-comparison time on Vercel build.
 */

export type ReportTypeValue = "PDF_ONE_PAGER" | "CSV_LIST" | "SHARE_LINK";

export type ReportStatusValue = "READY" | "PENDING" | "FAILED";

/**
 * One row in the reports hub table. The hub renders the union of all
 * three report kinds; the `type` discriminator drives the action
 * affordance (open PDF · copy share link · download CSV).
 */
export interface ReportRow {
  id: string;
  type: ReportTypeValue;
  status: ReportStatusValue;
  /** ISO timestamp · drives "created · 2h ago" formatting. */
  createdAt: string;
  /** ISO timestamp; null when not applicable (one-pagers don't expire). */
  expiresAt: string | null;
  /** Number of times the report has been viewed. */
  viewCount: number;
  /** Public share id when type === SHARE_LINK; null otherwise. */
  publicShareId: string | null;
  /** Direct download URL (PDF / CSV) when stored to Vercel Blob; null otherwise. */
  storageUrl: string | null;
  /** Optional business association · drives "for {businessName}" line. */
  businessId: string | null;
  businessName: string | null;
  /** Optional list association · drives "for {listName}" line. */
  listId: string | null;
  listName: string | null;
}

export interface AgencyReportsData {
  /** Agency the signed-in user belongs to · `""` for build/empty/no-membership. */
  agencyId: string;
  agencyName: string;
  /** All reports for this agency · sorted by `createdAt DESC` · capped at 100. */
  reports: ReportRow[];
  /**
   * Counts per type · drives the per-kind tile row at the top of the
   * page. Sum may exceed `reports.length` when the cap truncates.
   */
  counts: {
    onePager: number;
    csv: number;
    shareLink: number;
    /** Total before the cap was applied. */
    total: number;
  };
}

/**
 * Canonical empty / short-circuit shape per cache-components Pattern 1.
 * Returned for the build phase, no-membership, and Prisma-error cases.
 * Callers identify the no-membership case via `data.agencyId === ""`.
 */
export const EMPTY_AGENCY_REPORTS: AgencyReportsData = {
  agencyId: "",
  agencyName: "",
  reports: [],
  counts: { onePager: 0, csv: 0, shareLink: 0, total: 0 },
};
