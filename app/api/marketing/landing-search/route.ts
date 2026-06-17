/**
 * GET /api/marketing/landing-search?q=...
 *
 * PUBLIC, anonymous business-name autosuggest for the /for-businesses hero.
 * Returns the businesses we've already analyzed (have an active landing) so
 * the visitor can jump straight to their personalized landing.
 *
 *   Response: { matches: { name, city, landingPath }[] }
 *
 * - No auth (marketing surface). IP rate-limited via PUBLIC_LIMIT.
 * - DB-only read (no vendor API) → not subject to the no-live-api guard.
 * - Degrades to `{ matches: [] }` on bad input so the client just shows the
 *   "no match → lead form" path (never a 500 in the user's face).
 */

import { z } from "zod";

import { PUBLIC_LIMIT, ipKey, rateLimit } from "@/lib/middleware/rate-limit";
import {
  EMPTY_LANDING_SEARCH,
  MAX_LANDING_QUERY_LEN,
  searchLandings,
} from "@/modules/landing-search";

const QuerySchema = z.object({
  q: z.string().min(1).max(MAX_LANDING_QUERY_LEN),
});

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function GET(req: Request): Promise<Response> {
  // 60 req/min/IP — debounced client keystrokes stay well under this.
  const limited = await rateLimit(req, PUBLIC_LIMIT, ipKey(req));
  if (limited) return limited;

  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({ q: url.searchParams.get("q") ?? "" });
  if (!parsed.success) {
    return Response.json(EMPTY_LANDING_SEARCH, { headers: NO_STORE });
  }

  const matches = await searchLandings(parsed.data.q);
  return Response.json({ matches }, { headers: NO_STORE });
}
