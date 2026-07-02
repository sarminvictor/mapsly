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
import {
  getSignalCorrelation,
  type SignalCorrelation,
} from "@/modules/agency-portal/discover/signal-outcome-correlation";

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

  // WP6-14 · the outcome-feedback correlation card (null until ≥30 scored leads).
  const correlation = await getSignalCorrelation(member.agencyId);

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

      {correlation && correlation.signals.length > 0 ? (
        <SignalCorrelationCard correlation={correlation} />
      ) : null}

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

/**
 * WP6-14 · "signals that predicted replies in your market". One honest aggregate
 * (no ML): each fired signal's reply-rate lift vs the agency's baseline. Shown
 * only once ≥30 leads have a recorded outcome (the query gates that). Agency
 * voice: numbers over adjectives, terse. Server-rendered plain data.
 */
function SignalCorrelationCard({
  correlation,
}: {
  correlation: SignalCorrelation;
}) {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const top = correlation.signals.slice(0, 6);
  return (
    <div className="card" style={{ marginTop: 22 }}>
      <h2 style={{ margin: "0 0 2px", fontSize: 16 }}>
        Signals that predicted replies in your market
      </h2>
      <p className="note" style={{ margin: "0 0 12px" }}>
        Across {correlation.totalLeads.toLocaleString()} leads with an outcome ·
        baseline reply rate {pct(correlation.baselineReplyRate)}. Lift = how
        much more a lead replied when this signal fired.
      </p>
      <table
        style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}
      >
        <thead>
          <tr style={{ textAlign: "left", color: "var(--muted)" }}>
            <th style={{ padding: "4px 8px 4px 0" }} scope="col">
              Signal
            </th>
            <th style={{ padding: "4px 8px" }} scope="col">
              Fired
            </th>
            <th style={{ padding: "4px 8px" }} scope="col">
              Reply rate
            </th>
            <th style={{ padding: "4px 0 4px 8px" }} scope="col">
              Lift
            </th>
          </tr>
        </thead>
        <tbody>
          {top.map((s) => {
            const up = s.lift >= 0;
            return (
              <tr
                key={s.signalKey}
                style={{ borderTop: "1px solid var(--line, #eef0f6)" }}
              >
                <td style={{ padding: "6px 8px 6px 0" }}>{s.title}</td>
                <td style={{ padding: "6px 8px" }}>
                  {s.firedLeads.toLocaleString()}
                </td>
                <td style={{ padding: "6px 8px" }}>{pct(s.firedReplyRate)}</td>
                <td
                  style={{
                    padding: "6px 0 6px 8px",
                    color: up ? "var(--green)" : "var(--red)",
                    fontWeight: 600,
                  }}
                >
                  {up ? "+" : ""}
                  {pct(s.lift)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
