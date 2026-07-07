/**
 * Agency business detail ·
 * `/(agency)/discover/[discoveryId]/business/[businessId]` (demand flow).
 *
 * The single-business deep view reached from the raw list, signals view, or a
 * pipeline. It renders the SAME `LeadDetail` payload the workbench drawer shows
 * — header, pills, at-a-glance, fired composite signals, other angles, the
 * data-domain blocks (rendered off the honest per-type run STATE: enriched /
 * empty / failed / running / not_run — truth unification 2026-07-06), expert
 * findings, and the lead's touches. Page + drawer share ONE loader
 * (`getLeadDetail`) so they never diverge. Read-only.
 *
 * Per `.claude/rules/cache-components.md`:
 *   - Pattern 2 · default export is SYNC; the async body (auth + DB) lives in a
 *     Suspense boundary so the shell prerenders.
 *   - Pattern 5 · no `export const dynamic`; Suspense is the dynamic signal.
 *
 * Auth mirrors the sibling discovery pages: no session → `unauthorized()`;
 * session but no AgencyMember → `redirect('/home')`. The business must resolve in
 * the caller agency's discovered cells (via the shared loader) AND in THIS
 * discovery's cellKeys (the route scope) else not-found (`notFound()`).
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
import { Icon } from "@/components/agency/Icon";
import { StatusPill } from "@/modules/agency-portal/components/StatusPill";
import {
  getLeadDetail,
  type LeadEvidenceRow,
} from "@/modules/agency-portal/discover/lead-detail";

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

function evidenceToneClass(tone: LeadEvidenceRow["tone"]): string {
  switch (tone) {
    case "g":
      return "text-emerald-700";
    case "a":
      return "text-amber-700";
    case "r":
      return "text-red-700";
    default:
      return "text-slate-700";
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

  // The shared loader (agency-scoped). It also gates on the business living in
  // one of the agency's cells; we additionally require it in THIS discovery's
  // cells so the route scope holds.
  const businessCell = await prisma.business.findUnique({
    where: { id: businessId },
    select: { cellKey: true },
  });
  if (
    !businessCell?.cellKey ||
    !discovery.cellKeys.includes(businessCell.cellKey)
  ) {
    notFound();
  }

  // Pass discoveryId so the page evaluates the lead against THIS research's
  // persisted signals (real match% + per-signal verdicts), matching the drawer.
  const lead = await getLeadDetail(businessId, agencyId, discoveryId);
  if (!lead) notFound();

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={{
            pathname: "/discover/[discoveryId]",
            params: { discoveryId },
          }}
          className="font-mono text-xs text-indigo-600 hover:text-indigo-700"
        >
          ← Research overview
        </Link>
        {/* WP5-5 · the client-ready print artifact over this same payload. */}
        <Link
          href={{
            pathname: "/discover/[discoveryId]/business/[businessId]/report",
            params: { discoveryId, businessId },
          }}
          className="font-mono text-xs text-indigo-600 hover:text-indigo-700"
        >
          Proof Pack →
        </Link>
      </div>

      {/* Header */}
      <header className="mt-2 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-slate-900">
              {lead.name}
            </h1>
            <p className="mt-1 font-mono text-xs text-slate-500">
              {lead.category ?? "—"}
              {lead.addressLine && lead.addressLine !== "—"
                ? ` · ${lead.addressLine}`
                : ""}
              {lead.openStatus && lead.openStatus !== "—"
                ? ` · ${lead.openStatus}`
                : ""}
            </p>
          </div>
          <span
            className={`inline-flex shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${reachabilityChipClass(lead.reachability)}`}
          >
            {lead.reachability.toLowerCase()}
          </span>
        </div>

        {/* Pills */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-flex rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
            Match {lead.match}%
          </span>
          <StatusPill status={lead.status} as="span" />
          {lead.complianceFlag ? (
            <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
              Compliance: pixel risk
            </span>
          ) : null}
          {lead.closed ? (
            <span className="inline-flex rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
              {lead.openStatus}
            </span>
          ) : null}
        </div>

        {/* Top stats */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Rating" value={lead.rating?.toFixed(1) ?? "—"} />
          <Stat
            label="Reviews"
            value={lead.reviewCount?.toLocaleString() ?? "—"}
          />
          <div className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="font-mono text-[11px] uppercase tracking-wide text-slate-400">
              Website
            </div>
            <div className="mt-0.5 truncate text-sm text-slate-700">
              {lead.website ? (
                <a
                  href={lead.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 hover:text-indigo-700"
                  title={lead.website}
                >
                  visit ↗
                </a>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </div>
          </div>
          {/* The phone FACT falls back to the GBP listing scalar — a plain fact
              is fine here; only the contacts SECTION below is state-gated. */}
          <Stat
            label="Phone"
            value={
              lead.phones[0]?.value ??
              lead.listingContacts.find((c) => c.href.startsWith("tel:"))
                ?.value ??
              "—"
            }
            mono
          />
        </div>
      </header>

      {/* At a glance · fact grid + contacts */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          At a glance
        </h2>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {lead.facts.map((f) => (
              <div key={f.key} className="min-w-0">
                <div className="font-mono text-[11px] uppercase tracking-wide text-slate-400">
                  {f.key}
                </div>
                <div className="truncate text-sm font-medium text-slate-800">
                  {f.value}
                </div>
              </div>
            ))}
          </div>
          {/* Truth unification: the contact strip is state-gated off the shared
              loader's CONTACTS run state. The GBP scalars render as LISTING
              facts in every state — never as proof the contact scan ran. */}
          <div className="mt-3 border-t border-dashed border-slate-200 pt-3 text-sm">
            {lead.listingContacts.length > 0 ? (
              <div className="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-mono text-[10px] uppercase tracking-wide text-slate-400">
                  From the Google listing
                </span>
                {lead.listingContacts.map((c) => (
                  <a
                    key={c.href}
                    href={c.href}
                    className="text-indigo-600 hover:text-indigo-700"
                  >
                    {c.href.startsWith("tel:") ? "📞" : "✉️"} {c.value}
                  </a>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {lead.contactsState === "enriched" ? (
                <>
                  {lead.phones.map((c) => (
                    <a
                      key={c.href}
                      href={c.href}
                      className="text-indigo-600 hover:text-indigo-700"
                    >
                      📞 {c.value}
                    </a>
                  ))}
                  {lead.emails.map((c) => (
                    <a
                      key={c.href}
                      href={c.href}
                      className="text-indigo-600 hover:text-indigo-700"
                    >
                      ✉️ {c.value}
                    </a>
                  ))}
                  {lead.socials.map((c) => (
                    <a
                      key={c.href}
                      href={c.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-indigo-600 hover:text-indigo-700"
                    >
                      🔗 {c.value}
                    </a>
                  ))}
                </>
              ) : (
                <span className="text-slate-400">
                  {lead.contactsState === "empty"
                    ? "Contacts scanned · none found"
                    : lead.contactsState === "failed"
                      ? "Contact scan failed on the last run — retry from the workbench"
                      : lead.contactsState === "running"
                        ? "Enriching contacts…"
                        : "Contacts not enriched yet"}
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Why this lead qualifies */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Why this lead qualifies
        </h2>

        {/* The research's chosen signals, with honest per-lead verdicts (P3). */}
        {lead.signalVerdicts.length > 0 ? (
          <div className="mb-3 rounded-xl border border-slate-200 bg-white p-4">
            <p className="mb-2 text-xs text-slate-500">
              {lead.signalVerdicts.filter((v) => v.matched === true).length} of{" "}
              {lead.signalVerdicts.length} of your signals fired
            </p>
            <ul className="flex flex-col gap-1.5">
              {lead.signalVerdicts.map((v) => {
                const cls =
                  v.matched === true
                    ? "bg-green-50 text-green-700 border-green-200"
                    : v.matched === null
                      ? "bg-amber-50 text-amber-700 border-amber-200"
                      : "bg-slate-50 text-slate-500 border-slate-200";
                const label =
                  v.matched === true
                    ? "Fired"
                    : v.matched === null
                      ? "Enrich to unlock"
                      : "Didn’t fire";
                return (
                  <li
                    key={v.key}
                    className="flex items-center justify-between gap-2"
                  >
                    <span
                      className="truncate text-sm text-slate-700"
                      title={v.means}
                    >
                      {v.title}
                    </span>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] ${cls}`}
                    >
                      {label}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {lead.firedSignals.length === 0 ? (
          lead.signalVerdicts.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
              No composite signals fired — this lead matched on raw qualifiers
              only.
            </div>
          ) : null
        ) : (
          <div className="flex flex-col gap-3">
            {lead.firedSignals.map((s) => (
              <div
                key={s.key}
                className="rounded-xl border border-slate-200 border-l-4 border-l-indigo-300 bg-white p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800">
                    {s.title}
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    {s.confidence}
                  </span>
                </div>
                {s.summary ? (
                  <p className="mt-1 text-sm text-slate-700">{s.summary}</p>
                ) : null}
                {s.pitch ? (
                  <p className="mt-2 border-l-2 border-indigo-200 pl-3 text-sm text-indigo-700">
                    {s.pitch}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
        {lead.angles.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {lead.angles.map((a, i) => (
              <span
                key={`${a.label}-${i}`}
                className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600"
                title={a.title}
              >
                {a.label}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      {/* Data domains */}
      <section className="mb-6">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          Data domains
        </h2>
        {/* Truth unification: render off the honest run STATE (the same
            TypeState the workbench matrix + drawer show) — a verified-empty
            run reads "Ran · none found" (calm, no sales pitch), a failed one
            says so with a retry hint, and only never-run domains get the
            dashed ghost + ghostNote. */}
        <div className="flex flex-col gap-3">
          {lead.domains.map((d) => (
            <div
              key={d.key}
              className={`rounded-xl border p-4 ${
                d.state === "not_run"
                  ? "border-dashed border-slate-300 bg-slate-50"
                  : "border-slate-200 bg-white"
              }`}
            >
              <div className="flex items-center gap-2">
                {/* LeadDomainBlock.icon is an IconName now (emoji retired). */}
                <span aria-hidden="true" className="inline-flex text-slate-400">
                  <Icon name={d.icon} size={14} />
                </span>
                <span className="text-sm font-semibold text-slate-800">
                  {d.title}
                </span>
                {d.state === "enriched" ? (
                  d.summary ? (
                    <span className="ml-auto truncate font-mono text-[11px] text-slate-500">
                      {d.summary}
                    </span>
                  ) : null
                ) : (
                  <span
                    className={`ml-auto font-mono text-[10px] uppercase tracking-wide ${
                      d.state === "failed" ? "text-red-600" : "text-slate-400"
                    }`}
                  >
                    {d.state === "empty"
                      ? "Ran · none found"
                      : d.state === "failed"
                        ? "Failed"
                        : d.state === "running"
                          ? "Enriching…"
                          : "Not enriched"}
                  </span>
                )}
              </div>
              {/* Listing facts (GBP aggregate) render in every state, honestly
                  labelled — same as the drawer (E1). */}
              {d.listingRows.length > 0 ? (
                <div className="mt-2">
                  <div className="font-mono text-[10px] uppercase tracking-wide text-slate-400">
                    From the Google listing
                  </div>
                  <dl className="mt-1 grid gap-1.5">
                    {d.listingRows.map((r, i) => (
                      <div
                        key={i}
                        className="flex justify-between gap-3 text-sm"
                      >
                        <dt className="text-slate-500">{r.label}</dt>
                        <dd
                          className={`text-right font-medium ${evidenceToneClass(r.tone)}`}
                        >
                          {r.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
              {d.state === "enriched" ? (
                <>
                  {d.rows.length ? (
                    <dl className="mt-2 grid gap-1.5">
                      {d.rows.map((r, i) => (
                        <div
                          key={i}
                          className="flex justify-between gap-3 text-sm"
                        >
                          <dt className="text-slate-500">{r.label}</dt>
                          <dd
                            className={`text-right font-medium ${evidenceToneClass(r.tone)}`}
                          >
                            {r.value}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {d.source ? (
                    <p className="mt-2 text-xs text-slate-400">
                      {d.source}
                      {d.asOf ? ` · as of ${d.asOf}` : ""}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="mt-1.5 text-sm text-slate-500">
                  {d.state === "empty"
                    ? (d.emptyNote ??
                      "Enrichment ran — nothing found for this business.")
                    : d.state === "failed"
                      ? "Enrichment errored on the last run. Retry it from the workbench."
                      : d.state === "running"
                        ? "Scan in progress — results land here when it finishes."
                        : d.ghostNote}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Expert findings */}
      {lead.expertFindings.length > 0 ? (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">
            Expert findings
          </h2>
          <div className="flex flex-col gap-3">
            {lead.expertFindings.map((f) => (
              <div
                key={f.key}
                className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800"
              >
                <b>{f.title}:</b> {f.body}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Touches */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">
          This lead&rsquo;s touches
        </h2>
        {lead.touches.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
            No touch yet. Generate from the Touchpoints tab.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {lead.touches.map((t) => (
              <div
                key={t.draftId}
                className="rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-800">
                    Touch {t.seq} of {t.of}
                    <span className="ml-2 font-mono text-[11px] font-normal text-slate-400">
                      {t.channel}
                    </span>
                  </span>
                  <span
                    className={`inline-flex rounded border px-1.5 py-0.5 text-xs ${t.status === "Sent" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}
                  >
                    {t.status}
                  </span>
                </div>
                {t.subject ? (
                  <p className="mt-2 text-sm font-medium text-slate-800">
                    {t.subject}
                  </p>
                ) : null}
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">
                  {t.body}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="font-mono text-[11px] uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div
        className={`mt-0.5 truncate text-lg text-slate-800 ${mono ? "font-mono text-sm" : "font-mono"}`}
      >
        {value}
      </div>
    </div>
  );
}
