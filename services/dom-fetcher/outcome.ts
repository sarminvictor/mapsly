// services/dom-fetcher/outcome.ts · R3 · pure outcome taxonomy for a DOM fetch.
//
// Same fail-loud discipline the Meta actor got in R0, applied to the
// dom-fetcher (apify-actors/dom-fetcher/): a per-target outcome CLASS that
// separates "the fetch reached rendered content" from "it was walled / timed
// out / errored". Without it, a Cloudflare-blocked page (or a dead URL burning
// its retry ladder — the original ERR_TIMED_OUT@blkmktsmp.com incident) looks
// identical to a genuinely thin page, and the contacts/Lighthouse consumer
// caches a blocked fetch as a clean empty.
//
// PURE + deterministic — no I/O — so it's unit-tested AND mirrored verbatim in
// the actor (actors can't import app code). The actor stamps each row's
// `outcome`; the app re-derives it here for rows from an older actor build that
// only emitted blocked/failed flags. Single source of truth for the mapping.

/** The verified-vs-silent-failure taxonomy (mirrors MetaRunOutcome shape). */
export type DomFetchOutcome =
  | "ok" // reached rendered content (html present, not a challenge page)
  | "empty_verified" // reached the server, page is genuinely near-empty
  | "blocked" // Cloudflare / 403 / challenge never cleared (retryable)
  | "timeout" // navigation/proxy timeout before any content (retryable)
  | "error"; // other hard failure (retryable)

/** Minimal shape of a dom-fetch row for classification (success OR dead-letter). */
export interface DomFetchOutcomeInput {
  /** True when the actor flagged a Cloudflare/403 block. */
  blocked?: boolean | undefined;
  /** True when the actor flagged the fetch as failed (no usable HTML). */
  failed?: boolean | undefined;
  /** HTTP status from the navigation, if any. */
  status?: number | null | undefined;
  /** Rendered HTML byte length (0/absent when nothing was fetched). */
  htmlBytes?: number | null | undefined;
  /** Whether HTML content is present at all. */
  hasHtml?: boolean | undefined;
  /** Error message from a dead-letter row (used to sniff timeout vs other). */
  error?: string | null | undefined;
}

/** A rendered page below this many bytes is treated as verified-empty, not ok. */
export const DOM_EMPTY_BYTE_THRESHOLD = 512;

/** Sniff a timeout from the actor's error string (Playwright/CDP phrasing). */
function looksLikeTimeout(error: string | null | undefined): boolean {
  if (!error) return false;
  return /timeout|timed?[-\s]?out|err_timed_out|navigation timeout|deadline/i.test(
    error,
  );
}

/**
 * Classify ONE dom-fetch row into the outcome taxonomy. Deterministic.
 *   - blocked flag OR 403 → `blocked` (Cloudflare wall — retryable, NOT empty)
 *   - failed flag / no html → `timeout` if the error looks like one, else `error`
 *   - html present + above the empty threshold → `ok`
 *   - html present but tiny → `empty_verified` (reached content, page is thin)
 */
export function classifyDomFetch(row: DomFetchOutcomeInput): DomFetchOutcome {
  const status = typeof row.status === "number" ? row.status : null;
  if (row.blocked === true || status === 403) return "blocked";

  const hasHtml =
    row.hasHtml === true ||
    (typeof row.htmlBytes === "number" && row.htmlBytes > 0);
  if (row.failed === true || !hasHtml) {
    return looksLikeTimeout(row.error) ? "timeout" : "error";
  }

  const bytes = typeof row.htmlBytes === "number" ? row.htmlBytes : Infinity;
  return bytes >= DOM_EMPTY_BYTE_THRESHOLD ? "ok" : "empty_verified";
}

/** Outcomes where the fetch provably reached rendered content (safe to trust as
 *  a real result). blocked/timeout/error are RETRYABLE silent failures — the
 *  consumer must treat them as FAILED (retryable), never a clean empty. */
const REACHED_CONTENT: ReadonlySet<DomFetchOutcome> = new Set([
  "ok",
  "empty_verified",
]);

export function domFetchReachedContent(o: DomFetchOutcome): boolean {
  return REACHED_CONTENT.has(o);
}

/** True when the outcome is a retryable silent failure (block/timeout/error). */
export function domFetchIsRetryable(o: DomFetchOutcome): boolean {
  return !REACHED_CONTENT.has(o);
}
