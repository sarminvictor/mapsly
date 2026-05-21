/**
 * GET /api/reports/one-pager/[businessId] · F.6 · one-pager PDF.
 *
 * Streams an `application/pdf` containing the agency one-pager for
 * the given business. The signed-in user must be an `AgencyMember`
 * of an agency that has a `Lead` row for this business — cross-agency
 * leak guard mirrored from
 * `modules/agency-portal/prospect-detail/queries.ts`.
 *
 * Response shapes (per `.claude/rules/validation-and-errors.md`):
 *
 *   200 · application/pdf · Content-Disposition: inline; filename="<slug>.pdf"
 *   401 · { error: "unauthorized" }
 *   404 · { error: "not_found" }  — business doesn't exist OR user
 *                                   has no AgencyMember row for any
 *                                   agency that has a Lead on this
 *                                   business. We collapse all three
 *                                   "you can't see this" cases
 *                                   (doesn't exist / no membership /
 *                                   cross-agency) to 404 so we never
 *                                   leak existence across agencies.
 *   429 · { error: "rate_limited", retryAfter } (USER_LIMIT)
 *   500 · { error: "internal_error" }
 *
 * Runtime: Node · `@react-pdf/renderer` needs Node APIs (Buffer,
 * stream). Do NOT switch to edge.
 *
 * Cost discipline: this endpoint does NOT call any external paid API
 * — it reads from already-snapshotted DB rows (Business, Snapshot,
 *  LighthouseAudit). Per `.claude/rules/cost-discipline.md` we're
 * inside the user request path, but with no live-API call there's no
 * CronRun to open.
 *
 * The PDF buffer is currently regenerated per request. A follow-up
 * will cache the buffer in Vercel KV under `pdf:one-pager:<businessId>:<slug-hash>`
 * with TTL matching the underlying snapshot cron cadence (~7d) so
 * downloads after the first are O(buffer-fetch) not O(PDF-render).
 */

import { auth } from "@/lib/auth";
import { rateLimit, USER_LIMIT } from "@/lib/middleware/rate-limit";
import {
  getOnePagerData,
  type OnePagerData,
} from "@/modules/reports/one-pager-data";
import { OnePagerDocument } from "@/modules/reports/one-pager";

// @react-pdf/renderer requires Node-only APIs. Turbopack defaults
// to Node for route handlers; per `.claude/rules/conventions.md` we
// do NOT export `runtime = 'nodejs'` (Turbopack default is correct;
// the explicit export is forbidden).

interface RouteContext {
  params: Promise<{ businessId: string }>;
}

export async function GET(
  req: Request,
  context: RouteContext,
): Promise<Response> {
  // ─── Auth ─────────────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // ─── Rate limit ───────────────────────────────────────────────────────
  // 30 req/min/user is plenty — a sales rep won't reasonably hit this
  // ceiling, and we block runaway loops cheaply.
  const limited = await rateLimit(req, USER_LIMIT, session.user.id);
  if (limited) return limited;

  // ─── Params ───────────────────────────────────────────────────────────
  const { businessId } = await context.params;
  if (!businessId || typeof businessId !== "string") {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  // ─── Locale (best-effort from Accept-Language header) ─────────────────
  // The PDF formats dates locale-aware. Prefer `?locale=` query (set
  // by the prospect-detail link), else parse Accept-Language, else
  // fall back to en-US.
  const url = new URL(req.url);
  const localeQuery = url.searchParams.get("locale");
  const locale = pickLocale(
    localeQuery,
    req.headers.get("accept-language"),
  );

  // ─── Domain ───────────────────────────────────────────────────────────
  let data: OnePagerData | null;
  try {
    data = await getOnePagerData({
      businessId,
      userId: session.user.id,
      locale,
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "reports.one_pager.domain_error",
        businessId,
        userId: session.user.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return Response.json({ error: "internal_error" }, { status: 500 });
  }

  if (!data) {
    // null covers: not-found, cross-agency, build phase. We surface a
    // 404 in all cases to avoid existence-probing across agencies.
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  // ─── Render PDF ───────────────────────────────────────────────────────
  // We import `renderToBuffer` lazily so the route's module-graph
  // tree-shaking can lift `@react-pdf/renderer` (~600 KB) out of any
  // sibling routes that don't need it.
  let pdfBuffer: Buffer;
  try {
    const { renderToBuffer } = await import("@react-pdf/renderer");
    pdfBuffer = await renderToBuffer(<OnePagerDocument data={data} />);
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "reports.one_pager.render_error",
        businessId,
        userId: session.user.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return Response.json({ error: "internal_error" }, { status: 500 });
  }

  const filename = `${data.slug || "one-pager"}.pdf`;

  return new Response(pdfBuffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Content-Length": String(pdfBuffer.length),
      // Authenticated, per-user content · never cache at the CDN.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

/**
 * Pick a locale string from (in order): explicit `?locale=` query, the
 * first acceptable language in the `Accept-Language` header, or the
 * `en-US` default. We constrain to the 4 supported locales so the
 * `Intl.DateTimeFormat` call is deterministic regardless of input.
 */
function pickLocale(
  query: string | null,
  acceptLanguage: string | null,
): string {
  const supported = ["en", "es", "en-CA", "fr"];
  const norm = (s: string): string => s.trim().toLowerCase();

  if (query) {
    const found = supported.find((s) => norm(s) === norm(query));
    if (found) return found;
  }

  if (acceptLanguage) {
    // Parse `en-US,en;q=0.9,fr;q=0.8` and walk in order.
    const tokens = acceptLanguage
      .split(",")
      .map((t) => norm(t.split(";")[0] ?? ""))
      .filter(Boolean);
    for (const t of tokens) {
      const direct = supported.find((s) => norm(s) === t);
      if (direct) return direct;
      // Fall back to the base language (e.g. "en-US" → "en").
      const base = t.split("-")[0];
      const fallback = supported.find((s) => norm(s) === base);
      if (fallback) return fallback;
    }
  }

  return "en";
}
