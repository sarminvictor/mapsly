/**
 * Agency · My research · `/(agency)/research`.
 *
 * The agency portal's PRIMARY workspace directory: every market of local
 * businesses the agency has mapped. A research IS its leads — open one to work
 * the set. Paid results are permanent — re-open any for 0 credits.
 *
 * Data: a "research" is a Discovery row. `getResearchList(agencyId)` loads the
 * agency's ACTIVE discoveries (pinned-first, then most-recently-opened) and
 * pre-resolves each into a plain `ResearchCard` (title, freshness, mapped/opened
 * relative time, credits-to-date, per-cell lead counts). The client
 * `<ResearchDirectory>` renders the filter toolbar + pinned/recent lists +
 * expandable cards using the ported prototype classes (.rfbar/.rlist/.rgroup).
 *
 * Per `.claude/rules/cache-components.md`: Pattern 2 (sync export + Suspense
 * async body), Pattern 5 (no `export const dynamic`), Pattern 4 (no function
 * props cross the client boundary — only plain card data). `getResearchList`
 * carries the Pattern 1 NEXT_PHASE guard + EMPTY_* constant.
 *
 * Auth mirrors `/(agency)/touchpoints/page.tsx`: no session → `unauthorized()`;
 * session but no AgencyMember → `redirect('/home')`. Copy is English-only for now
 * (the app runs English-only — see i18n/routing.ts).
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { unauthorized } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { Link, redirect } from "@/i18n/navigation";
import { getResearchList } from "@/modules/agency-portal/research/queries";
import { ResearchDirectory } from "@/modules/agency-portal/research/components/ResearchDirectory";

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

  const { pinned, recent } = await getResearchList(member.agencyId);
  const hasResearch = pinned.length > 0 || recent.length > 0;

  return (
    <section className="view wide">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div>
          <h1 style={{ marginBottom: 2 }}>My research</h1>
          <p className="note">
            Every market of local businesses you&rsquo;ve mapped. A research{" "}
            <b>is</b> its leads — open one to work the set. Paid results are
            permanent — re-open any for 0 credits.
          </p>
        </div>
        <Link href="/discover" className="btn primary sm">
          ＋ New research
        </Link>
      </div>

      {hasResearch ? (
        <ResearchDirectory pinned={pinned} recent={recent} />
      ) : (
        <div className="card" style={{ marginTop: 22, textAlign: "center" }}>
          <p style={{ margin: "0 0 14px", color: "var(--muted)" }}>
            No research yet. Pick a goal and a market to map your first set.
          </p>
          <Link href="/discover" className="btn punch big">
            Find my first leads →
          </Link>
        </div>
      )}
    </section>
  );
}
