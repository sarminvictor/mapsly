/**
 * AgFAQ · "Common questions. Quick answers."
 *
 * Identical in style to the SMB FAQ (dark ink band, native
 * <details>/<summary> accordion — no client JS, no hydration) with the
 * agency Q&A. FAQPage JSON-LD emitted inline for rich snippets (per
 * `.claude/rules/seo.md`).
 *
 * Pure server component.
 */
interface AgFAQProps {
  t: (key: string) => string;
}

const ITEMS = ["q1", "q2", "q3", "q4", "q5"] as const;

export function AgFAQ({ t }: AgFAQProps) {
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
      className="fb-section fb-dark"
      aria-labelledby="fb-ag-faq-title"
    >
      <div className="fb-container">
        <div className="fb-faq-head">
          <h2 id="fb-ag-faq-title" className="fb-h2">
            {t("faq.title_lead")}{" "}
            <em className="fb-em fb-ylw">{t("faq.title_emph")}</em>
          </h2>
        </div>

        <div className="fb-faq-list">
          {ITEMS.map((q) => (
            <details key={q} className="fb-faq-item">
              <summary>
                {t(`faq.${q}`)}
                <span className="fb-faq-plus" aria-hidden />
              </summary>
              <p className="fb-faq-answer">{t(`faq.${q.replace("q", "a")}`)}</p>
            </details>
          ))}
        </div>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />
    </section>
  );
}
