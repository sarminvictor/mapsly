"use client";

/**
 * Retargeting pixels · /l only, behind explicit consent (plan #7).
 *
 * Injects the Meta Pixel (fbq) and/or Google tag (gtag) ONLY when:
 *   1. the visitor explicitly accepted ads cookies (`mapsly_consent.ads`), AND
 *   2. the matching env id exists (NEXT_PUBLIC_META_PIXEL_ID /
 *      NEXT_PUBLIC_GOOGLE_ADS_ID).
 *
 * NO-OP otherwise — we ship before Viktor creates the ad accounts; with no
 * ids set this component renders nothing forever. PageView fires on load
 * post-consent (fbq track call · gtag config's automatic page_view).
 *
 * Consent is read from the cookie on mount AND from the `mapsly:consent`
 * event the ConsentBar dispatches, so accepting loads pixels without a
 * reload. Once loaded, pixels stay for the page's lifetime (consent can only
 * be granted once per page-load; declining never reaches this state).
 *
 * HARD RULE (decision log #7): never push recipient PII into pixel events.
 * Only the standard PageView fires here. Ad audiences = pixel clickers +
 * opted-in list uploads; the raw cold list is NEVER uploaded to Meta/Google.
 *
 * Mounted on app/l/[token]/page.tsx only — not the global layout.
 */

import { useEffect, useState } from "react";
import Script from "next/script";

import { CONSENT_EVENT, parseConsentCookie, pixelsToLoad } from "../consent";

// NEXT_PUBLIC_* values are inlined into the client bundle at build time.
const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID;
const GOOGLE_ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;

/** Conservative id allowlist — the ids come from OUR env, but they are
 * interpolated into inline script text, so keep the format strict anyway. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,40}$/;

function safe(id: string | null): string | null {
  return id && SAFE_ID.test(id) ? id : null;
}

export function RetargetingPixels() {
  const [ids, setIds] = useState<{
    meta: string | null;
    google: string | null;
  }>({ meta: null, google: null });

  useEffect(() => {
    const compute = () => {
      try {
        const consent = parseConsentCookie(document.cookie);
        const next = pixelsToLoad(consent, META_PIXEL_ID, GOOGLE_ADS_ID);
        // Only ever upgrade null → id; never unload a live pixel mid-page.
        setIds((prev) => ({
          meta: prev.meta ?? safe(next.meta),
          google: prev.google ?? safe(next.google),
        }));
      } catch {
        /* never break the page over analytics */
      }
    };
    compute();
    window.addEventListener(CONSENT_EVENT, compute);
    return () => window.removeEventListener(CONSENT_EVENT, compute);
  }, []);

  return (
    <>
      {ids.meta ? (
        <Script id="mapsly-meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${ids.meta}');fbq('track','PageView');`}
        </Script>
      ) : null}
      {ids.google ? (
        <>
          <Script
            id="mapsly-gtag-src"
            src={`https://www.googletagmanager.com/gtag/js?id=${ids.google}`}
            strategy="afterInteractive"
          />
          <Script id="mapsly-gtag-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${ids.google}');`}
          </Script>
        </>
      ) : null}
    </>
  );
}
