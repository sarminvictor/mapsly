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
import { trackProductEvent } from "@/lib/analytics/product-events";
import { absoluteUrl } from "@/lib/seo/canonical";
import { createShareLink, viewCountFor } from "@/modules/reports/share";

import { getLeadDetail, type LeadDetail } from "./lead-detail";

const Input = z.object({
  businessId: z.string().min(1).max(64),
  /** The discovery the drawer was opened from — selects whose persisted signals
   *  to evaluate this lead against (P3). Optional: omitted falls back to any
   *  agency discovery holding the lead, then to the heuristic. */
  discoveryId: z.string().min(1).max(64).optional(),
});

export type GetLeadDetailResult =
  | { status: "ok"; lead: LeadDetail }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "invalid_input" }
  | { status: "error" };

export async function getLeadDetailAction(
  businessId: string,
  discoveryId?: string,
): Promise<GetLeadDetailResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = Input.safeParse({ businessId, discoveryId });
  if (!parsed.success) return { status: "invalid_input" };

  try {
    const member = await prisma.agencyMember.findFirst({
      where: { userId: session.user.id },
      select: { agencyId: true },
    });
    if (!member) return { status: "forbidden" };

    const lead = await getLeadDetail(
      parsed.data.businessId,
      member.agencyId,
      parsed.data.discoveryId,
    );
    if (!lead) return { status: "not_found" };

    // WP6-4 · first_lead_drawer_opened — the evidence-reveal aha. Fires on every
    // successful drawer open; the activation query derives the "first" per
    // agency via MIN(createdAt), so we avoid a per-open "is this the first?"
    // read. Fire-and-forget, ids only (no lead PII).
    void trackProductEvent({
      type: "first_lead_drawer_opened",
      agencyId: member.agencyId,
      userId: session.user.id,
      props: {
        businessId: parsed.data.businessId,
        discoveryId: parsed.data.discoveryId ?? null,
      },
    });

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

const ShareInput = z.object({
  businessId: z.string().min(1).max(64),
  discoveryId: z.string().min(1).max(64),
});

export type ShareAuditLinkResult =
  | { status: "ok"; url: string; viewCount: number }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "not_found" }
  | { status: "invalid_input" }
  | { status: "error" };

/**
 * WP6-10 · mint (or reuse) a public, agency-branded share link for this lead's
 * Proof Pack. Auth + agency scope mirror the Proof Pack page exactly: the
 * business must live in one of the calling agency's discovered cells. Returns
 * an absolute URL (origin from NEXT_PUBLIC_APP_ORIGIN) + the current view count
 * ("opened Nx by the prospect"). Idempotent — a second click reuses the link.
 */
export async function shareAuditLinkAction(
  businessId: string,
  discoveryId: string,
): Promise<ShareAuditLinkResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = ShareInput.safeParse({ businessId, discoveryId });
  if (!parsed.success) return { status: "invalid_input" };

  try {
    const member = await prisma.agencyMember.findFirst({
      where: { userId: session.user.id },
      select: { agencyId: true },
    });
    if (!member) return { status: "forbidden" };
    const agencyId = member.agencyId;

    // Discovery belongs to this agency, and the business lives in one of its
    // cells — the same scope guard the Proof Pack page enforces.
    const discovery = await prisma.discovery.findUnique({
      where: { id: parsed.data.discoveryId },
      select: { agencyId: true, cellKeys: true },
    });
    if (!discovery || discovery.agencyId !== agencyId) {
      return { status: "not_found" };
    }
    const biz = await prisma.business.findUnique({
      where: { id: parsed.data.businessId },
      select: { cellKey: true },
    });
    if (!biz?.cellKey || !discovery.cellKeys.includes(biz.cellKey)) {
      return { status: "not_found" };
    }

    const link = await createShareLink(
      agencyId,
      parsed.data.businessId,
      parsed.data.discoveryId,
    );
    const viewCount = await viewCountFor(agencyId, parsed.data.businessId);

    return { status: "ok", url: absoluteUrl(link.path), viewCount };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "lead_detail.share.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}
