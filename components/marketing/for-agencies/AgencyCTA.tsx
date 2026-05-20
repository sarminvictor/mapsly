import * as React from "react";
import { Link } from "@/i18n/navigation";

/**
 * AgencyCTA · closing call-to-action band.
 *
 * Tom's voice. Two CTAs (primary: self-serve free trial · secondary:
 * talk-to-sales for the Boutique tier). Trust badges row below as
 * jargon-friendly reassurance (SOC 2, GDPR, monthly billing).
 *
 * Server component · no client JS.
 */

interface AgencyCTAProps {
  t: (key: string) => string;
}

export function AgencyCTA({ t }: AgencyCTAProps) {
  const trust = [t("cta.trust_1"), t("cta.trust_2"), t("cta.trust_3")];

  return (
    <section
      aria-labelledby="for-agencies-cta-title"
      style={{
        padding: "96px 24px",
        background:
          "linear-gradient(180deg, var(--color-bg-2) 0%, var(--color-agency-bg) 100%)",
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
            color: "var(--color-agency-indigo)",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            marginBottom: 16,
          }}
        >
          {t("cta.eyebrow")}
        </div>
        <h2
          id="for-agencies-cta-title"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(32px, 4vw, 52px)",
            fontWeight: 800,
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
              background: "var(--color-agency-indigo)",
              color: "#fff",
              fontWeight: 600,
              fontSize: 15,
              textDecoration: "none",
              boxShadow: "0 8px 24px rgba(91,61,245,.25)",
              minHeight: 44,
            }}
          >
            {t("cta.primary")}
          </Link>
          <a
            href="mailto:sales@mapsly.ai"
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
          aria-label="Trust indicators"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            gap: 28,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          {trust.map((item) => (
            <li
              key={item}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12.5,
                color: "var(--color-text-3)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "var(--color-agency-indigo)",
                }}
              />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
