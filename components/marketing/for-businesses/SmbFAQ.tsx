import * as React from "react";

/**
 * SmbFAQ · 5 questions Maria asks before signing up.
 *
 * Uses native <details>/<summary> for the accordion — no client JS, no
 * hydration, no JS-disabled fallback needed. FAQPage JSON-LD emitted
 * inline so Google can render rich snippets (per `.claude/rules/seo.md`).
 *
 * Pure server component.
 */
interface SmbFAQProps {
  t: (key: string) => string;
}

const ITEMS = ["q1", "q2", "q3", "q4", "q5"] as const;

export function SmbFAQ({ t }: SmbFAQProps) {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: ITEMS.map((q) => ({
      "@type": "Question",
      name: t(`faq.${q}`),
      acceptedAnswer: {
        "@type": "Answer",
        text: t(`faq.${q.replace("q", "a")}`),
      },
    })),
  };

  return (
    <section
      id="faq"
      aria-labelledby="for-businesses-faq-title"
      style={{
        padding: "96px 24px",
        background: "var(--color-bg-3)",
      }}
    >
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
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
            {t("faq.eyebrow")}
          </div>
          <h2
            id="for-businesses-faq-title"
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "clamp(32px, 4vw, 48px)",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1.1,
              margin: 0,
              color: "var(--color-text)",
            }}
          >
            {t("faq.title")}
          </h2>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {ITEMS.map((q) => (
            <details
              key={q}
              style={{
                background: "var(--color-bg-2)",
                borderRadius: 12,
                border: "1px solid var(--color-border)",
                overflow: "hidden",
              }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  padding: "20px 24px",
                  fontSize: 17,
                  fontWeight: 600,
                  color: "var(--color-text)",
                  listStyle: "none",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  minHeight: 44,
                }}
              >
                {t(`faq.${q}`)}
                <span
                  aria-hidden
                  style={{
                    flex: "0 0 auto",
                    fontFamily: "var(--font-mono)",
                    color: "var(--color-coral)",
                    fontSize: 18,
                    fontWeight: 700,
                  }}
                >
                  +
                </span>
              </summary>
              <div
                style={{
                  padding: "0 24px 22px",
                  fontSize: 15,
                  lineHeight: 1.6,
                  color: "var(--color-text-2)",
                }}
              >
                {t(`faq.${q.replace("q", "a")}`)}
              </div>
            </details>
          ))}
        </div>

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
        />
      </div>
    </section>
  );
}
