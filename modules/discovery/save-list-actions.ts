"use server";

/**
 * Save-as-list + lead-status server actions (demand-flow pipeline).
 *
 * Both auth-gated + Zod-validated + agency-scoped per `.claude/rules/security.md`.
 * Pure DB — no external API — so they're request-path-safe
 * (`.claude/rules/cost-discipline.md`). They mirror the result-union style of
 * the other discovery actions (ok / unauthorized / forbidden / invalid_input /
 * error).
 *
 *   - saveAsListAction · turns a selection of raw-list businesses into a saved
 *     `List` + `Lead` rows (status NEW, deduped via `createMany({
 *     skipDuplicates })`). The list is scoped to the caller's agency +
 *     AgencyMember; category/metro are seeded from the discovery's first cellKey
 *     when parseable. Returns the new list id so the caller can route into the
 *     pipeline view.
 *   - setLeadStatusAction · the lean pipeline mutation: flip a lead's status
 *     (NEW→CONTACTED→REPLIED→WON/LOST) and stamp the matching closed-loop
 *     timestamp. Agency-scoped via the lead's own agencyId.
 */

import { z } from "zod";

import { auth } from "@/lib/auth";
import { parseCellKey } from "@/lib/cell";
import prisma from "@/lib/prisma";

// ── Defaults ────────────────────────────────────────────────────────────────

/**
 * Saved demand-flow lists carry no service-template intent yet (they're a raw
 * working selection, not a filter-defined campaign list), so they default to the
 * neutral CUSTOM service type. The agency can re-type the list later.
 */
const DEFAULT_SERVICE_TYPE = "CUSTOM" as const;

/** Hard cap on a single save — protects against a runaway selection. */
const MAX_BUSINESSES_PER_SAVE = 500;

// ── Input schemas ─────────────────────────────────────────────────────────

const SaveAsListInput = z.object({
  discoveryId: z.string().min(1).max(64),
  businessIds: z
    .array(z.string().min(1).max(64))
    .min(1)
    .max(MAX_BUSINESSES_PER_SAVE),
  name: z.string().trim().min(1).max(120),
});

export type SaveAsListInputType = z.input<typeof SaveAsListInput>;

const LeadStatusEnum = z.enum([
  "NEW",
  "CONTACTED",
  "REPLIED",
  "WON",
  "LOST",
  "HIDDEN",
]);

export type SaveLeadStatus = z.infer<typeof LeadStatusEnum>;

const SetLeadStatusInput = z.object({
  leadId: z.string().min(1).max(64),
  status: LeadStatusEnum,
});

export type SetLeadStatusInputType = z.input<typeof SetLeadStatusInput>;

// ── Result shapes ───────────────────────────────────────────────────────────

export type SaveAsListResult =
  | { status: "ok"; listId: string }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

export type SetLeadStatusResult =
  | { status: "ok" }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

// ── Helpers ─────────────────────────────────────────────────────────────────

/** The caller's agency membership (agencyId + memberId), or null if none. */
async function callerMembership(
  userId: string,
): Promise<{ agencyId: string; memberId: string } | null> {
  const member = await prisma.agencyMember.findFirst({
    where: { userId },
    select: { id: true, agencyId: true },
  });
  return member ? { agencyId: member.agencyId, memberId: member.id } : null;
}

// ── saveAsListAction ─────────────────────────────────────────────────────────

/**
 * Create a saved List from a raw-list selection. The Lead rows are written with
 * `createMany({ skipDuplicates: true })` so re-saving an overlapping selection
 * into a NEW list never errors on the `@@unique([listId, businessId])` (a fresh
 * list can't collide, but the flag keeps the write idempotent if the same
 * businessId appears twice in the input).
 */
export async function saveAsListAction(
  input: unknown,
): Promise<SaveAsListResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = SaveAsListInput.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    const membership = await callerMembership(session.user.id);
    if (!membership) return { status: "forbidden" };
    const { agencyId, memberId } = membership;

    // The discovery must belong to the caller's agency. Cross-agency / missing
    // reads as forbidden — we never confirm another agency's discovery.
    const discovery = await prisma.discovery.findUnique({
      where: { id: parsed.data.discoveryId },
      select: { id: true, agencyId: true, cellKeys: true },
    });
    if (!discovery || discovery.agencyId !== agencyId) {
      return { status: "forbidden" };
    }

    // Seed category/metro from the discovery's first parseable cellKey (cheap,
    // best-effort — null when the discovery has no cells).
    const firstCell = discovery.cellKeys[0]
      ? parseCellKey(discovery.cellKeys[0])
      : null;

    const uniqueBusinessIds = Array.from(new Set(parsed.data.businessIds));

    const list = await prisma.list.create({
      data: {
        agencyId,
        ownerMemberId: memberId,
        name: parsed.data.name,
        serviceType: DEFAULT_SERVICE_TYPE,
        filterJson: {},
        discoveryId: discovery.id,
        isRaw: false,
        category: firstCell?.categorySlug ?? null,
        metro: firstCell?.metroSlug ?? null,
      },
      select: { id: true },
    });

    await prisma.lead.createMany({
      data: uniqueBusinessIds.map((businessId) => ({
        listId: list.id,
        agencyId,
        businessId,
        status: "NEW" as const,
      })),
      skipDuplicates: true,
    });

    return { status: "ok", listId: list.id };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "discovery.save-as-list.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}

// ── setLeadStatusAction ──────────────────────────────────────────────────────

/**
 * Map a target status to the closed-loop timestamp it stamps. statusChangedAt
 * is always bumped; the per-stage timestamp is set on first transition into that
 * stage (and left as-is otherwise — we don't clear earlier stamps).
 */
function closedLoopStamp(
  status: SaveLeadStatus,
  now: Date,
): Record<string, Date> {
  switch (status) {
    case "CONTACTED":
      return { contactedAt: now };
    case "REPLIED":
      return { repliedAt: now };
    case "WON":
      return { wonAt: now };
    case "LOST":
      return { lostAt: now };
    default:
      return {};
  }
}

/**
 * Flip a lead's status. Agency-scoped: the lead's own `agencyId` must match the
 * caller's agency, else forbidden. Pure DB write — safe in the request path.
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
    const membership = await callerMembership(session.user.id);
    if (!membership) return { status: "forbidden" };

    const lead = await prisma.lead.findUnique({
      where: { id: parsed.data.leadId },
      select: { id: true, agencyId: true },
    });
    // Missing or another agency's lead reads as forbidden.
    if (!lead || lead.agencyId !== membership.agencyId) {
      return { status: "forbidden" };
    }

    const now = new Date();
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        status: parsed.data.status,
        statusChangedAt: now,
        ...closedLoopStamp(parsed.data.status, now),
      },
    });

    return { status: "ok" };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "discovery.set-lead-status.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}
