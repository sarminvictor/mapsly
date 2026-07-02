// modules/outreach/draft-scope.ts · the ONE place OutreachDraft agency scoping
// lives (WP5 draft security, finishing WP0-1).
//
// OutreachDraft.agencyId is nullable (WP0 additive migration): every draft
// created since WP5 carries the generating agency's id; legacy rows are null.
// The transition contract, applied at EVERY read site:
//
//   where: { businessId: { in: cellScopedIds },
//            OR: [{ agencyId }, { agencyId: null }] }
//
// - The strict `agencyId` arm closes the SHARED-cell leak: two agencies who
//   discovered the same cellKey used to see each other's drafts; new rows are
//   now invisible across agencies immediately.
// - The `agencyId: null` arm keeps legacy (pre-WP0) rows reachable — but ONLY
//   inside the caller's own cell scope (every read site already pre-filters
//   businessId to the agency's discovered cells), so a null row is never
//   exposed outside the cells the agency actually discovered. This is the
//   safest transition: no data loss, no cross-agency confirmation.
// - Mutations additionally adopt-on-write: when the legacy cellKey walk proves
//   ownership, the row is backfilled with the caller's agencyId (safe — the
//   mutation path just proved ownership), so the null population only shrinks.
//
// Once scripts/backfill-outreach-draft-agencyid.ts reports 0 resolvable nulls,
// drop the OR-null arm and read `where: { agencyId }` directly.
//
// See docs/mvp-10of10-tracker.md §WP5 + prisma/schema.prisma (OutreachDraft).

import prisma from "@/lib/prisma";
import type { Prisma } from "@/lib/prisma";

/**
 * The transition `where` for OutreachDraft reads: cell-scoped businessIds AND
 * (this agency's rows OR legacy null rows). Spread extra conditions into the
 * result as needed (`{ ...draftWhereForAgency(a, ids), channel: "email" }`).
 */
export function draftWhereForAgency(
  agencyId: string,
  businessIds: readonly string[],
): Prisma.OutreachDraftWhereInput {
  return {
    businessId: { in: [...businessIds] },
    OR: [{ agencyId }, { agencyId: null }],
  };
}

/** The draft fields the mutation guard needs. */
export interface DraftOwnershipRow {
  id: string;
  agencyId: string | null;
  businessId: string;
}

/**
 * May `agencyId` mutate this draft?
 *
 * - Stamped draft → strict equality, one comparison, no extra queries.
 * - Legacy null draft → the pre-WP5 cellKey walk (business.cellKey must sit in
 *   one of the agency's discovered cells); on success the row is
 *   OPPORTUNISTICALLY BACKFILLED with the agencyId (adopt-on-write — safe
 *   because ownership was just proven), so the next check is the fast path.
 */
export async function canAgencyMutateDraft(
  agencyId: string,
  draft: DraftOwnershipRow,
): Promise<boolean> {
  if (draft.agencyId !== null) return draft.agencyId === agencyId;

  const business = await prisma.business.findUnique({
    where: { id: draft.businessId },
    select: { cellKey: true },
  });
  const cellKey = business?.cellKey;
  if (!cellKey) return false;

  const discoveries = await prisma.discovery.findMany({
    where: { agencyId },
    select: { cellKeys: true },
  });
  const owns = discoveries.some((d) => d.cellKeys.includes(cellKey));
  if (!owns) return false;

  // Adopt-on-write: ownership proven → stamp the row. Best-effort (a failed
  // backfill must not block the mutation it was gating).
  try {
    await prisma.outreachDraft.update({
      where: { id: draft.id },
      data: { agencyId },
      select: { id: true },
    });
  } catch {
    // Row deleted in a race — the caller's mutation will surface that itself.
  }
  return true;
}

/** The concrete draft row loadAgencyDrafts returns (a fixed superset the
 *  CSV/regenerate/polish actions all read from). */
export interface ScopedDraftRow {
  id: string;
  agencyId: string | null;
  businessId: string;
  channel: string;
  subject: string | null;
  body: string;
  predictedTier: string | null;
  whyJson: unknown;
}

/**
 * Load a set of drafts by id, filtered to what `agencyId` may see: stamped
 * rows must match; legacy null rows must belong to a business inside the
 * agency's discovered cells. Used by the CSV/regenerate/polish actions that
 * take raw draftId lists from the client. Fixed (small) select — callers
 * read the fields they need.
 */
export async function loadAgencyDrafts(
  agencyId: string,
  draftIds: readonly string[],
): Promise<ScopedDraftRow[]> {
  if (draftIds.length === 0) return [];
  const rows = await prisma.outreachDraft.findMany({
    where: {
      id: { in: [...draftIds] },
      OR: [{ agencyId }, { agencyId: null }],
    },
    select: {
      id: true,
      agencyId: true,
      businessId: true,
      channel: true,
      subject: true,
      body: true,
      predictedTier: true,
      whyJson: true,
    },
  });

  const nullRows = rows.filter((r) => r.agencyId === null);
  if (nullRows.length === 0) return rows;

  // Verify legacy rows through the cell walk (one discoveries read + one
  // businesses read for the whole batch).
  const discoveries = await prisma.discovery.findMany({
    where: { agencyId },
    select: { cellKeys: true },
  });
  const cells = new Set(discoveries.flatMap((d) => d.cellKeys));
  const businesses = await prisma.business.findMany({
    where: { id: { in: [...new Set(nullRows.map((r) => r.businessId))] } },
    select: { id: true, cellKey: true },
  });
  const inCell = new Set(
    businesses
      .filter((b) => b.cellKey && cells.has(b.cellKey))
      .map((b) => b.id),
  );

  return rows.filter(
    (r) => r.agencyId === agencyId || inCell.has(r.businessId),
  );
}
