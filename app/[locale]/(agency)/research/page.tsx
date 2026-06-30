/**
 * Agency · My research · `/(agency)/research`.
 *
 * Phase-1 placeholder for the research directory (the prototype's primary
 * home object). Phase 2 (docs/portal-gap-analysis.md) fleshes this out with
 * pinned/recent research cards, per-cell breakdown, pin/archive/rename, and
 * "set as default landing". For now it renders the branded shell + a CTA into
 * the get-leads flow so the nav item is honest.
 *
 * Per `.claude/rules/cache-components.md`: Pattern 2 (sync export + Suspense
 * async body), Pattern 5 (no `export const dynamic`).
 * Auth mirrors `/(agency)/discover/page.tsx`. Copy is English-only for now
 * (the app runs English-only — see i18n/routing.ts).
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { Link, redirect } from "@/i18n/navigation";

export const metadata: Metadata = {
  title: "My research · Mapsly",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default function ResearchPage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <ResearchBody params={params} />
    </Suspense>
  );
}

async function ResearchBody({ params }: PageProps) {
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
    <section className="view wide">
      <h1>My research</h1>
      <p className="sub">
        Every market of local businesses you&rsquo;ve mapped. A research is its
        leads — open one to work the set. Paid results are permanent — re-open
        any for 0 credits.
      </p>

      <div className="card" style={{ marginTop: 22, textAlign: "center" }}>
        <p style={{ margin: "0 0 14px", color: "var(--muted)" }}>
          No research yet. Pick a goal and a market to map your first set.
        </p>
        <Link href="/discover" className="btn punch big">
          Find my first leads →
        </Link>
      </div>
    </section>
  );
}
