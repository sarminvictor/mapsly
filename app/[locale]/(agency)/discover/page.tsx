/**
 * Agency Discover · `/(agency)/discover` — the "Get leads" journey entry.
 *
 * The 5-step resumable flow (Goal ▸ Market ▸ Preview ▸ Discover ▸ Enrich) lives
 * in one client component (`<GetLeadsFlow>`) that switches views in place — like
 * the prototype's go(id) router — so the whole journey runs on /discover without
 * new routes. The page is a SYNC server shell that auth-gates and feeds the flow
 * the real metro list, category list, and wallet credit balance. Each step wires
 * the real server actions (preflight/run discovery, preflight/run enrich, fetch
 * raw list) and the jobs feed; no external API runs in the request path.
 *
 * Per `.claude/rules/cache-components.md`:
 *   - Pattern 2 · default export is SYNC; the async body (auth + DB) lives in a
 *     Suspense boundary so the shell prerenders.
 *   - Pattern 4 · no function props cross the client boundary — metros /
 *     categories / wallet credits are plain serialized data.
 *   - Pattern 5 · no `export const dynamic`; Suspense is the dynamic signal.
 * Auth mirrors `/(agency)/touchpoints`: no session → `unauthorized()`; session
 * but no AgencyMember → `redirect('/home')`.
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
import { GetLeadsFlow } from "@/modules/agency-portal/discover/components/GetLeadsFlow";

export const metadata: Metadata = {
  title: "Get leads · Mapsly",
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
  if (!member) {
    redirect({ href: "/home", locale });
    return null;
  }

  const [categories, wallet] = await Promise.all([
    prisma.businessCategory.findMany({
      where: { isActive: true },
      select: { id: true, dataforseoId: true, label: true },
      orderBy: { label: "asc" },
      take: 400,
    }),
    prisma.agencyWallet.findUnique({
      where: { agencyId: member.agencyId },
      select: {
        planCredits: true,
        purchasedCredits: true,
        rolloverCredits: true,
        heldCredits: true,
      },
    }),
  ]);

  const metros = US_METROS.map((m) => ({ slug: m.slug, name: m.name }));
  const cats = categories.map((c) => ({
    id: c.id,
    slug: c.dataforseoId,
    label: c.label,
  }));

  const walletCredits = wallet
    ? Math.max(
        0,
        wallet.planCredits +
          wallet.purchasedCredits +
          wallet.rolloverCredits -
          wallet.heldCredits,
      )
    : 0;

  return (
    <GetLeadsFlow
      metros={metros}
      categories={cats}
      walletCredits={walletCredits}
    />
  );
}
