// Meta Ad Library `ads_archive` adapter · daily competitor ad scan.
//
// Source: Meta Graph API · `https://graph.facebook.com/v19.0/ads_archive`.
// Auth: a long-lived Marketing API access token (set in
// META_AD_LIBRARY_ACCESS_TOKEN). Per Meta's docs the endpoint is FREE — no
// per-call charge — but we still flow every call through the cost-counter
// (unitCost = $0) so that:
//
//   1. The "no live API in user request path" invariant from
//      `.claude/rules/cost-discipline.md` is enforced for THIS adapter too —
//      callers from a Next route handler will throw because no CronRun is
//      open. Only the daily cron should be calling this.
//   2. Every adapter call still creates a CronRun trail (operation tag +
//      cache-hit tally), giving the dashboard a uniform observability story
//      regardless of vendor pricing model.
//   3. If Meta later starts charging (rate-limit overages, premium tier),
//      flipping `META_ADS_ARCHIVE_UNIT_COST_USD` is the only edit needed.
//
// Cache: 6h per `.claude/rules/data-cadence.md` daily-tier guidance — the
// daily cron pulls fresh data once per business; second-run-of-day reads hit
// cache. The cache key is the FULL query (search_terms, ad_active_status,
// country, etc.) so two adjacent scans for the same brand still bill once.
//
// Validation surface (mocked unit tests cover all of these):
//   - Missing access token → descriptive error
//   - Cron-context invariant from withCostCounter
//   - 4xx / 5xx → adapter throws with operation tag + status + body snippet
//   - Schema validation (Meta returns ad_id as string, dates as ISO-like
//     strings, sometimes booleans missing)
//   - Pagination follow-through via `paging.next`
//   - Total result count enforced by `MAX_RESULTS_PER_QUERY` so a runaway
//     query can't hammer the API forever

import { z } from "zod";
import { kvCache } from "@/lib/cache";
import { withCostCounter } from "@/lib/cost/cost-counter";

// ---- Constants ----------------------------------------------------------

const META_GRAPH_BASE_URL =
  process.env.META_GRAPH_API_BASE_URL?.replace(/\/+$/, "") ??
  "https://graph.facebook.com/v19.0";

/** Meta endpoint reports "free" — every call charges $0 to the open CronRun.
 *  Kept as a constant so it shows up explicitly in audits + can be tuned if
 *  Meta starts billing (e.g. premium tier or rate-limit overage). */
export const META_ADS_ARCHIVE_UNIT_COST_USD = 0;

/** Safety ceiling — a single search must not page beyond this. Meta's
 *  default page size is 25; at 50 pages we've already returned 1,250 ads
 *  per business which dwarfs any realistic SMB-competitor scan. */
const MAX_RESULTS_PER_QUERY = 1_500;

/** Per-call timeout in ms. Meta's median latency is < 600ms; we generously
 *  allow 15s for slow regions but cap to keep the daily cron's per-business
 *  budget bounded. */
const FETCH_TIMEOUT_MS = 15_000;

/** Defensive cap on paging follow-through. Each page returns up to `limit`
 *  rows; even at limit=100 this allows 6,000 rows — well above
 *  MAX_RESULTS_PER_QUERY. If we ever exceed this, paging never terminated. */
const MAX_PAGES_PER_QUERY = 60;

// ---- Test seams ---------------------------------------------------------

let _fetchOverride: typeof fetch | null = null;
let _tokenOverride: string | null = null;

export function __setFetchForTesting(fn: typeof fetch | null): void {
  _fetchOverride = fn;
}
export function __setTokenForTesting(tok: string | null): void {
  _tokenOverride = tok;
}

function getFetch(): typeof fetch {
  return _fetchOverride ?? globalThis.fetch;
}

function getAccessToken(): string {
  const tok = _tokenOverride ?? process.env.META_AD_LIBRARY_ACCESS_TOKEN;
  if (!tok) {
    throw new Error(
      "[meta-ad-library] META_AD_LIBRARY_ACCESS_TOKEN is not set. " +
        "Provision a long-lived Marketing API token and add it to .env.local / Vercel env.",
    );
  }
  return tok;
}

