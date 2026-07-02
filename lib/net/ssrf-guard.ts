// lib/net/ssrf-guard.ts · SSRF guard for business-controlled URL fetches.
//
// Our server-side fetchers follow arbitrary `Business.website` URLs (and their
// redirects) straight out of our own egress. Without a guard, a malicious or
// misconfigured business URL can point us — or 302-redirect us — at an internal
// host: cloud metadata (169.254.169.254), a loopback admin panel, or an RFC1918
// service. This module is the single sanctioned gate: parse + protocol/port
// allowlist + IP-literal range check + DNS-resolution range check (to defeat
// DNS-rebinding, where a public name resolves to a private address), and a
// redirect-following `safeFetch` that re-validates every hop.
//
// Node built-ins only (node:dns/promises, node:net) — no new deps.
//
// See:
//   - .claude/rules/security.md — "never let user input become a URL we fetch"
//   - modules/contacts/fetch-site.ts, services/dom-fetcher/free-fetch.ts,
//     modules/business-qualification/scrape-email.ts,
//     services/business-services-detect/from-service-pages.ts — the callers
//
// Egress note: the Apify actor paths (services/apify/*, dom-fetcher/fetcher.ts's
// actor calls) fetch business URLs from Apify's infrastructure, NOT our process
// egress — those do NOT need this guard. Only OUR-process `fetch()` of a
// business-controlled URL must route through here.

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

/** Thrown when a URL is rejected as pointing at (or resolving to) a blocked host. */
export class SsrfBlockedError extends Error {
  /** The URL (or hop) that was rejected. */
  readonly url: string;
  /** Machine-readable reason for the block. */
  readonly reason: SsrfBlockReason;

  constructor(url: string, reason: SsrfBlockReason, detail?: string) {
    super(
      `SSRF guard blocked ${url} (${reason})${detail ? `: ${detail}` : ""}`,
    );
    this.name = "SsrfBlockedError";
    this.url = url;
    this.reason = reason;
  }
}

export type SsrfBlockReason =
  | "invalid-url"
  | "bad-protocol"
  | "bad-port"
  | "private-ip-literal"
  | "private-resolved-ip"
  | "too-many-redirects";

/** Only http(s) with the default ports (80 / 443, or scheme-implied) allowed. */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
/** Explicit ports we permit. Empty string = scheme default (80/443). */
const ALLOWED_PORTS = new Set(["", "80", "443"]);

/** Max redirect hops safeFetch will follow before giving up. */
const MAX_REDIRECTS = 5;

/**
 * True when an IPv4/IPv6 literal falls in a private, loopback, link-local,
 * unique-local, or otherwise-reserved range that must never be reachable from
 * a server-side fetch of a business-controlled URL.
 *
 * IPv4 blocks: 0.0.0.0/8, 10/8, 100.64/10 (CGNAT), 127/8, 169.254/16 (incl.
 * 169.254.169.254 cloud metadata), 172.16/12, 192.0.0/24, 192.168/16, 198.18/15
 * (benchmarking), 224/4 (multicast), 240/4 (reserved).
 * IPv6 blocks: ::, ::1 (loopback), ::ffff:0:0/96 (IPv4-mapped — resolved via the
 * embedded v4), fc00::/7 (ULA), fe80::/10 (link-local), ff00::/8 (multicast).
 *
 * Anything not recognised as a valid IP literal returns false (the caller has
 * already handled hostnames via DNS resolution).
 */
