import type { ReactNode } from "react";
import { Space_Grotesk, Bricolage_Grotesque } from "next/font/google";

import { Link } from "@/i18n/navigation";
import { FbLogo } from "@/components/marketing/for-businesses/FbLogo";
import "@/components/marketing/for-businesses/fb.css";
import "./signin.css";

// Auth-page chrome in the marketing-v2 design language: the homepage's
// indigo hero gradient full-bleed, grid overlay, scattered glow dots, white
// wordmark top-left, and a centered white card. Reuses fb.css (tokens,
// .fb-btn, .fb-dot) inside a `.fb-scope` wrapper — same fonts as the
// (marketing-v2) layout, loaded here because /signin lives outside that
// route group (auth pages keep minimal chrome: no nav, no footer).
//
// Deliberately sync + presentation-only (no async, no next-intl calls) so
// BOTH the server /signin page and the client /signin/check-email page can
// render it without crossing a server/client boundary.

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fb-sg",
});

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fb-bric",
});

export function SignInShell({
  children,
  badge,
  homeLabel,
  centerCard = false,
}: {
  children: ReactNode;
  /** Optional glass-capsule line above the card (e.g. the free-leads pill). */
  badge?: string;
  /** Localized accessible name for the logo home link (shell is intl-free). */
  homeLabel: string;
  /** Center-align card content (check-email). */
  centerCard?: boolean;
}) {
  return (
    <div
      className={`fb-scope si-page ${spaceGrotesk.variable} ${bricolage.variable}`}
    >
      <header className="si-top">
        <Link href="/" aria-label={homeLabel}>
          <FbLogo height={26} />
        </Link>
      </header>

      {/* Decorative glow dots — .fb-dot recipe from fb.css (nth-of-type
          staggers the pulse; hidden from AT, pointer-events: none). */}
      <span className="fb-dot" style={{ top: "16%", left: "9%" }} aria-hidden />
      <span
        className="fb-dot"
        style={{ top: "28%", right: "8%" }}
        aria-hidden
      />
      <span
        className="fb-dot"
        style={{ bottom: "24%", left: "13%" }}
        aria-hidden
      />
      <span
        className="fb-dot"
        style={{ bottom: "12%", right: "11%" }}
        aria-hidden
      />

      <main className="si-main">
        <div className="si-wrap">
          {badge ? (
            <p className="si-pill">
              <span className="si-pill-dot" aria-hidden />
              {badge}
            </p>
          ) : null}
          <div className={`si-card${centerCard ? " si-card--center" : ""}`}>
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