// ---- Public schemas + types --------------------------------------------

/** Meta enumerated values for `ad_active_status`. */
export const AdActiveStatus = z.enum(["ACTIVE", "INACTIVE", "ALL"]);
export type AdActiveStatus = z.infer<typeof AdActiveStatus>;

/** ISO 3166-1 alpha-2 country code. Meta uses `country=US` etc. */
const Country = z
  .string()
  .regex(
    /^[A-Z]{2}$/,
    "country must be a 2-letter uppercase ISO 3166-1 alpha-2 code",
  );

/** Bounded paging — Meta caps each page at 100 according to docs. */
const Limit = z.number().int().min(1).max(100);

export const AdsArchiveQuerySchema = z.object({
  /** Free-text search across ad copy + page name. Either this OR
   *  `search_page_ids` (or both) must be provided per Meta. */
  search_terms: z.string().min(1).optional(),
  /** Comma-separated list of Page IDs (Meta IDs, not vanity slugs). */
  search_page_ids: z.string().optional(),
  ad_active_status: AdActiveStatus.default("ALL"),
  ad_reached_countries: z.array(Country).min(1),
  /** Optional ISO date — fetch only ads with delivery on or after this. */
  ad_delivery_date_min: z.string().date().optional(),
  ad_delivery_date_max: z.string().date().optional(),
  /** Page size. Meta defaults to 25; we default to 100 to minimize round
   *  trips. */
  limit: Limit.default(100),
});
export type AdsArchiveQuery = z.input<typeof AdsArchiveQuerySchema>;

/** Single ad row as we expose it to callers. Meta's raw shape has many more
 *  fields; we keep the ones that map cleanly to `AdLibraryEntry` plus a few
 *  that the daily cron needs for matching. */
export const AdsArchiveRowSchema = z.object({
  id: z.string(),
  page_id: z.string().optional(),
  page_name: z.string().optional(),
  ad_creative_bodies: z.array(z.string()).optional(),
  ad_creative_link_captions: z.array(z.string()).optional(),
  ad_creative_link_titles: z.array(z.string()).optional(),
  ad_creative_link_descriptions: z.array(z.string()).optional(),
  ad_snapshot_url: z.string().optional(),
  ad_delivery_start_time: z.string().optional(),
  ad_delivery_stop_time: z.string().optional(),
  /** Meta returns banded estimates as strings like "1000" or "5000-50000".
   *  Use {@link parseBand} to normalize before persisting. */
  impressions: z
    .object({
      lower_bound: z.string().optional(),
      upper_bound: z.string().optional(),
    })
    .optional(),
  spend: z
    .object({
      lower_bound: z.string().optional(),
      upper_bound: z.string().optional(),
    })
    .optional(),
  publisher_platforms: z.array(z.string()).optional(),
  /** Meta sometimes returns this as boolean, sometimes as string. */
  ad_active_status: z.union([z.string(), z.boolean()]).optional(),
});
export type AdsArchiveRow = z.infer<typeof AdsArchiveRowSchema>;

const PagingSchema = z
  .object({
    cursors: z
      .object({
        before: z.string().optional(),
        after: z.string().optional(),
      })
      .optional(),
    next: z.string().optional(),
  })
  .optional();

const AdsArchiveResponseSchema = z.object({
  data: z.array(AdsArchiveRowSchema),
  paging: PagingSchema,
});

export interface AdsArchiveResult {
  /** All rows fetched across paging, capped at MAX_RESULTS_PER_QUERY. */
  rows: AdsArchiveRow[];
  /** Total rows fetched (== rows.length unless we hit the safety ceiling). */
  totalFetched: number;
  /** Set to true if MAX_RESULTS_PER_QUERY was hit and more pages exist. */
  truncated: boolean;
  /** Operation tag for telemetry — matches what was billed to the CronRun. */
  operation: string;
}

