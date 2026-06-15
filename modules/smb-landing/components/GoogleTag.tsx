"use client";

/**
 * GA4 Google tag (gtag.js) — SITE-WIDE. Mounted in the root `app/layout.tsx`
 * `<body>`, so it loads on every route (marketing, landings, checkout, portals,
 * admin, dev) under one GA4 property — the standard "put this on every page"
 * gtag snippet.
 *
 * First-party page analytics, always-on (not consent-gated) — distinct from the
 * ad-RETARGETING pixels in RetargetingPixels.tsx (those stay behind the /l
 * ad-cookie consent bar). The campaign is US-focused, so it runs always-on to
 * capture all traffic, matching a standard gtag install. If EU coverage is ever
 * needed, gate this on a site-wide consent choice.
 *
 * Id comes from NEXT_PUBLIC_GA4_ID, defaulting to the mapsly GA4 property so it
 * ships via the gitlab→Vercel deploy without a separate env change.
 */

import Script from "next/script";

// NEXT_PUBLIC_* is inlined at build time; the literal default makes the tag
// live on deploy without setting a Vercel env var first.
const GA4_ID = process.env.NEXT_PUBLIC_GA4_ID ?? "G-N2RQLN3KED";

// GA4 measurement-id shape ("G-XXXXXXXX") — the id is interpolated into inline
// script text, so validate the format defensively even though it's our own.
const SAFE_GA4 = /^G-[A-Z0-9]{6,15}$/;

export function GoogleTag() {
  if (!GA4_ID || !SAFE_GA4.test(GA4_ID)) return null;
  return (
    <>
      <Script
        id="ga4-src"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA4_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${GA4_ID}');`}
      </Script>
    </>
  );
}
