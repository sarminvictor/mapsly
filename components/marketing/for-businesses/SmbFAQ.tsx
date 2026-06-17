/**
 * SmbFAQ · "Common questions. Quick answers."
 *
 * Dark ink band. Native <details>/<summary> accordion — no client JS, no
 * hydration. FAQPage JSON-LD emitted inline so Google can render rich
 * snippets (per `.claude/rules/seo.md`).
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
      className="fb-section fb-dark"
      aria-labelledby="fb-faq-title"
    >
      <div className="fb-container">
        <div className="fb-faq-head">
          <h2 id="fb-faq-title" className="fb-h2">
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
