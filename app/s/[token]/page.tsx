/**
 * Public agency-branded share page · `/s/[token]` (WP6-10).
 *
 * The viral one-pager: a prospect (or the agency's client) opens a shared audit
 * link. Renders the SAME ProofPackSheet the in-portal report uses, branded
 * "Prepared by {Agency} · powered by Mapsly". Sits OUTSIDE the `[locale]` tree
 * (a direct-share artifact — see middleware.ts `/s/` bypass), is no-indexed, and
 * kept out of the sitemap. Resolves by the unguessable 16-digit token
 * (Report.publicShareId); possession of the link is the authorization (same
 * capability model as /l and /r). Each open increments viewCount + a funnel
 * event, so the drawer can surface "opened Nx by the prospect".
 *
 * Per `.claude/rules/cache-components.md` Pattern 2: sync export + a Suspense'd
 * async body so the shell prerenders while the data streams. Bad/expired token →
 * 404 status (metadata resolves before the stream). Read-only; no external API.
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ProofPackSheet } from "@/app/[locale]/(agency)/discover/[discoveryId]/business/[businessId]/report/ProofPackSheet";
import { resolveShareReport } from "@/modules/reports/share";

const BASE_METADATA: Metadata = {
  title: "Prospect audit · Mapsly",
  description: "A prospect audit prepared with Mapsly.",
  robots: { index: false, follow: false },
};

/** 16-digit share token (Report.publicShareId via generateLandingToken). */
const TOKEN_RE = /^[1-9][0-9]{15}$/;

export function generateMetadata(): Metadata {
  return BASE_METADATA;
}

export default function SharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return (
    <Suspense fallback={null}>
      <ShareBody params={params} />
    </Suspense>
  );
}

async function ShareBody({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!TOKEN_RE.test(token)) notFound();

  const resolved = await resolveShareReport(token);
  if (!resolved) notFound();

  // The share was retrieved now (request-scoped) — safe to read the clock.
  const retrievedOn = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div style={{ background: "#f6f7fb", minHeight: "100vh", padding: "24px" }}>
      <ProofPackSheet
        lead={resolved.lead}
        agencyName={resolved.agencyName}
        retrievedOn={retrievedOn}
        poweredBy
      />
    </div>
  );
}
