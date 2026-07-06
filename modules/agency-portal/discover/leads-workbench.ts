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

// enrichTypesForFamilies maps a column's DataFamily → its research tokens. The
// reverse type-import (family-coverage imports DataFamily from here) is type-only
// and erased, so there is no runtime cycle; the value is read at call time.
import { enrichTypesForFamilies } from "./family-coverage";

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
  /** AUDIT C3 · the exact on-site booking tool (Square/Vagaro/Fresha/…) from
   *  BusinessTech.name — stored, never surfaced as its own column. */
  bookingTool: string | null;
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
  /** AUDIT F2 · Lighthouse SEO score (0–100) — was stored, never columnised. */
  seo: number | null;
  /** Active Meta (FB/IG) ad-creative count — stored, columnised separately from
   *  Google (distinct source + attribution; never merged). */
  metaAdCount: number | null;
  /** Active Google ad-creative count (per-business target-host attribution). */
  googleAdCount: number | null;
  /** AUDIT F2 · best local-pack rank (lower = better; null = off the pack). */
  serpRank: number | null;
  /** AUDIT F2 · the AI-research one-line positioning summary (BusinessEnrichment.
   *  positioningSummary) — the researched read the drawer surfaces, now a
   *  toggle-able column. Null when AI research hasn't run for this lead. */
  aiSummary: string | null;
  // Contact facts.
  phones: string[];
  emails: string[];
  /** Social handles (Instagram/Facebook/TikTok/…) from Contact rows — AUDIT E6:
   *  the data was always stored, just never surfaced as a column. */
  socials: SocialContact[];
  /** Enrichment families present on this lead (for coverage + "— enrich" cells). */
  families: Record<DataFamily, boolean>;
}