export function isPrivateIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isPrivateIpv4(ip);
  if (kind === 6) return isPrivateIpv6(ip);
  return false;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (
    parts.length !== 4 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
  ) {
    // Not a well-formed dotted quad — treat as blocked out of caution.
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 (incl. 0.0.0.0)
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true; // unspecified + loopback
  // IPv4-mapped (::ffff:a.b.c.d or ::ffff:aabb:ccdd) — evaluate the embedded v4.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  const firstHextet = lower.split(":")[0] ?? "";
  const lead = parseInt(firstHextet || "0", 16);
  if (Number.isNaN(lead)) return true; // malformed → block
  if ((lead & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((lead & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((lead & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/**
 * Parse + validate a URL for server-side fetch, resolving its hostname to
 * confirm none of its addresses land in a blocked range. Returns the parsed
 * `URL` on success; throws {@link SsrfBlockedError} on any rejection.
 *
 * Rejects:
 *   - non-http(s) protocols (file:, ftp:, gopher:, data:, …)
 *   - non-default ports (anything but 80 / 443 / scheme-implied)
 *   - IP-literal hosts in private/loopback/link-local/metadata/ULA ranges
 *   - hostnames whose DNS `lookup` yields ANY private/reserved address
 *     (defeats DNS-rebinding of a public name onto an internal IP)
 */
export async function assertPublicUrl(url: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfBlockedError(url, "invalid-url");
  }

  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw new SsrfBlockedError(url, "bad-protocol", parsed.protocol);
  }
  if (!ALLOWED_PORTS.has(parsed.port)) {
    throw new SsrfBlockedError(url, "bad-port", parsed.port);
  }

  // Strip IPv6 brackets from the hostname for isIP / isPrivateIp checks.
  const host = parsed.hostname.replace(/^\[|\]$/g, "");

  // If the host is itself an IP literal, check it directly — no DNS needed.
  if (isIP(host) !== 0) {
    if (isPrivateIp(host)) {
      throw new SsrfBlockedError(url, "private-ip-literal", host);
    }
    return parsed;
  }

  // Hostname → resolve ALL addresses and reject if ANY is private/reserved.
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    // DNS failure is not an SSRF signal — let the caller's own fetch fail
    // naturally (NXDOMAIN / SERVFAIL). Returning here keeps behaviour
    // identical to today for genuinely-unresolvable hosts.
    return parsed;
  }

  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new SsrfBlockedError(
        url,
        "private-resolved-ip",
        `${host} → ${address}`,
      );
    }
  }

  return parsed;
}

/** Init accepted by {@link safeFetch}. Mirrors the subset callers rely on. */
export interface SafeFetchInit {
  headers?: HeadersInit;
  signal?: AbortSignal;
  /** Method — defaults to GET. */
  method?: string;
}

/**
 * SSRF-safe `fetch`. Validates the initial URL via {@link assertPublicUrl},
 * disables automatic redirects (`redirect: "manual"`), and re-validates each
 * `Location` hop against {@link assertPublicUrl} before following it — so a
 * public URL that 302-redirects to 169.254.169.254 is blocked, not chased.
 *
 * Bounded to {@link MAX_REDIRECTS} hops. Preserves caller behaviour otherwise:
 * the supplied `headers` + `signal` (timeout/UA) ride on every hop, and the
 * final non-redirect `Response` is returned as-is (callers inspect `res.ok`,
 * `res.url`, `res.headers`, `res.text()` exactly as before).
 *
 * Throws {@link SsrfBlockedError} on a blocked URL/hop or on exceeding the hop
 * budget. Callers already treat a thrown fetch as FAILED (their try/catch), so
 * an SSRF block collapses to their existing "unreachable" outcome.
 */
export async function safeFetch(
  url: string,
  init: SafeFetchInit = {},
): Promise<Response> {
  let current = (await assertPublicUrl(url)).toString();

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(current, {
      method: init.method,
      headers: init.headers,
      signal: init.signal,
      redirect: "manual",
    });

    // 3xx with a Location → validate the next hop, then continue.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res; // 3xx without Location — hand back as-is.
      const next = new URL(location, current).toString();
      await assertPublicUrl(next); // throws SsrfBlockedError on a bad hop
      current = next;
      continue;
    }

    return res;
  }

  throw new SsrfBlockedError(current, "too-many-redirects");
}
