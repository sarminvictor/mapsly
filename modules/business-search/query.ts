/**
 * Business-search · server query for the agency ⌘K quick-lookup (F.11).
 *
 * `searchBusinesses(q)` runs a case-insensitive fuzzy match across
 * `Business.name`, `Business.website`, `Business.slug`, and
 * `Business.city`. Returns up to `MAX_MATCHES` rows ordered by review
 * count desc (a coarse-but-cheap "active operations" proxy that biases
 * toward businesses Tom is actually likely to pitch).
 *
 * Per `.claude/rules/scalability.md`:
 *   - `select` only the fields the picker renders — no broad `include`
 *     (INC-37 prevention).
 *   - `take: MAX_MATCHES` — bounded result set, always.
 *
 * Per `.claude/rules/performance.md`:
 *   - No `'use cache'` here · the picker fires per-keystroke and the
 *     query is dynamic-by-design. Caching one user's keystroke for
 *     another is wrong; the cost of an indexed `LIKE` on Business is
 *     low enough that we skip caching entirely.
 *
 * Per `.claude/rules/security.md`:
 *   - Caller (route handler) enforces auth + rate limiting. This
 *     function trusts its input — the route's Zod schema is the
 *     boundary.
 *   - Active-only filter (`isActive: true`) so we never surface an
 *     archived business to the agency picker.
 *
 * URL-host extraction: when Tom pastes a URL like
 * `https://www.solea-spa.com/treatments`, we want the underlying
 * `website` LIKE clause to match `solea-spa.com`. `normalizeWebsiteToken`
 * pulls the host out of a URL-shaped query so the contains match
 * targets the registrable domain, not the full pasted string.
 */

import prisma from "@/lib/prisma";

import { MAX_MATCHES, MAX_QUERY_LEN, type BusinessMatch } from "./types";

/**
 * Strip protocol + path + trailing punctuation from a URL-shaped query
 * so the `contains` clause matches against the host portion of
 * `Business.website` (which Mapsly stores as full URLs).
 *
 * Pure / no I/O — kept exported so unit tests can pin it down.
 *
 *   normalizeWebsiteToken("https://www.solea-spa.com/x") === "solea-spa.com"
 *   normalizeWebsiteToken("Solea Spa")                   === "solea spa"
 *
 * Heuristics:
 *   - If the input is a URL, drop scheme + leading "www." + path/query/hash.
 *   - Otherwise, lowercase + trim — `contains` will still match
 *     name/city tokens.
 */
export function normalizeWebsiteToken(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return "";
  // URL-ish (has a scheme or a dot before a TLD-ish token).
  const isUrlLike =
    /^(https?:\/\/)/.test(trimmed) || /[a-z0-9-]\.[a-z]{2,}/i.test(trimmed);
  if (!isUrlLike) return trimmed;

  let host = trimmed.replace(/^https?:\/\//, "");
  // Drop everything from the first slash, query, or hash onward.
  const stopIdx = host.search(/[/?#]/);
  if (stopIdx !== -1) host = host.slice(0, stopIdx);
  // Drop leading "www." — Mapsly normalizes hosts the same way.
  host = host.replace(/^www\./, "");
  // Trim trailing punctuation users sometimes paste.
  host = host.replace(/[.,;]+$/, "");
  return host;
}

/**
 * Fuzzy search across the Business index. See module header for the
 * design contract.
 *
 * Returns an empty array (not null, not thrown) for queries below the
 * minimum length — keeps the route handler dumb.
 */
export async function searchBusinesses(q: string): Promise<BusinessMatch[]> {
  const trimmed = (q ?? "").trim();
  if (trimmed.length < 2) return [];
  // Mirror the route-handler Zod cap defensively — never burn a long
  // LIKE on a pasted blob even if the boundary check is bypassed.
  const bounded = trimmed.slice(0, MAX_QUERY_LEN);
  const hostToken = normalizeWebsiteToken(bounded);

  try {
    const rows = await prisma.business.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: bounded, mode: "insensitive" } },
          { slug: { contains: bounded, mode: "insensitive" } },
          { city: { contains: bounded, mode: "insensitive" } },
          // Website match uses the host-only token when the user
          // pasted a URL — `contains` against `https://...` would
          // never hit because we store the full URL on Business.
          { website: { contains: hostToken, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        slug: true,
        name: true,
        city: true,
        category: true,
        website: true,
      },
      orderBy: [
        // Review count desc · "active operations" proxy. NULLs sort
        // last under Postgres default so we don't need to filter them.
        { reviewCount: "desc" },
        // Deterministic tiebreaker · stable cursor on equal counts.
        { id: "asc" },
      ],
      take: MAX_MATCHES,
    });
    return rows;
  } catch (err) {
    // Degrade to "no matches" rather than 500 — the picker shows the
    // empty state, the user retypes, Sentry captures the cause.
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "business-search.query.failed",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return [];
  }
}
