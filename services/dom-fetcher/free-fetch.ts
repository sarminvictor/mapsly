// services/dom-fetcher/free-fetch.ts · the $0 first-pass DOM fetch.
//
// The orchestrator's biggest cost win: ~70% of SMB sites are open and a plain
// `fetch` gets their rendered-enough HTML for free. Only the ones a plain fetch
// CAN'T get — Cloudflare-challenged, JS-walled, or empty — fall through to the
// paid Apify actor (services/dom-fetcher/fetcher.ts). Try free FIRST, pay for
// the blocked remainder.
//
// This is a NARROWER surface than modules/contacts/fetch-site.ts: that helper
// gates strictly on a 2xx HTML content-type (it feeds the legacy contact scan).
// Here we WANT the challenge-page body too, because detecting it is how we route
// a URL to the paid actor. So `freeFetchDom` returns `{ html, blocked, status }`
// and classifies a Cloudflare/empty response as `blocked: true` rather than
// discarding it.
//
// NEVER throws — every failure (DNS, timeout, reset, non-HTML) collapses to
// `{ blocked: true }`, which routes the URL to the paid actor (the safe default:
// pay to be sure rather than silently drop a reachable site).
//
// See:
//   - services/dom-fetcher/fetcher.ts — the paid fallback (Apify actor)
//   - modules/discovery/enrich-contacts.ts — the consumer (free-first routing)
//   - lib/net/ssrf-guard.ts — the SSRF gate (WP8-1): every hop is re-validated
//   - .claude/rules/cost-discipline.md — free path first, pay only when blocked

import { safeFetch } from "@/lib/net/ssrf-guard";

/** Desktop UA — some sites serve a stripped/blocked page to obvious bots. */
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Per-request hard ceiling. Most open homepages return in < 2s. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** Cap the body we read so a misconfigured multi-MB homepage can't eat memory. */
const MAX_HTML_BYTES = 4_000_000;

/**
 * A body shorter than this is almost never a real homepage — it's a challenge
 * stub, an interstitial, or an empty shell. Treat it as blocked so the paid
 * actor (which runs a real browser) gets a chance.
 */
const MIN_USABLE_BYTES = 500;

/**
 * Markers of a Cloudflare / WAF / JS-challenge interstitial. If the body matches
 * any of these the page isn't the real content — route it to the paid actor.
 * Kept tight + case-insensitive: over-matching would pay for open sites.
 */
const CHALLENGE_PATTERNS =
  /just a moment|attention required|cf-browser-verification|checking your browser|enable javascript and cookies to continue|verifying you are human/i;

/** Result of a free fetch. `blocked` is the routing signal: true → paid actor. */
export interface FreeFetchResult {
  /** Rendered HTML — present only when the fetch succeeded AND wasn't blocked. */
  html?: string;
  /** True when a plain fetch can't get usable content (challenge / empty / error). */
  blocked: boolean;
  /** HTTP status from the navigation, when we got a response. */
  status?: number;
}

/**
 * Decide whether an HTTP response body is a real homepage or a wall.
 * PURE + exported for unit tests — the whole cost story rides on this not
 * over-blocking (paying for open sites) or under-blocking (dropping walled ones).
 *
 * Blocked when:
 *   - status is a challenge/unavailable code (403 / 503), OR
 *   - the body matches a known Cloudflare/JS-challenge interstitial, OR
 *   - the body is shorter than MIN_USABLE_BYTES (empty shell / stub).
 */
export function isBlockedResponse(status: number, body: string): boolean {
  if (status === 403 || status === 503) return true;
  if (CHALLENGE_PATTERNS.test(body)) return true;
  if (body.trim().length < MIN_USABLE_BYTES) return true;
  return false;
}

/** Normalize a (possibly bare) website value into an absolute http(s) URL. */
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

export interface FreeFetchOptions {
  /** Hard per-request timeout in ms. Default 10000. */
  timeoutMs?: number;
}

/**
 * Fetch a site's homepage with a plain `fetch` — no browser, no proxy, $0.
 * Returns the HTML when it's an open, usable page; otherwise `{ blocked: true }`
 * so the caller routes it to the paid Apify actor. NEVER throws.
 *
 * The blocked-path body is intentionally discarded (we only return `html` on a
 * clean success) — a challenge stub is useless to the parser, and returning it
 * would risk a downstream consumer treating the wall as real content.
 */
export async function freeFetchDom(
  url: string,
  options: FreeFetchOptions = {},
): Promise<FreeFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const target = toAbsoluteUrl(url);
  if (!target) return { blocked: true };

  try {
    // WP8-1: route through the SSRF guard — validates the URL + every redirect
    // hop against private/loopback/link-local/metadata ranges (incl. DNS
    // rebinding). A blocked URL throws SsrfBlockedError, which the catch below
    // collapses to { blocked: true } → the paid actor (Apify infra, not our
    // egress), the safe default.
    const res = await safeFetch(target, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });

    const status = res.status;

    // A non-HTML body (PDF / image / JSON homepage) yields no contacts and would
    // pollute the tech fingerprint — route it to the actor, which renders a DOM.
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const looksHtml =
      contentType.includes("html") || contentType.includes("text");

    // Read the (bounded) body once; we need it for both content + challenge check.
    const body = await res.text();
    const html =
      body.length > MAX_HTML_BYTES ? body.slice(0, MAX_HTML_BYTES) : body;

    if (!res.ok || !looksHtml || isBlockedResponse(status, html)) {
      return { blocked: true, status };
    }

    return { html, blocked: false, status };
  } catch {
    // Timeout, DNS failure, connection reset, abort — route to the paid actor.
    return { blocked: true };
  }
}
