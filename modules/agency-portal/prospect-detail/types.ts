/**
 * Agency prospect-detail page · payload type definitions.
 *
 * Surface: `/(agency)/prospect/[businessId]`. Tom drills into one
 * qualified prospect to see the full pitch — the "closing weapon".
 * This is the page Tom screen-shares on a sales call or sends to a
 * salesperson.
 *
 * `AgencyProspectDetailData` is the flat shape the page renders from.
 * The query layer materialises the row from `Business` + (the latest)
 * `BusinessSnapshot` / `LighthouseAudit`, plus computed pitch wedges
 * + signal blocks derived deterministically from those facts.
 *
 * Per `.claude/rules/cache-components.md` Pattern 1 the `EMPTY_*` shape
 * is the canonical short-circuit for:
 *
 *   - Vercel's build phase (NEXT_PHASE === 'phase-production-build')
 *   - business id not found
 *   - signed-in user has no `AgencyMember` row matching any list this
 *     business appears in (cross-agency leak guard)
 *   - Prisma threw an error
 *
 * Callers check `data.prospect === null` and call `notFound()` so the
 * `/prospect/[businessId]/not-found.tsx` shell renders.
 */

/** Severity tone used by pitch wedges + signal-block rows. */
export type ProspectSeverity = "critical" | "warn" | "ok";

/**
 * One "pitch wedge" — exactly 4 are emitted on every page. These are
 * Tom's closing weapon: a numbered, evidence-footed bullet that
 * justifies why this prospect qualifies.
 *
 * The query layer derives them deterministically from the latest
 * snapshot + lighthouse audit so two reads return the same wedges.
 */
export interface ProspectPitchWedge {
  /** One-line headline · "Reply rate 0% · 23 unanswered". */
  headline: string;
  /** Evidence footer · concrete data point or comparison. */
  evidence: string;
  /** Drives color: critical = red, warn = amber, ok = teal/success. */
  severity: ProspectSeverity;
}

/** Categories of signal blocks rendered on the detail page. */
export type ProspectSignalBlockKey =
  | "reviews"
  | "competitors"
  | "search"
  | "ads"
  | "website";

/**
 * One collapsible signal block — typically 3..6 dense bullets. The
 * page renders these inside `<details>` for native progressive
 * disclosure (server-component-safe).
 */
export interface ProspectSignalBlock {
  key: ProspectSignalBlockKey;
  /** Translated title set by the page from i18n. */
  title: string;
  /** One-line "what's the verdict" shown next to the title. */
  summaryLine: string;
  /** Dense facts · 3..6 entries typical · plain strings. */
  bullets: string[];
  severity: ProspectSeverity;
}

/** Sidebar "appears in" link · the lists this business is a lead on. */
export interface ProspectAppearsInList {
  id: string;
  name: string;
  serviceType: string | null;
}

/** Sidebar "data sources" row · provenance + freshness. */
export interface ProspectDataSource {
  label: string;
  /** ISO date string · the page formats for locale. */
  refreshedAt: string;
}

/** The latest BusinessSnapshot subset surfaced on the detail page. */
export interface ProspectSnapshotSummary {
  /** 0..10 Mapsly Score composite. */
  mapslyScore: number | null;
  msiRank: number | null;
  msiTotal: number | null;
  /** Proxy for reply rate — 0..1. */
  communicationScore: number | null;
  /** 0..1 profile completeness. */
  profileCompleteness: number | null;
}

/** The latest LighthouseAudit subset surfaced on the detail page. */
export interface ProspectLighthouseSummary {
  /** 0..100 mobile Performance score. */
  performance: number | null;
  seo: number | null;
  /** LCP in milliseconds (we convert from `LighthouseAudit.lcp` seconds). */
  lcpMs: number | null;
  clsScore: number | null;
}

/**
 * The full prospect record rendered by the page. `null` means
 * "not found / cross-agency / build / error".
 */
export interface ProspectRecord {
  id: string;
  name: string;
  /** 1-2 letter avatar derived from the business name. */
  avatarInitials: string;
  /** 1..7 stable hash-derived tone. */
  avatarTone: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  /** Single-line formatted address (or empty). */
  address: string;
  city: string | null;
  province: string | null;
  category: string | null;
  /** Google rating 0..5. */
  rating: number | null;
  reviewCount: number;
  websiteUrl: string | null;
  phone: string | null;
  /** ISO timestamp of the latest snapshot used for the page. */
  refreshedAt: string;
  snapshot: ProspectSnapshotSummary | null;
  lighthouse: ProspectLighthouseSummary | null;
  /** Exactly 4 entries · ordered critical → warn → ok. */
  pitchWedges: ProspectPitchWedge[];
  /** One signal block per relevant category. */
  signalBlocks: ProspectSignalBlock[];
  appearsInLists: ProspectAppearsInList[];
  dataSources: ProspectDataSource[];
}

/**
 * The shape every read on `/(agency)/prospect/[businessId]` produces.
 *
 * `prospect === null` means "not found / not-yours / build phase /
 * error" — the page calls `notFound()`.
 */
export interface AgencyProspectDetailData {
  prospect: ProspectRecord | null;
  /** For `← prev` button · null when no prev lead exists. */
  prevProspectId: string | null;
  /** For `next →` button · null when no next lead exists. */
  nextProspectId: string | null;
}

/**
 * Canonical empty / short-circuit shape · returned for the build
 * phase, not-found, not-yours, and Prisma-error cases. Every field of
 * `AgencyProspectDetailData` is present so TypeScript catches partial
 * shapes at literal-comparison time (`.claude/rules/cache-components.md`
 * Pattern 1, INC-25).
 */
export const EMPTY_PROSPECT_DETAIL: AgencyProspectDetailData = {
  prospect: null,
  prevProspectId: null,
  nextProspectId: null,
};
