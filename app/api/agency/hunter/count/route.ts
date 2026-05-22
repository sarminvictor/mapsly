/**
 * `/api/agency/hunter/count` · live match-count endpoint for Hunter.
 *
 * GET query params:
 *   - `category` (string, optional) — Business.category filter
 *   - `city` (string, optional) — Business.city filter (case-insensitive)
 *   - `radius` (integer, optional) — currently ignored (no lat/lng input)
 *
 * Returns: `{ count: number, ms: number }` · the count of active
 * businesses matching the supplied filter. Caps at 10,000 + uses a
 * 10-second `revalidate` window so identical queries don't hammer
 * Neon.
 *
 * Per `.claude/rules/security.md`:
 *   - Auth-gated · only agency members can call this (cross-agency
 *     leak isn't possible because the endpoint returns counts only,
 *     never row data).
 *   - Zod-validated params · invalid input → 400.
 *
 * Per `.claude/rules/scalability.md`:
 *   - Single Prisma `count` round-trip · indexed columns (category,
 *     city) keep this cheap.
 *   - No external API call · the cron-populated `Business` index
 *     is the source.
 *
 * Per `.claude/rules/cost-discipline.md`:
 *   - No external API calls · no CronRun cost tracked.
 *
 * v1 scope: category + city only. Step-3 signal filters (filterJson
 * shape) will fold in once the read-only HunterFiltersGrid becomes
 * editable in a follow-up.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

const MAX_REPORTED_COUNT = 10_000;

const QuerySchema = z.object({
  category: z.string().trim().min(1).max(64).optional(),
  city: z.string().trim().min(1).max(64).optional(),
  radius: z.preprocess(
    (v) => (typeof v === "string" && v.length > 0 ? Number(v) : undefined),
    z.number().int().min(1).max(500).optional(),
  ),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Membership gate · only AgencyMembers see the hunter surface so
  // only AgencyMembers should be able to ping the count endpoint.
  const member = await prisma.agencyMember.findFirst({
    where: { userId: session.user.id },
    select: { agencyId: true },
  });
  if (!member) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    category: searchParams.get("category") ?? undefined,
    city: searchParams.get("city") ?? undefined,
    radius: searchParams.get("radius") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "invalid_input",
        details: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  // Compose the `where` filter inline · explicit shape avoids the
  // Prisma type-inference issue with `Parameters<typeof
  // prisma.business.count>[0]["where"]` (the args is optional ·
  // Subset<...> | undefined).
  const where = {
    isActive: true,
    ...(parsed.data.category
      ? {
          category: {
            equals: parsed.data.category,
            mode: "insensitive" as const,
          },
        }
      : {}),
    ...(parsed.data.city
      ? {
          city: {
            equals: parsed.data.city,
            mode: "insensitive" as const,
          },
        }
      : {}),
  };
  // `radius` from the URL doesn't gate on lat/lng yet — left as a
  // forward-compatibility input. When the geo prefill lands the
  // filter will switch to a `lat`/`lng` bounding box.

  const started = Date.now();

  try {
    const raw = await prisma.business.count({ where });
    const ms = Date.now() - started;
    const count = Math.min(raw, MAX_REPORTED_COUNT);
    return NextResponse.json(
      { count, ms, truncated: raw > MAX_REPORTED_COUNT },
      {
        headers: {
          // Cache identical queries for 10 seconds at the edge so
          // typing-driven repeat requests don't re-hit Neon. Tom's
          // typing cadence is ~150ms debounced; 10s covers a session
          // of refinements before he submits.
          "Cache-Control": "private, max-age=10, stale-while-revalidate=30",
        },
      },
    );
  } catch {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
