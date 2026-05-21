/**
 * Agency list-detail page · payload type definitions.
 *
 * Surface: `/(agency)/lists/[id]`. Tom drills into one list to triage
 * its qualified leads — see the pitch, the filters defining the list,
 * a 5-stat hero, status-tab counts, and a leads table per active
 * status filter.
 *
 * `AgencyListDetailData` is the flat shape the page renders from. The
 * shape is designed so the page renders the table for the **currently
 * selected status** (chosen via URL search param `?status=`) without
 * re-fetching — `statusCounts` covers the tab counts for all statuses,
 * and `leads` is already filtered down to the active status.
 *
 * Per `.claude/rules/cache-components.md` Pattern 1 the `EMPTY_*` shape
 * is the canonical short-circuit for:
 *
 *   - Vercel's build phase (NEXT_PHASE === 'phase-production-build')
 *   - list id not found
 *   - user has no `AgencyMember` row for this list's agency
 *   - Prisma threw an error
 *
 * Callers check `data.list === null` and call `notFound()` so the
 * `/lists/[id]/not-found.tsx` shell renders.
 */

import type {
  LeadStatusValue,
  ListCadenceValue,
  ListServiceTypeValue,
} from "../lists/types";

/** Re-exports so this module is the canonical import for list-detail UI. */
export type { LeadStatusValue, ListCadenceValue, ListServiceTypeValue };

/**
 * A single signal chip displayed in the leads-table "Why qualified"
 * cell. The query layer derives these from the per-business latest
 * snapshot — see `queries.ts` `summarizeLeadSignals`.
 */
export interface LeadDetailSignal {
  /** Visible label · "Perf 58", "LCP 3.4s", "no schema". */
  label: string;
  /** Tone drives color: `alert` red, `warn` amber, `teal` info, `neutral` gray. */
  tone: "neutral" | "warn" | "alert" | "teal";
  /** Optional hover help · plain-English explanation. */
  title?: string;
}

/**
 * A single row rendered in the leads table.
 *
 * The query layer materialises the row from `Lead` + `Business` + (the
 * latest) `BusinessSnapshot` / `LighthouseAudit`. We keep this flat
 * (no nested relations exposed to the UI) so the table component can
 * stay a server component without re-walking Prisma typings.
 */
export interface LeadDetailRow {
  id: string;
  businessId: string;
  businessName: string;
  /** Stable 1-2 letter avatar derived from the business name. */
  avatar: string;
  /** Avatar tone in 1..7 — derived from a stable hash of `businessId`. */
  avatarTone: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** Mono meta line · "5 yrs · 4.4★ · 342 reviews · added 3d ago". */
  meta: string;
  /** Up to 4 signal chips · the agency-portal "why qualified" weapon. */
  signals: LeadDetailSignal[];
  /** Current lead status. */
  status: LeadStatusValue;
  /**
   * Optional dwell suffix shown after the status pill ("3d",
   * "interested") · derived from how long the status has been current.
   */
  statusDwell: string | null;
  /** Optional contact line · email + phone, mono. */
  contactEmail: string | null;
  contactPhone: string | null;
  /** When this lead was added to the list (Lead.createdAt). */
  addedAt: Date;
  /** Optional match score 0..1 · used for the default sort. */
  matchScore: number | null;
}

/**
 * Status tab counts · one count per LeadStatus enum value. The page
 * uses this to render the 6-tab toolbar (New default · Contacted ·
 * Replied · Won · Lost · Hidden) with per-tab counts.
 */
export type LeadStatusCounts = Record<LeadStatusValue, number>;

/**
 * One readable filter chip rendered inside the "filters used" card.
 * The query layer turns `List.filterJson` (a free-form serialized
 * filter expression) into an array of these via `filter-tags.ts`.
 */
export interface AgencyListDetailFilterTag {
  /** Stable id · used as React key. */
  id: string;
  /** Visible label · "Lighthouse Perf < 60", "category : medical_spa". */
  label: string;
  /** When true, paint with the alert tone (e.g. "exclude existing clients"). */
  exclude?: boolean;
}

/**
 * The shape every read on `/(agency)/lists/[id]` produces.
 *
 * `list === null` means "not found / not-yours / build phase / error"
 * — the page calls `notFound()`.
 */
export interface AgencyListDetailData {
  list: {
    id: string;
    name: string;
    pitch: string | null;
    serviceType: ListServiceTypeValue;
    refreshCadence: ListCadenceValue;
    isActive: boolean;
    /** Target market shorthand. */
    category: string | null;
    metro: string | null;
    radiusMi: number | null;
    /** Owner display info (the member who created the list). */
    ownerName: string;
    createdAt: Date;
    lastRefreshedAt: Date | null;
    /** Bookkeeping · agency name shown in the breadcrumb. */
    agencyId: string;
    agencyName: string;
  } | null;
  /** Per-status counts across the list's entire lead set. */
  statusCounts: LeadStatusCounts;
  /** Total leads (sum of statusCounts). */
  totalLeads: number;
  /** Leads created in the last 7 days, all statuses. */
  newThisWeekCount: number;
  /** Prior-week count for the "+12 vs +6 prior" trend hint. */
  newPriorWeekCount: number;
  /** Filter chips parsed from `List.filterJson`. */
  filterTags: AgencyListDetailFilterTag[];
  /** Currently visible status tab · drives the leads table render. */
  activeStatus: LeadStatusValue;
  /** Leads filtered down to `activeStatus`, sorted by matchScore desc. */
  leads: LeadDetailRow[];
}

/**
 * Canonical empty / short-circuit shape · returned for the build
 * phase, not-found, not-yours, and Prisma-error cases. Every field of
 * `AgencyListDetailData` is present so TypeScript catches partial
 * shapes at literal-comparison time (`.claude/rules/cache-components.md`
 * Pattern 1).
 */
export const EMPTY_LIST_DETAIL: AgencyListDetailData = {
  list: null,
  statusCounts: {
    NEW: 0,
    CONTACTED: 0,
    REPLIED: 0,
    WON: 0,
    LOST: 0,
    HIDDEN: 0,
  },
  totalLeads: 0,
  newThisWeekCount: 0,
  newPriorWeekCount: 0,
  filterTags: [],
  activeStatus: "NEW",
  leads: [],
};

/** The complete ordered list of statuses used by the tab strip. */
export const LEAD_STATUS_TAB_ORDER: ReadonlyArray<LeadStatusValue> = [
  "NEW",
  "CONTACTED",
  "REPLIED",
  "WON",
  "LOST",
  "HIDDEN",
];
