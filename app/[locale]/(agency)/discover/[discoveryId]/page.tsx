/**
 * Agency Discovery detail · `/(agency)/discover/[discoveryId]` (Phase 9).
 *
 * The Raw List result view: after a Discovery populates its cells, the user
 * browses the raw businesses before spending credits to enrich them. This page
 * loads the Discovery row + its cellKeys, computes the reachability summary
 * (`getRawListSummary`) + the first page of rows (`getRawList`), and hands them
 * to the client `<RawListTable>` (multi-select → bulk enrich / save-as-list) +
 * the `<EnrichPanel>` (the 9 enrichments, per-row cost, live total).
 *
 * Per `.claude/rules/cache-components.md`:
 *   - Pattern 2 · default export is SYNC; the async body (auth + DB) lives in a
 *     Suspense boundary so the shell prerenders.
 *   - Pattern 4 · no function props cross the client boundary — rows are plain
 *     serialized data; the table/panel resolve their own copy.
 *   - Pattern 5 · no `export const dynamic`; Suspense is the dynamic signal.
 *
 * Auth mirrors `/(agency)/discover/page.tsx`: no session → `unauthorized()`;
 * session but no AgencyMember → `redirect('/home')`. A Discovery owned by a
 * different agency is treated as not-found (`notFound()`).
 *
 * Copy is English-only for now (the app runs English-only — see i18n/routing.ts).
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound, unauthorized } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { auth } from "@/lib/auth";
import { Link, redirect } from "@/i18n/navigation";
import prisma from "@/lib/prisma";
import { getRawList, getRawListSummary } from "@/modules/discovery/raw-list";
import { getResearchOverview } from "@/modules/agency-portal/discover/overview";
import { ReachabilityBanner } from "@/modules/agency-portal/discover/components/ReachabilityBanner";
import { CohortCard } from "@/modules/agency-portal/discover/components/CohortCard";
import { CellStandardsPanel } from "@/modules/agency-portal/discover/components/CellStandardsPanel";
import { Sparkline } from "@/modules/agency-portal/discover/components/Sparkline";
import { FreshnessChip } from "@/modules/agency-portal/discover/components/FreshnessChip";
import {
  RawListTable,
  type RawListTableRow,
} from "@/modules/agency-portal/discover/components/RawListTable";

export const metadata: Metadata = {
  title: "Raw list · Mapsly",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string; discoveryId: string }>;
}

export default function DiscoveryDetailPage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <DiscoveryDetailBody params={params} />
    </Suspense>
  );
}

async function DiscoveryDetailBody({ params }: PageProps) {
  const { locale, discoveryId } = await params;
  setRequestLocale(locale);

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

  const discovery = await prisma.discovery.findUnique({
    where: { id: discoveryId },
    select: {
      id: true,
      agencyId: true,
      name: true,
      status: true,
      cellKeys: true,
      cellCount: true,
      totalBusinesses: true,
    },
  });

  // Cross-agency access (or missing row) reads as not-found, not forbidden — we
  // never confirm the existence of another agency's discovery.
  if (!discovery || discovery.agencyId !== agencyId) notFound();

  const cellKeys = discovery.cellKeys;

  const [summary, firstPage, savedLists] = await Promise.all([
    getRawListSummary({ cellKeys }),
    getRawList({ cellKeys }, { take: 50 }),
    // Saved (non-raw) lists carved out of this discovery, with a per-status
    // rollup so the overview shows pipeline progress at a glance.
    prisma.list.findMany({
      where: { discoveryId: discovery.id, agencyId, isRaw: false },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        leads: { select: { status: true } },
      },
    }),
  ]);

  // Pre-resolve each saved list into a plain serializable shape (no function
  // props cross the boundary — but this section renders server-side anyway).
  const savedListRows = savedLists.map((l) => {
    const counts: Record<string, number> = {};
    for (const lead of l.leads) {
      counts[lead.status] = (counts[lead.status] ?? 0) + 1;
    }
    return {
      id: l.id,
      name: l.name,
      total: l.leads.length,
      newCount: counts.NEW ?? 0,
      contactedCount: counts.CONTACTED ?? 0,
      repliedCount: counts.REPLIED ?? 0,
      wonCount: counts.WON ?? 0,
      lostCount: counts.LOST ?? 0,
    };
  });

  const rows: RawListTableRow[] = firstPage.rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    city: r.city,
    province: r.province,
    metroSlug: r.metroSlug,
    rating: r.rating,
    reviewCount: r.reviewCount,
    website: r.website,
    phone: r.phone,
    reachability: r.reachability,
    reachableChannelCount: r.reachableChannelCount,
  }));

  // The reachability banner counts the WHOLE cell set; "unreachable" is the
  // suppressed-from-default remainder (total − reachable − phoneOnly), floored.
  const bannerCounts = {
    total: summary.total,
    reachable: summary.reachable,
    phoneOnly: summary.phoneOnly,
    unreachable: Math.max(
      0,
      summary.total - summary.reachable - summary.phoneOnly,
    ),
  };

  // Comprehension layer (§4.19/4.20): cohort tiles + per-cell freshness + the
  // cell-standards reference panel + a distribution sparkline. A just-completed
  // discovery's cells are FRESH (served within the 182-day window).
  const overview = await getResearchOverview({ cellKeys, summary });

  return (
    <div className="mx-auto max-w-7xl p-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-slate-900">
          {discovery.name ?? "Raw list"}
        </h1>
        <p className="mt-1 font-mono text-xs text-slate-500">
          {discovery.cellCount} cells · {summary.total.toLocaleString()}{" "}
          businesses · status {discovery.status.toLowerCase()}
        </p>
      </header>

      {/* Research overview · cohorts + freshness + cell standards */}
      <section className="mb-5 space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {overview.cohorts.map((c) => (
            <CohortCard
              key={c.toneLabel}
              pitch={c.pitch}
              count={c.count}
              reachableCount={c.reachableCount}
              tone={c.tone}
              toneLabel={c.toneLabel}
              footnote={c.footnote}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Cells:</span>
          {cellKeys.map((k) => (
            <span key={k} className="inline-flex items-center gap-1.5">
              <FreshnessChip state="fresh" />
              <span className="font-mono text-xs text-slate-500">{k}</span>
            </span>
          ))}
        </div>

        {overview.standardRows.length > 0 ? (
          <div className="space-y-2">
            <CellStandardsPanel
              cellLabel={overview.cellLabel}
              rows={overview.standardRows}
              sampleSize={overview.sampleSize}
            />
            {overview.distributionSeries.length > 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                <span className="text-xs text-slate-500">
                  Review-count spread (p10→p90)
                </span>
                <Sparkline
                  values={overview.distributionSeries}
                  label="cell review-count distribution"
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* Saved lists · pipelines carved out of this discovery */}
      {savedListRows.length > 0 ? (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            Saved lists
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {savedListRows.map((l) => (
              <Link
                key={l.id}
                href={{
                  pathname: "/discover/[discoveryId]/lists/[listId]",
                  params: { discoveryId: discovery.id, listId: l.id },
                }}
                className="rounded-xl border border-slate-200 bg-white p-4 hover:border-indigo-300 hover:shadow-sm"
              >
                <div className="font-medium text-slate-800">{l.name}</div>
                <div className="mt-1 font-mono text-xs text-slate-500">
                  {l.total.toLocaleString()} leads
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[11px]">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">
                    {l.newCount} new
                  </span>
                  <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700">
                    {l.contactedCount} contacted
                  </span>
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-700">
                    {l.repliedCount} replied
                  </span>
                  <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700">
                    {l.wonCount} won
                  </span>
                  <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700">
                    {l.lostCount} lost
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mb-4">
        <ReachabilityBanner counts={bannerCounts} />
      </div>

      <RawListTable
        rows={rows}
        cellKeys={cellKeys}
        discoveryId={discovery.id}
        nextCursor={firstPage.nextCursor}
      />
    </div>
  );
}
