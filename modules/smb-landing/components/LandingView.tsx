/**
 * Public landing page view (`/l/[slug]-[token]`).
 *
 * A personalized, single-scroll proposal assembled from the business's REAL
 * latest snapshot + market-cell data — the surface we email a qualified SMB to
 * convert them into a $29/mo subscriber. Recreated block-by-block from the
 * design: centered eyebrow + coral-italic serif headings, a hero score panel,
 * a "what changed this week" card, per-section blocks (search / ads / reviews /
 * website) each with a market-relative "problem → solution" callout, ranked
 * fixes, and the $29 band.
 *
 * Server component · inline styles + CSS vars per the marketing convention.
 * `data-landing-section` / `data-landing-cta` hooks let the client analytics
 * layer (LandingAnalytics) observe scroll-depth + clicks. Honest "we don't
 * track this yet" notes stand in for any missing section.
 *
 * Per `.claude/rules/ui-ux-smb.md`: warm, plain English, Maria's vocabulary,
 * one clear action (See what to fix first · $29/mo). Headline copy is template-level
 * (to be reworked) — the DATA is real.
 *
 * This file is the composing shell — each block lives in ./sections/ (split
 * mechanically; render output is identical to the pre-split single file).
 */

import type { LandingData } from "../types";

import { LandingAnalytics } from "./LandingAnalytics";

import { AdsSection } from "./sections/Ads";
import { ChangesSection } from "./sections/Changes";
import { FixesSection } from "./sections/Fixes";
import { LandingFooter } from "./sections/Footer";
import { Hero } from "./sections/Hero";
import { PricingSection } from "./sections/Pricing";
import { ReviewsSection } from "./sections/Reviews";
import { SearchSection } from "./sections/Search";
import { SectionDivider } from "./sections/shared";
import { PAGE } from "./sections/style-tokens";
import { TopBar } from "./sections/TopBar";
import { WebsiteSection } from "./sections/Website";

// Re-export for the existing unit tests (modules/smb-landing/__tests__) +
// any caller that imported the footer from this module pre-split.
export { LandingFooter } from "./sections/Footer";

/* ------------------------------------------------------------------- view */

export function LandingView({ data }: { data: LandingData }) {
  // Direct-from-landing checkout — no sign-in first. An anonymous Stripe
  // subscription session; the prospect is auto-logged-in + their business
  // claimed after payment (see /api/checkout/start → /checkout/return).
  const checkoutBase = `/api/checkout/start?landing=${encodeURIComponent(data.token)}`;
  const ctaHref = `${checkoutBase}&term=monthly`;
  const ctaHrefAnnual = `${checkoutBase}&term=annual`;
  return (
    <main style={PAGE}>
      <LandingAnalytics token={data.token} />
      <TopBar ctaHref={ctaHref} />
      <div style={{ overflowX: "clip" }}>
        <Hero data={data} />
        <ChangesSection events={data.events} copy={data.copy.changes} />
        <SearchSection
          search={data.search}
          category={data.category}
          copy={data.copy.search}
          noun={data.copy.noun.many}
          ctaHref={ctaHref}
        />
        <SectionDivider />
        <AdsSection
          ads={data.adsDetail}
          name={data.name}
          copy={data.copy.ads}
          noun={data.copy.noun.many}
          ctaHref={ctaHref}
        />
        <SectionDivider />
        <ReviewsSection
          reviews={data.reviews}
          copy={data.copy.reviews}
          noun={data.copy.noun.many}
          ctaHref={ctaHref}
        />
        <SectionDivider />
        <WebsiteSection
          website={data.websiteDetail}
          city={data.city}
          copy={data.copy.website}
          noun={data.copy.noun.many}
          ctaHref={ctaHref}
        />
        <FixesSection
          fixes={data.fixes}
          copy={data.copy.fixes}
          ctaHref={ctaHref}
        />
        <PricingSection
          copy={data.copy.pricing}
          ctaHref={ctaHref}
          ctaHrefAnnual={ctaHrefAnnual}
          token={data.token}
        />
        <LandingFooter token={data.token} />
      </div>
    </main>
  );
}
