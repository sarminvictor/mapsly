"use server";

/**
 * WP6-15 · Lead-collision positioning.
 *
 * `otherAgenciesOnCellsAction(cells)` counts the DISTINCT OTHER agencies that
 * have a Discovery overlapping the cells the caller is about to map — the
 * honesty + scarcity nudge on the Preview screen ("N other agencies track this
 * market"). NOT the same as "they get the same list": Mapsly diversifies the
 * generated touch pain-hook ordering per agency (see modules/outreach/
 * first-touch.ts orderPains), so overlapping markets never yield verbatim
 * openers — this count is the honest framing of that reality.
 *
 * Lives in a NEW file (NOT modules/discovery/actions.ts — that file owns the
 * spend gate and is edited elsewhere). Auth-gated + Zod-validated; the count
 * excludes the caller's own agency. Bounded query (Discovery.cellKeys is a
 * String[] with an overlap filter). Read-only; no external API.
 */

import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { cellKey } from "@/lib/cell";

const CellInput = z.object({
  categorySlug: z.string().min(1).max(120),
  metroSlug: z.string().min(1).max(120),
  country: z.string().min(1).max(8).default("US"),
});

const Input = z.array(CellInput).min(1).max(12);

export type CollisionCountResult =
  | { status: "ok"; otherAgencies: number }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid_input" }
  | { status: "error" };

export async function otherAgenciesOnCellsAction(
  cells: unknown,
): Promise<CollisionCountResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = Input.safeParse(cells);
  if (!parsed.success) return { status: "invalid_input" };

  try {
    const member = await prisma.agencyMember.findFirst({
      where: { userId: session.user.id },
      select: { agencyId: true },
    });
    if (!member) return { status: "forbidden" };

    // Canonical cell keys for the target market (dedup).
    const keys = Array.from(
      new Set(
        parsed.data.map((c) => cellKey(c.categorySlug, c.metroSlug, c.country)),
      ),
    );

    // Distinct OTHER agencies with a discovery overlapping any of these cells.
    // `hasSome` maps to the Postgres array-overlap (&&) operator — bounded, and
    // Discovery has an index path via agencyId. We only need the distinct
    // agencyId set, so select that column and count in JS (the overlap set is
    // small: a handful of agencies per local cell).
    const rows = await prisma.discovery.findMany({
      where: {
        agencyId: { not: member.agencyId },
        cellKeys: { hasSome: keys },
      },
      select: { agencyId: true },
      take: 500, // bound the scan; 500 distinct agencies per cell is unreal
    });
    const otherAgencies = new Set(rows.map((r) => r.agencyId)).size;

    return { status: "ok", otherAgencies };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "discovery.collision_count.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}
