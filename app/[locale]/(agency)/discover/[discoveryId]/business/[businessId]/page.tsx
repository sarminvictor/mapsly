/**
 * Agency business detail ·
 * `/(agency)/discover/[discoveryId]/business/[businessId]` (demand flow).
 *
 * The single-business deep view reached from the raw list, signals view, or a
 * pipeline. It renders the business header (name, address, rating, reviews,
 * website, reachability), its comparative signals vs the rest of its cell
 * (reuses `buildSingleBusinessSignals`), and its flagged + checked
 * `PlaybookFinding` rows (confidence + evidence + pitch angle). Read-only.
 *
 * Per `.claude/rules/cache-components.md`:
 *   - Pattern 2 · default export is SYNC; the async body (auth + DB) lives in a
 *     Suspense boundary so the shell prerenders.
 *   - Pattern 4 · no function props cross the client boundary — `<VsCellBar>`
 *     receives plain numeric props resolved server-side.
 *   - Pattern 5 · no `export const dynamic`; Suspense is the dynamic signal.
 *
 * Auth mirrors the sibling discovery pages: no session → `unauthorized()`;
 * session but no AgencyMember → `redirect('/home')`. The business's cellKey must
 * be in this discovery's cellKeys (agency-scope) else not-found (`notFound()`).
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
import { buildSingleBusinessSignals } from "@/modules/agency-portal/discover/signals";
import { VsCellBar } from "@/modules/agency-portal/discover/components/VsCellBar";

export const metadata: Metadata = {
  title: "Business · Mapsly",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string; discoveryId: string; businessId: string }>;
}

function reachabilityChipClass(tier: string): string {
  switch (tier) {
    case "RICH":
    case "MULTI":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "PHONE_ONLY":
    case "EMAIL_ONLY":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "UNREACHABLE":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-slate-50 text-slate-500 border-slate-200";
  }
}

function confidencePillClass(confidence: string): string {
  switch (confidence.toLowerCase()) {
    case "high":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "medium":
      return "bg-amber-50 text-amber-700 border-amber-200";
    default:
      return "bg-slate-50 text-slate-600 border-slate-200";
  }
}

export default function BusinessDetailPage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <BusinessDetailBody params={params} />
    </Suspense>
  );
}

async function BusinessDetailBody({ params }: PageProps) {
  const { locale, discoveryId, businessId } = await params;
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

  const discovery = await prisma.discovery.findUnique({
    where: { id: discoveryId },
    select: { id: true, agencyId: true, cellKeys: true },
  });
  // Cross-agency / missing discovery reads as not-found.
  if (!discovery || discovery.agencyId !== agencyId) notFound();

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      category: true,
      address: true,
      city: true,
      province: true,
      country: true,
      rating: true,
      reviewCount: true,
      website: true,
      phone: true,
      reachability: true,
      cellKey: true,
    },
  });

  // Agency-scope: the business must live in one of this discovery's cells.
  // Missing or out-of-cell reads as not-found.
  if (
    !business ||
    !business.cellKey ||
    !discovery.cellKeys.includes(business.cellKey)
  ) {
    notFound();
  }

  // Cohort reviewCount sample for the vs-cell signal: every business in the
  // discovery's cells (the cell IS the comparison set). Bounded select.
  const cohort = await prisma.business.findMany({
    where: {
      cellKey: { in: discovery.cellKeys },
      isHidden: false,
      reviewCount: { not: null },
    },
    select: { reviewCount: true },
    take: 1000,
  });
  const cohortReviewCounts = cohort
    .map((c) => c.reviewCount)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  const signals = buildSingleBusinessSignals(
    { reviewCount: business.reviewCount },
    cohortReviewCounts,
  );

  const findings = await prisma.playbookFinding.findMany({
    where: { businessId: business.id, status: "flagged" },
    select: {
      signalKey: true,
      group: true,
      confidence: true,
      explanation: true,
      pitchAngle: true,
    },
    orderBy: { confidence: "asc" },
    take: 50,
  });

  // AI research rollup (the 5-stage gpt-5.4-nano pipeline) — persisted but
  // previously never surfaced. Drives the "why call them" pitch.
  const research = await prisma.businessEnrichment.findUnique({
    where: { businessId: business.id },
    select: {
      subType: true,
      sophistication: true,
      pricingTransparency: true,
      positioningSummary: true,
      painHypotheses: true,
      competitivePositioning: true,
      complianceCues: true,
    },
  });

  const addressLine = [
    business.address,
    business.city,
    business.province,
    business.country,
  ]
    .filter(Boolean)
    .join(", ");
  const tier = business.reachability ?? "UNKNOWN";

  return (
    <div className="mx-auto max-w-5xl p-6">
      <Link
        href={{
          pathname: "/discover/[discoveryId]",
          params: { discoveryId },
        }}
        className="font-mono text-xs text-indigo-600 hover:text-indigo-700"
      >
        ← Research overview
      </Link>

      {/* Header */}
      <header className="mt-2 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-slate-900">
              {business.name}
            </h1>
            <p className="mt-1 font-mono text-xs text-slate-500">
              {business.category ?? "—"}
              {addressLine ? ` · ${addressLine}` : ""}
            </p>
          </div>
          <span
            className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${reachabilityChipClass(tier)}`}
          >
            {tier.toLowerCase()}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="font-mono text-[11px] uppercase tracking-wide text-slate-400">
              Rating
            </div>
            <div className="mt-0.5 font-mono text-lg text-slate-800">
              {business.rating != null ? business.rating.toFixed(1) : "—"}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="font-mono text-[11px] uppercase tracking-wide text-slate-400">
              Reviews
            </div>
            <div className="mt-0.5 font-mono text-lg text-slate-800">
              {business.reviewCount != null
                ? business.reviewCount.toLocaleString()
                : "—"}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="font-mono text-[11px] uppercase tracking-wide text-slate-400">
              Website
            </div>
            <div className="mt-0.5 truncate text-sm text-slate-700">
              {business.website ? (
                <a
                  href={business.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 hover:text-indigo-700"
                  title={business.website}
                >
                  visit ↗
                </a>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="font-mono text-[11px] uppercase tracking-wide text-slate-400">
              Phone
            </div>
            <div className="mt-0.5 truncate font-mono text-sm text-slate-700">
              {business.phone ?? "—"}
            </div>
          </div>
        </div>
      </header>

      {/* Signals vs cell */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Signals vs cell
        </h2>
        {signals.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            No comparable signal for this business yet.
          </div>
        ) : (
          <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4">
            {signals.map((s) => (
              <div key={s.key}>
                <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-slate-400">
                  {s.label}
                </div>
                {s.band ? (
                  <VsCellBar
                    value={s.value}
                    p10={s.band.p10}
                    p25={s.band.p25}
                    p50={s.band.p50}
                    p75={s.band.p75}
                    p90={s.band.p90}
                    percentile={s.percentile}
                    unit={s.unit}
                  />
                ) : (
                  <span className="font-mono text-sm text-slate-700">
                    {s.value.toLocaleString()}
                    {s.unit ? ` ${s.unit}` : ""}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Expert findings */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Expert findings
        </h2>
        {findings.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            No flagged findings for this business.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {findings.map((f) => (
              <div
                key={f.signalKey}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex rounded border px-1.5 py-0.5 text-xs font-medium ${confidencePillClass(f.confidence)}`}
                    title={`confidence: ${f.confidence}`}
                  >
                    {f.confidence}
                  </span>
                  <span className="font-mono text-xs text-slate-400">
                    {f.signalKey}
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    {f.group}
                  </span>
                </div>
                {f.explanation ? (
                  <p className="mt-2 text-sm text-slate-700">{f.explanation}</p>
                ) : null}
                {f.pitchAngle ? (
                  <p className="mt-2 border-l-2 border-indigo-200 pl-3 text-sm text-indigo-700">
                    {f.pitchAngle}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* AI research (gpt-5.4-nano pipeline rollup) */}
      {research ? (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            AI research
          </h2>
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap gap-2">
              {research.subType ? (
                <span className="inline-flex rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                  {research.subType}
                </span>
              ) : null}
              {research.sophistication ? (
                <span className="inline-flex rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                  sophistication: {research.sophistication}
                </span>
              ) : null}
              {research.pricingTransparency ? (
                <span className="inline-flex rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
                  pricing: {research.pricingTransparency}
                </span>
              ) : null}
            </div>
            {research.positioningSummary ? (
              <p className="text-sm text-slate-700">
                {research.positioningSummary}
              </p>
            ) : null}
            {research.painHypotheses.length > 0 ? (
              <div>
                <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-slate-400">
                  Pain hypotheses
                </div>
                <ul className="list-disc pl-5 text-sm text-slate-700">
                  {research.painHypotheses.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {research.competitivePositioning ? (
              <p className="border-l-2 border-indigo-200 pl-3 text-sm text-indigo-700">
                {research.competitivePositioning}
              </p>
            ) : null}
            {research.complianceCues.length > 0 ? (
              <div>
                <div className="mb-1 font-mono text-[11px] uppercase tracking-wide text-slate-400">
                  Compliance cues
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {research.complianceCues.map((c) => (
                    <span
                      key={c}
                      className="inline-flex rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
