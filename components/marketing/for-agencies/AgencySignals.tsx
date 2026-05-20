import * as React from "react";

/**
 * AgencySignals · signal-vocabulary teaser · the moat made browsable.
 *
 * 8 category cards, each showing 3 example filter signatures. The point
 * is making the 74-signal taxonomy concrete + scannable. Tom's voice:
 * full jargon (LCP, NAP, schema, MSI, 3-pack) — he wants the technical
 * names because they let him think in his own vocabulary.
 *
 * Pure server component · the entire grid is statically rendered.
 */

interface AgencySignalsProps {
  t: (key: string) => string;
}

interface SignalCategory {
  num: number;
  label: string;
  count: string;
  examples: string[];
}

export function AgencySignals({ t }: AgencySignalsProps) {
  const categories: SignalCategory[] = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({
    num: i,
    label: t(`signals.cat_${i}_label`),
    count: t(`signals.cat_${i}_count`),
    examples: [
      t(`signals.cat_${i}_ex_1`),
      t(`signals.cat_${i}_ex_2`),
      t(`signals.cat_${i}_ex_3`),
    ],
  }));

  return (
    <section
      id="signals"
      aria-labelledby="for-agencies-signals-title"
      style={{ padding: "80px 24px", background: "var(--color-bg-2)" }}
    >
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
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
          {t("signals.eyebrow")}
        </div>
        <h2
          id="for-agencies-signals-title"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "clamp(28px, 3.5vw, 44px)",
            fontWeight: 800,
            letterSpacing: "-0.03em",
            lineHeight: 1.08,
            margin: "0 0 16px",
            color: "var(--color-text)",
          }}
        >
          {t("signals.title")}
        </h2>
        <p
          style={{
            fontSize: 17,
            color: "var(--color-text-2)",
            maxWidth: 760,
            margin: "0 0 48px",
            lineHeight: 1.55,
          }}
        >
          {t("signals.sub")}
        </p>

        <div
          className="mapsly-signals-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 16,
          }}
        >
          {categories.map((cat) => (
            <article
              key={cat.num}
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: 12,
                padding: 20,
                background: "var(--color-bg)",
              }}
            >
              <header
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: 12,
                  marginBottom: 14,
                }}
              >
                <h3
                  style={{
                    margin: 0,
                    fontSize: 16,
                    fontWeight: 700,
                    color: "var(--color-text)",
                    letterSpacing: "-0.01em",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      color: "var(--color-agency-indigo)",
                      marginRight: 8,
                    }}
                  >
                    {String(cat.num).padStart(2, "0")}
                  </span>
                  {cat.label}
                </h3>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--color-text-3)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    whiteSpace: "nowrap",
                  }}
                >
                  {cat.count}
                </span>
              </header>
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {cat.examples.map((ex) => (
                  <li
                    key={ex}
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12.5,
                      color: "var(--color-text-2)",
                      lineHeight: 1.5,
                    }}
                  >
                    {ex}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>

      <style>{`
        @media (min-width: 720px) {
          .mapsly-signals-grid {
            grid-template-columns: 1fr 1fr !important;
          }
        }
        @media (min-width: 1080px) {
          .mapsly-signals-grid {
            grid-template-columns: repeat(4, 1fr) !important;
          }
        }
      `}</style>
    </section>
  );
}
