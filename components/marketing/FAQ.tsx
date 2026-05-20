import * as React from "react";

/**
 * FAQ · 5-question accordion using native `<details>`/`<summary>`.
 *
 * Server-rendered, zero JS. `<details>` provides keyboard accessibility,
 * screen-reader semantics, and toggle UX out of the box. No React hooks
 * needed — keeps the page server-only, no client bundle bloat.
 */

interface FAQProps {
  t: (key: string) => string;
}

interface QA {
  q: string;
  a: string;
}

export function FAQ({ t }: FAQProps) {
  const items: QA[] = [
    { q: t("faq.q1"), a: t("faq.a1") },
    { q: t("faq.q2"), a: t("faq.a2") },
    { q: t("faq.q3"), a: t("faq.a3") },
    { q: t("faq.q4"), a: t("faq.a4") },
    { q: t("faq.q5"), a: t("faq.a5") },
  ];

  // JSON-LD FAQPage schema · helps Google show rich results
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };

  return (
    <section
      aria-labelledby="faq-title"
      style={{
        padding: "72px 24px",
        background: "var(--color-bg)",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        <p
          style={{
            textAlign: "center",
            margin: 0,
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--color-text-3)",
          }}
        >
          {t("faq.eyebrow")}
        </p>
        <h2
          id="faq-title"
          style={{
            margin: "12px 0 40px",
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(28px, 4vw, 44px)",
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            textAlign: "center",
            color: "var(--color-text)",
          }}
        >
          {t("faq.title")}
        </h2>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {items.map((item, i) => (
            <details
              key={i}
              style={{
                background: "var(--color-bg-2)",
                border: "1px solid var(--color-border)",
                borderRadius: 10,
                padding: "0 20px",
              }}
            >
              <summary
                style={{
                  padding: "16px 0",
                  fontSize: 16,
                  fontWeight: 600,
                  color: "var(--color-text)",
                  cursor: "pointer",
                  listStyle: "none",
                }}
              >
                {item.q}
              </summary>
              <p
                style={{
                  margin: 0,
                  padding: "0 0 16px",
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: "var(--color-text-2)",
                }}
              >
                {item.a}
              </p>
            </details>
          ))}
        </div>
      </div>

      {/* FAQ rich-result schema · safe to dangerouslySetInnerHTML own data */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </section>
  );
}
