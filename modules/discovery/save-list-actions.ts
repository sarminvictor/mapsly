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
 *   - setLeadStatusBulkAction · WP5-9: the same mutation for N ids in ONE
 *     transaction (updateMany + createMany lazy-create for bare businessIds)
 *     instead of N per-id server-action round-trips. Returns per-id failures
 *     so the optimistic UI can revert exactly what didn't land.
 */

import { z } from "zod";

import { auth } from "@/lib/auth";
import { parseCellKey } from "@/lib/cell";
import prisma from "@/lib/prisma";
import type { Prisma } from "@/lib/prisma";
import {
  ACTION_MUTATE_LIMIT,
  rateLimitAction,
} from "@/lib/middleware/rate-limit";
import { trackProductEvent } from "@/lib/analytics/product-events";

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
  /**
   * Optional — the discovery this lead is being triaged from. The demand-flow
   * workbench shows every discovered business, but a `Lead` row (required:
   * `Lead.listId` is non-null) only exists for businesses explicitly saved via
   * `saveAsListAction`. For an unsaved row the workbench passes the BUSINESS id
   * as `leadId` (see app/[locale]/(agency)/discover/[discoveryId]/page.tsx's
   * `leadId: lead?.id ?? b.id`) — without `discoveryId`, that id never resolves
   * to a Lead and the status click fails ("Couldn't update the lead"). When
   * provided and the initial Lead lookup misses, we upsert a Lead into this
   * discovery's auto-created RAW list (List.isRaw) instead of failing. Callers
   * that always pass a real Lead id (e.g. TouchpointsTab) can omit this.
   */
  discoveryId: z.string().min(1).max(64).optional(),
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
  | { status: "rate_limited"; retryAfter: number }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

export type SetLeadStatusBulkResult =
  | { status: "ok"; updated: number; failedIds: string[] }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "rate_limited"; retryAfter: number }
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
 * Find (or lazily create) the discovery's auto-managed RAW list — the implicit
 * "every discovered business is a triageable lead" list the demand-flow
 * workbench needs so a status click works WITHOUT an explicit "Save as list"
 * step first. One per discovery (idempotent: a concurrent double-create is
 * caught by the retry below rather than by a unique constraint, since
 * `List` has no unique key on `discoveryId` — the rare race just leaves two
 * raw lists, harmless, and the next call reuses the first found).
 */
