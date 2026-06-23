/**
 * Agency Touchpoints · `/(agency)/touchpoints` (Phase 9).
 *
 * Browse the OutreachDraft rows generated for this agency's prospects: subject /
 * body / predicted response tier / grounding "why", each with Copy buttons.
 * Read-only — the page never calls external APIs. Bulk generation runs out-of-
 * band via `generateTouchesForLeads` (a note on the page points there).
 *
 * Agency scoping · OutreachDraft has no direct agencyId, so we scope through the
 * agency's discoveries → their cellKeys → the businesses in those cells →
 * drafts for those businesses. This keeps the boundary honest (you only see
 * touches for prospects your agency actually discovered).
 *
 * Per `.claude/rules/cache-components.md`:
 *   - Pattern 2 · default export is SYNC; the async body (auth + DB) lives in a
 *     Suspense boundary so the shell prerenders.
 *   - Pattern 4 · no function props cross the client boundary — drafts are plain
 *     serialized data; the list resolves its own copy.
 *   - Pattern 5 · no `export const dynamic`; Suspense is the dynamic signal.
 *
 * Auth mirrors `/(agency)/discover/page.tsx`: no session → `unauthorized()`;
 * session but no AgencyMember → `redirect('/home')`.
 *
 * Copy is English-only for now (the app runs English-only — see i18n/routing.ts).
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import prisma from "@/lib/prisma";
import { toTouchpointDraft } from "@/modules/agency-portal/discover/touchpoints";
import {
  TouchpointsList,
  type TouchpointDraft,
} from "@/modules/agency-portal/discover/components/TouchpointsList";
import { GenerateTouchpointsPanel } from "@/modules/agency-portal/discover/components/GenerateTouchpointsPanel";

export const metadata: Metadata = {
  title: "Touchpoints · Mapsly",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string }>;
}

/** Page-level cap on rendered drafts (the list is a browse, not a workspace). */
const MAX_DRAFTS = 100;

export default function TouchpointsPage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <TouchpointsBody params={params} />
    </Suspense>
  );
}

async function TouchpointsBody({ params }: PageProps) {
  const { locale } = await params;
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

  // Agency boundary: collect the agency's discovered cells, then the businesses
  // in those cells. Drafts for those businesses are this agency's touchpoints.
  const discoveries = await prisma.discovery.findMany({
    where: { agencyId },
    select: { cellKeys: true },
  });
  const cellKeys = Array.from(new Set(discoveries.flatMap((d) => d.cellKeys)));

  let drafts: TouchpointDraft[] = [];

  if (cellKeys.length > 0) {
    const businesses = await prisma.business.findMany({
      where: { cellKey: { in: cellKeys } },
      select: { id: true, name: true },
    });
    const nameById = new Map(businesses.map((b) => [b.id, b.name]));
    const businessIds = businesses.map((b) => b.id);

    if (businessIds.length > 0) {
      const rows = await prisma.outreachDraft.findMany({
        where: { businessId: { in: businessIds } },
        orderBy: { createdAt: "desc" },
        take: MAX_DRAFTS,
        select: {
          id: true,
          businessId: true,
          channel: true,
          subject: true,
          body: true,
          predictedTier: true,
          whyJson: true,
          createdAt: true,
        },
      });

      drafts = rows.map((r) =>
        toTouchpointDraft({
          id: r.id,
          businessName: nameById.get(r.businessId) ?? null,
          channel: r.channel,
          subject: r.subject,
          body: r.body,
          predictedTier: r.predictedTier,
          whyJson: r.whyJson,
          createdAt: r.createdAt,
        }),
      );
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold text-slate-900">Touchpoints</h1>
        <p className="mt-1 font-mono text-xs text-slate-500">
          {drafts.length} draft{drafts.length === 1 ? "" : "s"}
        </p>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">
          Signal-grounded first touches. Every line is bound to a real signal —
          no generic openers. Generate a batch below from your discovered,
          reachable prospects.
        </p>
      </header>

      <GenerateTouchpointsPanel />

      <TouchpointsList drafts={drafts} />
    </div>
  );
}