/** One social contact channel + its handle/URL (audit E6). */
export interface SocialContact {
  /** Contact.channel — INSTAGRAM · FACEBOOK · TIKTOK · YOUTUBE · X · LINKEDIN. */
  channel: string;
  /** The stored handle or profile URL. */
  value: string;
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

/**
 * Human label + pill tone for a reachability tier. The row already carries the
 * tier (`row.reachability`) but the table used to throw it away and render a
 * bare green/red "Yes/No" — this surfaces the tier Tom actually wants ("can I
 * email AND call, or just one channel?"). Pure. `UNKNOWN` → the "not scanned"
 * state so an un-enriched lead reads "— enrich", never a fake "No".
 */
export function reachabilityLabel(status: string): {
  text: string;
  tone: "green" | "amber" | "red" | "muted";
} {
  switch (status) {
    case "RICH":
      return { text: "Rich", tone: "green" };
    case "MULTI":
      return { text: "Multi", tone: "green" };
    case "EMAIL_ONLY":
      return { text: "Email", tone: "amber" };
    case "PHONE_ONLY":
      return { text: "Phone", tone: "amber" };
    case "UNREACHABLE":
      return { text: "None", tone: "red" };
    default:
      // UNKNOWN / anything unmapped = not scanned yet.
      return { text: "—", tone: "muted" };
  }
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
  // AUDIT C3 · this coverage FAMILY means "a site audit (tech/Lighthouse) ran",
  // NOT the website URL — the "Website" COLUMN (COLUMNS[website], kind:"site")
  // owns that. Labelled "Site audit" so the coverage panel + field-state filters
  // + per-cell enrich tooltips never collide with the URL column. The family KEY
  // stays `website` (unchanged) — only the human label changed.
  { key: "website", label: "Site audit" },
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
  | "site" // website URL link (the domain, clickable)
  | "contact" // contact links
  | "socials" // social handle chips (audit E6)
  | "status" // status pill
  | "touch" // touch pill
  | "cov" // per-row enrichment coverage dot-strip
  | "sig" // one goal-signal verdict (✓ fired / — didn't / needs enrichment)
  | "lastC"; // last-contacted timestamp

/**
 * F3 · the ENRICHMENT-TYPE grouping the Fields picker buckets columns by (each
 * rendered under its own header). Distinct from `group` (workflow vs enriched),
 * which drives the "add for free" copy + the locked buy-rows. Every column is
 * tagged with exactly one typeGroup.
 */
export type ColumnTypeGroup =
  | "Identity"
  | "Contacts"
  | "Tech"
  | "Reviews"
  | "Site audit"
  | "Ads"
  | "Search"
  | "AI";

/** F3 · stable render order for the type-grouped Fields picker sections. */
export const COLUMN_TYPE_GROUP_ORDER: readonly ColumnTypeGroup[] = [
  "Identity",
  "Contacts",
  "Reviews",
  "Site audit",
  "Tech",
  "Ads",
  "Search",
  "AI",
] as const;

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
  /** F3 · which ENRICHMENT-TYPE section the Fields picker files it under. */
  typeGroup: ColumnTypeGroup;
  /** Backing data family (for "— enrich" greying + coverage). */
  family?: DataFamily;
  /** Override the enrich TYPES a cell-click on this column requests. Defaults to
   *  the family's types (`FAMILY_ENRICH_TYPES`). Use this when a column is a
   *  subset of its family — e.g. Built on / Booking tool are `website` family but
   *  only want the tech/DOM scan (contacts+tech), NOT Lighthouse. */
  enrichTypes?: readonly string[];
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
    typeGroup: "Identity",
  },
  {
    key: "match",
    label: "Match %",
    kind: "match",
    sortable: true,
    defaultOn: true,
    group: "workflow",
    typeGroup: "Identity",
  },
  {
    key: "pains",
    label: "Pain points",
    fullLabel: "Pain points (pitch angles)",
    kind: "pains",
    sortable: false,
    defaultOn: true,
    group: "workflow",
    typeGroup: "Identity",
  },
  {
    key: "website",
    label: "Website",
    kind: "site",
    sortable: false,
    // On by default — "Has a website: match" begged the question "why not the
    // website itself?" The URL is the single most-clicked field on a lead.
    defaultOn: true,
    group: "enriched",
    family: "website",
    typeGroup: "Tech",
  },
  {
    key: "builtOn",
    label: "Built on",
    kind: "text",
    sortable: false,
    // Off by default now that the Website column carries the URL — the CMS name
    // is a secondary detail, kept toggle-able in the Fields menu.
    defaultOn: false,
    group: "enriched",
    family: "website",
    // Built-on comes from the DOM/tech scan (rides the contacts fetch) — NOT
    // Lighthouse. A cell-click enriches contacts+tech only.
    enrichTypes: ["contacts", "tech"],
    typeGroup: "Tech",
  },
  {
    key: "reachable",
    label: "Reachable",
    kind: "reach",
    sortable: false,
    defaultOn: true,
    group: "workflow",
    family: "contacts",
    typeGroup: "Contacts",
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
    typeGroup: "Reviews",
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
    typeGroup: "Reviews",
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
    typeGroup: "Site audit",
  },
  {
    // AUDIT F2 · SEO score — stored on LighthouseAudit, never shown.
    key: "seo",
    label: "SEO",
    fullLabel: "Lighthouse SEO score",
    kind: "num",
    sortable: true,
    defaultOn: false,
    group: "enriched",
    family: "website",
    higherIsBetter: true,
    typeGroup: "Site audit",
  },
  {
    // Meta and Google ads are SEPARATE columns — distinct sources, cost bases,
    // and reliability. Never merged into one "Ads" total. `enrichTypes` scopes a
    // cell-click to THAT platform only (the `ads` DataFamily is shared for the
    // coverage dot, but the enrich action must not buy the other platform).
    key: "metaAdCount",
    label: "Meta ads",
    fullLabel: "Active Meta (FB/IG) ad creatives",
    kind: "num",
    sortable: true,
    defaultOn: false,
    group: "enriched",
    family: "ads",
    enrichTypes: ["meta_ads"],
    higherIsBetter: true,
    typeGroup: "Ads",
  },
  {
    key: "googleAdCount",
    label: "Google ads",
    fullLabel: "Active Google ad creatives (target-host attribution)",
    kind: "num",
    sortable: true,
    defaultOn: false,
    group: "enriched",
    family: "ads",
    enrichTypes: ["google_ads"],
    higherIsBetter: true,
    typeGroup: "Ads",
  },
  {
    // AUDIT F2 · best local-pack rank — stored on SerpResult, never shown.
    key: "serpRank",
    label: "SERP",
    fullLabel: "Best local-pack rank (lower is better)",
    kind: "num",
    sortable: true,
    defaultOn: false,
    group: "enriched",
    family: "search",
    higherIsBetter: false,
    typeGroup: "Search",
  },
  {
    // AUDIT C3 · the exact booking tool (Square/Vagaro/Fresha) — stored, unshown.
    key: "bookingTool",
    label: "Booking tool",
    kind: "text",
    sortable: false,
    defaultOn: false,
    group: "enriched",
    family: "website",
    // Booking tool is read from the DOM/tech scan, not Lighthouse.
    enrichTypes: ["contacts", "tech"],
    typeGroup: "Tech",
  },
  {
    // AUDIT F2 · the AI-research positioning summary — stored on
    // BusinessEnrichment (the drawer already renders it), now a toggle-able
    // column. Off by default (a long text field); the cell truncates + carries
    // the full text in its tooltip. No DataFamily maps to AI research, so it has
    // no `family` — the empty cell offers a generic enrich affordance.
    key: "aiSummary",
    label: "AI summary",
    kind: "text",
    sortable: false,
    defaultOn: false,
    group: "enriched",
    typeGroup: "AI",
  },
  {
    key: "phones",
    label: "Phone",
    kind: "contact",
    sortable: false,
    // Contacts are what the agency paid to enrich — show them by default so a
    // fresh workbench answers "how do I see the contacts?" without hunting the
    // Fields menu. (Junk phones are now purged + NANP-validated at the source.)
    defaultOn: true,
    group: "enriched",
    family: "contacts",
    typeGroup: "Contacts",
  },
  {
    key: "emails",
    label: "Email",
    kind: "contact",
    sortable: false,
    defaultOn: true,
    group: "enriched",
    family: "contacts",
    typeGroup: "Contacts",
  },
  {
    // AUDIT E6 · social handles were stored but never shown. Off by default
    // (secondary contact channel), addable from the Fields menu.
    key: "socials",
    label: "Socials",
    kind: "socials",
    sortable: false,
    defaultOn: false,
    group: "enriched",
    family: "contacts",
    typeGroup: "Contacts",
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
    typeGroup: "Identity",
  },
  {
    key: "status",
    label: "Status",
    kind: "status",
    sortable: false,
    defaultOn: true,
    group: "workflow",
    typeGroup: "Identity",
  },
  {
    key: "touch",
    label: "Touch",
    kind: "touch",
    sortable: false,
    defaultOn: true,
    group: "workflow",
    typeGroup: "Identity",
  },
  {
    key: "lastContactedAt",
    label: "Last contacted",
    kind: "lastC",
    sortable: true,
    defaultOn: true,
    group: "workflow",
    typeGroup: "Identity",
  },
] as const;

