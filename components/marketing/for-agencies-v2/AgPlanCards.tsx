import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { PriceCheck } from "@/components/marketing/for-businesses/fb-shared";
import {
  PLAN_CARDS,
  PLAN_CARD_ORDER,
  type PlanKey,
} from "@/modules/cost/pricing";

/**
 * AgPlanCards · the plan ladder, rendered identically everywhere it appears.
 *
 * ONE component backs both the homepage pricing band (<AgPricing>) and the
 * standalone /pricing page (<AgPricingPage>). That is the entire point: the
 * homepage used to hardcode its prices into `for_agencies.pricing.p*_price`
 * i18n keys while the app granted credits from `PLAN_CARDS`, and the two
 * drifted — marketing advertised a $19 entry tier and a $99 top tier while the
 * code sold Solo at $49 and Pro at $299, and Solo (the tier the repricing
 * decision says to advertise) appeared nowhere on the marketing site at all.
 * Two renderers reading two sources will always drift eventually; one renderer
 * reading the grant table cannot.
 *
 * Layout follows the in-app billing screen (`components/agency/billing/
 * PlansGrid`): the FOUR paid cards fill a 4-up grid, and Free drops to a
 * de-emphasized strip underneath. Five equal columns shrink the price type
 * past legibility.
 *
 * i18n note · plan names and feature bullets are English-only today because
 * they live in `PLAN_CARDS`. Chrome around them is translated. Localising the
 * card bodies means per-locale strings in that registry — a follow-up, rather
 * than copying them back into `messages/*.json` and recreating the drift.
 *
 * Pure server component.
 */
export async function AgPlanCards() {
  const t = await getTranslations("pricing");
  const nf = new Intl.NumberFormat("en-US");

  const paidKeys = PLAN_CARD_ORDER.filter(
    (k): k is Exclude<PlanKey, "free"> => k !== "free",
  );
  const free = PLAN_CARDS.free;

  return (
    <>
      <div className="fb-ag-plans">
        {paidKeys.map((key) => {
          const card = PLAN_CARDS[key];
          return (
            <div
              key={key}
              className={`fb-price-card${
                card.featured ? " fb-price-card--featured" : ""
              }`}
            >
              {card.featured && (
                <span className="fb-price-badge">{t("badge_popular")}</span>
              )}

              <p className="fb-price-plan">{card.displayName}</p>
              <div className="fb-price-amount">
                {`$${card.priceUsd}`}
                <span className="fb-unit">/mo</span>
              </div>

              {/* One primary yield figure, as on the in-app card — the number
                  an agency actually shops on. */}
              <div className="fb-ag-yield">
                <span className="fb-ag-yield-n">
                  {nf.format(card.withContacts)}
                </span>
                <span className="fb-ag-yield-l">
                  {t(card.oneTime ? "leads_line_once" : "leads_line")}
                </span>
                <span className="fb-ag-yield-sub">
                  {t("enriched_line", { n: card.fullyEnriched })}
                </span>
              </div>

              <p className="fb-ag-rate">{card.rate}</p>

              <ul className="fb-price-list">
                {card.features.map((feature) => (
                  <li key={feature}>
                    <PriceCheck />
                    {feature}
                  </li>
                ))}
              </ul>

              <p className="fb-ag-reset">{t("reset_note")}</p>

              {/* audience=agency → self-serve provisioning; plan pre-selects
                  the tier on the billing screen after sign-in. */}
              <Link
                href={{
                  pathname: "/signin",
                  query: { audience: "agency", plan: key },
                }}
                className="fb-btn"
              >
                {t("cta_paid")}
              </Link>
            </div>
          );
        })}
      </div>

      {/* Free tier · de-emphasized strip, not a fifth column. */}
      <div className="fb-ag-free-strip">
        <div className="fb-ag-free-copy">
          <p className="fb-ag-free-label">{t("free.label")}</p>
          <p className="fb-ag-free-desc">
            {t("free.desc", { n: free.monthlyCredits })}
          </p>
        </div>
        <Link
          href={{
            pathname: "/signin",
            query: { audience: "agency", plan: "free" },
          }}
          className="fb-btn fb-btn--ghost"
        >
          {t("free.cta")}
        </Link>
      </div>
    </>
  );
}
