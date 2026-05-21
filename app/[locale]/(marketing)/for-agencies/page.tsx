import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { AgencyHero } from "@/components/marketing/for-agencies/AgencyHero";
import { AgencyPitch } from "@/components/marketing/for-agencies/AgencyPitch";
import { AgencyTiers } from "@/components/marketing/for-agencies/AgencyTiers";
import { AgencySampleList } from "@/components/marketing/for-agencies/AgencySampleList";
import { AgencyCalculator } from "@/components/marketing/for-agencies/AgencyCalculator";
import { AgencySignals } from "@/components/marketing/for-agencies/AgencySignals";
import { AgencyFAQ } from "@/components/marketing/for-agencies/AgencyFAQ";
import { AgencyCTA } from "@/components/marketing/for-agencies/AgencyCTA";
import type { Locale } from "@/i18n/routing";
import {
  getLocaleAlternates,
  getLocalizedPath,
} from "@/i18n/pathnames";

// For-Agencies marketing landing · mapsly.ai/for-agencies (and locale-pathnamed
// equivalents: /es/para-agencias, /en-ca/for-agencies, /fr/pour-agences).
//
// Static under cacheComponents PPR — copy + signal counts only update on
// phase ships, so tag-revalidated `marketing-for-agencies`. All blocks are
// server-rendered except <AgencyCalculator> (interactive sizing widget).
//
// Architecture per Task B.2 acceptance:
//   1. Hero (Tom's voice · numbers over adjectives)
//   2. Pitch · old way vs Mapsly way comparison
//   3. Tiers · 4 pricing cards ($49 Solo / $99 Growth / $249 Pro / $499 Boutique)
//   4. Sample list preview (a real-looking saved-search return)
//   5. Calculator · "how many qualified leads in your metro?"
//   6. Signals · signal-vocabulary teaser (74 filters across 8 categories)
//   7. FAQ · 5 agency-specific questions + FAQPage JSON-LD
//   8. CTA · closing band with trust badges
//
// SEO: full metadata + hreflang for all 4 locales + Organization JSON-LD
// (FAQ schema lives in <AgencyFAQ>). Per `.claude/rules/seo.md` and
// `.claude/rules/cache-components.md` Pattern 1 — no DB reads, all i18n
// reads are next-intl getTranslations which is build-safe.

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

  // Organization JSON-LD · helps Google bind brand + sitelinks across pages
  const orgSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Mapsly",
    url: CANONICAL_ORIGIN,
    description: t("meta.description"),
    sameAs: [],
  };

  return (
    <>
      <AgencyHero t={t} />
      <AgencyPitch t={t} />
      <AgencyTiers t={t} />
      <AgencySampleList t={t} />
      <AgencyCalculator />
      <AgencySignals t={t} />
      <AgencyFAQ t={t} />
      <AgencyCTA t={t} />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
      />
    </>
  );
}
