import type { Metadata } from "next";
import { setRequestLocale, getTranslations } from "next-intl/server";

import { PricingHero } from "@/components/marketing/pricing/PricingHero";
import { PricingSmbCard } from "@/components/marketing/pricing/PricingSmbCard";
import { PricingAgencyTiers } from "@/components/marketing/pricing/PricingAgencyTiers";
import { PricingTrust } from "@/components/marketing/pricing/PricingTrust";
import { PricingFAQ } from "@/components/marketing/pricing/PricingFAQ";
import { PricingCTA } from "@/components/marketing/pricing/PricingCTA";
import type { Locale } from "@/i18n/routing";
import { getLocaleAlternates, getLocalizedPath } from "@/i18n/pathnames";

// Pricing page · mapsly.ai/pricing (locale variants /es/precios, /en-ca/pricing,
// /fr/tarifs registered in i18n/routing.ts).
//
// Unified pricing surface for BOTH audiences (Maria + Tom). Per CLAUDE.md the
// SMB and Agency portals have distinct UX languages, but a public pricing page
// must present both side-by-side because prospects often arrive via brand /
// generic search without a portal preselected. The page makes the audience
// distinction visually obvious: SMB section uses warm cream + coral, Agency
// section switches to cool gray + indigo. No tab-switcher, no audience
// selector — just stacked sections so screen-readers + search-indexers see
// both pricing structures in document order.
//
// Static under cacheComponents PPR — no DB reads, all copy is i18n. Tier copy
// is reused from existing namespaces (for_businesses.pricing for SMB, and
// for_agencies.tiers for the 4 agency cards) to avoid duplication + drift; the
// new `pricing` top-level namespace owns only page-specific scaffolding (hero,
// FAQ, trust, CTA). Cache-revalidate tag: `marketing-pricing`.
//
// CTA wiring: every tier CTA links to /signin (with `?intent=<tier>` query so
// the post-signin flow can route to the correct Stripe checkout once G.1
// lands). Plain anchor href, no client JS.
//
// SEO: full metadata + hreflang for all 4 locales + Product JSON-LD listing
// each tier as an Offer (helps Google show price-range rich-snippets).
// FAQPage JSON-LD lives in <PricingFAQ>. Per `.claude/rules/seo.md` and
// `.claude/rules/cache-components.md` Pattern 1 — no Suspense wrap needed
// because the page does no auth/cookies/DB reads; only build-safe i18n.

const CANONICAL_ORIGIN = "https://mapsly.ai";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({
    locale,
    namespace: "pricing.meta",
  });

  const path = getLocalizedPath("/pricing", locale as Locale);

  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: `${CANONICAL_ORIGIN}${path}`,
      languages: getLocaleAlternates("/pricing"),
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

export default async function PricingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Three bound translators · one per source namespace. Re-use existing
  // copy where it already exists (avoids drift), introduces the new
  // `pricing` namespace only for page-specific scaffolding.
  const tPricing = await getTranslations("pricing");
  const tSmb = await getTranslations("for_businesses.pricing");
  const tAgency = await getTranslations("for_agencies.tiers");

  // Locale-aware base path for Offer URLs in JSON-LD below. Derived from
  // i18n/pathnames so a route translation in routing.ts auto-propagates.
  const path = getLocalizedPath("/pricing", locale as Locale);

  // Product JSON-LD · helps Google show price-range in SERP for "mapsly
  // pricing" queries. Listing both audiences as separate Offers because
  // Google supports a `priceRange` aggregator over Offer list.
  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Mapsly",
    description: tPricing("meta.description"),
    brand: { "@type": "Brand", name: "Mapsly" },
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "USD",
      lowPrice: "29",
      highPrice: "499",
      offerCount: "5",
      offers: [
        {
          "@type": "Offer",
          name: tSmb("price") + " — " + tPricing("smb_eyebrow"),
          price: "29",
          priceCurrency: "USD",
          url: `${CANONICAL_ORIGIN}${path}#smb`,
        },
        {
          "@type": "Offer",
          name: tAgency("solo_name"),
          price: "49",
          priceCurrency: "USD",
          url: `${CANONICAL_ORIGIN}${path}#agency`,
        },
        {
          "@type": "Offer",
          name: tAgency("growth_name"),
          price: "99",
          priceCurrency: "USD",
          url: `${CANONICAL_ORIGIN}${path}#agency`,
        },
        {
          "@type": "Offer",
          name: tAgency("pro_name"),
          price: "249",
          priceCurrency: "USD",
          url: `${CANONICAL_ORIGIN}${path}#agency`,
        },
        {
          "@type": "Offer",
          name: tAgency("boutique_name"),
          price: "499",
          priceCurrency: "USD",
          url: `${CANONICAL_ORIGIN}${path}#agency`,
        },
      ],
    },
  };

  return (
    <>
      <PricingHero t={tPricing} />
      <PricingSmbCard t={tPricing} tSmb={tSmb} />
      <PricingAgencyTiers t={tPricing} tAgency={tAgency} />
      <PricingTrust t={tPricing} />
      <PricingFAQ t={tPricing} />
      <PricingCTA t={tPricing} />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema) }}
      />
    </>
  );
}