// NB: per-goal-signal ✓/— COLUMNS were removed — a boolean verdict carries no
// per-lead value as a column (that's filter work). Signals are exposed as
// filters (the whole library via the "+ Signal" picker) and surfaced as
// "why qualifies" chips in the Pain-points column. The `sig` ColumnKind +
// `sigKey` field remain on ColumnDef only for back-compat of persisted views.

export const DEFAULT_ACTIVE_COLUMNS: string[] = COLUMNS.filter(
  (c) => c.defaultOn,
).map((c) => c.key);

/**
 * WB-COL-1 · the first-visit column set for a GOAL-BASED hunt: the always-on
 * defaults PLUS every enriched-group column whose backing research intersects
 * the goal's researches — so a Website-redesign hunt opens showing Site speed +
 * SEO (the data the agency paid for), not just contacts. Additive (never drops a
 * default), preserves COLUMNS render order, `biz` stays first. A goal with no
 * researches (discovery-only) yields exactly DEFAULT_ACTIVE_COLUMNS. Pure —
 * `goalResearches` are the expanded, lowercase research tokens
 * (researchesForSignals output); each column's tokens come from `enrichTypes` or
 * its family's FAMILY_ENRICH_TYPES.
 */
export function defaultActiveColumnsForGoal(
  goalResearches: readonly string[],
): string[] {
  const goalSet = new Set(goalResearches);
  const out: string[] = [];
  for (const c of COLUMNS) {
    if (c.defaultOn) {
      out.push(c.key);
      continue;
    }
    const tokens =
      c.enrichTypes ?? (c.family ? enrichTypesForFamilies([c.family]) : []);
    if (tokens.some((t) => goalSet.has(t))) out.push(c.key);
  }
  return out;
}

