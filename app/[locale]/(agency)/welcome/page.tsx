/**
 * Agency Welcome · `/(agency)/welcome` — the branded entry/hero screen.
 *
 * The agency portal's designated front door (prototype `#view-welcome`,
 * docs/portal-prototype.html lines 6760-6905). A confidence-building, one-CTA
 * marketing-grade hero that frames the discovery flow BEFORE the user has to
 * pick a metro/category. Sells the payoff, shows the free credits, then routes
 * the single "Find my first leads →" CTA into `/discover`.
 *
 * Per `.claude/rules/cache-components.md`:
 *   - Pattern 2 · the default export is SYNC; the async body (auth + DB reads)
 *     lives inside a `<Suspense>` boundary so the shell prerenders.
 *   - Pattern 4 · no function props cross the `'use client'` boundary — the
 *     HeroStats client component receives plain numbers/strings only.
 *   - Pattern 5 · no `export const dynamic`; Suspense is the dynamic signal.
 *
 * Auth mirrors `/(agency)/touchpoints/page.tsx`: no session → `unauthorized()`;
 * session but no AgencyMember → `redirect({ href: '/home', locale })` (the SMB
 * landing — same fallback the discover page uses for non-agency users).
 *
 * Data is REAL (Prisma, request-path safe — no external APIs):
 *   - agency name → personalized eyebrow (Agency joined via AgencyMember)
 *   - wallet credit balance → CTA sub-text (mirrors WalletPill.readCredits)
 * Everything else (stats, peek mock, testimonials) is static marketing content.
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
import { grantFreeTierIfNew } from "@/modules/cost/server";
import { WelcomeHero } from "@/modules/agency-portal/welcome/components/WelcomeHero";
import { Testimonials } from "@/modules/agency-portal/welcome/components/Testimonials";

export const metadata: Metadata = {
  title: "Welcome · Mapsly",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default function WelcomePage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <WelcomeBody params={params} />
    </Suspense>
  );
}

async function WelcomeBody({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) unauthorized();

  // Oldest membership wins (mirrors WalletPill) — the agency the wallet belongs to.
  const member = await prisma.agencyMember.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: { agency: { select: { id: true, name: true } } },
  });
  if (!member) {
    redirect({ href: "/home", locale });
    return null;
  }

  const agencyName = member.agency.name;
  // First-touch free-tier grant (idempotent) — a brand-new agency landing here
  // gets its 50 credits so the CTA reflects them. Mirrors /discover + /usage.
  await grantFreeTierIfNew(member.agency.id).catch(() => {});
  const credits = await readCredits(member.agency.id);

  return (
    <section className="view wide">
      <WelcomeHero agencyName={agencyName} credits={credits} />
      <Testimonials />
    </section>
  );
}

/**
 * Available credit balance for the CTA sub-text. Mirrors the math in
 * `components/agency/WalletPill.tsx` (plan + purchased + rollover − held,
 * floored at 0). Degrades to 0 on any read failure — the welcome screen must
 * never crash on a missing wallet.
 */
async function readCredits(agencyId: string): Promise<number> {
  try {
    const wallet = await prisma.agencyWallet.findUnique({
      where: { agencyId },
      select: {
        planCredits: true,
        purchasedCredits: true,
        rolloverCredits: true,
        heldCredits: true,
      },
    });
    if (!wallet) return 0;
    return Math.max(
      0,
      wallet.planCredits +
        wallet.purchasedCredits +
        wallet.rolloverCredits -
        wallet.heldCredits,
    );
  } catch {
    return 0;
  }
}
