/**
 * Public landing page · `/l/[slug]-[token]`.
 *
 * The personalized proposal we email a qualified SMB. Sits OUTSIDE the
 * `[locale]` tree (a direct-share artifact — see middleware.ts bypass), is
 * no-indexed, kept out of the sitemap, and resolves by the unguessable token
 * (cosmetic slug verified → 404 on mismatch).
 *
 * 404 status: `generateMetadata` resolves the token and calls `notFound()` for
 * a bad/expired link — metadata runs BEFORE the response streams, so the status
 * is a real 404 (a `notFound()` inside the Suspense'd body would flush a 200
 * shell first). The body re-resolves to render. Both `resolveLandingToken` and
 * `getLandingData` NEXT_PHASE-guard to null so the Vercel build never opens a
 * Neon WebSocket; metadata short-circuits at build too (no notFound at build).
 *
 * Per `.claude/rules/cache-components.md` Pattern 2: sync export + Suspense'd
 * async body so the shell prerenders while the data streams.
 */

import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

// Landing-scoped stylesheet — the desktop values + breakpoint overrides for
// every `landing-*` / `hero-*` class. Lives next to the components that use
// it; this page is the only route that renders LandingView.
import "@/modules/smb-landing/landing.css";

import { ConsentBar } from "@/modules/smb-landing/components/ConsentBar";
import { GoogleTag } from "@/modules/smb-landing/components/GoogleTag";
import { LandingView } from "@/modules/smb-landing/components/LandingView";
import { RetargetingPixels } from "@/modules/smb-landing/components/RetargetingPixels";
import {
  getLandingData,
  resolveLandingToken,
} from "@/modules/smb-landing/queries";

const BASE_METADATA: Metadata = {
  title: "Mapsly · your local business briefing",
  description:
    "A personalized snapshot of how your business shows up locally — reviews, search, ads, website, and where you stand.",
  robots: { index: false, follow: false },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  // Skip the DB lookup at build (Pattern 1) — never notFound() during build.
  if (process.env.NEXT_PHASE === "phase-production-build") return BASE_METADATA;
  const { token } = await params;
  const resolved = await resolveLandingToken(token);
  // Bad/expired token → 404 *status* (metadata resolves before the stream).
  if (!resolved) notFound();
  return BASE_METADATA;
}

export default function LandingTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  return (
    <>
      <Suspense fallback={null}>
        <LandingBody params={params} />
      </Suspense>
      {/* Client leaves, /l only (never the global layout): the ad-cookie
          consent bar + the consent-gated Meta/Google pixels (plan #7). Both
          are NO-OPs until the visitor chooses / the env ids exist. */}
      <ConsentBar />
      <RetargetingPixels />
      {/* GA4 first-party analytics (gtag.js) — always-on, landing-only. */}
      <GoogleTag />
    </>
  );
}

async function LandingBody({ params }: { params: Promise<{ token: string }> }) {
  const { token: param } = await params;

  const resolved = await resolveLandingToken(param);
  if (!resolved) notFound();

  const data = await getLandingData(resolved.businessId);
  if (!data) notFound();

  return <LandingView data={{ ...data, token: resolved.token }} />;
}
