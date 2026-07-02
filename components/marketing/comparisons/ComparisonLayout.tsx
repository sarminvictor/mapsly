// components/marketing/comparisons/ComparisonLayout.tsx · WP6-7.
//
// The shared render for every /compare/mapsly-vs-* page, driven by a
// ComparisonSpec. Pure server component (zero client JS): hero → weakness
// callout → signal-combination examples → head-to-head table → CTA (internal
// link to /for-agencies) → sibling cross-links. Agency voice; a11y-first (real
// <table> with scoped headers, semantic headings). JSON-LD lives in the page so
// it can reference the canonical URL.

import { Link } from "@/i18n/navigation";
import {
  COMPARISONS,
  COMPARISON_SLUGS,
  type ComparisonSpec,
} from "./comparison-data";

import "./comparison.css";

/**
 * Map each slug to its full, literal typed pathname so next-intl's typed
 * `Link` accepts it (a template string would widen to `string` and fail the
 * pathname union check).
 */
const SLUG_PATHNAME: Record<
  ComparisonSpec["slug"],
  | "/compare/mapsly-vs-apollo"
  | "/compare/mapsly-vs-gohighlevel"
  | "/compare/mapsly-vs-leadswift-d7"
> = {
  "mapsly-vs-apollo": "/compare/mapsly-vs-apollo",
  "mapsly-vs-gohighlevel": "/compare/mapsly-vs-gohighlevel",
  "mapsly-vs-leadswift-d7": "/compare/mapsly-vs-leadswift-d7",
};

export function ComparisonLayout({ spec }: { spec: ComparisonSpec }) {
  const siblings = COMPARISON_SLUGS.filter((s) => s !== spec.slug);

  return (
    <div className="cmp-scope">
      <div className="cmp-wrap">
        <header className="cmp-hero">
          <span className="cmp-eyebrow">{spec.eyebrow}</span>
          <h1 className="cmp-h1">{spec.h1}</h1>
          <p className="cmp-lede">{spec.lede}</p>
        </header>

        {/* Documented weakness of the competitor's camp. */}
        <section className="cmp-section" aria-labelledby="cmp-weakness-title">
          <div className="cmp-weakness">
            <h2 id="cmp-weakness-title">{spec.weaknessTitle}</h2>
            <p>{spec.weaknessBody}</p>
          </div>
        </section>

        {/* Signal-combination examples the competitor can't produce. */}
        <section className="cmp-section" aria-labelledby="cmp-examples-title">
          <h2 id="cmp-examples-title" className="cmp-h2">
            Signal combinations {spec.competitor} can&rsquo;t produce
          </h2>
          <p className="cmp-section-sub">
            Any one field is a commodity. The moat is combining local-business
            signals into a single qualified reason to call — each backed by
            evidence.
          </p>
          <div className="cmp-examples">
            {spec.examples.map((ex) => (
              <article className="cmp-card" key={ex.title}>
                <p className="cmp-card-signals">
                  {ex.signals.map((sig) => (
                    <span className="cmp-chip" key={sig}>
                      {sig}
                    </span>
                  ))}
                </p>
                <h3 className="cmp-card-title">{ex.title}</h3>
                <p className="cmp-card-body">{ex.body}</p>
              </article>
            ))}
          </div>
        </section>

        {/* Head-to-head table. */}
        <section className="cmp-section" aria-labelledby="cmp-table-title">
          <h2 id="cmp-table-title" className="cmp-h2">
            Mapsly vs {spec.competitor}, head to head
          </h2>
          <div className="cmp-table-wrap">
            <table className="cmp-table">
              <caption>{spec.tableCaption}</caption>
              <thead>
                <tr>
                  <th scope="col">Dimension</th>
                  <th scope="col">Mapsly</th>
                  <th scope="col">{spec.competitor}</th>
                </tr>
              </thead>
              <tbody>
                {spec.rows.map((row) => (
                  <tr key={row.dimension}>
                    <th scope="row">{row.dimension}</th>
                    <td className="cmp-col-mapsly">{row.mapsly}</td>
                    <td className="cmp-col-them">{row.them}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* CTA — internal link into the agency funnel (for-agencies + signin). */}
        <section
          className="cmp-section cmp-cta"
          aria-labelledby="cmp-cta-title"
        >
          <h2 id="cmp-cta-title">{spec.ctaTitle}</h2>
          <p>{spec.ctaSub}</p>
          <Link
            href={{ pathname: "/signin", query: { audience: "agency" } }}
            className="cmp-btn"
          >
            Get 50 free leads
          </Link>
          <p className="cmp-links">
            <Link href="/for-agencies">See how Mapsly works for agencies</Link>
            <span className="cmp-sep" aria-hidden="true">
              ·
            </span>
            <Link href="/for-agencies">Explore the 60+ signals</Link>
          </p>
        </section>

        {/* Sibling comparison cross-links (internal linking, SEO). */}
        <nav className="cmp-siblings" aria-label="Other comparisons">
          Compare Mapsly with{" "}
          {siblings.map((slug, i) => (
            <span key={slug}>
              {i > 0 && " and "}
              <Link href={SLUG_PATHNAME[slug]}>
                {COMPARISONS[slug].competitor}
              </Link>
            </span>
          ))}
          .
        </nav>
      </div>
    </div>
  );
}
