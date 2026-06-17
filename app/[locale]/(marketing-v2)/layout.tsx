/**
 * Marketing-v2 chrome layout · 2026-06 redesign (yellow #FFFD54 / ink #22271C).
 *
 * Pages migrate here one at a time as they get the new design (first:
 * /for-businesses). The group ships its own dark header + footer, so it
 * lives OUTSIDE the legacy `(marketing)` group whose layout injects the
 * cream chrome. URLs are unchanged — route groups don't affect paths.
 *
 * Fonts: Space Grotesk (body + heading base) and Bricolage Grotesque
 * (heading accent face), self-hosted via next/font/google — downloaded at
 * build time, served same-origin, zero runtime requests to Google. Exposed
 * as `--font-fb-sg` / `--font-fb-bric`, consumed by fb.css tokens.
 *
 * Same cacheComponents discipline as the legacy marketing layout
 * (Pattern 2, INC-2026-05-21 B.5): sync outer shell, async header/footer
 * inside <Suspense> so the i18n awaits never block a descendant route's
 * shell prerender. Header is absolutely positioned over the page's hero
 * gradient (per the mock), so its fallback is height-neutral — no CLS.
 */
import { Suspense, type ReactNode } from "react";
import { Space_Grotesk, Bricolage_Grotesque } from "next/font/google";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { FbLogo } from "@/components/marketing/for-businesses/FbLogo";
import { StickyHeader } from "@/components/marketing/for-businesses/StickyHeader";
import "@/components/marketing/for-businesses/fb.css";

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

interface LayoutParams {
  locale: string;
}

export default function MarketingV2Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<LayoutParams>;
}) {
  return (
    <div className={`fb-scope ${spaceGrotesk.variable} ${bricolage.variable}`}>
      <Suspense fallback={<header className="fb-header" aria-hidden />}>
        <V2Header params={params} />
      </Suspense>

      <main style={{ flex: 1 }}>{children}</main>

      <Suspense fallback={<footer className="fb-footer fb-dark" aria-hidden />}>
        <V2Footer params={params} />
      </Suspense>
    </div>
  );
}

async function V2Header({ params }: { params: Promise<LayoutParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("marketing_v2.header");

  return (
    <StickyHeader>
      <div className="fb-container fb-header-row">
        <Link href="/" aria-label={t("home_aria")}>
          {/* 140px wide per design (SVG is 141×40 → height 40 ≈ width 140) */}
          <FbLogo height={40} />
        </Link>
        <nav aria-label={t("nav_aria")} className="fb-nav">
          {/* FIXME before a second route migrates into (marketing-v2):
              derive aria-current from the active segment instead of
              pinning it — today the group hosts only /for-businesses. */}
          <Link
            href="/for-businesses"
            className="fb-navlink"
            aria-current="page"
          >
            {t("for_businesses")}
          </Link>
          <Link href="/for-agencies" className="fb-navlink">
            {t("for_agencies")}
          </Link>
          {/* In-page anchor to the pricing band — plain <a>, not a route. */}
          <a href="#pricing" className="fb-navlink">
            {t("price")}
          </a>
          <Link
            href="/signin"
            className="fb-btn fb-btn--nav"
            data-testid="marketing-signin-cta"
          >
            {t("signin")}
          </Link>
        </nav>
      </div>
    </StickyHeader>
  );
}

async function V2Footer({ params }: { params: Promise<LayoutParams> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("marketing_v2");

  return (
    <footer className="fb-footer fb-dark">
      <div className="fb-container fb-footer-row">
        <Link href="/" aria-label={t("header.home_aria")}>
          <FbLogo height={32} />
        </Link>
        <nav aria-label={t("footer.nav_aria")} className="fb-footer-nav">
          <Link href="/for-businesses">{t("header.for_businesses")}</Link>
          <Link href="/for-agencies">{t("header.for_agencies")}</Link>
          <Link href="/privacy">{t("footer.privacy")}</Link>
          <Link href="/terms">{t("footer.terms")}</Link>
          <Link href="/cookies">{t("footer.cookies")}</Link>
          <Link href="/refunds">{t("footer.refunds")}</Link>
        </nav>
        {/* Year is static per INC-2026-05-19-09 — new Date() is forbidden
            under cacheComponents PPR. Bump on annual redeploy. */}
        <span className="fb-footer-rights">
          {t("footer.rights", { year: 2026 })}
        </span>
      </div>
    </footer>
  );
}
