import type { Metadata } from "next";
import "./globals.css";

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
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- App Router root layout (Next 13+) is the correct place; the lint rule is for pages/_document.js in Pages Router */}
        <link
          href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&family=Inter:wght@400..800&family=JetBrains+Mono:wght@400..600&family=Montserrat:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
