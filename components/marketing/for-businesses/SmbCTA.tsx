import * as React from "react";
import { Link } from "@/i18n/navigation";

/**
 * SmbCTA · closing band. Maria-warm voice.
 *
 * Single primary CTA, secondary "see sample" to defuse hesitation. Trust
 * row (money-back, no card, cancel) below — same reassurance pattern
 * Maria sees from familiar consumer SaaS.
 *
 * Pure server component.
 */
interface SmbCTAProps {
  t: (key: string) => string;
}

export function SmbCTA({ t }: SmbCTAProps) {
  const trust = [t("cta.trust_1"), t("cta.trust_2"), t("cta.trust_3")];

  return (
    <section
      aria-labelledby="for-businesses-cta-title"
      style={{
        padding: "96px 24px",
        background:
          "linear-gradient(180deg, var(--color-bg-3) 0%, var(--color-bg) 100%)",
      }}
    >
      <div
        style={{
          maxWidth: 880,
          margin: "0 auto",
          textAlign: "center",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--color-coral)",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            marginBottom: 16,
          }}
        >
          {t("cta.eyebrow")}
        </div>
        <h2
          id="for-businesses-cta-title"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(32px, 4vw, 52px)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.05,
            margin: "0 0 20px",
            color: "var(--color-text)",
          }}
        >
          {t("cta.title")}
        </h2>
        <p
          style={{
            fontSize: 18,
            color: "var(--color-text-2)",
            lineHeight: 1.55,
            margin: "0 auto 36px",
            maxWidth: 580,
          }}
        >
          {t("cta.sub")}
        </p>

        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            justifyContent: "center",
            marginBottom: 40,
          }}
        >
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
            {t("cta.primary")}
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
            {t("cta.secondary")}
          </a>
        </div>

        <ul
          aria-label="Trust signals"
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "16px 28px",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--color-text-3)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {trust.map((label) => (
            <li
              key={label}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span
                aria-hidden
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: "var(--color-coral)",
                }}
              />
              {label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
