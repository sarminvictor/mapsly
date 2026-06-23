/**
 * Agency Campaigns · `/(agency)/campaigns` (Phase 9 · demand intent index).
 *
 * Lists the agency's saved campaigns (the demand-intent records that drive
 * discovery strategy) and links to the intake at `/campaigns/new`. A campaign
 * captures "what are you selling / who's the buyer / what pain do you solve" and
 * resolves to a costed research strategy (see modules/campaign/strategy.ts).
 *
 * Per `.claude/rules/cache-components.md`:
 *   - Pattern 2 · default export is SYNC; the async body (auth + DB) lives in a
 *     Suspense boundary so the shell prerenders.
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
import { Link, redirect } from "@/i18n/navigation";
import prisma from "@/lib/prisma";

export const metadata: Metadata = {
  title: "Campaigns · Mapsly",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default function CampaignsPage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <CampaignsBody params={params} />
    </Suspense>
  );
}

async function CampaignsBody({ params }: PageProps) {
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

  const campaigns = await prisma.campaign.findMany({
    where: { agencyId: member.agencyId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: {
      id: true,
      name: true,
      sellingWhat: true,
      createdAt: true,
    },
  });

  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Campaigns</h1>
          <p className="mt-1 text-sm text-slate-500">
            Describe what you sell once — we turn it into a costed research
            strategy you can run against any market.
          </p>
        </div>
        <Link
          href="/campaigns/new"
          className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          New campaign
        </Link>
      </header>

      {campaigns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
          <p className="text-sm text-slate-600">
            No campaigns yet. Create one to get a signal-driven strategy.
          </p>
          <Link
            href="/campaigns/new"
            className="mt-3 inline-block rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm font-semibold text-indigo-700 hover:border-indigo-300"
          >
            Create your first campaign
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {campaigns.map((c) => (
            <li key={c.id}>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-semibold text-slate-900">
                    {c.name ?? "Untitled campaign"}
                  </p>
                  <span className="font-mono text-xs text-slate-400">
                    {c.createdAt.toISOString().slice(0, 10)}
                  </span>
                </div>
                {c.sellingWhat ? (
                  <p className="mt-1 line-clamp-2 text-sm text-slate-600">
                    {c.sellingWhat}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
