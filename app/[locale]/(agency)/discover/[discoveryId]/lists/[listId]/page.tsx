/**
 * Agency leads WORKBENCH ·
 * `/(agency)/discover/[discoveryId]/lists/[listId]` (the heart of the portal).
 *
 * A saved list opened as a two-tab workspace (Leads · Touchpoints) sharing one
 * set of Lead rows. The Leads tab is a dense power table (search · group-by-cell
 * · Comfortable/Compact density · vs-cell deltas · Fields menu · filter chips ·
 * coverage line · sortable cols · numbered pagination · bulk bar). The
 * Touchpoints tab groups the generated OutreachDrafts by business into expandable
 * grounded sequences. Built on the ported prototype classes (agency-portal.css)
 * + the adopted agency primitives (StatusPill, BulkActionBar).
 *
 * The entire side-load → maps → rows/touches/stats pipeline lives in the ONE
 * shared `buildWorkbenchRows` (modules/agency-portal/discover/workbench-rows.ts)
 * — this page only resolves the SCOPE (auth · list ownership · the lead window)
 * and the header. The 2026-07-06 refactor retired this page's near-verbatim
 * copy of the market workbench pipeline, which had drifted: seo / metaAdCount /
 * googleAdCount / serpRank / aiSummary / bookingTool were hardcoded null here
 * (their Fields-menu columns rendered "— enrich" over data that exists), tech
 * loaded CMS-only, ads were presence-only, and vs-cell bands were cohort-only.
 * All of those are REAL on this page now — same values as the market workbench.
 *
 * Match % comes from `Lead.matchScore` when stored, else is DERIVED from the
 * count of flagged PlaybookFindings (see deriveMatchPct). Pain-point chips and
 * "why this works" come from flagged PlaybookFindings grouped by signal group.
 *
 * Per `.claude/rules/cache-components.md`:
 *   - Pattern 2 · default export is SYNC; the async body (auth + DB) lives in a
 *     Suspense boundary so the shell prerenders.
 *   - Pattern 4 · no function props cross the client boundary — rows/touches/
 *     stats are plain serialized data; the client components import their own
 *     server actions.
 *   - Pattern 5 · no `export const dynamic`; Suspense is the dynamic signal.
 *
 * Auth: no session → `unauthorized()`; session but no AgencyMember →
 * `redirect('/home')`. A list owned by a different agency — or one whose
 * discoveryId doesn't match the route — reads as not-found (`notFound()`); we
 * never confirm another agency's data. Every query is scoped by agencyId so a
 * cross-agency leak is impossible (`.claude/rules/security.md`).
 *
 * Copy is English-only for now (the app runs English-only — see i18n/routing.ts).
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound, unauthorized } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import prisma from "@/lib/prisma";
import { cellFreshnessState, parseCellKey } from "@/lib/cell";
import {
  WORKBENCH_WINDOW,
  WB_COLS_COOKIE,
  defaultActiveColumnsForGoal,
  heavyFieldsForColumns,
  parseWbColsCookie,
} from "@/modules/agency-portal/discover/leads-workbench";
import {
  buildWorkbenchRows,
  csvSlug,
  parsePageParam,
  prettyCell,
  relativeDays,
  WORKBENCH_BUSINESS_SELECT,
} from "@/modules/agency-portal/discover/workbench-rows";
import {
  activeSignalsFromJson,
  allLibrarySignals,
  goalMetaFromJson,
} from "@/modules/agency-portal/discover/discovery-signals";
import {
  SIG_META,
  templateByKey,
} from "@/modules/agency-portal/discover/goal-templates";
import { researchesForSignals } from "@/modules/agency-portal/discover/researches";
import { WorkspaceHeader } from "@/modules/agency-portal/discover/components/WorkspaceHeader";
import {
  WorkbenchShell,
  type WorkbenchShellProps,
} from "@/modules/agency-portal/discover/components/WorkbenchShell";
import { LiveRunGate } from "@/modules/agency-portal/discover/components/LiveRunGate";
import {
  resolveActiveRunForDiscovery,
  resolveSpendCreditsForDiscovery,
} from "@/modules/agency-portal/discover/active-run";

export const metadata: Metadata = {
  title: "Workbench · Mapsly",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string; discoveryId: string; listId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

// Server fetch-window (WP4-4): ONE window of WORKBENCH_WINDOW (1000) leads per
// request, at the offset the awaited `?page=` searchParam selects (Pattern 3 ·
// awaited INSIDE the Suspense boundary). Page 1 is identical to the old
// MAX_LEADS ceiling; every lead beyond it is now reachable via the pager's
// window crossing (+ the server export route streams the full set). See
// WORKBENCH_WINDOW (leads-workbench.ts) for the window-size rationale.

// The curated signal library's {key,title} option list — built ONCE (pure over
// SIG_META). The "+ Signal" picker's option list (#2).
const LIBRARY_OPTIONS = allLibrarySignals();

export default function ListWorkbenchPage({ params, searchParams }: PageProps) {
  return (
    <Suspense fallback={null}>
      <ListWorkbenchBody params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ListWorkbenchBody({ params, searchParams }: PageProps) {
  const { locale, discoveryId, listId } = await params;
  setRequestLocale(locale);
  // Pattern 3 (cache-components.md): request-time searchParams are awaited
  // INSIDE the Suspense boundary, never on it.
  const requestedPage = parsePageParam((await searchParams).page);

  const session = await auth();
  if (!session?.user?.id) unauthorized();

  const member = await prisma.agencyMember.findFirst({
    where: { userId: session.user.id },
    select: { agencyId: true },
  });
  if (!member) {
    redirect({ href: "/home", locale });
    return null;
  }
  const agencyId = member.agencyId;

  // Load the list meta + total lead count first (WP4-4 — the count drives the
  // window clamp + the header totals). Scoped by listId; agency ownership is
  // checked immediately after.
  const list = await prisma.list.findUnique({
    where: { id: listId },
    select: {
      id: true,
      agencyId: true,
      name: true,
      discoveryId: true,
      serviceType: true,
      metro: true,
      category: true,
      lastRefreshedAt: true,
      _count: { select: { leads: true } },
    },
  });

  // Cross-agency, missing, or a list that doesn't belong to this discovery all
  // read as not-found — we never confirm another agency's data.
  if (!list || list.agencyId !== agencyId || list.discoveryId !== discoveryId) {
    notFound();
  }

  // Server window (WP4-4): clamp the requested `?page=` into range, then fetch
  // ONE window of leads. The `id` tiebreaker keeps skip/take windows
  // non-overlapping when createdAt collides (bulk-saved lists). The business
  // select is the shared WORKBENCH_BUSINESS_SELECT — one query feeds both the
  // row builder and the signal hydration.
  const totalLeads = list._count.leads;
  const serverPageCount = Math.max(1, Math.ceil(totalLeads / WORKBENCH_WINDOW));
  const serverPage = Math.min(requestedPage, serverPageCount);

  const leads = await prisma.lead.findMany({
    where: { listId: list.id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    skip: (serverPage - 1) * WORKBENCH_WINDOW,
    take: WORKBENCH_WINDOW,
    select: {
      id: true,
      status: true,
      matchScore: true,
      contactedAt: true,
      business: { select: WORKBENCH_BUSINESS_SELECT },
    },
  });

  // The list belongs to a discovery; that discovery's persisted signals are the
  // research's chosen set (P3). signalsJson absent / no signals → empty
  // ActiveSignal[] → the per-row fallback keeps the stored-score/heuristic path.
  const discoveryRow = await prisma.discovery.findUnique({
    where: { id: discoveryId },
    select: {
      signalsJson: true,
      cellKeys: true,
      finishedAt: true,
      createdAt: true,
    },
  });
  const activeSignals = activeSignalsFromJson(discoveryRow?.signalsJson);

  // The goal's active signals (key + title) — drives the per-signal verdict
  // columns (see the discoveryId workspace page for the full rationale).
  const goalSignals = activeSignals
    .map((s) => {
      const title = SIG_META[s.key]?.title;
      return title ? { key: s.key, title } : null;
    })
    .filter((s): s is { key: string; title: string } => s !== null);
  // WB-COL-1 · goal's research families → default the goal's data columns on.
  const goalResearches = researchesForSignals(activeSignals);

  // Step 4 · column-driven serialization (see the workspace page): the
  // cookie's active-column set decides which HEAVY fields ship in the first
  // paint; the rest hydrate lazily on column toggle.
  const wbCols = parseWbColsCookie(
    (await cookies()).get(WB_COLS_COOKIE)?.value,
  );
  const serializeHeavyFields = heavyFieldsForColumns(
    wbCols ?? defaultActiveColumnsForGoal(goalResearches),
  );

  // ── The ONE shared pipeline (rows + touches + stats + bands + coverage) ────
  const data = await buildWorkbenchRows(
    { kind: "list", leads },
    {
      agencyId,
      discoveryId,
      cellKeys: discoveryRow?.cellKeys ?? [],
      activeSignals,
      serializeHeavyFields,
    },
  );

  // WP4-1 · live workbench — poll + refresh new rows while an enrichment run for
  // this discovery is in flight (resolved by cellKey overlap; see active-run.ts).
  const activeRun = await resolveActiveRunForDiscovery(
    agencyId,
    discoveryId,
    discoveryRow?.cellKeys ?? [],
  );

  // CSV export filename base: "{categorySlug}-{metroSlug}" from the first
  // lead's cell (WP2-4) — the client appends the date; falls back to the
  // list's own category/metro strings, then to the client default.
  const firstLeadCell = leads[0]?.business.cellKey
    ? parseCellKey(leads[0].business.cellKey)
    : null;
  const exportSlug = firstLeadCell
    ? `${csvSlug(firstLeadCell.categorySlug)}-${csvSlug(firstLeadCell.metroSlug)}`
    : list.category && list.metro
      ? `${csvSlug(list.category)}-${csvSlug(list.metro)}`
      : undefined;

  const shell: WorkbenchShellProps = {
    leads: {
      rows: data.rows,
      discoveryId,
      bands: data.bands,
      coverageTypeStates: data.coverageTypeStates,
      scannedAt: data.scannedAt,
      goalSignals,
      goalResearches,
      // #2 · the full curated library for the "+ Signal" picker (gated to those
      // with data on every lead, client-side).
      allSignals: LIBRARY_OPTIONS,
      exportSlug,
      serverPage,
      serverPageCount,
      totalRows: totalLeads,
      // Streams THIS list's full set (WP4-4) — same 13 columns, scoped by
      // ?list= inside the discovery export route.
      exportAllUrl: `/api/agency/research/${discoveryId}/export?list=${listId}`,
      // Step 4 · which HEAVY fields this payload carries + the list scope for
      // the lazy row-fields action (its window is this list's leads).
      serializedRowFields: [...serializeHeavyFields],
      listId,
    },
    touchpoints: { touches: data.touches, stats: data.stats },
  };

  const cellKey = leads[0]?.business.cellKey ?? null;
  const title = cellKey ? prettyCell(cellKey) : list.name;

  // The research goal for the header pill (WP4-14): the persisted goal name,
  // else the base template's title, else no pill (older discoveries).
  const goalMeta = goalMetaFromJson(discoveryRow?.signalsJson);
  const goalName =
    goalMeta.goalName ??
    (goalMeta.goalBase
      ? (templateByKey(goalMeta.goalBase)?.title ?? null)
      : null);

  // Meta line: mapped freshness (list refresh, else the parent research's
  // mapped date) + the research's spend-to-date credits.
  const now = new Date();
  const mappedAt =
    list.lastRefreshedAt ??
    discoveryRow?.finishedAt ??
    discoveryRow?.createdAt ??
    null;
  const freshness = mappedAt ? cellFreshnessState(mappedAt, now) : "never";
  const credits = discoveryRow?.cellKeys?.length
    ? await resolveSpendCreditsForDiscovery(
        agencyId,
        discoveryId,
        discoveryRow.cellKeys,
      )
    : 0;

  return (
    <div className="view full">
      {/* WP4-14 · shared workspace header — goal pill + narrative count
          ("the 1,412 leads in this list · showing 1,000"), list name +
          service kept as the trailing meta segment. Back-nav stays on the
          parent research workspace. */}
      <WorkspaceHeader
        title={title}
        goalName={goalName}
        showing={data.rows.length}
        total={totalLeads}
        marketNoun="leads"
        scopeNoun="list"
        freshness={freshness}
        mappedRelative={mappedAt ? relativeDays(mappedAt) : "—"}
        credits={credits}
        backHref={{
          pathname: "/discover/[discoveryId]",
          params: { discoveryId },
        }}
        extra={`${list.name} · ${list.serviceType.toLowerCase().replace(/_/g, " ")}`}
      />

      {/* AUDIT D4 · always-mounted gate (see LiveRunGate). */}
      <LiveRunGate activeRun={activeRun}>
        <WorkbenchShell {...shell} />
      </LiveRunGate>
    </div>
  );
}
