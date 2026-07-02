import { Link } from "@/i18n/navigation";

import { PriceCheck } from "@/components/marketing/for-businesses/fb-shared";

/**
 * AgPricing · "Pay for outcomes, not seats."
 *
 * Purple rounded band (same gradient as the SMB pricing band) with a
 * centered head and three plan cards. Reuses the SMB `.fb-price-*` card
 * system; the middle plan carries the floating yellow badge + a yellow
 * ring. Each card's CTA links to /signin (start free / start trial).
 *
 * Pure server component.
 */
interface AgPricingProps {
  t: (key: string) => string;
}

interface Plan {
  key: "p1" | "p2" | "p3";
  features: number;
  featured?: boolean;
}

const PLANS: Plan[] = [
  { key: "p1", features: 5 },
  { key: "p2", features: 5, featured: true },
  { key: "p3", features: 5 },
];

export function AgPricing({ t }: AgPricingProps) {
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

        <div className="fb-ag-price-grid">
          {PLANS.map(({ key, features, featured }) => (
            <div
              key={key}
              className={`fb-price-card${
                featured ? " fb-price-card--featured" : ""
              }`}
            >
              {featured && (
                <span className="fb-price-badge">{t("pricing.p2_badge")}</span>
              )}
              <p className="fb-price-plan">{t(`pricing.${key}_name`)}</p>
              <div className="fb-price-amount">
                {t(`pricing.${key}_price`)}
                <span className="fb-unit">{t(`pricing.${key}_period`)}</span>
              </div>
              <p className="fb-price-sub">{t(`pricing.${key}_sub`)}</p>

              <ul className="fb-price-list">
                {Array.from({ length: features }, (_, i) => i + 1).map((n) => (
                  <li key={n}>
                    <PriceCheck />
                    {t(`pricing.${key}_f${n}`)}
                  </li>
                ))}
              </ul>

              {/* audience=agency → self-serve agency provisioning (WP2-1). */}
              <Link
                href={{ pathname: "/signin", query: { audience: "agency" } }}
                className="fb-btn"
              >
                {t(`pricing.${key}_cta`)}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
