import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import {
  ArrowGlyph,
  Dot,
  PriceCheck,
} from "@/components/marketing/for-businesses/fb-shared";
import { AgPlanCards } from "./AgPlanCards";

import "./ag.css";

/**
 * AgPricingPage · the standalone `/pricing` surface.
 *
 * Layout mirrors the in-app billing screen (`components/agency/billing/
 * PlansGrid`), which is the version that actually reads well with five tiers:
 * the FOUR paid cards fill a 4-up grid above the fold, and Free drops to a
 * de-emphasized horizontal strip underneath. Cramming all five into one row
 * shrinks the price type past legibility.
 *
 * Chrome is the marketing system, not the portal's: `.fb-hero--ag` for the
 * first screen (same gradient mesh, dots and glass pill as the homepage) and
 * the `.fb-price-*` card stack inside the purple band.
 *
 * Prices, credit grants and feature bullets all come from `PLAN_CARDS`
 * (`modules/cost/pricing.ts`) — the same source the in-app grid reads. The
 * homepage band hardcoded its prices into i18n and drifted (advertising a $19
 * entry tier while the code sold Solo at $49); a page that reads the grant
 * table cannot.
 *
 * i18n note · plan names and feature bullets are English-only today because
 * they live in `PLAN_CARDS`. The chrome around them is translated. Localising
 * the card bodies means per-locale strings in that registry — a follow-up,
 * rather than duplicating them into `messages/*.json` and recreating the drift.
 *
 * Pure server component · no auth, no DB, fully prerenderable.
 */
export async function AgPricingPage() {
  const t = await getTranslations("pricing");
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [1, 2, 3, 4].map((n) => ({
      "@type": "Question",
      name: t(`faq.q${n}`),
      acceptedAnswer: { "@type": "Answer", text: t(`faq.a${n}`) },
    })),
  };

  return (
    <>
      {/* ── First screen · same hero system as the homepage ─────────────── */}
      <section
        className="fb-hero fb-hero--ag fb-hero--pricing"
        aria-labelledby="pricing-title"
      >
        <Dot style={{ top: "18%", left: "9%" }} />
        <Dot style={{ top: "34%", left: "16%" }} />
        <Dot style={{ top: "14%", right: "12%" }} />
        <Dot style={{ top: "42%", right: "7%" }} />
        <Dot style={{ top: "66%", left: "6%" }} />
        <Dot style={{ top: "72%", right: "14%" }} />

        <div className="fb-container fb-hero-inner">
          <span className="fb-ag-pill">
            <span className="fb-ag-pill-dot" aria-hidden />
            {t("hero.pill")}
          </span>

          <h1 id="pricing-title" className="fb-h1">
            {t("hero.title_lead")}{" "}
            <em className="fb-em fb-ylw">{t("hero.title_emph")}</em>{" "}
            {t("hero.title_trail")}
          </h1>

          <p className="fb-sub">{t("hero.sub")}</p>

          <div className="fb-ag-hero-cta">
            <Link
              href={{ pathname: "/signin", query: { audience: "agency" } }}
              className="fb-btn"
            >
              {t("hero.cta")} <ArrowGlyph />
            </Link>
          </div>

          <ul className="fb-ag-trust">
            {["trust_1", "trust_2", "trust_3"].map((k) => (
              <li key={k}>
                <PriceCheck />
                {t(`hero.${k}`)}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── Plans · 4 paid cards + Free strip (in-app billing layout), inside
             the homepage's purple band: rounded top, square bottom.
             No band heading — the hero above already made the argument, and a
             second headline + sub here just said it twice before the reader
             saw a single price. The hero's own fade-to-white supplies the light
             backdrop the rounded top needs, so no filler band is needed
             either; cutting it lifts the cards a full screen higher. ────── */}
      <section
        className="fb-section fb-pricing fb-pricing--ag fb-pricing--solo"
        aria-label={t("plans_eyebrow")}
        data-fb-tone="dark"
      >
        <div className="fb-container">
          <AgPlanCards />

          <p className="fb-ag-price-note">{t("note")}</p>
        </div>
      </section>

      {/* Same markup + classes as <AgFAQ>: a CSS-only <details> accordion, so
          this inherits the existing dark FAQ band with no new styles and no
          client JS. */}
      <section
        className="fb-section fb-dark"
        aria-labelledby="pricing-faq-title"
      >
        <div className="fb-container">
          <div className="fb-faq-head">
            <h2 id="pricing-faq-title" className="fb-h2">
              {t("faq.title")}
            </h2>
          </div>

          <div className="fb-faq-list">
            {[1, 2, 3, 4].map((n) => (
              <details key={n} className="fb-faq-item">
                <summary>
                  {t(`faq.q${n}`)}
                  <span className="fb-faq-plus" aria-hidden />
                </summary>
                <p className="fb-faq-answer">{t(`faq.a${n}`)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
    </>
  );
}
