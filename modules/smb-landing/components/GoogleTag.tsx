"use client";

/**
 * GA4 Google tag (gtag.js) for the public landing pages (`/l/[token]`).
 *
 * First-party analytics — loaded on EVERY landing view (not consent-gated):
 * distinct from the ad-RETARGETING pixels in RetargetingPixels.tsx, which stay
 * behind the ad-cookie consent bar. GA4 is page-measurement, and the cold
 * campaign is US-only, so it runs always-on to capture all traffic (the same
 * behavior as a standard gtag snippet). If EU/consent coverage is ever needed,
 * gate this on `mapsly_consent.analytics` like the retargeting pixels do.
 *
 * Id comes from NEXT_PUBLIC_GA4_ID, defaulting to the mapsly GA4 property so it
 * ships via the gitlab→Vercel deploy without a separate env change. Mounted on
 * app/l/[token]/page.tsx only — never the global app layout.
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
