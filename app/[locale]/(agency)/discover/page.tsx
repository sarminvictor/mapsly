/**
 * Agency Discover · `/(agency)/discover` (Phase 9 · demand-driven entry).
 *
 * The new front door of the demand model: pick metros × categories (= cells),
 * see the pre-flight cost (fresh cells served from DB at $0), and run discovery.
 * Wires the real Phase 2 server actions (preflightDiscoveryAction /
 * runDiscoveryAction) to the visual-first components.
 *
 * Per `.claude/rules/cache-components.md`:
 *   - Pattern 2 · default export is SYNC; the async body (auth + DB) lives in
 *     a Suspense boundary so the shell prerenders.
 *   - Pattern 5 · no `export const dynamic`; Suspense is the dynamic signal.
 * Auth mirrors `/(agency)/hunter`: no session → `unauthorized()`; session but
 * no AgencyMember → `redirect('/home')`.
 *
 * Copy is English-only for now (the app runs English-only — see i18n/routing.ts);
 * i18n message keys are a follow-up.
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import prisma from "@/lib/prisma";
import { US_METROS } from "@/lib/geo/us-metros";
import { DiscoverFlow } from "@/modules/agency-portal/discover/components/DiscoverFlow";

export const metadata: Metadata = {
  title: "Discover · Mapsly",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default function DiscoverPage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <DiscoverBody params={params} />
    </Suspense>
  );
}

async function DiscoverBody({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) unauthorized();

  const member = await prisma.agencyMember.findFirst({
    where: { userId: session.user.id },
    select: { agencyId: true },
  });
  if (!member) redirect({ href: "/home", locale });

  const categories = await prisma.businessCategory.findMany({
    where: { isActive: true },
    select: { id: true, dataforseoId: true, label: true },
    orderBy: { label: "asc" },
    take: 80,
  });

  const metros = US_METROS.map((m) => ({ slug: m.slug, name: m.name }));
  const cats = categories.map((c) => ({
    id: c.id,
    slug: c.dataforseoId,
    label: c.label,
  }));

  return (
    <div className="mx-auto max-w-4xl p-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Discover</h1>
        <p className="mt-1 text-sm text-slate-500">
          Pick metros and categories, preview the cost, and pull the live
          market. Cells discovered in the last 6 months are served from your
          data for $0.
        </p>
      </header>
      <DiscoverFlow metros={metros} categories={cats} />
    </div>
  );
}
