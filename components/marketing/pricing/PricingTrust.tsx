import * as React from "react";

/**
 * PricingTrust · trust strip below tier cards.
 *
 * 4 trust signals: secure payments (Stripe), money-back guarantee,
 * cancel-anytime, no-card-required. Per CLAUDE.md: trust badges
 * specifically called out in B.4 acceptance. SOC2 messaging is
 * intentionally "in progress" — the platform isn't audited yet, no
 * false claims.
 *
 * Pure server component. No icon libraries — inline SVGs only, all
 * decorative (aria-hidden).
 */
interface PricingTrustProps {
  t: (key: string) => string;
}

interface TrustBadge {
  key: "secure" | "refund" | "cancel" | "soc2";
  icon: React.ReactNode;
}

const SECURE_ICON = (
  <svg
    aria-hidden
    width="28"
    height="28"
    viewBox="0 0 28 28"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 3 5 7v6c0 5.5 3.6 10.4 9 12 5.4-1.6 9-6.5 9-12V7l-9-4Z" />
    <path d="m10 14 3 3 5-5" />
  </svg>
);

const REFUND_ICON = (
  <svg
    aria-hidden
    width="28"
    height="28"
    viewBox="0 0 28 28"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M22 11.5A8.5 8.5 0 1 1 14 3" />
    <path d="M22 4v6h-6" />
  </svg>
);

const CANCEL_ICON = (
  <svg
    aria-hidden
    width="28"
    height="28"
    viewBox="0 0 28 28"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="4" y="6" width="20" height="16" rx="2" />
    <path d="M4 12h20" />
    <path d="m10 17 4-4 4 4" />
  </svg>
);

const SOC2_ICON = (
  <svg
    aria-hidden
    width="28"
    height="28"
    viewBox="0 0 28 28"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="4" y="4" width="20" height="20" rx="2" />
    <path d="M9 14h4l2-4 2 8 2-4h2" />
  </svg>
);

const BADGES: TrustBadge[] = [
  { key: "secure", icon: SECURE_ICON },
  { key: "refund", icon: REFUND_ICON },
  { key: "cancel", icon: CANCEL_ICON },
  { key: "soc2", icon: SOC2_ICON },
];

export function PricingTrust({ t }: PricingTrustProps) {
  return (
    <section
      aria-labelledby="pricing-trust-title"
      style={{
        padding: "56px 24px",
        background: "var(--color-bg)",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <h2
          id="pricing-trust-title"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--color-text-3)",
            textTransform: "uppercase",
            letterSpacing: "0.14em",
            margin: "0 0 28px",
            textAlign: "center",
          }}
        >
          {t("trust.heading")}
        </h2>

        <div
          className="pricing-trust-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 16,
          }}
        >
          {BADGES.map((b) => (
            <article
              key={b.key}
              style={{
                display: "flex",
                gap: 14,
                alignItems: "flex-start",
                padding: "20px 18px",
                borderRadius: 12,
                background: "var(--color-bg-2)",
                border: "1px solid var(--color-border)",
              }}
            >
              <span
                style={{
                  flex: "0 0 28px",
                  color: "var(--color-coral)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 2,
                }}
              >
                {b.icon}
              </span>
              <div>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 14,
                    color: "var(--color-text)",
                    marginBottom: 4,
                  }}
                >
                  {t(`trust.${b.key}_label`)}
                </div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    color: "var(--color-text-2)",
                    lineHeight: 1.5,
                  }}
                >
                  {t(`trust.${b.key}_desc`)}
                </p>
              </div>
            </article>
          ))}
        </div>
      </div>

      <style>{`
        @media (min-width: 720px) {
          .pricing-trust-grid {
            grid-template-columns: 1fr 1fr !important;
          }
        }
        @media (min-width: 1080px) {
          .pricing-trust-grid {
            grid-template-columns: repeat(4, 1fr) !important;
          }
        }
      `}</style>
    </section>
  );
}
