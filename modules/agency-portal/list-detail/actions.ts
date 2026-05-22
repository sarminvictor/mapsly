"use server";

/**
 * List detail server actions · single + bulk lead-status mutations.
 *
 * Per `.claude/rules/security.md`:
 *   - `auth()` at the top · anonymous → unauthorized
 *   - Cross-agency leak guard · the lead must belong to one of the
 *     caller's agencies before any update lands
 *   - Zod validation on every shape that crosses the boundary
 *
 * Per `.claude/rules/realtime-and-optimistic.md`:
 *   - Single-row actions return void · the client uses `useOptimistic`
 *     to render the new pill state instantly
 *   - Bulk actions return a count so the caller can show a toast
 *   - We `revalidateTag('list-${listId}')` after every successful
 *     write so subsequent reads from the cache layer reflect the
 *     change
 */

import { revalidateTag } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

const LeadStatus = z.enum([
  "NEW",
  "CONTACTED",
  "REPLIED",
  "WON",
  "LOST",
  "HIDDEN",
]);
export type LeadStatusValue = z.infer<typeof LeadStatus>;

const SetLeadStatusInput = z.object({
  leadId: z.string().min(1).max(64),
  status: LeadStatus,
});

const BulkSetLeadStatusInput = z.object({
  leadIds: z.array(z.string().min(1).max(64)).min(1).max(500),
  status: LeadStatus,
});

export type SetLeadStatusResult =
  | { status: "ok"; newStatus: LeadStatusValue }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

export type BulkSetLeadStatusResult =
  | { status: "ok"; updated: number; newStatus: LeadStatusValue }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

async function callerAgencyIds(userId: string): Promise<string[]> {
  const memberships = await prisma.agencyMember.findMany({
    where: { userId },
    select: { agencyId: true },
  });
  return memberships.map((m) => m.agencyId);
}

/**
 * Single-row · used by the optimistic status pill on each LeadRow.
 * Stamps `statusChangedAt` + the appropriate `contactedAt` /
 * `repliedAt` / `wonAt` / `lostAt` timestamps so the closed-loop
 * funnel stays accurate. Returns the new status so the optimistic
 * client can roll back on error.
 */
export async function setLeadStatusAction(
  input: unknown,
): Promise<SetLeadStatusResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = SetLeadStatusInput.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    const agencyIds = await callerAgencyIds(session.user.id);
    if (agencyIds.length === 0) return { status: "forbidden" };

    const existing = await prisma.lead.findFirst({
      where: { id: parsed.data.leadId, agencyId: { in: agencyIds } },
      select: { id: true, listId: true, status: true },
    });
    if (!existing) return { status: "forbidden" };
    if (existing.status === parsed.data.status) {
      // no-op · still revalidate so any concurrent client converges
      revalidateTag(`list-${existing.listId}`, "minutes");
      return { status: "ok", newStatus: parsed.data.status };
    }

    const now = new Date();
    const updateData: Record<string, unknown> = {
      status: parsed.data.status,
      statusChangedAt: now,
    };
    if (parsed.data.status === "CONTACTED") updateData.contactedAt = now;
    if (parsed.data.status === "REPLIED") updateData.repliedAt = now;
    if (parsed.data.status === "WON") updateData.wonAt = now;
    if (parsed.data.status === "LOST") updateData.lostAt = now;

    await prisma.lead.update({
      where: { id: parsed.data.leadId },
      data: updateData,
    });

    revalidateTag(`list-${existing.listId}`, "minutes");
    return { status: "ok", newStatus: parsed.data.status };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "list_detail.set_lead_status.error",
        leadId: parsed.data.leadId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}

/**
 * Bulk variant · used by BulkActionBar buttons. Single transaction
 * so partial failures roll back cleanly. Cap is enforced both at
 * the Zod layer (500 rows max) and by the Prisma `updateMany`'s
 * deterministic semantics.
 */
export async function bulkSetLeadStatusAction(
  input: unknown,
): Promise<BulkSetLeadStatusResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = BulkSetLeadStatusInput.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    const agencyIds = await callerAgencyIds(session.user.id);
    if (agencyIds.length === 0) return { status: "forbidden" };

    // Resolve list IDs we'll need to revalidate · also enforces the
    // cross-agency leak guard at the DB layer.
    const leads = await prisma.lead.findMany({
      where: {
        id: { in: parsed.data.leadIds },
        agencyId: { in: agencyIds },
      },
      select: { id: true, listId: true },
    });
    if (leads.length === 0) return { status: "forbidden" };

    const accessibleIds = leads.map((l) => l.id);
    const now = new Date();
    const updateData: Record<string, unknown> = {
      status: parsed.data.status,
      statusChangedAt: now,
    };
    if (parsed.data.status === "CONTACTED") updateData.contactedAt = now;
    if (parsed.data.status === "REPLIED") updateData.repliedAt = now;
    if (parsed.data.status === "WON") updateData.wonAt = now;
    if (parsed.data.status === "LOST") updateData.lostAt = now;

    const res = await prisma.lead.updateMany({
      where: { id: { in: accessibleIds } },
      data: updateData,
    });

    const distinctListIds = Array.from(new Set(leads.map((l) => l.listId)));
    for (const listId of distinctListIds) {
      revalidateTag(`list-${listId}`, "minutes");
    }

    return {
      status: "ok",
      updated: res.count,
      newStatus: parsed.data.status,
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "list_detail.bulk_set_lead_status.error",
        count: parsed.data.leadIds.length,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}
