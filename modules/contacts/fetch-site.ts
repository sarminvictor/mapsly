/**
 * Polite site fetcher · Phase 4 (Contacts + reachability gate) / Phase 6-tech.
 *
 * One standalone, dependency-free homepage fetch that BOTH the contact
 * extractor (`extractContactsFromHtml`) and the tech fingerprint
 * (`fingerprintTech`) ride on. A single network round-trip enriches contacts
 * AND tech at $0 — that's the whole point of doing them together.
 *
 * Politeness mirrors `modules/business-qualification/scrape-email.ts` (a
 * self-identifying MapslyBot UA, a short per-request timeout, redirect-follow,
 * content-type gating) but this is a NEW, narrower surface: one URL, one fetch,
 * no path-probing / SPA-bundle / WAF-rescue machinery. The contact scan only
 * needs the homepage HTML + response headers.
 *
 * The function NEVER throws — every failure mode (DNS, timeout, 4xx/5xx, a
 * non-HTML body, a malformed URL) collapses to `{ ok: false }`. A FAILED fetch
 * is load-bearing downstream: it means "we know nothing", which is distinct
 * from "no contacts found" (see modules/contacts/reachability.ts — FAILED ≠
 * UNREACHABLE). Callers must treat `ok: false` as FAILED, not as zero-contact.
 *
 * See:
 *   - modules/contacts/scan.ts — the consumer (contacts + tech in one pass)
 *   - modules/business-qualification/scrape-email.ts — politeness reference
 *   - lib/net/ssrf-guard.ts — the SSRF gate (WP8-1): every hop is re-validated
 *   - .claude/rules/cost-discipline.md — no live API in user request path
 *   - .claude/rules/scalability.md — bounded per-request timeout
 */

import { safeFetch } from "@/lib/net/ssrf-guard";

/** Self-identifying crawl UA so site owners can recognise + contact us. */
const USER_AGENT =
  "Mozilla/5.0 (compatible; MapslyBot/0.1; +https://mapsly.ai/bot · sarminvictor@gmail.com)";

/** Default per-request hard ceiling. Most SMB homepages return in < 2s. */
const DEFAULT_TIMEOUT_MS = 8_000;

/** Cap the body we read so a misconfigured multi-MB homepage can't eat memory. */
const MAX_HTML_BYTES = 4_000_000;

/** Options for {@link fetchSiteHtml}. */
export interface FetchSiteOptions {
  /** Hard per-request timeout in ms. Default 8000. */
  timeoutMs?: number;
}

/**
 * Result of a site fetch. On success `ok` is true and `html` / `finalUrl` /
 * `headers` are populated. On ANY failure `ok` is false and the other fields
 * are empty — callers MUST branch on `ok`, never assume `html` is meaningful.
 */
export interface FetchSiteResult {
  /** True only for a 2xx HTML response that was read successfully. */
  ok: boolean;
  /** Raw HTML body. Empty string when `ok` is false. */
  html: string;
  /** URL after redirects. Empty string when `ok` is false. */
  finalUrl: string;
  /** Lower-cased response headers. Empty object when `ok` is false. */
  headers: Record<string, string>;
  /**
   * INC-59 · WHY the fetch failed, when known — the raw evidence the site
   * verdict is classified from ("ENOTFOUND", "ECONNREFUSED", "HTTP_500",
   * "ETIMEDOUT", …). Collapsing every failure to a bare `ok:false` was how a
   * domain that DOESN'T EXIST IN DNS spent three runs on the "transient —
   * retry" ladder. Absent on success or when the cause is genuinely unknown.
   */
  errorCode?: string;
}

const FAILED: FetchSiteResult = Object.freeze({
  ok: false,
  html: "",
  finalUrl: "",
  headers: {},
});

/** Dig the most specific error code/name out of a (possibly wrapped) fetch
 *  error — undici wraps network errors as `TypeError: fetch failed` with the
 *  real `code` on `cause` (sometimes nested one level deeper). */
function errorCodeOf(err: unknown): string | undefined {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  let fallback: string | undefined;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const e = cur as { code?: unknown; name?: string; cause?: unknown };
    if (typeof e.code === "string" && e.code) return e.code;
    if (!fallback && typeof e.name === "string" && e.name !== "TypeError") {
      fallback = e.name;
    }
    cur = e.cause;
  }
  return fallback;
}

/**
 * Normalize a possibly-bare website value into a fetchable absolute https URL.
 * Returns null when the input can't be coerced into a valid URL. DataForSEO
 * sometimes stores the GBP click-through with a scheme, sometimes a bare host —
 * handle both, default to https for schemeless input.
 */
function toAbsoluteUrl(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  let candidate = trimmed;
  if (candidate.startsWith("//")) candidate = "https:" + candidate;
  else if (!/^https?:\/\//i.test(candidate)) candidate = "https://" + candidate;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** Collapse a `Headers` object into a plain lower-cased key→value record. */
function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/**
 * Fetch a site's homepage HTML politely. NEVER throws — returns `{ ok: false }`
 * on any error (timeout, DNS, non-2xx, non-HTML body, oversized body, malformed
 * URL). The same fetched HTML + headers feed both the contact extractor and the
 * tech fingerprint, so the network cost is paid once.
 */
export async function fetchSiteHtml(
  url: string,
  options: FetchSiteOptions = {},
): Promise<FetchSiteResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const target = toAbsoluteUrl(url);
  if (!target) return FAILED;

  try {
    // WP8-1: route through the SSRF guard — validates the URL + every redirect
    // hop against private/loopback/link-local/metadata ranges (incl. DNS
    // rebinding). A blocked URL throws SsrfBlockedError, which the catch below
    // collapses to FAILED (SSRF block == treat as unreachable).
    const res = await safeFetch(target, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) return { ...FAILED, errorCode: `HTTP_${res.status}` };

    const headers = headersToRecord(res.headers);

    // Gate on content type — we only want HTML. A PDF / image / JSON homepage
    // would yield no contacts and pollute the tech fingerprint.
    const contentType = headers["content-type"] ?? "";
    if (!contentType.includes("html") && !contentType.includes("text")) {
      return FAILED;
    }

    // Bound the body via the declared length when present.
    const declaredLength = Number(headers["content-length"] ?? 0);
    if (declaredLength > 0 && declaredLength > MAX_HTML_BYTES) {
      return FAILED;
    }

    const html = await res.text();
    if (html.length > MAX_HTML_BYTES) return FAILED;

    return {
      ok: true,
      html,
      finalUrl: res.url || target,
      headers,
    };
  } catch (err) {
    // Timeout, DNS failure, connection reset, abort — FAILED, but KEEP the
    // cause (INC-59): "ENOTFOUND" vs "ETIMEDOUT" is the difference between a
    // domain that doesn't exist and a slow afternoon.
    return { ...FAILED, errorCode: errorCodeOf(err) };
  }
}
