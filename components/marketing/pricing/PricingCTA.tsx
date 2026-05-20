import * as React from "react";
import { Link } from "@/i18n/navigation";

/**
 * PricingCTA · final closing band.
 *
 * Audience-neutral CTA pair (matches PricingHero's jump-links). Email
 * fallback link uses standard mailto: so people who want to talk to
 * sales (Boutique tier) have an immediate path.
 *
 * Pure server component.
 */
interface PricingCTAProps {
  t: (key: string) => string;
}

export function PricingCTA({ t }: PricingCTAProps) {
  return (
    <section
      aria-labelledby="pricing-cta-title"
      style={{
        padding: "80px 24px",
        background:
          "linear-gradient(180deg, var(--color-bg) 0%, var(--color-bg-2) 100%)",
        borderTop: "1px solid var(--color-border)",
        textAlign: "center",
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h2
          id="pricing-cta-title"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(28px, 3.5vw, 44px)",
            fontWeight: 700,
            letterSpacing: "-0.025em",
            lineHeight: 1.1,
            margin: "0 0 16px",
            color: "var(--color-text)",
          }}
        >
          {t("cta.title")}
        </h2>
        <p
          style={{
            fontSize: 17,
            color: "var(--color-text-2)",
            lineHeight: 1.55,
            margin: "0 auto 32px",
            maxWidth: 560,
          }}
        >
          {t("cta.sub")}
        </p>
        <div
          style={{
            display: "inline-flex",
            gap: 12,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          <Link
            href="/signin"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "14px 28px",
              borderRadius: 10,
              background: "var(--color-text)",
              color: "var(--color-bg)",
              fontWeight: 600,
              fontSize: 15,
              textDecoration: "none",
              minHeight: 44,
            }}
          >
            {t("cta.primary")}
          </Link>
          <a
            href="mailto:hello@mapsly.ai?subject=Pricing%20question"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "14px 28px",
              borderRadius: 10,
              background: "var(--color-bg-2)",
              color: "var(--color-text)",
              fontWeight: 600,
              fontSize: 15,
              textDecoration: "none",
              border: "1px solid var(--color-border)",
              minHeight: 44,
            }}
          >
            {t("cta.secondary")}
          </a>
        </div>
      </div>
    </section>
  );
}
