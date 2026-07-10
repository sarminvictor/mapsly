/**
 * `/api/agency/jobs` · running background jobs for the HUD JobsTray.
 *
 * GET → `{ jobs: AgencyJob[] }` where each job is a normalized view of a
 * still-running Discovery or EnrichmentRun for the caller's agency, with an
 * X-of-Y progress pair the tray renders. Recently-finished runs (last 60s) are
 * included so the tray can show a brief "done" flash before they drop off.
 *
 * GET `?runId=<id>` ALSO returns `{ stages: EnrichStage[] }` — a per-stage
 * rollup of that run's EnrichmentJob rows grouped into the display stages the
 * Enriching step renders (ONLY the stages this run actually performs; first-
 * touch drafts are NOT enrichment and are never listed here). Families that
 * produce job rows (CONTACTS / SERVICES / REVIEWS / AI_RESEARCH) report real
 * done/total; families that run inline or post-close (mapping, per-cell
 * tech/lighthouse, the playbook) have no job rows and gate on the run lifecycle
 * instead — honest either way.
 *
 * Per `.claude/rules/security.md`:
 *   - Auth-gated · agency resolved from the session, never a query param.
 *   - No cross-agency leak · every query scopes on the resolved agencyId
 *     (the optional runId is re-checked to belong to that agency).
 *
 * Per `.claude/rules/scalability.md` · bounded `take`, indexed `(agencyId,…)`.
 * Per `.claude/rules/cost-discipline.md` · no external calls, no CronRun.
 * Per `.claude/rules/performance.md` · `private, no-store` (per-agency data).
 */

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { buildTechStageLabel, STAGE_DEFS } from "./stage-label";

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

/** One display stage of the Enriching step's checklist (only stages the run
 *  actually performs are emitted — never a fixed full list). */
export interface EnrichStage {
  key: string;
  label: string;
  done: number;
  total: number;
  status: "done" | "running" | "pending";
}

// STAGE_DEFS (the candidate display stages) lives in ./stage-label — a bare,
// prisma-free module — so the "no Draft-first-touches / no overclaim" honesty
// invariant is unit-testable without importing next-auth + prisma. route.ts
// emits ONLY the subset this run actually performs (see buildEnrichStages).

