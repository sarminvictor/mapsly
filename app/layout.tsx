import type { Metadata } from "next";
import "./globals.css";

import { GoogleTag } from "@/modules/smb-landing/components/GoogleTag";

export const metadata: Metadata = {
  title: "Mapsly — Local business intelligence",
  description:
    "Signal-driven intelligence for local businesses. Reviews, ads, search, competitors, website health — refreshed weekly.",
  metadataBase: new URL("https://mapsly.ai"),
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
        {/* Preload the landing headline faces for faster LCP: Semibold (hero
            H1, card titles) and Bold Italic (TopBar "Mapped." em + hero coral
            emphasis — used above the fold but previously only font-display:
            swap'd in late). */}
        <link
          rel="preload"
          href="/fonts/freightbigpro-semibold.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/fonts/freightbigpro-bolditalic.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
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
        {/* GA4 (gtag.js) · site-wide first-party analytics — every route. */}
        <GoogleTag />
      </body>
    </html>
  );
}