/** Default fields requested from Meta. We ask for the union of everything
 *  AdLibraryEntry uses plus a couple of useful join keys. */
const DEFAULT_FIELDS = [
  "id",
  "page_id",
  "page_name",
  "ad_creative_bodies",
  "ad_creative_link_captions",
  "ad_creative_link_titles",
  "ad_creative_link_descriptions",
  "ad_snapshot_url",
  "ad_delivery_start_time",
  "ad_delivery_stop_time",
  "impressions",
  "spend",
  "publisher_platforms",
  "ad_active_status",
].join(",");

// ---- Public API ---------------------------------------------------------

/**
 * Uncached, untracked entrypoint — raw fetch + paging follow-through.
 *
 * NOT exported. Callers use {@link adsArchiveSearch} (cached) or
 * {@link adsArchiveSearchUncached} (cost-tracked but cache-bypassing).
 *
 * Enforces:
 *   - Either search_terms OR search_page_ids present
 *   - MAX_RESULTS_PER_QUERY ceiling
 *   - MAX_PAGES_PER_QUERY defensive cap
 *   - Per-call timeout via AbortSignal.timeout
 */
async function adsArchiveSearchRaw(
  query: AdsArchiveQuery,
): Promise<AdsArchiveResult> {
  const parsed = AdsArchiveQuerySchema.parse(query);
  if (!parsed.search_terms && !parsed.search_page_ids) {
    throw new Error(
      "[meta-ad-library] adsArchiveSearch requires either search_terms or search_page_ids",
    );
  }

  const operation = buildOperationTag(parsed);
  const token = getAccessToken();
  const fetchFn = getFetch();

  const rows: AdsArchiveRow[] = [];
  let truncated = false;

  // First-page URL — subsequent pages use Meta's `paging.next` verbatim so
  // we don't have to recompose pagination params ourselves.
  let nextUrl: string | null = buildFirstPageUrl(parsed, token);
  let pageCount = 0;

  while (nextUrl) {
    pageCount += 1;
    if (pageCount > MAX_PAGES_PER_QUERY) {
      throw new Error(
        `[meta-ad-library] ${operation} paging exceeded ${MAX_PAGES_PER_QUERY} pages — refusing to continue. Tighten the query.`,
      );
    }

    const res: Response = await fetchFn(nextUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      let bodySnippet = "";
      try {
        bodySnippet = await res.text();
      } catch {
        // ignore
      }
      throw new Error(
        `[meta-ad-library] ${operation} HTTP ${res.status} ${res.statusText}: ${redactSecrets(bodySnippet).slice(0, 500)}`,
      );
    }

    const json: unknown = await res.json();
    const parsedJson = AdsArchiveResponseSchema.parse(json);

    let pageHadOverflow = false;
    for (const row of parsedJson.data) {
      if (rows.length >= MAX_RESULTS_PER_QUERY) {
        pageHadOverflow = true;
        break;
      }
      rows.push(row);
    }

    if (pageHadOverflow) {
      // Inner loop hit the ceiling mid-page — there is by definition more
      // data available than we returned.
      truncated = true;
      break;
    }

    const next = parsedJson.paging?.next;
    const hasNext = typeof next === "string" && next.length > 0 ? next : null;

    if (rows.length >= MAX_RESULTS_PER_QUERY) {
      // Filled exactly to the ceiling. If Meta says there's another page,
      // mark truncated WITHOUT fetching it — saves one network round trip
      // vs the prior "fetch-then-discover" loop shape.
      if (hasNext) truncated = true;
      break;
    }

    nextUrl = hasNext;
  }

  return {
    rows,
    totalFetched: rows.length,
    truncated,
    operation,
  };
}

/**
 * Cost-tracked, cron-context-enforced search. This is the entrypoint cron
 * handlers + adapter callers should use when they explicitly want to bypass
 * the 6h cache (e.g. an admin "Refresh now" action).
 *
 * Cost: $0 per call (Meta endpoint is free). Still attribution-tracked.
 *
 * Throws if called outside a CronRun (the "no live API in user path"
 * invariant).
 */
