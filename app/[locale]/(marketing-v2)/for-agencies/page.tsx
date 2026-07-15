import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { AgLanding } from "@/components/marketing/for-agencies-v2/AgLanding";
import { getLocaleAlternates } from "@/i18n/pathnames";
import { CANONICAL_ORIGIN } from "@/lib/seo/canonical";

// /for-agencies · the same agency landing as the homepage, kept as a stable
// URL for inbound links + the localized pathnames (/para-agencias,
// /pour-agences). Canonicalises to `/` so search engines consolidate on the
// homepage. Renders the shared <AgLanding> (no redirect → no flash).

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
      // Dedup to the homepage — the agency landing's canonical home is `/`.
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

export default async function ForAgenciesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <AgLanding />;
}
