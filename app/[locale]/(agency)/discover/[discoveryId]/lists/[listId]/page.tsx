/**
 * Agency pipeline view ·
 * `/(agency)/discover/[discoveryId]/lists/[listId]` (demand flow).
 *
 * Work a saved list: every Lead joined to its Business with a clickable status
 * pill (NEW → CONTACTED → REPLIED → WON/LOST) and a link into the business
 * detail. Status mutations are optimistic in the client `<LeadsPipelineTable>`.
 *
 * Per `.claude/rules/cache-components.md`:
 *   - Pattern 2 · default export is SYNC; the async body (auth + DB) lives in a
 *     Suspense boundary so the shell prerenders.
 *   - Pattern 4 · no function props cross the client boundary — rows are plain
 *     serialized data; the table imports its own server action.
 *   - Pattern 5 · no `export const dynamic`; Suspense is the dynamic signal.
 *
 * Auth mirrors the sibling discovery pages: no session → `unauthorized()`;
 * session but no AgencyMember → `redirect('/home')`. A list owned by a different
 * agency — or a list whose discoveryId doesn't match the route — reads as
 * not-found (`notFound()`); we never confirm another agency's data.
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
import {
  LeadsPipelineTable,
  type LeadPipelineRow,
} from "@/modules/agency-portal/discover/components/LeadsPipelineTable";
import type { SaveLeadStatus } from "@/modules/discovery/save-list-actions";

export const metadata: Metadata = {
  title: "Pipeline · Mapsly",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string; discoveryId: string; listId: string }>;
}

export default function ListPipelinePage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <ListPipelineBody params={params} />
    </Suspense>
  );
}

async function ListPipelineBody({ params }: PageProps) {
  const { locale, discoveryId, listId } = await params;
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

  const list = await prisma.list.findUnique({
    where: { id: listId },
    select: {
      id: true,
      agencyId: true,
      name: true,
      discoveryId: true,
      serviceType: true,
      leads: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          status: true,
          business: {
            select: {
              id: true,
              name: true,
              category: true,
              city: true,
              rating: true,
              reviewCount: true,
              website: true,
              phone: true,
              reachability: true,
            },
          },
        },
      },
    },
  });

  // Cross-agency, missing, or a list that doesn't belong to this discovery all
  // read as not-found — we never confirm another agency's data.
  if (!list || list.agencyId !== agencyId || list.discoveryId !== discoveryId) {
    notFound();
  }

  const rows: LeadPipelineRow[] = list.leads.map((lead) => ({
    leadId: lead.id,
    businessId: lead.business.id,
    name: lead.business.name,
    category: lead.business.category,
    city: lead.business.city,
    rating: lead.business.rating,
    reviewCount: lead.business.reviewCount,
    website: lead.business.website,
    phone: lead.business.phone,
    reachability: lead.business.reachability,
    status: lead.status as SaveLeadStatus,
  }));

  return (
    <div className="mx-auto max-w-7xl p-6">
      <header className="mb-5">
        <Link
          href={{
            pathname: "/discover/[discoveryId]",
            params: { discoveryId },
          }}
          className="font-mono text-xs text-indigo-600 hover:text-indigo-700"
        >
          ← Research overview
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">
          {list.name}
        </h1>
        <p className="mt-1 font-mono text-xs text-slate-500">
          {rows.length.toLocaleString()} leads ·{" "}
          {list.serviceType.toLowerCase().replace(/_/g, " ")}
        </p>
      </header>

      <LeadsPipelineTable rows={rows} discoveryId={discoveryId} />
    </div>
  );
}
