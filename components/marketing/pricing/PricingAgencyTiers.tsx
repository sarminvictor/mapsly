import * as React from "react";
import { Link } from "@/i18n/navigation";

/**
 * PricingAgencyTiers · 4 agency tier cards within the unified /pricing
 * page.
 *
 * Reuses copy from `for_agencies.tiers.*` (the single source of truth for
 * agency tier copy). Visually identical to <AgencyTiers> on
 * /for-agencies, with two differences:
 *   1. Section anchor #agency for jump-link from <PricingHero>.
 *   2. Each CTA includes `?intent=<tier>` query so the post-signin flow
 *      can route to the correct Stripe checkout once G.1 (Stripe
 *      checkout) ships.
 *
 * Per `.claude/rules/ui-ux-agency.md` · Tom's voice, dense, jargon-OK,
 * Growth tier highlighted as "most popular". Pure server component.
 */
interface PricingAgencyTiersProps {
  t: (key: string) => string;
  tAgency: (key: string) => string;
}

interface Tier {
  key: "solo" | "growth" | "pro" | "boutique";
  featured?: boolean;
  features: string[];
}

export function PricingAgencyTiers({ t, tAgency }: PricingAgencyTiersProps) {
  const tiers: Tier[] = [
    {
      key: "solo",
      features: [
        tAgency("solo_f1"),
        tAgency("solo_f2"),
        tAgency("solo_f3"),
        tAgency("solo_f4"),
        tAgency("solo_f5"),
      ],
    },
    {
      key: "growth",
      featured: true,
      features: [
        tAgency("growth_f1"),
        tAgency("growth_f2"),
        tAgency("growth_f3"),
        tAgency("growth_f4"),
        tAgency("growth_f5"),
        tAgency("growth_f6"),
      ],
    },
    {
      key: "pro",
      features: [
        tAgency("pro_f1"),
        tAgency("pro_f2"),
        tAgency("pro_f3"),
        tAgency("pro_f4"),
        tAgency("pro_f5"),
        tAgency("pro_f6"),
      ],
    },
    {
      key: "boutique",
      features: [
        tAgency("boutique_f1"),
        tAgency("boutique_f2"),
        tAgency("boutique_f3"),
        tAgency("boutique_f4"),
        tAgency("boutique_f5"),
        tAgency("boutique_f6"),
      ],
    },
  ];

  return (
    <section
      id="agency"
      aria-labelledby="pricing-agency-title"
      style={{
        padding: "80px 24px",
        background: "var(--color-agency-bg)",
        scrollMarginTop: 24,
      }}
    >
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <header style={{ marginBottom: 36 }}>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              color: "var(--color-agency-indigo)",
              textTransform: "uppercase",
              letterSpacing: "0.12em",
              marginBottom: 16,
            }}
          >
            {t("agency_eyebrow")}
          </div>
          <h2
            id="pricing-agency-title"
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "clamp(28px, 3.5vw, 44px)",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              lineHeight: 1.08,
              margin: "0 0 16px",
              color: "var(--color-text)",
            }}
          >
            {t("agency_title")}
          </h2>
          <p
            style={{
              fontSize: 17,
              color: "var(--color-text-2)",
              maxWidth: 720,
              margin: "0 0 12px",
              lineHeight: 1.55,
            }}
          >
            {t("agency_sub")}
          </p>
          <p
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              color: "var(--color-text-3)",
              margin: 0,
            }}
          >
            {tAgency("billing_note")}
          </p>
        </header>

        <div
          className="pricing-tier-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 16,
            alignItems: "stretch",
          }}
        >
          {tiers.map((tier) => {
            const name = tAgency(`${tier.key}_name`);
            const price = tAgency(`${tier.key}_price`);
            const period = tAgency(`${tier.key}_period`);
            const desc = tAgency(`${tier.key}_desc`);
            const cta = tAgency(`${tier.key}_cta`);
            return (
              <article
                key={tier.key}
                aria-label={name}
                style={{
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  padding: 28,
                  borderRadius: 16,
                  background: "var(--color-bg-2)",
                  border: tier.featured
                    ? "2px solid var(--color-agency-indigo)"
                    : "1px solid var(--color-border)",
                  boxShadow: tier.featured
                    ? "0 8px 24px rgba(91,61,245,.12)"
                    : "none",
                }}
              >
                {tier.featured ? (
                  <span
                    style={{
                      position: "absolute",
                      top: -12,
                      left: 28,
                      padding: "4px 10px",
                      background: "var(--color-agency-indigo)",
                      color: "#fff",
                      borderRadius: 999,
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      fontWeight: 600,
                    }}
                  >
                    {tAgency("growth_badge")}
                  </span>
                ) : null}

                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 13,
                    color: "var(--color-text-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.1em",
                    marginBottom: 10,
                  }}
                >
                  {name}
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 4,
                    marginBottom: 12,
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontSize: 40,
                      fontWeight: 800,
                      letterSpacing: "-0.02em",
                      color: "var(--color-text)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {price}
                  </span>
                  <span
                    style={{
                      fontSize: 14,
                      color: "var(--color-text-3)",
                    }}
                  >
                    {period}
                  </span>
                </div>

                <p
                  style={{
                    fontSize: 14,
                    color: "var(--color-text-2)",
                    lineHeight: 1.5,
                    margin: "0 0 20px",
                    minHeight: 60,
                  }}
                >
                  {desc}
                </p>

                <ul
                  aria-label={tAgency("feature_check_label")}
                  style={{
                    listStyle: "none",
                    padding: 0,
                    margin: "0 0 24px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    flex: 1,
                  }}
                >
                  {tier.features.map((f) => (
                    <li
                      key={f}
                      style={{
                        display: "flex",
                        gap: 10,
                        fontSize: 14,
                        color: "var(--color-text)",
                        lineHeight: 1.45,
                      }}
                    >
                      <span
                        aria-hidden
                        style={{
                          flex: "0 0 16px",
                          color: "var(--color-agency-indigo)",
                          fontWeight: 700,
                          marginTop: 1,
                        }}
                      >
                        ✓
                      </span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={{
                    pathname: "/signin",
                    query: { intent: tier.key },
                  }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "12px 16px",
                    borderRadius: 10,
                    background: tier.featured
                      ? "var(--color-agency-indigo)"
                      : "var(--color-bg-3)",
                    color: tier.featured ? "#fff" : "var(--color-text)",
                    fontWeight: 600,
                    fontSize: 14,
                    textDecoration: "none",
                    border: tier.featured
                      ? "none"
                      : "1px solid var(--color-border)",
                    minHeight: 44,
                  }}
                >
                  {cta}
                </Link>
              </article>
            );
          })}
        </div>
      </div>

      <style>{`
        @media (min-width: 720px) {
          .pricing-tier-grid {
            grid-template-columns: 1fr 1fr !important;
          }
        }
        @media (min-width: 1080px) {
          .pricing-tier-grid {
            grid-template-columns: repeat(4, 1fr) !important;
          }
        }
      `}</style>
    </section>
  );
}
