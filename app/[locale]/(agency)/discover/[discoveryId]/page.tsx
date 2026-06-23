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
import { redirect } from "@/i18n/navigation";
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

  const [summary, firstPage] = await Promise.all([
    getRawListSummary({ cellKeys }),
    getRawList({ cellKeys }, { take: 50 }),
  ]);

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

      <div className="mb-4">
        <ReachabilityBanner counts={bannerCounts} />
      </div>

      <RawListTable
        rows={rows}
        cellKeys={cellKeys}
        nextCursor={firstPage.nextCursor}
      />
    </div>
  );
}
