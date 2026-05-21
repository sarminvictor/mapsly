import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { SmbHero } from "@/components/marketing/for-businesses/SmbHero";
import { SmbPitch } from "@/components/marketing/for-businesses/SmbPitch";
import { SmbMirror } from "@/components/marketing/for-businesses/SmbMirror";
import { SmbSignals } from "@/components/marketing/for-businesses/SmbSignals";
import { SmbPricing } from "@/components/marketing/for-businesses/SmbPricing";
import { SmbFAQ } from "@/components/marketing/for-businesses/SmbFAQ";
import { SmbCTA } from "@/components/marketing/for-businesses/SmbCTA";
import type { Locale } from "@/i18n/routing";
import { getLocaleAlternates, getLocalizedPath } from "@/i18n/pathnames";

// For-Businesses marketing landing · mapsly.ai/for-businesses (and locale-pathnamed
// equivalents: /es/para-empresas, /en-ca/for-businesses, /fr/pour-entreprises).
//
// Maria's voice per `.claude/rules/ui-ux-smb.md`. Warm cream + coral palette,
// plain English (no MSI/CTR/LCP/3-pack/NAP), outcome-over-metric framing,
// mobile-first density (4-tile max above the fold). Industry vocabulary
// anchors on "patients" / med-spa (most relatable single-vertical example).
//
// Static under cacheComponents PPR — copy + sample numbers only update on
// phase ships, so tag-revalidated `marketing-for-businesses`. All blocks
// are pure server components (zero client JS). FAQ uses native
// <details>/<summary> for accordion behavior — no hydration cost.
//
// SEO: full metadata + hreflang for all 4 locales + Organization JSON-LD
// + FAQPage JSON-LD (lives in <SmbFAQ>). Per `.claude/rules/seo.md` and
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
    namespace: "for_businesses.meta",
  });

  const path = getLocalizedPath("/for-businesses", locale as Locale);

  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: `${CANONICAL_ORIGIN}${path}`,
      languages: getLocaleAlternates("/for-businesses"),
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

export default async function ForBusinessesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("for_businesses");

  // Organization JSON-LD · helps Google bind brand + sitelinks across pages.
  // FAQPage JSON-LD lives in <SmbFAQ> so its key list stays co-located with
  // the rendered Q&A copy (one source of truth, less drift risk).
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
      <SmbHero t={t} />
      <SmbPitch t={t} />
      <SmbMirror t={t} />
      <SmbSignals t={t} />
      <SmbPricing t={t} />
      <SmbFAQ t={t} />
      <SmbCTA t={t} />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(orgSchema) }}
      />
    </>
  );
}
