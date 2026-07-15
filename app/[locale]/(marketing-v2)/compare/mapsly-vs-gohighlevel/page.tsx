import type { Metadata } from "next";

import { ComparisonLayout } from "@/components/marketing/comparisons/ComparisonLayout";
import { COMPARISONS } from "@/components/marketing/comparisons/comparison-data";
import { getLocaleAlternates } from "@/i18n/pathnames";
import { CANONICAL_ORIGIN } from "@/lib/seo/canonical";

// WP6-7 · /compare/mapsly-vs-gohighlevel — static SEO comparison page in the
// agency voice. See mapsly-vs-apollo/page.tsx for the caching rationale.

const SLUG = "mapsly-vs-gohighlevel" as const;
const PATH = `/compare/${SLUG}`;
const spec = COMPARISONS[SLUG];

export function generateMetadata(): Metadata {
  return {
    title: spec.metaTitle,
    description: spec.metaDescription,
    alternates: {
      canonical: `${CANONICAL_ORIGIN}${PATH}`,
      languages: getLocaleAlternates(PATH),
    },
    openGraph: {
      type: "website",
      siteName: "Mapsly",
      title: spec.metaTitle,
      description: spec.metaDescription,
      url: `${CANONICAL_ORIGIN}${PATH}`,
    },
    twitter: {
      card: "summary_large_image",
      title: spec.metaTitle,
      description: spec.metaDescription,
    },
    robots: { index: true, follow: true },
  };
}

async function ComparisonBody() {
  // NOTE: NOT `use cache` — ComparisonLayout uses next-intl localized Link
  // (reads headers() for locale), which cacheComponents forbids inside a cache
  // scope. The page is static English content; it renders per-request cheaply
  // and is fully SEO-tagged via generateMetadata + JSON-LD (seo.md).

  const schema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: spec.metaTitle,
    description: spec.metaDescription,
    url: `${CANONICAL_ORIGIN}${PATH}`,
    isPartOf: { "@type": "WebSite", name: "Mapsly", url: CANONICAL_ORIGIN },
  };

  return (
    <>
      <ComparisonLayout spec={spec} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
    </>
  );
}

export default function MapslyVsGoHighLevelPage() {
  return <ComparisonBody />;
}
