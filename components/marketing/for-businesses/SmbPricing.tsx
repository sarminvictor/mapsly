import * as React from "react";
import { Link } from "@/i18n/navigation";

/**
 * SmbPricing · Maria's single-plan pricing card.
 *
 * SMB philosophy per `.claude/rules/ui-ux-smb.md`: ONE plan, no comparison
 * tables, no tier confusion. Free reality check first, $29/mo after.
 *
 * Pure server component.
 */
interface SmbPricingProps {
  t: (key: string) => string;
}

const FEATURES = ["f1", "f2", "f3", "f4", "f5", "f6", "f7"] as const;

export function SmbPricing({ t }: SmbPricingProps) {
  return (
    <section
      id="pricing"
      aria-labelledby="for-businesses-pricing-title"
      style={{
        padding: "96px 24px",
        background: "var(--color-bg-2)",
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto", textAlign: "center" }}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--color-coral)",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            marginBottom: 12,
          }}
        >
          {t("pricing.eyebrow")}
        </div>
        <h2
          id="for-businesses-pricing-title"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(32px, 4vw, 52px)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
            margin: "0 0 16px",
            color: "var(--color-text)",
          }}
        >
          {t("pricing.title")}
        </h2>
        <p
          style={{
            fontSize: 18,
            color: "var(--color-text-2)",
            lineHeight: 1.55,
            margin: "0 auto 40px",
            maxWidth: 560,
          }}
        >
          {t("pricing.sub")}
        </p>

        <article
          style={{
            padding: "44px 32px",
            borderRadius: 20,
            background:
              "linear-gradient(180deg, var(--color-bg) 0%, var(--color-bg-3) 100%)",
            border: "1px solid var(--color-coral)",
            boxShadow: "0 20px 56px rgba(195,85,58,.14)",
            textAlign: "left",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 12px",
              borderRadius: 999,
              background: "var(--color-bg-2)",
              color: "var(--color-coral)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 20,
            }}
          >
            {t("pricing.free_badge")}
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 6,
              marginBottom: 28,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 64,
                fontWeight: 700,
                letterSpacing: "-0.04em",
                color: "var(--color-text)",
                lineHeight: 1,
              }}
            >
              {t("pricing.price")}
            </span>
            <span style={{ fontSize: 17, color: "var(--color-text-2)" }}>
              {t("pricing.period")}
            </span>
          </div>

          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: "0 0 32px",
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            {FEATURES.map((f) => (
              <li
                key={f}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  fontSize: 15,
                  lineHeight: 1.5,
                  color: "var(--color-text)",
                }}
              >
                <span
                  aria-hidden
                  style={{
                    flex: "0 0 18px",
                    width: 18,
                    height: 18,
                    borderRadius: "50%",
                    background: "var(--color-coral)",
                    color: "#fff",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                    marginTop: 2,
                  }}
                >
                  ✓
                </span>
                {t(`pricing.${f}`)}
              </li>
            ))}
          </ul>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link
              href="/signin"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "16px 28px",
                borderRadius: 10,
                background: "var(--color-coral)",
                color: "#fff",
                fontWeight: 600,
                fontSize: 15,
                textDecoration: "none",
                boxShadow: "0 8px 24px rgba(195,85,58,.25)",
                minHeight: 44,
              }}
            >
              {t("pricing.cta_primary")}
            </Link>
            <a
              href="#signals"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "16px 28px",
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
              {t("pricing.cta_secondary")}
            </a>
          </div>
        </article>
      </div>
    </section>
  );
}
