"use server";

/**
 * Outreach server actions (Phase 8 · Touchpoints).
 *
 * generateTouchpointsAction · bulk-generates first-touch OutreachDraft rows for
 * the agency's discovered, reachable prospects that don't yet have a draft.
 * `generateTouchesForLeads` is DETERMINISTIC (a grounded skeleton + DB write, no
 * external API) so it's safe in the request path — but it loops + writes per
 * business, so the batch is capped (≤20) per `.claude/rules/scalability.md`.
 *
 * Auth-gated + Zod-validated per `.claude/rules/security.md`; agency-scoped via
 * the caller's AgencyMember → the agency's discovered cells → businesses.
 */

import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { generateTouchesForLeads } from "@/modules/outreach/generate";

// Channel values match TouchChannel in modules/outreach/first-touch.ts.
const Input = z.object({
  sellingWhat: z.string().min(3).max(400),
  channel: z.enum(["email", "dm", "phone", "social"]),
  limit: z.number().int().min(1).max(20).default(20),
});

export type GenerateTouchpointsInput = z.input<typeof Input>;

export type GenerateTouchpointsResult =
  | { status: "ok"; generated: number; scanned: number }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

export async function generateTouchpointsAction(
  input: unknown,
): Promise<GenerateTouchpointsResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = Input.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    const member = await prisma.agencyMember.findFirst({
      where: { userId: session.user.id },
      select: { agencyId: true },
    });
    if (!member) return { status: "forbidden" };
    const agencyId = member.agencyId;

    // Agency boundary: discovered cells → reachable, non-hidden businesses.
    const discoveries = await prisma.discovery.findMany({
      where: { agencyId },
      select: { cellKeys: true },
    });
    const cellKeys = Array.from(
      new Set(discoveries.flatMap((d) => d.cellKeys)),
    );
    if (cellKeys.length === 0)
      return { status: "ok", generated: 0, scanned: 0 };

    // Over-fetch a pool (best leads first), exclude those already drafted, then
    // take the batch limit. Avoids depending on a back-relation name.
    const pool = await prisma.business.findMany({
      where: {
        cellKey: { in: cellKeys },
        isHidden: false,
        reachableChannelCount: { gt: 0 },
      },
      select: { id: true },
      take: parsed.data.limit * 3,
      orderBy: { reviewCount: "desc" },
    });
    if (pool.length === 0) return { status: "ok", generated: 0, scanned: 0 };

    const drafted = await prisma.outreachDraft.findMany({
      where: { businessId: { in: pool.map((p) => p.id) } },
      select: { businessId: true },
    });
    const draftedSet = new Set(drafted.map((d) => d.businessId));
    const targets = pool
      .filter((p) => !draftedSet.has(p.id))
      .slice(0, parsed.data.limit)
      .map((p) => p.id);

    if (targets.length === 0) {
      return { status: "ok", generated: 0, scanned: pool.length };
    }

    const agency = await prisma.agency.findUnique({
      where: { id: agencyId },
      select: { mailingAddress: true },
    });

    const touches = await generateTouchesForLeads(targets, {
      sellingWhat: parsed.data.sellingWhat,
      channel: parsed.data.channel,
      mailingAddress: agency?.mailingAddress ?? null,
    });

    return { status: "ok", generated: touches.length, scanned: pool.length };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "touchpoints.generate.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}
