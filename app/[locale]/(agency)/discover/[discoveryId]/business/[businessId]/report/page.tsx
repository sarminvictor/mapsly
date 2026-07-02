/**
 * Proof Pack one-pager (WP5-5) ·
 * `/(agency)/discover/[discoveryId]/business/[businessId]/report`
 *
 * The client-ready artifact: a print-CSS page over the SAME `getLeadDetail`
 * payload the drawer + business page render, branded with the agency's name.
 * "Download PDF" is the browser's print-to-PDF (PrintButton → window.print());
 * the print styles isolate the sheet from the portal chrome. Evidence keeps
 * the vs-cell context baked into the loader's values ("38/100 · cell median
 * 58"), findings keep the confidence-capped exposure framing, and the footer
 * carries the public-sources provenance + disclaimer (WP7-1/7-3 alignment).
 *
 * Per `.claude/rules/cache-components.md`:
 *   - Pattern 2 · SYNC default export; the async body (auth + DB) renders in a
 *     Suspense boundary so the shell prerenders.
 *   - Pattern 5 · no `export const dynamic`.
 * Auth + scoping mirror the sibling business page exactly: session →
 * AgencyMember → discovery belongs to the agency → business in THIS
 * discovery's cells → shared loader. Read-only; no external API. English-only.
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound, unauthorized } from "next/navigation";
import { setRequestLocale } from "next-intl/server";

import { auth } from "@/lib/auth";
import { Link, redirect } from "@/i18n/navigation";
import prisma from "@/lib/prisma";
import { getLeadDetail } from "@/modules/agency-portal/discover/lead-detail";
import { PrintButton } from "./PrintButton";
import { ProofPackSheet } from "./ProofPackSheet";
import styles from "./report.module.css";

export const metadata: Metadata = {
  title: "Proof Pack · Mapsly",
  robots: { index: false, follow: false },
};

interface PageProps {
  params: Promise<{ locale: string; discoveryId: string; businessId: string }>;
}

export default function ProofPackPage({ params }: PageProps) {
  return (
    <Suspense fallback={null}>
      <ProofPackBody params={params} />
    </Suspense>
  );
}

async function ProofPackBody({ params }: PageProps) {
  const { locale, discoveryId, businessId } = await params;
  setRequestLocale(locale);

  const session = await auth();
  if (!session?.user?.id) unauthorized();

  const member = await prisma.agencyMember.findFirst({
    where: { userId: session.user.id },
    select: { agencyId: true, agency: { select: { name: true } } },
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
  if (!discovery || discovery.agencyId !== agencyId) notFound();

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

  const lead = await getLeadDetail(businessId, agencyId, discoveryId);
  if (!lead) notFound();

  const agencyName = member.agency?.name ?? "Your agency";
  // The route is request-scoped (auth above) — safe to read the clock here.
  const retrievedOn = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="p-6">
      {/* Screen-only toolbar (hidden in print). */}
      <div className={styles.toolbar}>
        <Link
          href={{
            pathname: "/discover/[discoveryId]/business/[businessId]",
            params: { discoveryId, businessId },
          }}
          className="font-mono text-xs text-indigo-600 hover:text-indigo-700"
        >
          ← Business detail
        </Link>
        <PrintButton />
      </div>

      {/* In-portal Proof Pack — no "powered by Mapsly" tell (that's the shared
          public variant's viral marker, WP6-10). */}
      <ProofPackSheet
        lead={lead}
        agencyName={agencyName}
        retrievedOn={retrievedOn}
      />
    </div>
  );
}
