import * as React from "react";
import { Link } from "@/i18n/navigation";

/**
 * AgencyTiers · 4 pricing cards · $49 Solo / $99 Growth / $249 Pro / $499 Boutique.
 *
 * Pricing matches CLAUDE.md canonical table. Growth is highlighted (most-popular).
 * Server component · no client JS · all CTAs are <Link>s into /signin.
 *
 * Per `.claude/rules/ui-ux-agency.md` · sentence-case labels, no exclamation
 * marks, jargon-OK ("verticals", "metros", "saved searches").
 */

interface AgencyTiersProps {
  t: (key: string) => string;
}

interface Tier {
  key: "solo" | "growth" | "pro" | "boutique";
  featured?: boolean;
  features: string[];
}

export function AgencyTiers({ t }: AgencyTiersProps) {
  const tiers: Tier[] = [
    {
      key: "solo",
      features: [
        t("tiers.solo_f1"),
        t("tiers.solo_f2"),
        t("tiers.solo_f3"),
        t("tiers.solo_f4"),
        t("tiers.solo_f5"),
      ],
    },
    {
      key: "growth",
      featured: true,
      features: [
        t("tiers.growth_f1"),
        t("tiers.growth_f2"),
        t("tiers.growth_f3"),
        t("tiers.growth_f4"),
        t("tiers.growth_f5"),
        t("tiers.growth_f6"),
      ],
    },
    {
      key: "pro",
      features: [
        t("tiers.pro_f1"),
        t("tiers.pro_f2"),
        t("tiers.pro_f3"),
        t("tiers.pro_f4"),
        t("tiers.pro_f5"),
        t("tiers.pro_f6"),
      ],
    },
    {
      key: "boutique",
      features: [
        t("tiers.boutique_f1"),
        t("tiers.boutique_f2"),
        t("tiers.boutique_f3"),
        t("tiers.boutique_f4"),
        t("tiers.boutique_f5"),
        t("tiers.boutique_f6"),
      ],
    },
  ];

  return (
    <section
      id="pricing"
      aria-labelledby="for-agencies-tiers-title"
      style={{ padding: "80px 24px", background: "var(--color-agency-bg)" }}
    >
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
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
          {t("tiers.eyebrow")}
        </div>
        <h2
          id="for-agencies-tiers-title"
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
          {t("tiers.title")}
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
          {t("tiers.sub")}
        </p>
        <p
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            color: "var(--color-text-3)",
            margin: "0 0 48px",
          }}
        >
          {t("tiers.billing_note")}
        </p>

        <div
          className="mapsly-tier-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 16,
            alignItems: "stretch",
          }}
        >
          {tiers.map((tier) => {
            const name = t(`tiers.${tier.key}_name`);
            const price = t(`tiers.${tier.key}_price`);
            const period = t(`tiers.${tier.key}_period`);
            const desc = t(`tiers.${tier.key}_desc`);
            const cta = t(`tiers.${tier.key}_cta`);
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
                    {t("tiers.growth_badge")}
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
                  aria-label={t("tiers.feature_check_label")}
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
                  href="/signin"
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
          .mapsly-tier-grid {
            grid-template-columns: 1fr 1fr !important;
          }
        }
        @media (min-width: 1080px) {
          .mapsly-tier-grid {
            grid-template-columns: repeat(4, 1fr) !important;
          }
        }
      `}</style>
    </section>
  );
}
