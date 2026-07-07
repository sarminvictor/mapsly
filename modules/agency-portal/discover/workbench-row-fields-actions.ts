"use server";

/**
 * Step 4 (2026-07-06 render refactor) · LAZY hydration for the workbench's
 * HEAVY row fields.
 *
 * The workbench pages serialize a row's heavy fields (seo / ad counts /
 * serpRank / aiSummary / bookingTool / socials / pitchAngle — see
 * HEAVY_ROW_FIELDS) only while their column is ACTIVE (the `mapsly-wb-cols`
 * cookie). When the user toggles a column on (or the auto-show adds one after
 * a run, or the client CSV export needs `pitchAngle`), the client calls THIS
 * action once for the whole window — the same pattern as the drawer's
 * getLeadDetailAction: pay for the data when it's asked for, not on every
 * visit.
 *
 * The WINDOW is re-resolved server-side from (discoveryId, listId?, page) with
 * EXACTLY the pages' scope + order (rawListWhere incl. the website gate for
 * site goals; the list's lead window) — the client never sends businessIds, so
 * the response can't be steered outside the agency's own scope. Results merge
 * client-side by businessId, so a window that drifted since render simply
 * no-ops for the missing rows.
 *
 * Auth-gated + Zod-validated (`.claude/rules/security.md`): agency from the
 * session, never a param; cross-agency discovery/list reads as not_found. No
 * external API — bounded, deliberate selects only (scalability rule).
 */

import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { rawListWhere } from "@/modules/discovery/raw-list";
import { enrichmentNeedsWebsite } from "@/modules/cost/pricing";
import { researchesForSignals } from "./researches";
import { activeSignalsFromJson } from "./discovery-signals";
import {
  HEAVY_ROW_FIELDS,
  WORKBENCH_WINDOW,
  type HeavyRowField,
  type WorkbenchLeadRow,
} from "./leads-workbench";

const Input = z.object({
  discoveryId: z.string().min(1).max(64),
  /** Present on the saved-list workbench — scopes the window to that list. */
  listId: z.string().min(1).max(64).optional(),
  /** The server window index the client is currently rendering (`?page=`). */
  page: z.number().int().min(1).max(10_000),
  fields: z
    .array(z.enum([...HEAVY_ROW_FIELDS] as [HeavyRowField, ...HeavyRowField[]]))
    .min(1)
    .max(HEAVY_ROW_FIELDS.length),
});

export type WorkbenchRowFieldValues = Partial<
  Pick<WorkbenchLeadRow, HeavyRowField>
>;

export type GetWorkbenchRowFieldsResult =
  | { status: "ok"; values: Record<string, WorkbenchRowFieldValues> }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "invalid_input" }
  | { status: "error" };

/** Social Contact channels surfaced by the Socials column (same set as the
 *  row builder's). */
const SOCIAL_CHANNELS = [
  "INSTAGRAM",
  "FACEBOOK",
  "TIKTOK",
  "YOUTUBE",
  "X",
  "LINKEDIN",
] as const;

