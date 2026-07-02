// modules/reports/share.ts · WP6-10 · agency-branded prospect one-pager share.
//
// Mints (and resolves) a tokenized public share of the Proof Pack for one
// business, backed by the existing Report model (publicShareId / shareExpiresAt
// / viewCount — no new infra). The public /s/[token] route renders the SAME
// ProofPackSheet the in-portal report uses, branded "Prepared by {Agency} ·
// powered by Mapsly", so every shared audit is a Tom close-signal + a Mapsly ad.
//
//   createShareLink(agencyId, businessId, discoveryId) → { token, url }
//   resolveShareReport(token) → { lead, agencyName, viewCount } | null   (public)
//   viewCountFor(agencyId, businessId) → number                          (drawer)
//
// The token is the 16-digit unguessable id shared by the SMB landing engine
// (modules/smb-landing/token.ts) so possession-of-link is the only auth — same
// capability model as /l and /r. Report.meta carries the discoveryId so the
// public resolver can evaluate the research's signals in the Proof Pack.

import prisma from "@/lib/prisma";
import { generateLandingToken } from "@/modules/smb-landing/token";
import {
  getLeadDetail,
  type LeadDetail,
} from "@/modules/agency-portal/discover/lead-detail";
import { trackProductEvent } from "@/lib/analytics/product-events";

/** How long a fresh share link stays live before expiring. */
const SHARE_TTL_DAYS = 90;

export interface ShareLink {
  token: string;
  /** Path (origin-agnostic) of the public share, e.g. "/s/1234…". */
  path: string;
}

/** Read the discoveryId a share Report stored in `meta` (best-effort). */
function metaDiscoveryId(meta: unknown): string | undefined {
  const o = (meta ?? {}) as Record<string, unknown>;
  return typeof o.discoveryId === "string" ? o.discoveryId : undefined;
}

/**
 * Create (or reuse) a public share link for a business's Proof Pack, scoped to
 * the calling agency. Idempotent: an existing, unexpired SHARE_LINK Report for
 * the same (agency, business) is reused (its token returned) so a second click
 * doesn't mint a new link. Caller MUST have already authorized the agency.
 */
export async function createShareLink(
  agencyId: string,
  businessId: string,
  discoveryId: string,
  now: Date = new Date(),
): Promise<ShareLink> {
  const existing = await prisma.report.findFirst({
    where: {
      agencyId,
      businessId,
      type: "SHARE_LINK",
      publicShareId: { not: null },
      OR: [{ shareExpiresAt: null }, { shareExpiresAt: { gt: now } }],
    },
    select: { publicShareId: true },
    orderBy: { createdAt: "desc" },
  });
  if (existing?.publicShareId) {
    return {
      token: existing.publicShareId,
      path: `/s/${existing.publicShareId}`,
    };
  }

  // Mint a fresh unguessable token; retry once on the (rare) unique collision.
  let token = generateLandingToken();
  const expiresAt = new Date(now.getTime() + SHARE_TTL_DAYS * 86_400_000);
  try {
    await prisma.report.create({
      data: {
        agencyId,
        businessId,
        type: "SHARE_LINK",
        status: "SHARED",
        publicShareId: token,
        shareExpiresAt: expiresAt,
        meta: { discoveryId },
      },
      select: { id: true },
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      token = generateLandingToken();
      await prisma.report.create({
        data: {
          agencyId,
          businessId,
          type: "SHARE_LINK",
          status: "SHARED",
          publicShareId: token,
          shareExpiresAt: expiresAt,
          meta: { discoveryId },
        },
        select: { id: true },
      });
    } else {
      throw err;
    }
  }

  await trackProductEvent({
    type: "audit_shared",
    agencyId,
    props: { businessId, discoveryId },
  });

  return { token, path: `/s/${token}` };
}

export interface ResolvedShare {
  lead: LeadDetail;
  agencyName: string;
  /** Views BEFORE this one (the count surfaced back in the drawer). */
  viewCount: number;
}

/**
 * Resolve a public share token → the Proof Pack payload + agency name, and
 * record the view (increment viewCount + a funnel event). Public/no-auth:
 * possession of the unguessable token is the authorization. Returns null when
 * the token is unknown, expired, or the lead can no longer be loaded (deleted /
 * out of the agency's cells) — the route then 404s.
 *
 * `countView` is false for the owning agency's own preview so a self-check
 * doesn't inflate the "opened Nx by the prospect" signal.
 */
export async function resolveShareReport(
  token: string,
  opts: { countView?: boolean } = {},
  now: Date = new Date(),
): Promise<ResolvedShare | null> {
  const report = await prisma.report.findUnique({
    where: { publicShareId: token },
    select: {
      id: true,
      agencyId: true,
      businessId: true,
      shareExpiresAt: true,
      viewCount: true,
      meta: true,
      agency: { select: { name: true } },
    },
  });
  if (!report || !report.businessId) return null;
  if (report.shareExpiresAt && report.shareExpiresAt <= now) return null;

  const discoveryId = metaDiscoveryId(report.meta);
  const lead = await getLeadDetail(
    report.businessId,
    report.agencyId,
    discoveryId,
  );
  if (!lead) return null;

  const priorViews = report.viewCount;
  if (opts.countView !== false) {
    await prisma.report.update({
      where: { id: report.id },
      data: { viewCount: { increment: 1 } },
      select: { id: true },
    });
    await trackProductEvent({
      type: "audit_link_viewed",
      agencyId: report.agencyId,
      props: { businessId: report.businessId },
    });
  }

  return {
    lead,
    agencyName: report.agency?.name ?? "Your agency",
    viewCount: priorViews,
  };
}

/**
 * The current view count of a business's share link for an agency (0 when no
 * link exists yet). Surfaced in the drawer as "opened Nx by the prospect".
 */
export async function viewCountFor(
  agencyId: string,
  businessId: string,
): Promise<number> {
  const report = await prisma.report.findFirst({
    where: { agencyId, businessId, type: "SHARE_LINK" },
    select: { viewCount: true },
    orderBy: { createdAt: "desc" },
  });
  return report?.viewCount ?? 0;
}