export const adsArchiveSearchUncached = withCostCounter(
  "meta-ad-library.ads-archive.search",
  META_ADS_ARCHIVE_UNIT_COST_USD,
  adsArchiveSearchRaw,
);

/**
 * Cost-tracked + KV-cached (6h) search. Cache key includes the FULL
 * normalized query so two callers asking for the same brand in the same
 * window dedupe.
 *
 * Per `.claude/rules/data-cadence.md`, this is the canonical entrypoint for
 * the daily competitor-ad-scan cron. The 6h TTL means a second daily run
 * within the same UTC day (e.g. a manual re-trigger) hits cache; the next
 * morning's cron picks fresh data.
 */
export const adsArchiveSearch = kvCache(
  "meta:adlib:search",
  { ttl: 6 * 60 * 60 /* 6h in seconds */, tag: "meta:adlib" },
  adsArchiveSearchUncached,
);

/**
 * Convenience: convert Meta's banded `{ lower_bound, upper_bound }` string
 * pair into mid-point + low/high numbers for the `AdLibraryEntry` columns.
 * Returns null if neither bound is parseable.
 *
 * Examples:
 *   { lower_bound: "1000", upper_bound: "5000" } → { mid: 3000, low: 1000, high: 5000 }
 *   { lower_bound: "0", upper_bound: "100" }     → { mid: 50,   low: 0,    high: 100 }
 *   undefined                                    → null
 */
export function parseBand(
  band: { lower_bound?: string; upper_bound?: string } | undefined,
): { mid: number; low: number; high: number } | null {
  if (!band) return null;
  const low = parseBandedNumber(band.lower_bound);
  const high = parseBandedNumber(band.upper_bound);
  if (low === null && high === null) return null;
  if (low !== null && high !== null) {
    return { mid: (low + high) / 2, low, high };
  }
  const single = low ?? high ?? 0;
  return { mid: single, low: single, high: single };
}

// ---- Internals ----------------------------------------------------------

/**
 * Strip secrets that Meta sometimes echoes back into error responses. If the
 * upstream body ever contains the access_token (rare but observed when Meta
 * 4xx's a malformed request) we MUST NOT propagate it into Sentry / logs.
 * Per `.claude/rules/security.md` § Secret handling.
 */
function redactSecrets(raw: string): string {
  return raw.replace(/(access_token=)[^&\s"]+/gi, "$1<redacted>");
}

function parseBandedNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

function buildOperationTag(q: z.infer<typeof AdsArchiveQuerySchema>): string {
  const subject = q.search_terms
    ? `search="${q.search_terms.slice(0, 32)}"`
    : `page_ids=${q.search_page_ids?.slice(0, 64) ?? "?"}`;
  return `meta-ad-library.ads-archive.search[${q.ad_reached_countries.join(",")}|${q.ad_active_status}|${subject}]`;
}

function buildFirstPageUrl(
  q: z.infer<typeof AdsArchiveQuerySchema>,
  token: string,
): string {
  const params = new URLSearchParams();
  params.set("access_token", token);
  params.set("fields", DEFAULT_FIELDS);
  // Meta expects ad_reached_countries as a bracketed JSON-ish list.
  params.set("ad_reached_countries", JSON.stringify(q.ad_reached_countries));
  params.set("ad_active_status", q.ad_active_status);
  params.set("limit", String(q.limit));
  if (q.search_terms) params.set("search_terms", q.search_terms);
  if (q.search_page_ids) params.set("search_page_ids", q.search_page_ids);
  if (q.ad_delivery_date_min)
    params.set("ad_delivery_date_min", q.ad_delivery_date_min);
  if (q.ad_delivery_date_max)
    params.set("ad_delivery_date_max", q.ad_delivery_date_max);
  return `${META_GRAPH_BASE_URL}/ads_archive?${params.toString()}`;
}
