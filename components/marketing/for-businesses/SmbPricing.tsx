import { Link } from "@/i18n/navigation";

import { PriceCheck } from "./fb-shared";

/**
 * SmbPricing · "$29/month. That's it."
 *
 * Purple rounded band: one plan, no comparison tables, no tier confusion
 * (per `.claude/rules/ui-ux-smb.md`). Free reality check first, $29/mo
 * after. Floating yellow badge anchors the "free first" promise.
 *
 * Pure server component.
 */
interface SmbPricingProps {
  t: (key: string) => string;
}

const FEATURES = [1, 2, 3, 4, 5, 6] as const;

export function SmbPricing({ t }: SmbPricingProps) {
  return (
    <section
      id="pricing"
      className="fb-section fb-pricing"
      aria-labelledby="fb-pricing-title"
      data-fb-tone="dark"
    >
      <div className="fb-container fb-split">
        <div>
          <h2 id="fb-pricing-title" className="fb-h2">
            {t("pricing.title_lead")}{" "}
            <em className="fb-em fb-ylw">{t("pricing.title_emph")}</em>
          </h2>
          <p className="fb-sub">{t("pricing.sub")}</p>
        </div>

        <div className="fb-price-card">
          <span className="fb-price-badge">{t("pricing.badge")}</span>
          <p className="fb-price-plan">{t("pricing.plan_name")}</p>
          <div className="fb-price-amount">
            {t("pricing.price")}
            <span className="fb-unit">{t("pricing.period")}</span>
          </div>
          <p className="fb-price-sub">{t("pricing.plan_sub")}</p>

          <ul className="fb-price-list">
            {FEATURES.map((i) => (
              <li key={i}>
                <PriceCheck />
                {t(`pricing.f${i}`)}
              </li>
            ))}
          </ul>

          <Link href="/signin" className="fb-btn">
            {t("pricing.cta")}
          </Link>
          <p className="fb-price-note">{t("pricing.note")}</p>
        </div>
      </div>
    </section>
  );
}
