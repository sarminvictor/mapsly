/**
 * GET /api/marketing/portal-destination
 *
 * Post-hydration portal resolution for the marketing header CTA
 * (INC-2026-07-15-64). The header itself is fully static — a server-side
 * `auth()` read there made the Suspense boundary postpone under
 * cacheComponents/PPR, splitting the document into two Fizz renders whose
 * segment ids collided and white-paged the site. The signed-in
 * "Open your workspace" swap therefore happens HERE, fetched by the
 * <PortalCta> client island AFTER hydration.
 *
 *   Response: { portal: { href, labelKey, external } | null }
 *
 * - Anonymous visitors (the majority): `auth()` is a JWT decode, no DB hit,
 *   returns { portal: null } fast.
 * - Signed-in: one User findUnique via getPortalDestination.
 * - IP rate-limited via PUBLIC_LIMIT; no-store (session-dependent).
 * - Degrades to { portal: null } on any failure — the CTA just stays
 *   "Sign in", which still lands a signed-in user in their portal because
 *   /signin redirects authenticated visitors (signin/page.tsx).
 */

import { auth } from "@/lib/auth";
import { getPortalDestination } from "@/lib/portal-destination";
import { PUBLIC_LIMIT, ipKey, rateLimit } from "@/lib/middleware/rate-limit";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export async function GET(req: Request): Promise<Response> {
  const limited = await rateLimit(req, PUBLIC_LIMIT, ipKey(req));
  if (limited) return limited;

  try {
    const session = await auth();
    if (!session?.user?.id) {
      return Response.json({ portal: null }, { headers: NO_STORE });
    }
    const portal = await getPortalDestination(session.user.id);
    return Response.json({ portal }, { headers: NO_STORE });
  } catch {
    return Response.json({ portal: null }, { headers: NO_STORE });
  }
}