export async function GET(request: Request): Promise<NextResponse> {
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
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId");
  // 2026-07-10 · Neon-load cut. EnrichingStep polls this every few seconds for
  // ONE run's stage checklist and never uses the JobsTray `jobs` array — yet the
  // full path runs 2 extra findMany (discoveries + enrichments, ≤10 rows each)
  // every poll. `?stagesOnly=1` skips those and returns ONLY `{ stages }`, cutting
  // a watching user's per-poll DB reads from ~5 to ~3. The tray (which needs
  // `jobs`) simply omits the flag.
  const stagesOnly = url.searchParams.get("stagesOnly") === "1";

  try {
    if (runId && stagesOnly) {
      const stages = await buildEnrichStages(runId, agencyId);
      return NextResponse.json(
        { stages },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }

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

    // Optional per-stage rollup for one run (the Enriching step's checklist).
    let stages: EnrichStage[] | undefined;
    if (runId) {
      stages = await buildEnrichStages(runId, agencyId);
    }

    return NextResponse.json(stages ? { jobs, stages } : { jobs }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

/**
 * Build the 6-stage rollup for one EnrichmentRun, agency-scoped (the run must
 * belong to `agencyId` or we return all-pending stages — never another agency's
 * data). Real per-family done/total comes from EnrichmentJob.groupBy; stages
 * whose families produce no job rows gate on the run lifecycle.
 */
async function buildEnrichStages(
  runId: string,
  agencyId: string,
): Promise<EnrichStage[]> {
  const run = await prisma.enrichmentRun.findFirst({
    where: { id: runId, agencyId },
    select: { status: true, enrichmentsJson: true },
  });
  // Cross-agency / missing run → all pending (no leak, graceful).
  if (!run) {
    return STAGE_DEFS.map((d) => ({
      key: d.key,
      label: d.label,
      done: 0,
      total: 0,
      status: "pending" as const,
    }));
  }

  const fannedOut =
    run.status === "RUNNING" ||
    run.status === "OK" ||
    run.status === "PARTIAL" ||
    run.status === "FAILED";
  const finished = run.status === "OK" || run.status === "PARTIAL";

  // Real per-family job rollup. DONE + SKIPPED_FRESH are both "done" (a
  // skipped-fresh unit needed no work). QUEUED/RUNNING are still outstanding.
  const grouped = await prisma.enrichmentJob.groupBy({
    by: ["family", "status"],
    where: { runId },
    _count: { _all: true },
  });
  const familyTotals = new Map<string, { done: number; total: number }>();
  for (const g of grouped) {
    const entry = familyTotals.get(g.family) ?? { done: 0, total: 0 };
    const n = g._count._all;
    entry.total += n;
    if (
      g.status === "DONE" ||
      g.status === "SKIPPED_FRESH" ||
      g.status === "CHARGED_FROM_DB" ||
      g.status === "SKIPPED_ENTITLED"
    )
      entry.done += n;
    familyTotals.set(g.family, entry);
  }

  // Honest checklist: show ONLY the stages this run actually performs.
  //  - "mapped": discovery always ran.
  //  - "contacts": the CONTACTS fetch (also fingerprints tech) — when contacts
  //    or tech is requested.
  //  - "tech": the DOM/tech fingerprint (rides the CONTACTS fetch) + the
  //    per-business Lighthouse audit — when tech or lighthouse is requested.
  //  - "reviews": only when reviews were selected.
  //  - "expert": playbooks auto-run ($0) for every business that got ANY
  //    per-business enrichment job (dispatch.ts closeRunIfDone runs the expert
  //    layer for every business with a DONE job, regardless of family).
  //  - "touches": NEVER part of enrichment — first-touch drafts are a separate
  //    user action on the Touchpoints tab — so it is omitted here entirely.
  const types = (
    Array.isArray(run.enrichmentsJson) ? run.enrichmentsJson : []
  ) as string[];
  const has = (t: string) => types.includes(t);
  // A run produces per-business jobs (hence an expert/playbook pass at close)
  // for ANY per-business family. LIGHTHOUSE is one such family (buildJobPlan),
  // so a lighthouse-only run DOES fan out jobs + run playbooks → the expert
  // stage must show. Omitting lighthouse here dropped the expert row on a
  // lighthouse-only run even though playbooks ran (WP10-4 · latent mismatch).
  const perBusiness =
    has("contacts") ||
    has("tech") ||
    has("lighthouse") ||
    has("reviews") ||
    has("services") ||
    has("ai_research");
  const activeKeys = new Set<string>(["mapped"]);
  if (has("contacts") || has("tech")) activeKeys.add("contacts");
  if (has("tech") || has("lighthouse")) activeKeys.add("tech");
  if (has("reviews")) activeKeys.add("reviews");
  if (perBusiness) activeKeys.add("expert");

  return STAGE_DEFS.filter((def) => activeKeys.has(def.key)).map((def) => {
    let done = 0;
    let total = 0;
    for (const fam of def.families) {
      const t = familyTotals.get(fam);
      if (t) {
        done += t.done;
        total += t.total;
      }
    }

    // A stage with real job rows reports its true done/total; one without
    // (no job rows for its families) gates on the run lifecycle so the
    // checklist still advances honestly.
    let status: EnrichStage["status"];
    if (total > 0) {
      status = done >= total ? "done" : done > 0 ? "running" : "pending";
    } else if (def.key === "mapped") {
      // Mapping completes the moment fan-out flips the run RUNNING.
      status = fannedOut ? "done" : "pending";
    } else {
      // Inline/post-close family with no rows in THIS run: done when finished,
      // running once fan-out happened, else pending.
      status = finished ? "done" : fannedOut ? "running" : "pending";
    }

    const label =
      def.key === "tech"
        ? buildTechStageLabel(has("tech"), has("lighthouse"))
        : def.label;

    return { key: def.key, label, done, total, status };
  });
}