async function getOrCreateRawList(
  agencyId: string,
  memberId: string,
  discoveryId: string,
): Promise<string> {
  const existing = await prisma.list.findFirst({
    where: { agencyId, discoveryId, isRaw: true },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.list.create({
    data: {
      agencyId,
      ownerMemberId: memberId,
      name: "Raw discovery",
      serviceType: DEFAULT_SERVICE_TYPE,
      filterJson: {},
      discoveryId,
      isRaw: true,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Flip a lead's status. Agency-scoped: the lead's own `agencyId` must match the
 * caller's agency, else forbidden. Pure DB write — safe in the request path.
 *
 * FALLBACK (the demand-flow workbench shows every discovered business, most of
 * which have no `Lead` row yet — see `SetLeadStatusInput.discoveryId` doc):
 * when `leadId` doesn't resolve to an existing Lead AND `discoveryId` was
 * given, treat `leadId` as a Business id, verify it belongs to that discovery's
 * agency, and upsert a Lead into the discovery's raw list instead of failing.
 */
export async function setLeadStatusAction(
  input: unknown,
): Promise<SetLeadStatusResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  // WP8-2 · bound status-flip floods (bursty triage is fine; runaway is not).
  const rl = await rateLimitAction(ACTION_MUTATE_LIMIT, session.user.id);
  if (rl.limited) return { status: "rate_limited", retryAfter: rl.retryAfter };

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

    const now = new Date();
    const lead = await prisma.lead.findUnique({
      where: { id: parsed.data.leadId },
      select: { id: true, agencyId: true, status: true, businessId: true },
    });

    if (lead) {
      // Another agency's lead reads as forbidden — never confirm its existence.
      if (lead.agencyId !== membership.agencyId) {
        return { status: "forbidden" };
      }
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          status: parsed.data.status,
          statusChangedAt: now,
          ...closedLoopStamp(parsed.data.status, now),
        },
      });
      // WP6-14 · outcome feedback. Record the transition (from → to) so the
      // research-page correlation card can pair status against the signals that
      // fired for the lead (joined at query time from PlaybookFinding — kept off
      // this hot write path). Fire-and-forget, ids only (userId = attribution).
      void trackProductEvent({
        type: "status_changed",
        agencyId: membership.agencyId,
        userId: session.user.id,
        props: {
          businessId: lead.businessId,
          from: lead.status,
          to: parsed.data.status,
        },
      });
      return { status: "ok" };
    }

    // No Lead with this id — try the businessId fallback (workbench-only path).
    if (!parsed.data.discoveryId) {
      return { status: "forbidden" };
    }

    const discovery = await prisma.discovery.findUnique({
      where: { id: parsed.data.discoveryId },
      select: { id: true, agencyId: true },
    });
    if (!discovery || discovery.agencyId !== membership.agencyId) {
      return { status: "forbidden" };
    }

    const business = await prisma.business.findUnique({
      where: { id: parsed.data.leadId },
      select: { id: true },
    });
    if (!business) return { status: "forbidden" };

    const listId = await getOrCreateRawList(
      membership.agencyId,
      membership.memberId,
      discovery.id,
    );

    await prisma.lead.upsert({
      where: { listId_businessId: { listId, businessId: business.id } },
      create: {
        listId,
        agencyId: membership.agencyId,
        businessId: business.id,
        status: parsed.data.status,
        statusChangedAt: now,
        ...closedLoopStamp(parsed.data.status, now),
      },
      update: {
        status: parsed.data.status,
        statusChangedAt: now,
        ...closedLoopStamp(parsed.data.status, now),
      },
    });

    // WP6-14 · outcome feedback for the workbench fallback (bare businessId) —
    // the lead was just created/updated, so `from` is unknown (null).
    void trackProductEvent({
      type: "status_changed",
      agencyId: membership.agencyId,
      userId: session.user.id,
      props: {
        businessId: business.id,
        from: null,
        to: parsed.data.status,
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

// ── setLeadStatusBulkAction (WP5-9) ──────────────────────────────────────────

const SetLeadStatusBulkInput = z.object({
  /** Lead ids — or bare BUSINESS ids for unsaved workbench rows (see the
   *  `SetLeadStatusInput.discoveryId` doc; same fallback, batched). */
  leadIds: z.array(z.string().min(1).max(64)).min(1).max(500),
  status: LeadStatusEnum,
  discoveryId: z.string().min(1).max(64).optional(),
});

export type SetLeadStatusBulkInputType = z.input<typeof SetLeadStatusBulkInput>;

/**
 * Flip N leads' statuses in one transaction (a 40-lead sweep is one call, not
 * 40). Mirrors setLeadStatusAction exactly:
 *
 *   1. ids resolving to Leads in the caller's agency → one `updateMany`.
 *   2. Misses + `discoveryId` → treat as business ids, verify the discovery
 *      belongs to the agency and the businesses exist, then lazy-create into
 *      the discovery's raw list (`createMany` skipDuplicates + `updateMany`
 *      for rows that already existed).
 *   3. Everything else → returned in `failedIds` (the client reverts those
 *      optimistic pills only).
 *
 * Note: `updateMany` stamps ALL matched leads' closed-loop timestamps for the
 * target stage. setLeadStatusAction has the same semantics per call (the
 * stamp object always overwrites) — first-transition-wins refinement is
 * tracked with the WP5-8 `changedByUserId` column follow-up. Attribution:
 * the acting userId is logged on every bulk change (no Lead schema change —
 * Lead has no changedBy column; see docs/seat-model.md).
 */
export async function setLeadStatusBulkAction(
  input: unknown,
): Promise<SetLeadStatusBulkResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  // WP8-2 · one bulk call already collapses N flips into one transaction, but
  // still bound the number of bulk CALLS per minute.
  const rl = await rateLimitAction(ACTION_MUTATE_LIMIT, session.user.id);
  if (rl.limited) return { status: "rate_limited", retryAfter: rl.retryAfter };

  const parsed = SetLeadStatusBulkInput.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    const membership = await callerMembership(session.user.id);
    if (!membership) return { status: "forbidden" };

    const now = new Date();
    const ids = Array.from(new Set(parsed.data.leadIds));
    const patch = {
      status: parsed.data.status,
      statusChangedAt: now,
      ...closedLoopStamp(parsed.data.status, now),
    };

    // 1 · ids that ARE leads in this agency (one read for the whole batch).
    const leads = await prisma.lead.findMany({
      where: { id: { in: ids }, agencyId: membership.agencyId },
      select: { id: true },
    });
    const leadIds = leads.map((l) => l.id);
    const leadIdSet = new Set(leadIds);
    const misses = ids.filter((id) => !leadIdSet.has(id));

    // 2 · misses → businessId fallback (workbench-only path), batched.
    let fallbackBusinessIds: string[] = [];
    let listId: string | null = null;
    if (misses.length > 0 && parsed.data.discoveryId) {
      const discovery = await prisma.discovery.findUnique({
        where: { id: parsed.data.discoveryId },
        select: { id: true, agencyId: true },
      });
      if (discovery && discovery.agencyId === membership.agencyId) {
        const businesses = await prisma.business.findMany({
          where: { id: { in: misses } },
          select: { id: true },
        });
        fallbackBusinessIds = businesses.map((b) => b.id);
        if (fallbackBusinessIds.length > 0) {
          listId = await getOrCreateRawList(
            membership.agencyId,
            membership.memberId,
            discovery.id,
          );
        }
      }
    }

    // One transaction for every write: existing leads, lazy-created raw-list
    // leads, and the update for fallback rows createMany skipped (they
    // already existed in the raw list).
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    if (leadIds.length > 0) {
      ops.push(
        prisma.lead.updateMany({
          where: { id: { in: leadIds } },
          data: patch,
        }),
      );
    }
    if (listId && fallbackBusinessIds.length > 0) {
      ops.push(
        prisma.lead.createMany({
          data: fallbackBusinessIds.map((businessId) => ({
            listId: listId as string,
            agencyId: membership.agencyId,
            businessId,
            ...patch,
          })),
          skipDuplicates: true,
        }),
        prisma.lead.updateMany({
          where: { listId, businessId: { in: fallbackBusinessIds } },
          data: patch,
        }),
      );
    }
    if (ops.length > 0) await prisma.$transaction(ops);

    const fallbackSet = new Set(fallbackBusinessIds);
    const failedIds = misses.filter((id) => !fallbackSet.has(id));
    const updated = leadIds.length + fallbackBusinessIds.length;

    // Per-member attribution (docs/seat-model.md): Lead carries no changedBy
    // column yet, so the acting user is recorded in the action log.
    console.log(
      JSON.stringify({
        level: "info",
        event: "discovery.set-lead-status.bulk",
        userId: session.user.id,
        agencyId: membership.agencyId,
        status: parsed.data.status,
        updated,
        failed: failedIds.length,
      }),
    );

    return { status: "ok", updated, failedIds };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "discovery.set-lead-status-bulk.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}
