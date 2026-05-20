import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { Hero } from "@/components/marketing/Hero";
import { Pipeline } from "@/components/marketing/Pipeline";
import { AudienceSplit } from "@/components/marketing/AudienceSplit";
import { SignalsPreview } from "@/components/marketing/SignalsPreview";
import { FAQ } from "@/components/marketing/FAQ";
import { FinalCTA } from "@/components/marketing/FinalCTA";
import type { Locale } from "@/i18n/routing";

// Main marketing landing · mapsly.ai/
// Public, anonymous. Static under cacheComponents PPR — the only thing
// that changes is when we update copy or signal counts. Tag-revalidated
// on next phase ship.
//
// Architecture: 6-block scroll story per `_design/landing/index.html`.
//   1. Hero with audience switcher (SMB cream+coral / Agency cool-gray+indigo)
//   2. Pipeline · 4-step "how it works"
//   3. AudienceSplit · "which side of the table" head-to-head
//   4. SignalsPreview · 6 example signals as plain English
//   5. FAQ · 5 questions with JSON-LD FAQPage schema for rich results
//   6. FinalCTA · closing audience split
//   (layout.tsx provides nav + footer chrome around all of it)
//
// Performance budget: Lighthouse mobile Performance ≥ 90, LCP ≤ 2.0s,
// CLS ≤ 0.05. Server-rendered with no client JS in any component — the
// FAQ uses native <details>/<summary> for accordion behavior. No images
// at MVP scope; geometry-only SVG icons inlined. First-load JS budget
// well under 200 kB.
//
// SEO: full metadata + hreflang for all 4 locales + Organization JSON-LD
// inline. FAQPage schema lives in the FAQ component.

const CANONICAL_ORIGIN = "https://mapsly.ai";

const LOCALE_TO_PATH: Record<Locale, string> = {
  en: "/",
  es: "/es",
  "en-CA": "/en-ca",
  fr: "/fr",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing.meta" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: `${CANONICAL_ORIGIN}${LOCALE_TO_PATH[locale as Locale] ?? "/"}`,
      languages: {
        "en-US": "/",
        "es-US": "/es",
        "en-CA": "/en-ca",
        "fr-CA": "/fr",
        "x-default": "/",
      },
    },
    openGraph: {
      type: "website",
      siteName: "Mapsly",
      title: t("og_title"),
      description: t("og_description"),
      url: `${CANONICAL_ORIGIN}${LOCALE_TO_PATH[locale as Locale] ?? "/"}`,
    },
    twitter: {
      card: "summary_large_image",
      title: t("og_title"),
      description: t("og_description"),
    },
    robots: { index: true, follow: true },
  };
}

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("landing");

  // Organization JSON-LD · helps Google bind brand + sitelinks
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
      <Hero locale={locale as Locale} t={t} />
      <Pipeline t={t} />
      <AudienceSplit t={t} />
      <SignalsPreview t={t} />
      <FAQ t={t} />
      <FinalCTA t={t} />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
      />
    </>
  );
}
