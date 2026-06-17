/**
 * Landing-search · server query for the /for-businesses hero autosuggest.
 *
 * `searchLandings(q)` is a case-insensitive prefix/substring match on
 * `Business.name`, scoped to businesses that have an ACTIVE landing page
 * (`landingPage: { isActive: true }` — the relation filter inherently
 * requires the row to exist, so undiscovered businesses are excluded and
 * fall through to the lead form). Returns up to `MAX_LANDING_MATCHES` rows,
 * each carrying the full `/l/{slug}-{token}` path.
 *
 * Per `.claude/rules`:
 *   - scalability: `select` only what the dropdown renders (INC-37), bounded
 *     `take`, no broad include.
 *   - performance: no `'use cache'` — fires per-keystroke, dynamic by design;
 *     an indexed-ish match over a few-hundred-row launched set is cheap.
 *   - security: caller (route handler) owns auth (none — public) + IP rate
 *     limiting + the Zod boundary; this function trusts its input.
 *   - cost-discipline: pure Postgres read, never a vendor API (no-live-api).
 */

import prisma from "@/lib/prisma";
import { buildLandingPath } from "@/modules/smb-landing/token";

import {
  MAX_LANDING_MATCHES,
  MAX_LANDING_QUERY_LEN,
  type LandingMatch,
} from "./types";

/**
 * Match businesses with an active landing by name. Returns an empty array
 * (never throws) for too-short queries or on DB error — keeps the route
 * handler dumb and degrades to "no matches → lead form".
 */
export async function searchLandings(q: string): Promise<LandingMatch[]> {
  const trimmed = (q ?? "").trim();
  if (trimmed.length < 2) return [];
  const bounded = trimmed.slice(0, MAX_LANDING_QUERY_LEN);

  try {
    const rows = await prisma.business.findMany({
      where: {
        isActive: true,
        // To-one relation filter: requires an active LandingPage to exist —
        // businesses without one are excluded (→ lead-form path).
        landingPage: { isActive: true },
        name: { contains: bounded, mode: "insensitive" },
      },
      select: {
        name: true,
        city: true,
        landingPage: { select: { slug: true, token: true } },
      },
      orderBy: [
        // Review count desc · "most established first" proxy.
        { reviewCount: "desc" },
        // Deterministic tiebreaker.
        { id: "asc" },
      ],
      take: MAX_LANDING_MATCHES,
    });

    // flatMap narrows away the (impossible-by-filter, but nullable-by-type)
    // null landingPage without a non-null assertion.
    return rows.flatMap((r) =>
      r.landingPage
        ? [
            {
              name: r.name,
              city: r.city,
              landingPath: buildLandingPath(
                r.landingPage.slug,
                r.landingPage.token,
              ),
            },
          ]
        : [],
    );
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "landing-search.query.failed",
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    }
    return [];
  }
}
