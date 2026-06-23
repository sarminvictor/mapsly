/**
 * `/api/agency/jobs` · running background jobs for the HUD JobsTray.
 *
 * GET → `{ jobs: AgencyJob[] }` where each job is a normalized view of a
 * still-running Discovery or EnrichmentRun for the caller's agency, with an
 * X-of-Y progress pair the tray renders. Recently-finished runs (last 60s) are
 * included so the tray can show a brief "done" flash before they drop off.
 *
 * Per `.claude/rules/security.md`:
 *   - Auth-gated · agency resolved from the session, never a query param.
 *   - No cross-agency leak · both queries scope on the resolved agencyId.
 *
 * Per `.claude/rules/scalability.md` · bounded `take`, indexed `(agencyId,…)`.
 * Per `.claude/rules/cost-discipline.md` · no external calls, no CronRun.
 * Per `.claude/rules/performance.md` · `private, no-store` (per-agency data).
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

const RECENT_DONE_WINDOW_MS = 60_000;

export interface AgencyJob {
  id: string;
  kind: "discovery" | "enrichment";
  label: string;
  status: string;
  /** Units done. */
  done: number;
  /** Units total (0 = indeterminate). */
  total: number;
  running: boolean;
  startedAt: string;
}

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const member = await prisma.agencyMember.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: { agencyId: true },
  });
  if (!member) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const agencyId = member.agencyId;
  const recentCutoff = new Date(Date.now() - RECENT_DONE_WINDOW_MS);

  try {
    const [discoveries, enrichments] = await Promise.all([
      prisma.discovery.findMany({
        where: {
          agencyId,
          OR: [
            { status: { in: ["PENDING", "RUNNING"] } },
            { finishedAt: { gte: recentCutoff } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          name: true,
          status: true,
          cellCount: true,
          freshCount: true,
          refetchedCount: true,
          createdAt: true,
        },
      }),
      prisma.enrichmentRun.findMany({
        where: {
          agencyId,
          OR: [
            { status: { in: ["PENDING", "RUNNING"] } },
            { finishedAt: { gte: recentCutoff } },
          ],
        },
        orderBy: { startedAt: "desc" },
        take: 10,
        select: {
          id: true,
          status: true,
          unitsRequested: true,
          unitsCompleted: true,
          startedAt: true,
        },
      }),
    ]);

    const discoveryJobs: AgencyJob[] = discoveries.map((d) => ({
      id: d.id,
      kind: "discovery",
      label: d.name ?? "Discovery",
      status: d.status,
      // Cells "done" = those served-fresh + refetched so far.
      done: Math.min(d.cellCount, d.freshCount + d.refetchedCount),
      total: d.cellCount,
      running: d.status === "PENDING" || d.status === "RUNNING",
      startedAt: d.createdAt.toISOString(),
    }));

    const enrichmentJobs: AgencyJob[] = enrichments.map((e) => ({
      id: e.id,
      kind: "enrichment",
      label: "Enrichment",
      status: e.status,
      done: e.unitsCompleted,
      total: e.unitsRequested,
      running: e.status === "PENDING" || e.status === "RUNNING",
      startedAt: e.startedAt.toISOString(),
    }));

    const jobs = [...discoveryJobs, ...enrichmentJobs].sort(
      (a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt),
    );

    return NextResponse.json(
      { jobs },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