// ── Filter model ─────────────────────────────────────────────────────────────

export type FilterOp = "<" | "≤" | "=" | "≥" | ">" | "between";

/** A numeric threshold filter on a WorkbenchLeadRow field. `kind` is optional
 *  for back-compat — an absent kind means numeric. */
export interface NumericLeadFilter {
  kind?: "numeric";
  /** A numeric WorkbenchLeadRow field key (reviews / rating / perf / match). */
  field: NumericFilterField;
  op: FilterOp;
  value: number;
  /** Upper bound for the "between" op. */
  value2?: number;
}

/**
 * A GOAL-SIGNAL verdict filter — narrows to leads where one of the user's chosen
 * signals matched (or explicitly didn't). Reads the per-lead verdict already on
 * every row (`row.perSignal[sigKey]`), so no new data/query is needed. This is
 * what turns the workbench from a generic table into one personalised to the
 * search: the signals you picked on the Goal step become filters here.
 */
export interface SignalLeadFilter {
  kind: "signal";
  sigKey: string;
  sigLabel: string;
  /** "match" = signal fired for this lead; "miss" = evaluated but didn't fire.
   *  A not-yet-computed (null) verdict never satisfies either — opt-in, so a
   *  filter never silently hides leads that just haven't been enriched. */
  want: "match" | "miss";
}

export type LeadFilter = NumericLeadFilter | SignalLeadFilter;

export type NumericFilterField =
  | "match"
  | "reviews"
  | "rating"
  | "perf"
  | "emails"
  | "phones";

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
  { field: "emails", label: "Emails found" },
  { field: "phones", label: "Phones found" },
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
  // Contactability: default to "has at least one" — the "find me leads I can
  // actually email/call" filter the workbench was missing entirely.
  emails: { op: "≥", value: 1 },
  phones: { op: "≥", value: 1 },
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
    case "emails":
      return row.emails.length;
    case "phones":
      return row.phones.length;
  }
}

/** Evaluate one filter against a row. A null backing value never matches. Pure. */
export function evalFilter(row: WorkbenchLeadRow, f: LeadFilter): boolean {
  if (f.kind === "signal") {
    const verdict = row.perSignal[f.sigKey];
    // null/undefined = not-yet-computed → never matches (opt-in honesty).
    if (verdict == null) return false;
    return f.want === "match" ? verdict === true : verdict === false;
  }
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
  if (f.kind === "signal") {
    return `${f.sigLabel}: ${f.want === "match" ? "matched" : "not matched"}`;
  }
  const meta = FILTER_FIELDS.find((m) => m.field === f.field);
  const name = meta?.label ?? f.field;
  if (f.op === "between") return `${name} ${f.value}–${f.value2 ?? f.value}`;
  return `${name} ${f.op} ${f.value}`;
}

