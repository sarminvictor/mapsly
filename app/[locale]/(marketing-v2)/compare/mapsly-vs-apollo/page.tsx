import type { Metadata } from "next";

import { ComparisonLayout } from "@/components/marketing/comparisons/ComparisonLayout";
import { COMPARISONS } from "@/components/marketing/comparisons/comparison-data";
import { getLocaleAlternates } from "@/i18n/pathnames";

// WP6-7 · /compare/mapsly-vs-apollo — a static SEO comparison page in the
// agency voice. The copy is a static spec (no DB reads, no translated strings —
// English-only per instructions), so the page prerenders cleanly under
// cacheComponents. The render body is static English content (no DB, no translated strings,
// no `use cache` — it renders per-request cheaply; SEO via generateMetadata). Full metadata +
// WebPage JSON-LD; internal links to/from /for-agencies live in
// ComparisonLayout.

const CANONICAL_ORIGIN = "https://mapsly.ai";
const SLUG = "mapsly-vs-apollo" as const;
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

/** Locale-free static render — cached by tag so copy edits revalidate. */
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

export default function MapslyVsApolloPage() {
  return <ComparisonBody />;
}
