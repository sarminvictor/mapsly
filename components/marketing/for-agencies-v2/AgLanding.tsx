import { getTranslations } from "next-intl/server";

import { AgHero } from "./AgHero";
import { AgPitch } from "./AgPitch";
import { AgHunter } from "./AgHunter";
import { AgPricing } from "./AgPricing";
import { AgPlatform } from "./AgPlatform";
import { AgFAQ } from "./AgFAQ";
import { AgCTA } from "./AgCTA";

import "./ag.css";
import { CANONICAL_ORIGIN } from "@/lib/seo/canonical";

/**
 * AgLanding · the agency landing composition, shared by the homepage (`/`)
 * and `/for-agencies` so the two routes can never drift. Agencies are the
 * primary channel, so this IS the homepage — rendered directly (no redirect,
 * no flash). All blocks are pure server components; ag.css recolours the
 * shared for-businesses design system to the agency indigo theme.
 */
export async function AgLanding() {
  const t = await getTranslations("for_agencies");

  // Organization JSON-LD · helps Google bind brand + sitelinks across pages.
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