const CONFIDENCE_RANK: Record<string, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export async function getWorkbenchRowFieldsAction(
  input: unknown,
): Promise<GetWorkbenchRowFieldsResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = Input.safeParse(input);
  if (!parsed.success) return { status: "invalid_input" };
  const { discoveryId, listId, page, fields } = parsed.data;

  try {
    const member = await prisma.agencyMember.findFirst({
      where: { userId: session.user.id },
      select: { agencyId: true },
    });
    if (!member) return { status: "forbidden" };
    const agencyId = member.agencyId;

    const discovery = await prisma.discovery.findUnique({
      where: { id: discoveryId },
      select: { id: true, agencyId: true, cellKeys: true, signalsJson: true },
    });
    if (!discovery || discovery.agencyId !== agencyId) {
      return { status: "not_found" };
    }

    // Re-resolve the window with EXACTLY the pages' scope + order.
    let ids: string[];
    if (listId) {
      const list = await prisma.list.findUnique({
        where: { id: listId },
        select: { agencyId: true, discoveryId: true },
      });
      if (
        !list ||
        list.agencyId !== agencyId ||
        list.discoveryId !== discovery.id
      ) {
        return { status: "not_found" };
      }
      const leads = await prisma.lead.findMany({
        where: { listId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        skip: (page - 1) * WORKBENCH_WINDOW,
        take: WORKBENCH_WINDOW,
        select: { business: { select: { id: true } } },
      });
      ids = leads.map((l) => l.business.id);
    } else {
      if (discovery.cellKeys.length === 0) {
        return { status: "ok", values: {} };
      }
      const activeSignals = activeSignalsFromJson(discovery.signalsJson);
      const goalNeedsWebsite = enrichmentNeedsWebsite(
        researchesForSignals(activeSignals),
      );
      const businesses = await prisma.business.findMany({
        where: rawListWhere({
          cellKeys: discovery.cellKeys,
          filters: goalNeedsWebsite ? { hasWebsite: true } : undefined,
        }),
        orderBy: [
          { reviewCount: { sort: "desc", nulls: "last" } },
          { id: "asc" },
        ],
        skip: (page - 1) * WORKBENCH_WINDOW,
        take: WORKBENCH_WINDOW,
        select: { id: true },
      });
      ids = businesses.map((b) => b.id);
    }
    if (ids.length === 0) return { status: "ok", values: {} };

    const wants = new Set<HeavyRowField>(fields);
    const values: Record<string, WorkbenchRowFieldValues> = {};
    // Every window row gets an entry for every REQUESTED field (null / [] when
    // no data) — the client marks the field loaded for the whole window, so a
    // no-data cell renders the honest "— enrich" affordance, never a loader
    // that spins forever.
    for (const id of ids) {
      const v: WorkbenchRowFieldValues = {};
      if (wants.has("seo")) v.seo = null;
      if (wants.has("metaAdCount")) v.metaAdCount = null;
      if (wants.has("googleAdCount")) v.googleAdCount = null;
      if (wants.has("serpRank")) v.serpRank = null;
      if (wants.has("aiSummary")) v.aiSummary = null;
      if (wants.has("bookingTool")) v.bookingTool = null;
      if (wants.has("socials")) v.socials = [];
      if (wants.has("pitchAngle")) v.pitchAngle = null;
      values[id] = v;
    }

    // One bounded, deliberate query per REQUESTED field family — the same
    // shapes the row builder's hydration pass reads, scoped to the window.
    await Promise.all([
      wants.has("seo")
        ? prisma.lighthouseAudit
            .findMany({
              where: { businessId: { in: ids } },
              distinct: ["businessId"],
              orderBy: [{ businessId: "asc" }, { auditedAt: "desc" }],
              select: { businessId: true, seo: true },
            })
            .then((rows) => {
              for (const r of rows) values[r.businessId]!.seo = r.seo;
            })
        : Promise.resolve(),
      wants.has("metaAdCount") || wants.has("googleAdCount")
        ? prisma.adLibraryEntry
            .groupBy({
              by: ["businessId", "platform"],
              where: {
                businessId: { in: ids },
                platform: { in: ["META", "GOOGLE"] },
              },
              _count: { _all: true },
            })
            .then((rows) => {
              for (const r of rows) {
                if (!r.businessId) continue;
                const v = values[r.businessId];
                if (!v) continue;
                if (r.platform === "META" && wants.has("metaAdCount")) {
                  v.metaAdCount = r._count._all;
                } else if (
                  r.platform === "GOOGLE" &&
                  wants.has("googleAdCount")
                ) {
                  v.googleAdCount = r._count._all;
                }
              }
            })
        : Promise.resolve(),
      wants.has("serpRank")
        ? prisma.serpResult
            .findMany({
              where: { businessId: { in: ids } },
              select: { businessId: true, localPackRank: true },
              // Best (lowest) rank per business — DISTINCT ON keeps the first
              // (best) row per the order below (the page/builder pattern).
              distinct: ["businessId"],
              orderBy: [
                { businessId: "asc" },
                { localPackRank: { sort: "asc", nulls: "last" } },
              ],
            })
            .then((rows) => {
              for (const r of rows) {
                if (r.businessId && r.localPackRank != null) {
                  values[r.businessId]!.serpRank = r.localPackRank;
                }
              }
            })
        : Promise.resolve(),
      wants.has("aiSummary")
        ? prisma.businessEnrichment
            .findMany({
              where: {
                businessId: { in: ids },
                positioningSummary: { not: null },
              },
              select: { businessId: true, positioningSummary: true },
            })
            .then((rows) => {
              for (const r of rows) {
                if (r.positioningSummary != null) {
                  // Same plain-text strip the row builder applies.
                  values[r.businessId]!.aiSummary =
                    r.positioningSummary.replaceAll("**", "");
                }
              }
            })
        : Promise.resolve(),
      wants.has("bookingTool")
        ? prisma.businessTech
            .findMany({
              where: { businessId: { in: ids }, category: "BOOKING" },
              orderBy: { confidence: "desc" },
              select: { businessId: true, name: true },
            })
            .then((rows) => {
              for (const r of rows) {
                const v = values[r.businessId];
                if (v && v.bookingTool == null) v.bookingTool = r.name;
              }
            })
        : Promise.resolve(),
      wants.has("socials")
        ? prisma.contact
            .findMany({
              where: {
                businessId: { in: ids },
                channel: { in: [...SOCIAL_CHANNELS] },
              },
              select: { businessId: true, channel: true, value: true },
            })
            .then((rows) => {
              for (const r of rows) {
                const v = values[r.businessId];
                if (!v) continue;
                (v.socials ??= []).push({
                  channel: r.channel,
                  value: r.value,
                });
              }
            })
        : Promise.resolve(),
      wants.has("pitchAngle")
        ? prisma.playbookFinding
            .findMany({
              where: { businessId: { in: ids }, status: "flagged" },
              select: { businessId: true, confidence: true, pitchAngle: true },
            })
            .then((rows) => {
              // Strongest pitch angle per business — the builder's exact rule:
              // most-confident-first (JS rank — a DB orderBy on the string
              // sorts alphabetically), first finding WITH a pitch angle wins.
              const ranked = [...rows].sort(
                (a, b) =>
                  (CONFIDENCE_RANK[b.confidence ?? ""] ?? 0) -
                  (CONFIDENCE_RANK[a.confidence ?? ""] ?? 0),
              );
              for (const r of ranked) {
                const v = values[r.businessId];
                if (v && r.pitchAngle && v.pitchAngle == null) {
                  v.pitchAngle = r.pitchAngle;
                }
              }
            })
        : Promise.resolve(),
    ]);

    return { status: "ok", values };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "workbench.row_fields.load.error",
        discoveryId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}
