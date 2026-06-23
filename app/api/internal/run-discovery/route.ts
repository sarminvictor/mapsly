/**
 * /api/internal/run-discovery · executes a queued Discovery inside cron context.
 *
 * The discovery server action only ENQUEUES a PENDING Discovery row (no live
 * API in the user request path). This worker route runs the heavy `mapsSearch`
 * fan-out inside `runDiscovery` (which opens its own per-cell CronRun), so the
 * "no live API in user request path" invariant holds
 * (.claude/rules/cost-discipline.md).
 *
 * Auth: a shared internal token — accepts either `Bearer ${CRON_SECRET}` or
 * `Bearer ${BOXLY_WORKER_AUTH_TOKEN}`. Only the scheduler / worker can call it.
 *
 * Body: { discoveryId } (re-runs an enqueued Discovery) OR an inline
 * { agencyId, userId, cells, limitPerCell } request.
 */

import { z } from "zod";

import prisma from "@/lib/prisma";
import { parseCellKey } from "@/lib/cell";
import { runDiscovery } from "@/modules/discovery/run-discovery";

// Maps fan-out over many cells can be slow; stay under Vercel's 300s default.
export const maxDuration = 300;

const CellInput = z.object({
  categorySlug: z.string().min(1).max(120),
  categoryId: z.string().min(1).max(64),
  metroSlug: z.string().min(1).max(120),
  country: z.string().min(2).max(3).optional(),
});

const ByIdSchema = z.object({
  discoveryId: z.string().min(1).max(64),
  /** categoryId can't be parsed from a cellKey — supply a slug→id map. */
  categoryIdByCellKey: z.record(z.string(), z.string()).optional(),
});

const InlineSchema = z.object({
  agencyId: z.string().min(1).max(64),
  userId: z.string().min(1).max(64),
  cells: z.array(CellInput).min(1).max(50),
  limitPerCell: z.number().int().min(1).max(1000).optional(),
});

const PayloadSchema = z.union([ByIdSchema, InlineSchema]);

/** Constant-time-ish Bearer check against either internal token. */
function verifyInternalAuth(authHeader: string | null): boolean {
  const match = authHeader?.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const token = match[1] ?? "";
  const cronSecret = process.env.CRON_SECRET ?? "";
  const workerToken = process.env.BOXLY_WORKER_AUTH_TOKEN ?? "";
  return (
    (cronSecret.length > 0 && token === cronSecret) ||
    (workerToken.length > 0 && token === workerToken)
  );
}

export async function POST(request: Request): Promise<Response> {
  if (!verifyInternalAuth(request.headers.get("authorization"))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let parsed: z.infer<typeof PayloadSchema>;
  try {
    const json = (await request.json()) as unknown;
    const result = PayloadSchema.safeParse(json);
    if (!result.success) {
      return Response.json(
        { error: "invalid_input", details: result.error.flatten() },
        { status: 400 },
      );
    }
    parsed = result.data;
  } catch {
    return Response.json({ error: "malformed_json" }, { status: 400 });
  }

  try {
    if ("discoveryId" in parsed) {
      const discovery = await prisma.discovery.findUnique({
        where: { id: parsed.discoveryId },
        select: {
          id: true,
          agencyId: true,
          requestedByUserId: true,
          cellKeys: true,
        },
      });
      if (!discovery) {
        return Response.json({ error: "not_found" }, { status: 404 });
      }

      // Rebuild the cell requests from the stored cellKeys. categoryId is not
      // encoded in a cellKey, so the caller supplies a categorySlug→id map.
      const cells = discovery.cellKeys
        .map((key) => parseCellKey(key))
        .filter((c): c is NonNullable<typeof c> => c !== null)
        .map((c) => ({
          categorySlug: c.categorySlug,
          categoryId:
            parsed.categoryIdByCellKey?.[
              `${c.categorySlug}|${c.metroSlug}|${c.country}`
            ] ??
            parsed.categoryIdByCellKey?.[c.categorySlug] ??
            "",
          metroSlug: c.metroSlug,
          country: c.country,
        }))
        .filter((c) => c.categoryId.length > 0);

      if (cells.length === 0) {
        return Response.json(
          { error: "invalid_input", message: "no resolvable cells" },
          { status: 400 },
        );
      }

      const summary = await runDiscovery({
        agencyId: discovery.agencyId,
        userId: discovery.requestedByUserId,
        cells,
      });
      return Response.json({ ok: true, ...summary }, { status: 200 });
    }

    const summary = await runDiscovery({
      agencyId: parsed.agencyId,
      userId: parsed.userId,
      cells: parsed.cells,
      limitPerCell: parsed.limitPerCell,
    });
    return Response.json({ ok: true, ...summary }, { status: 200 });
  } catch (err) {
    console.error(
      "[/api/internal/run-discovery] threw:",
      err instanceof Error ? err.stack : err,
    );
    return Response.json(
      {
        error: "internal_error",
        message: err instanceof Error ? err.message : "unknown",
      },
      { status: 500 },
    );
  }
}
