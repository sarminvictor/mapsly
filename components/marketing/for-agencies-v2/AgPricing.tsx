import { getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";

import { AgPlanCards } from "./AgPlanCards";

/**
 * AgPricing · "Pay for outcomes, not seats." — the homepage pricing band.
 *
 * Purple rounded band (bottom half of the sticky-stacking pair with
 * <AgHunter>) carrying a centered head and the plan ladder.
 *
 * The ladder itself is <AgPlanCards>, the SAME component the standalone
 * /pricing page renders. This band used to hand-roll three cards from
 * `for_agencies.pricing.p*_*` i18n keys, which drifted from what the app
 * actually charges: it advertised Free / $19 Starter / $99 Growth while the
 * grant table sold Starter $19, Solo $49, Growth $99 and Pro $299 — so Solo,
 * the tier the repricing decision says to advertise, appeared nowhere on the
 * marketing site. Sharing one renderer over `PLAN_CARDS` makes that class of
 * bug structurally impossible rather than a thing to remember.
 *
 * Pure server component.
 */
interface AgPricingProps {
  t: (key: string) => string;
}

export async function AgPricing({ t }: AgPricingProps) {
  const tp = await getTranslations("pricing");

  return (
    <section
      id="pricing"
      className="fb-section fb-pricing fb-pricing--ag"
      aria-labelledby="fb-ag-pricing-title"
      data-fb-tone="dark"
    >
      <div className="fb-container">
        <div className="fb-board-head">
          <h2 id="fb-ag-pricing-title" className="fb-h2">
            {t("pricing.title_lead")}{" "}
            <em className="fb-em fb-ylw">{t("pricing.title_emph")}</em>
          </h2>
          <p className="fb-sub">{t("pricing.sub")}</p>
        </div>

        <AgPlanCards />

        {/* Sends the ladder's detail (FAQ, full comparison) to the dedicated
            page — and gives /pricing a prominent internal link from the
            highest-traffic page on the site. */}
        <p className="fb-ag-price-note">
          <Link href="/pricing" className="fb-ag-price-link">
            {tp("see_full")}
          </Link>
        </p>
      </div>
    </section>
  );
}
