import * as React from "react";

/**
 * PricingFAQ · 5 billing/pricing-focused questions.
 *
 * Mirrors the AgencyFAQ structure (native <details>/<summary>, no client
 * JS, FAQPage JSON-LD) but scoped to pricing-specific questions: what's
 * included in free, refund policy, can you switch tiers, what counts as a
 * "lead", how cancellation works. Per `.claude/rules/seo.md` FAQPage
 * schema is eligible for Google rich-snippets.
 *
 * Pure server component.
 */
interface PricingFAQProps {
  t: (key: string) => string;
}

interface QA {
  q: string;
  a: string;
}

export function PricingFAQ({ t }: PricingFAQProps) {
  const qa: QA[] = [1, 2, 3, 4, 5].map((i) => ({
    q: t(`faq.q${i}`),
    a: t(`faq.a${i}`),
  }));

  const schema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: qa.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };

  return (
    <section
      aria-labelledby="pricing-faq-title"
      style={{ padding: "80px 24px", background: "var(--color-bg)" }}
    >
      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--color-text-3)",
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            marginBottom: 16,
          }}
        >
          {t("faq.eyebrow")}
        </div>
        <h2
          id="pricing-faq-title"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(28px, 3.5vw, 44px)",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.08,
            margin: "0 0 32px",
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
          {qa.map(({ q, a }) => (
            <details
              key={q}
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: 12,
                background: "var(--color-bg-2)",
                padding: "16px 20px",
              }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  listStyle: "none",
                  fontSize: 16,
                  fontWeight: 600,
                  color: "var(--color-text)",
                  outline: "none",
                }}
              >
                {q}
              </summary>
              <p
                style={{
                  marginTop: 12,
                  marginBottom: 0,
                  fontSize: 15,
                  lineHeight: 1.6,
                  color: "var(--color-text-2)",
                }}
              >
                {a}
              </p>
            </details>
          ))}
        </div>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
    </section>
  );
}
