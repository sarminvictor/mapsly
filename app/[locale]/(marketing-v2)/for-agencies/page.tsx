import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { AgHero } from "@/components/marketing/for-agencies-v2/AgHero";
import { AgPitch } from "@/components/marketing/for-agencies-v2/AgPitch";
import { AgHunter } from "@/components/marketing/for-agencies-v2/AgHunter";
import { AgPricing } from "@/components/marketing/for-agencies-v2/AgPricing";
import { AgPlatform } from "@/components/marketing/for-agencies-v2/AgPlatform";
import { AgFAQ } from "@/components/marketing/for-agencies-v2/AgFAQ";
import { AgCTA } from "@/components/marketing/for-agencies-v2/AgCTA";
import type { Locale } from "@/i18n/routing";
import { getLocaleAlternates, getLocalizedPath } from "@/i18n/pathnames";

import "@/components/marketing/for-agencies-v2/ag.css";

// For-Agencies marketing landing · mapsly.ai/for-agencies (and locale-
// pathnamed equivalents: /es/para-agencias, /en-ca/for-agencies,
// /fr/pour-agences).
//
// 2026-06 redesign: shares the for-businesses design system — same chrome
// (header/footer + fonts) from the (marketing-v2) group layout, same
// fb.css tokens, yellow #FFFD54, logo and sticky-header behaviour. The
// agency theme recolours the hero (cool indigo) + heading accents
// (violet); the FAQ + CTA + footer are identical in style to the SMB page,
// only the copy differs (`ag.css`).
//
// Tom's voice per `.claude/rules/ui-ux-agency.md`: numbers over adjectives,
// jargon OK (Hunter, signals, LCP, 3-pack), imperative CTAs. All blocks are
// pure server components (zero client JS) — the FAQ uses native
// <details>/<summary>, no hydration cost.
//
// SEO: full metadata + hreflang for all 4 locales + Organization JSON-LD
// + FAQPage JSON-LD (lives in <AgFAQ>). Per `.claude/rules/seo.md` and
// `.claude/rules/cache-components.md` Pattern 1 — no DB reads, all i18n
// reads via next-intl getTranslations which is build-safe.

const CANONICAL_ORIGIN = "https://mapsly.ai";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "for_agencies.meta",
  });

  const path = getLocalizedPath("/for-agencies", locale as Locale);

  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: `${CANONICAL_ORIGIN}${path}`,
      languages: getLocaleAlternates("/for-agencies"),
    },
    openGraph: {
      type: "website",
      siteName: "Mapsly",
      title: t("og_title"),
      description: t("og_description"),
      url: `${CANONICAL_ORIGIN}${path}`,
    },
    twitter: {
      card: "summary_large_image",
      title: t("og_title"),
      description: t("og_description"),
    },
    robots: { index: true, follow: true },
  };
}

export default async function ForAgenciesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("for_agencies");

  // Organization JSON-LD · helps Google bind brand + sitelinks across pages.
  // FAQPage JSON-LD lives in <AgFAQ> so its key list stays co-located with
  // the rendered Q&A copy (one source of truth, less drift risk).
  const orgSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Mapsly",
    url: CANONICAL_ORIGIN,
    description: t("meta.description"),
  };

  return (
    <>
      <AgHero t={t} />
      <AgPitch t={t} />
      {/* Sticky-stacking pair: Hunter pins to the top and the Pricing band
          scrolls up over it (same mechanism as the for-businesses page). */}
      <div className="fb-stack-group fb-ag-stack">
        <AgHunter t={t} />
        <AgPricing t={t} />
      </div>
      <AgPlatform t={t} />
      <AgFAQ t={t} />
      <AgCTA t={t} />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
      />
    </>
  );
}
