"use server";

/**
 * Lead-detail server action (Phase · Lead drawer).
 *
 * `getLeadDetailAction(businessId)` resolves the calling agency from the
 * session, then returns the agency-scoped `getLeadDetail` payload. Called LAZILY
 * — only when the drawer opens — so the workspace page never pays for it up
 * front and a discovery with 200 businesses doesn't load 200 detail blobs.
 *
 * Auth-gated + Zod-validated (`.claude/rules/security.md`). Cross-agency / missing
 * business reads as `{ status: "not_found" }` — we never confirm another agency's
 * data. No external API in the request path (read-only over enriched DB rows).
 */

import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

import { getLeadDetail, type LeadDetail } from "./lead-detail";

const Input = z.object({ businessId: z.string().min(1).max(64) });

export type GetLeadDetailResult =
  | { status: "ok"; lead: LeadDetail }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "invalid_input" }
  | { status: "error" };

export async function getLeadDetailAction(
  businessId: string,
): Promise<GetLeadDetailResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = Input.safeParse({ businessId });
  if (!parsed.success) return { status: "invalid_input" };

  try {
    const member = await prisma.agencyMember.findFirst({
      where: { userId: session.user.id },
      select: { agencyId: true },
    });
    if (!member) return { status: "forbidden" };

    const lead = await getLeadDetail(parsed.data.businessId, member.agencyId);
    if (!lead) return { status: "not_found" };

    return { status: "ok", lead };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "lead_detail.load.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}
