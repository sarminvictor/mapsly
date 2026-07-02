// GET /api/agency/search?q=...
//
// Agency ⌘K business quick-lookup (F.11). Returns up to 8 matches
// across Business.name/website/slug/city. The agency-portal layout
// auth-gates the page that triggers this endpoint, but route handlers
// are reachable directly — so we re-enforce auth here.
//
// Response shapes (per `.claude/rules/validation-and-errors.md`):
//   200 { query, matches: BusinessMatch[] }
//   400 { error: "invalid_input", details }
//   401 { error: "unauthorized" }
//   429 { error: "rate_limited", ... }       — emitted by rateLimit middleware
//
// Per `.claude/rules/performance.md`, this route handler is dynamic by
// default (no `'use cache'`) — every keystroke is a fresh request and
// caching one user's queries across users would be wrong.
//
// Per `.claude/rules/scalability.md`, user-facing API routes get
// `USER_LIMIT` (30 req/min/user). Typing fast in the picker can fire
// 6–10 requests/sec briefly; the client debounces to ~150ms (≈ 6/s
// peak), so 30/min is fine over a normal interaction (clamped + at the
// debounce ceiling, an active session uses ~300/min only if it never
// pauses — which is itself a signal of abuse).
//
// Per `.claude/rules/security.md` § Input validation, the `q` param is
// Zod-validated at the boundary; bounded length matches `MAX_QUERY_LEN`.

import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { rateLimit, USER_LIMIT } from "@/lib/middleware/rate-limit";
import {
  MAX_QUERY_LEN,
  searchBusinesses,
  type BusinessSearchResponse,
} from "@/modules/business-search";

const QuerySchema = z.object({
  q: z.string().min(1).max(MAX_QUERY_LEN),
});

export async function GET(req: Request): Promise<Response> {
  // ─── Auth ───────────────────────────────────────────────────────────────
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // ─── Rate limit ─────────────────────────────────────────────────────────
  const limited = await rateLimit(req, USER_LIMIT, session.user.id);
  if (limited) return limited;

  // ─── Param validation ───────────────────────────────────────────────────
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({ q: url.searchParams.get("q") ?? "" });
  if (!parsed.success) {
    return Response.json(
      {
        error: "invalid_input",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  // ─── Query ──────────────────────────────────────────────────────────────
  // Resolve the caller's agency so each match can carry the discovery that
  // contains it (WP4-7 deep-link). Agency-scoped — a match never links to
  // another agency's research. No agency (user not on a team yet) → matches
  // still return, just without a deep-link.
  const member = await prisma.agencyMember.findFirst({
    where: { userId: session.user.id },
    select: { agencyId: true },
  });
  const matches = await searchBusinesses(parsed.data.q, member?.agencyId);
  const body: BusinessSearchResponse = {
    query: parsed.data.q,
    matches,
  };
  return Response.json(body, {
    // Belt-and-suspenders: this is dynamic + auth-gated, so explicitly
    // forbid intermediary caches from holding onto a response.
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
