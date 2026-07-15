import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { AgLanding } from "@/components/marketing/for-agencies-v2/AgLanding";
import { getLocaleAlternates } from "@/i18n/pathnames";
import { CANONICAL_ORIGIN } from "@/lib/seo/canonical";

// Homepage · mapsly.ai/ — the agency landing IS the homepage (agencies are
// the primary channel, 2026-06). Rendered directly (no redirect) so there's
// no flash of a prior page. The SMB landing lives at /for-businesses, unlinked
// from nav + footer. The same content is also served at /for-agencies, which
// canonicalises here.
//
// Lives in (marketing-v2) so it gets the new dark chrome + fonts. The legacy
// (marketing) group keeps the cream chrome for /privacy, /terms, etc.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "for_agencies.meta" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: `${CANONICAL_ORIGIN}/`,
      languages: getLocaleAlternates("/"),
    },
    openGraph: {
      type: "website",
      siteName: "Mapsly",
      title: t("og_title"),
      description: t("og_description"),
      url: `${CANONICAL_ORIGIN}/`,
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
  return <AgLanding />;
}