// ── Data-availability (which filters are worth offering) ──────────────────────
// The add-filter UI offers only filters that CAN match — a signal with no
// enriched data, or a numeric field no lead carries, would just produce an
// empty (or dishonestly-narrowed) result. Computed over the FULL loaded row set
// (not the filtered/paged view) so the option list is stable as the user filters.

/**
 * The signal keys whose data is present on EVERY loaded lead — i.e. every row's
 * `perSignal[key]` is a real verdict (`true`/`false`), never `null`
 * (not-yet-computed). Only these are offered as filters (#2 · strict gating):
 * a signal missing data on even one lead is hidden until the whole cohort is
 * enriched, because filtering on a partially-computed signal would silently
 * drop the not-yet-enriched leads (dishonest). `signals` is the candidate set —
 * the goal signals (seed) or the whole library (picker). A signal absent from a
 * row's `perSignal` (pruned null) reads as not-present → excludes it. Pure.
 */
export function availableSignalKeys(
  rows: readonly WorkbenchLeadRow[],
  signals: readonly { key: string }[],
): Set<string> {
  const out = new Set<string>();
  if (rows.length === 0) return out;
  for (const s of signals) {
    if (rows.every((r) => r.perSignal[s.key] != null)) out.add(s.key);
  }
  return out;
}

/**
 * Merge a lead's LIBRARY signal verdicts (evaluated against default thresholds,
 * for #2 "filter by all signals") with its GOAL verdicts (the user's tuned
 * thresholds, for the goal columns). Goal wins for its own keys and keeps them
 * even when null — the goal COLUMNS render null as "— enrich", so those keys
 * must always be present. Non-goal library verdicts are kept ONLY when non-null:
 * a pruned/absent key reads as "no data" both in {@link evalFilter} and the
 * strict {@link availableSignalKeys} gate, and pruning keeps the serialized
 * payload lean (~one bool per computable signal, not dozens of nulls). Pure —
 * shared by the discovery workspace + the saved-list workbench pages.
 */
export function mergeSignalVerdicts(
  lib: Record<string, boolean | null>,
  goal: Record<string, boolean | null>,
  goalKeys: ReadonlySet<string>,
): Record<string, boolean | null> {
  const out: Record<string, boolean | null> = {};
  for (const [k, v] of Object.entries(lib)) {
    if (goalKeys.has(k)) continue; // goal (tuned) wins for its own keys
    if (v != null) out[k] = v; // prune non-goal nulls
  }
  for (const k of goalKeys) out[k] = goal[k] ?? null; // always present for columns
  return out;
}

/**
 * The numeric filter fields that have real data on ≥1 loaded lead. `match` is
 * always present (derived for every row). `reviews`/`rating`/`perf` count when
 * some row has a non-null finite value; contact counts (`emails`/`phones`)
 * count only when some row actually has ≥1 (an all-zero column can't usefully
 * be filtered "≥ 1"). Pure.
 */
export function availableNumericFields(
  rows: readonly WorkbenchLeadRow[],
): Set<NumericFilterField> {
  const out = new Set<NumericFilterField>();
  for (const { field } of FILTER_FIELDS) {
    const hasData = rows.some((r) => {
      const v = fieldValue(r, field);
      if (v == null || !Number.isFinite(v)) return false;
      // A contact count of 0 = "no contact of this kind" → not filterable data.
      if (field === "emails" || field === "phones") return v > 0;
      return true;
    });
    if (hasData) out.add(field);
  }
  return out;
}

/**
 * The DEFAULT signal filters to auto-apply when the workbench opens: the goal-
 * step signals whose data is present on EVERY loaded lead (`availableSignalKeys`
 * · strict gating). Partially-enriched goal signals are deliberately excluded —
 * auto-applying one would hide every not-yet-computed lead (the P0-B guard).
 * Each defaults to "match". Pure — the component seeds React state from this on
 * mount.
 */
