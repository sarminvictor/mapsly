import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { AgPricingPage } from "@/components/marketing/for-agencies-v2/AgPricingPage";
import { getLocaleAlternates } from "@/i18n/pathnames";
import { CANONICAL_ORIGIN } from "@/lib/seo/canonical";

// /pricing · the standalone pricing surface.
//
// Until now pricing existed ONLY as the `#pricing` anchor inside the agency
// landing, so nothing external could link to it: /pricing returned a 404 for
// every ad, comparison page, cold email and AI answer that tried. This route
// is that missing landing target. It canonicalises to itself (unlike
// /for-agencies, which dedups to `/`) because it is a distinct page with
// content the homepage band does not carry — the full five-tier ladder + FAQ.

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pricing.meta" });

  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: `${CANONICAL_ORIGIN}/pricing`,
      languages: getLocaleAlternates("/pricing"),
    },
    openGraph: {
      type: "website",
      siteName: "Mapsly",
      title: t("og_title"),
      description: t("og_description"),
      url: `${CANONICAL_ORIGIN}/pricing`,
    },
    twitter: {
      card: "summary_large_image",
      title: t("og_title"),
      description: t("og_description"),
    },
    robots: { index: true, follow: true },
  };
}

// Static marketing surface: no auth, no cookies, no DB read. Nothing here is
// request-scoped, so it prerenders cleanly under cacheComponents with no
// Suspense wrap needed (cache-components.md Pattern 2 does not apply).
export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AgPricingPage />;
}
