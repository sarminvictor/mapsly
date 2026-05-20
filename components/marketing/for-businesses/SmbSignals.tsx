import * as React from "react";

/**
 * SmbSignals · 6 example signals in Maria's language.
 *
 * Each card pairs a plain-English label, a concrete sample pill, and a
 * one-sentence explanation of what we'd show. NEVER uses signal jargon
 * (no MSI, CTR, schema, NAP, 3-pack) — outcome-first phrasing throughout.
 *
 * Pure server component.
 */
interface SmbSignalsProps {
  t: (key: string) => string;
}

const CARDS = ["c1", "c2", "c3", "c4", "c5", "c6"] as const;

export function SmbSignals({ t }: SmbSignalsProps) {
  return (
    <section
      id="signals"
      aria-labelledby="for-businesses-signals-title"
      style={{
        padding: "96px 24px",
        background: "var(--color-bg)",
      }}
    >
      <div style={{ maxWidth: 1120, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 56 }}>
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
            {t("signals.eyebrow")}
          </div>
          <h2
            id="for-businesses-signals-title"
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "clamp(32px, 4vw, 52px)",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1.05,
              margin: "0 auto 20px",
              color: "var(--color-text)",
              maxWidth: 720,
            }}
          >
            {t("signals.title")}
          </h2>
          <p
            style={{
              fontSize: 18,
              color: "var(--color-text-2)",
              lineHeight: 1.55,
              margin: "0 auto",
              maxWidth: 720,
            }}
          >
            {t("signals.sub")}
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 16,
          }}
        >
          {CARDS.map((c) => (
            <article
              key={c}
              style={{
                padding: "28px 24px",
                background: "var(--color-bg-2)",
                borderRadius: 14,
                border: "1px solid var(--color-border)",
                display: "flex",
                flexDirection: "column",
                gap: 14,
                minHeight: 180,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <h3
                  style={{
                    margin: 0,
                    fontFamily: "var(--font-serif)",
                    fontSize: 19,
                    fontWeight: 600,
                    letterSpacing: "-0.01em",
                    color: "var(--color-text)",
                  }}
                >
                  {t(`signals.${c}_label`)}
                </h3>
                <span
                  style={{
                    padding: "4px 10px",
                    borderRadius: 999,
                    background: "var(--color-coral-dim, rgba(195,85,58,0.1))",
                    color: "var(--color-coral)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t(`signals.${c}_pill`)}
                </span>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  lineHeight: 1.55,
                  color: "var(--color-text-2)",
                }}
              >
                {t(`signals.${c}_desc`)}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
