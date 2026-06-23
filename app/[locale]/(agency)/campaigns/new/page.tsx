/**
 * New campaign · `/(agency)/campaigns/new` (Phase 8 · demand-intent on-ramp).
 *
 * Mounts the <CampaignIntake> client flow: the agency describes what it sells →
 * a debounced live strategy preview (getStrategyAction) → "Save campaign"
 * (createCampaignAction) → redirect to /discover?campaign=… . The heavy lifting
 * lives in the client component; this page is the auth-gated shell.
 *
 * Per `.claude/rules/cache-components.md`:
 *   - Pattern 2 · default export is SYNC; the async body (auth + DB) lives in a
 *     Suspense boundary so the shell prerenders.
 *   - Pattern 5 · no `export const dynamic`; Suspense is the dynamic signal.
 *
 * Auth mirrors `/(agency)/campaigns/page.tsx`: no session → `unauthorized()`;
 * session but no AgencyMember → `redirect('/home')`.
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";
import prisma from "@/lib/prisma";
import { CampaignIntake } from "@/modules/campaign/components/CampaignIntake";

export const metadata: Metadata = {
  title: "New campaign · Mapsly",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default function NewCampaignPage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <NewCampaignBody params={params} />
    </Suspense>
  );
}

async function NewCampaignBody({ params }: PageProps) {
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

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">New campaign</h1>
        <p className="mt-1 text-sm text-slate-500">
          Tell us what you sell — we&apos;ll turn it into a costed research
          strategy and take you straight to discovery.
        </p>
      </header>
      <CampaignIntake />
    </div>
  );
}