export function seedSignalFilters(
  rows: readonly WorkbenchLeadRow[],
  goalSignals: readonly { key: string; title: string }[],
): SignalLeadFilter[] {
  const avail = availableSignalKeys(rows, goalSignals);
  return goalSignals
    .filter((s) => avail.has(s.key))
    .map((s) => ({
      kind: "signal",
      sigKey: s.key,
      sigLabel: s.title,
      want: "match",
    }));
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
      // NB: sortRows switches on the column KEY (not its kind). The Last-
      // contacted column's key is "lastContactedAt" — using "lastC" (its kind)
      // here was a silent dead sort (fell through to default → no reorder).
      case "lastContactedAt":
        return r.lastContactedAt
          ? new Date(r.lastContactedAt).getTime()
          : -Infinity;
      default:
        return 0;
    }
  };
  return [...rows].sort((a, b) => (num(a) - num(b)) * dir);
}

// ── Grouping by signal set (#5 · segment by pitch angle) ─────────────────────
// "Group by signals" buckets leads by the COMBINATION of their verdicts on the
// applied signal filters — so Tom sees "these 40 match SEO + Booking (pitch the
// bundle), those 12 only match SEO". Reuses the same collapsible group render as
// group-by-cell. Only meaningful (and only offered) when ≥1 signal filter is
// applied — the applied signals ARE the segmentation axes.

/** One signal-combination bucket: a stable key, a human label, and its rows. */
export interface SignalGroup {
  /** Stable per-combination key (verdict tuple) — the render key + collapse id. */
  key: string;
  /** "Weak SEO ✓ · Online booking ✗ · Reachable —" (✓ matched · ✗ missed · — no data). */
  label: string;
  rows: WorkbenchLeadRow[];
}

/** The verdict glyph for one signal on one lead: ✓ fired · ✗ evaluated-but-not ·
 *  — not computable yet. */
function verdictGlyph(v: boolean | null | undefined): "✓" | "✗" | "—" {
  return v === true ? "✓" : v === false ? "✗" : "—";
}

/**
 * Bucket rows by the combination of their verdicts across the applied signal
 * filters. Buckets are ordered strongest-first (most signals matched, fewest
 * unknown) so the highest-value segment leads. Preserves each bucket's incoming
 * row order (the caller pre-sorts). Pure. Returns `[]` when no signal filters
 * are applied (the caller then falls back to a flat/other grouping).
 */
export function groupBySignals(
  rows: readonly WorkbenchLeadRow[],
  signalFilters: readonly { sigKey: string; sigLabel: string }[],
): SignalGroup[] {
  if (signalFilters.length === 0) return [];
  const buckets = new Map<string, SignalGroup>();
  for (const r of rows) {
    const idParts: string[] = [];
    const labelParts: string[] = [];
    for (const f of signalFilters) {
      const g = verdictGlyph(r.perSignal[f.sigKey]);
      idParts.push(g);
      labelParts.push(`${f.sigLabel} ${g}`);
    }
    const key = idParts.join("│");
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, label: labelParts.join(" · "), rows: [] };
      buckets.set(key, bucket);
    }
    bucket.rows.push(r);
  }
  const score = (g: SignalGroup) => {
    // Strongest-first: rank by matched count desc, then unknown count asc. Every
    // row in a bucket shares the verdict tuple, so read the first row's.
    const first = g.rows[0];
    let matched = 0;
    let unknown = 0;
    for (const f of signalFilters) {
      const v = first.perSignal[f.sigKey];
      if (v === true) matched += 1;
      else if (v == null) unknown += 1;
    }
    return { matched, unknown };
  };
  return [...buckets.values()].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sb.matched !== sa.matched) return sb.matched - sa.matched;
    if (sa.unknown !== sb.unknown) return sa.unknown - sb.unknown;
    return a.label.localeCompare(b.label);
  });
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
