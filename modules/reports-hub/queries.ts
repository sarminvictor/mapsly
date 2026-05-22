/**
 * Agency reports hub · server query.
 *
 * Surface: `getAgencyReports(userId)` — assembles the full list of
 * Reports the signed-in user's agency has generated. Reports are
 * filed under `Report.agencyId` so the query is one round-trip with
 * an explicit `agencyId` filter (no cross-agency leak possible).
 *
 * Returns `EMPTY_AGENCY_REPORTS` (agencyId === "") for the
 * no-membership / build / failure cases per Pattern 1 of
 * `.claude/rules/cache-components.md` (INC-25, INC-27).
 *
 * Cache strategy:
 *
 *   - `'use cache'` + `cacheLife('minutes')` — Tom may generate
 *     reports and immediately switch tabs to verify; minutes-fresh
 *     keeps the page useful.
 *   - `cacheTag('agency-${agencyId}-reports')` so report-create /
 *     delete actions can invalidate just this surface.
 *   - `cacheTag('agency-${agencyId}')` co-tag for agency-wide
 *     invalidations.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

import {
  EMPTY_AGENCY_REPORTS,
  type AgencyReportsData,
  type ReportRow,
  type ReportStatusValue,
  type ReportTypeValue,
} from "./types";

/** Cap on rows shipped to the page · keeps the payload bounded. */
const MAX_REPORT_ROWS = 100;

export async function getAgencyReports(
  userId: string,
): Promise<AgencyReportsData> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`agency-reports-${userId}`);

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_AGENCY_REPORTS;
  }

  if (!userId || typeof userId !== "string") {
    return EMPTY_AGENCY_REPORTS;
  }

  try {
    const member = await prisma.agencyMember.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        agencyId: true,
        agency: { select: { id: true, name: true } },
      },
    });

    if (!member?.agency) {
      return EMPTY_AGENCY_REPORTS;
    }

    const agencyId = member.agency.id;
    cacheTag(`agency-${agencyId}`);
    cacheTag(`agency-${agencyId}-reports`);

    // Bounded slice · sorted DESC by createdAt. We over-fetch by 1 so
    // we can detect whether the cap truncated the result (drives the
    // page's "showing 100 of N" hint via the counts.total field).
    const reports = await prisma.report.findMany({
      where: { agencyId },
      orderBy: { createdAt: "desc" },
      take: MAX_REPORT_ROWS + 1,
      select: {
        id: true,
        type: true,
        status: true,
        createdAt: true,
        shareExpiresAt: true,
        viewCount: true,
        publicShareId: true,
        storageUrl: true,
        businessId: true,
        listId: true,
      },
    });

    // Backfill business + list names so the row can render
    // "for Solea Brickell" / "for Local SEO · Miami". Two parallel
    // batched lookups instead of N+1 per row.
    const businessIds = Array.from(
      new Set(
        reports.map((r) => r.businessId).filter((id): id is string => !!id),
      ),
    );
    const listIds = Array.from(
      new Set(reports.map((r) => r.listId).filter((id): id is string => !!id)),
    );

    const [businessRows, listRows] = await Promise.all([
      businessIds.length > 0
        ? prisma.business.findMany({
            where: { id: { in: businessIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as { id: string; name: string }[]),
      listIds.length > 0
        ? prisma.list.findMany({
            where: { id: { in: listIds }, agencyId },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as { id: string; name: string }[]),
    ]);

    const businessNameById = new Map(businessRows.map((b) => [b.id, b.name]));
    const listNameById = new Map(listRows.map((l) => [l.id, l.name]));

    const total = reports.length;
    const capped = reports.slice(0, MAX_REPORT_ROWS);

    const rows: ReportRow[] = capped.map((r) => ({
      id: r.id,
      type: r.type as ReportTypeValue,
      status: r.status as ReportStatusValue,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.shareExpiresAt ? r.shareExpiresAt.toISOString() : null,
      viewCount: r.viewCount,
      publicShareId: r.publicShareId,
      storageUrl: r.storageUrl,
      businessId: r.businessId,
      businessName: r.businessId
        ? (businessNameById.get(r.businessId) ?? null)
        : null,
      listId: r.listId,
      listName: r.listId ? (listNameById.get(r.listId) ?? null) : null,
    }));

    let onePager = 0;
    let csv = 0;
    let shareLink = 0;
    for (const r of rows) {
      if (r.type === "PDF_ONE_PAGER") onePager++;
      else if (r.type === "CSV_LIST") csv++;
      else if (r.type === "SHARE_LINK") shareLink++;
    }

    return {
      agencyId,
      agencyName: member.agency.name,
      reports: rows,
      counts: { onePager, csv, shareLink, total },
    };
  } catch {
    return EMPTY_AGENCY_REPORTS;
  }
}
