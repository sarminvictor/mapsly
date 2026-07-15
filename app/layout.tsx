import type { Metadata } from "next";
import "./globals.css";

import { GtmContainer } from "@/modules/analytics/GtmContainer";
import { CANONICAL_ORIGIN } from "@/lib/seo/canonical";

export const metadata: Metadata = {
  title: "Mapsly — Local business intelligence",
  description:
    "Signal-driven intelligence for local businesses. Reviews, ads, search, competitors, website health — refreshed weekly.",
  // Same origin as every canonical/hreflang/sitemap URL — must be the host that
  // answers 200 (www), not the redirecting apex. See lib/seo/canonical.ts.
  metadataBase: new URL(CANONICAL_ORIGIN),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        {/* No FreightBig Pro preloads here. They were added (917af9b, 2026-06-10)
            when `/` WAS the SMB landing; 93cf515 flipped `/` and /for-agencies to
            AgLanding, which renders Space Grotesk + Bricolage via next/font and
            references FreightBig ZERO times. Being in the ROOT layout they still
            fetched 50,292 B at high priority on every route — inverting the whole
            preload budget, since the three faces that DO render text got none.
            The @font-face rules stay in globals.css, so the real consumers
            (/l/[token], /checkout/return) still load FreightBig on demand; they
            are font-display:swap with metric-matched fallbacks, so the only cost
            there is a brief FOUT. Re-add per-route if that ever matters. */}
        {/* Montserrat ships 400/600/700 only — 500 is referenced nowhere
            (Montserrat is consumed solely via --font-landing-body; the
            font-weight:500 rules in globals.css are Inter nav items). */}
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- App Router root layout (Next 13+) is the correct place; the lint rule is for pages/_document.js in Pages Router */}
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&family=Inter:wght@400..800&family=JetBrains+Mono:wght@400..600&family=Montserrat:wght@400;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        {/* Google Tag Manager · USER pages only — excludes /admin, /dev, and
            the dev.mapsly.ai host (gated in the component). GTM owns ALL tags:
            GA4 (G-N2RQLN3KED), Meta Pixel (1809319550066351), Smartlook. The
            direct GA4 gtag was removed — GTM is the single source (no dupes). */}
        <GtmContainer />
      </body>
    </html>
  );
}
