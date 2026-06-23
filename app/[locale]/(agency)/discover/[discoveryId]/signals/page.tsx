/**
 * Agency Discovery signals · `/(agency)/discover/[discoveryId]/signals` (Phase 9).
 *
 * The comparative-signals view for a Discovery: load the businesses in the
 * Discovery's cells (via `getRawList` over its cellKeys), their flagged expert
 * findings (`PlaybookFinding` status="flagged"), and map them into SignalRow[]
 * (`buildSignalRows`) — one row per business showing reviews-vs-cell via
 * <VsCellBar> + evidence chips. Read-only.
 *
 * Per `.claude/rules/cache-components.md`:
 *   - Pattern 2 · default export is SYNC; the async body (auth + DB) lives in a
 *     Suspense boundary so the shell prerenders.
 *   - Pattern 4 · no function props cross the client boundary — rows are plain
 *     serialized data; the table resolves its own copy.
 *   - Pattern 5 · no `export const dynamic`; Suspense is the dynamic signal.
 *
 * Auth mirrors `/(agency)/discover/[discoveryId]/page.tsx`: no session →
 * `unauthorized()`; session but no AgencyMember → `redirect('/home')`; a
 * Discovery owned by a different agency reads as not-found (`notFound()`).
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
import { getRawList } from "@/modules/discovery/raw-list";
import {
  buildSignalRows,
  type SignalBusinessInput,
  type SignalFindingInput,
} from "@/modules/agency-portal/discover/signals";
import { SignalsTable } from "@/modules/agency-portal/discover/components/SignalsTable";

export const metadata: Metadata = {
  title: "Signals · Mapsly",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string; discoveryId: string }>;
}

export default function DiscoverySignalsPage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <DiscoverySignalsBody params={params} />
    </Suspense>
  );
}

async function DiscoverySignalsBody({ params }: PageProps) {
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
    },
  });

  // Cross-agency access (or missing row) reads as not-found — we never confirm
  // the existence of another agency's discovery.
  if (!discovery || discovery.agencyId !== agencyId) notFound();

  const cellKeys = discovery.cellKeys;

  // Load the cohort (the cell IS the comparison set) + each business's latest
  // snapshot (for percentiles) + flagged findings, in parallel.
  const firstPage = await getRawList({ cellKeys }, { take: 100 });
  const businessIds = firstPage.rows.map((r) => r.id);

  const [snapshots, findingRows] = await Promise.all([
    businessIds.length > 0
      ? prisma.businessSnapshot.findMany({
          where: { businessId: { in: businessIds } },
          orderBy: { snapshotDate: "desc" },
          select: {
            businessId: true,
            reviewCount: true,
            rating: true,
            snapshotDate: true,
          },
        })
      : Promise.resolve([]),
    businessIds.length > 0
      ? prisma.playbookFinding.findMany({
          where: { businessId: { in: businessIds }, status: "flagged" },
          select: {
            businessId: true,
            signalKey: true,
            confidence: true,
            explanation: true,
            group: true,
          },
          orderBy: { confidence: "asc" },
        })
      : Promise.resolve([]),
  ]);

  // Keep only the latest snapshot per business (findMany returns desc-sorted).
  const latestSnapshot = new Map<
    string,
    { reviewCount: number | null; rating: number | null }
  >();
  for (const s of snapshots) {
    if (!latestSnapshot.has(s.businessId)) {
      latestSnapshot.set(s.businessId, {
        reviewCount: s.reviewCount,
        rating: s.rating,
      });
    }
  }

  // Prefer the snapshot's reviewCount/rating (graded vs the cell) and fall back
  // to the live Business column when no snapshot exists yet.
  const businesses: SignalBusinessInput[] = firstPage.rows.map((r) => {
    const snap = latestSnapshot.get(r.id);
    return {
      id: r.id,
      name: r.name,
      category: r.category,
      city: r.city,
      reviewCount: snap?.reviewCount ?? r.reviewCount,
      rating: snap?.rating ?? r.rating,
    };
  });

  const findings: SignalFindingInput[] = findingRows.map((f) => ({
    businessId: f.businessId,
    signalKey: f.signalKey,
    confidence: f.confidence,
    explanation: f.explanation,
    group: f.group,
  }));

  const rows = buildSignalRows(businesses, findings);

  return (
    <div className="mx-auto max-w-7xl p-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-slate-900">
          {discovery.name ?? "Discovery"} · signals
        </h1>
        <p className="mt-1 font-mono text-xs text-slate-500">
          {discovery.cellCount} cells · {businesses.length} businesses ·{" "}
          {findings.length} flagged findings
        </p>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">
          Each bar compares a business to the rest of its cell. Expert findings
          are flagged signals with evidence — hover the confidence pill for its
          strength.
        </p>
      </header>

      <SignalsTable rows={rows} discoveryId={discovery.id} />
    </div>
  );
}
