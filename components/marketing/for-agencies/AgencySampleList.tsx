import * as React from "react";

/**
 * AgencySampleList · sample of a real Hunter saved-search return.
 *
 * Shows 4 rows of qualified med-spa prospects in Miami with their
 * "why qualified" signal stack + redacted contacts + match scores.
 * Pure server render · static demo data baked into the component.
 *
 * Per `.claude/rules/ui-ux-agency.md`:
 *   - Dense table layout (sticky header, 4 columns)
 *   - Numbers in tabular-nums
 *   - Match score uses both color + numeric value (a11y: not color-alone)
 *   - Contact strings are redacted (••• 4421) to signal "verified, full
 *     value in app" without showing private contacts on a public page
 */

interface AgencySampleListProps {
  t: (key: string) => string;
}

interface SampleRow {
  key: string;
  name: string;
  meta: string;
  signals: string;
  contact: string;
  score: string;
}

function scoreColor(score: number): string {
  if (score >= 90) return "var(--color-success)";
  if (score >= 80) return "var(--color-agency-indigo)";
  return "var(--color-text-2)";
}

export function AgencySampleList({ t }: AgencySampleListProps) {
  const rows: SampleRow[] = [1, 2, 3, 4].map((i) => ({
    key: `r${i}`,
    name: t(`sample_list.row_${i}_name`),
    meta: t(`sample_list.row_${i}_meta`),
    signals: t(`sample_list.row_${i}_signals`),
    contact: t(`sample_list.row_${i}_contact`),
    score: t(`sample_list.row_${i}_score`),
  }));

  return (
    <section
      aria-labelledby="for-agencies-sample-title"
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
          {t("sample_list.eyebrow")}
        </div>
        <h2
          id="for-agencies-sample-title"
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
          {t("sample_list.title")}
        </h2>
        <p
          style={{
            fontSize: 17,
            color: "var(--color-text-2)",
            maxWidth: 820,
            margin: "0 0 32px",
            lineHeight: 1.55,
            fontFamily: "var(--font-mono)",
          }}
        >
          {t("sample_list.sub")}
        </p>

        <div
          role="region"
          aria-label={t("sample_list.title")}
          tabIndex={0}
          style={{
            borderRadius: 12,
            border: "1px solid var(--color-border)",
            background: "var(--color-bg)",
            overflow: "auto",
          }}
        >
          <table
            style={{
              width: "100%",
              minWidth: 720,
              borderCollapse: "collapse",
              fontSize: 14,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <caption className="sr-only">{t("sample_list.title")}</caption>
            <thead>
              <tr style={{ background: "var(--color-bg-3)" }}>
                <th
                  scope="col"
                  style={{
                    textAlign: "left",
                    padding: "12px 16px",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "var(--color-text-3)",
                    borderBottom: "1px solid var(--color-border)",
                  }}
                >
                  {t("sample_list.header_business")}
                </th>
                <th
                  scope="col"
                  style={{
                    textAlign: "left",
                    padding: "12px 16px",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "var(--color-text-3)",
                    borderBottom: "1px solid var(--color-border)",
                  }}
                >
                  {t("sample_list.header_signals")}
                </th>
                <th
                  scope="col"
                  style={{
                    textAlign: "left",
                    padding: "12px 16px",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "var(--color-text-3)",
                    borderBottom: "1px solid var(--color-border)",
                  }}
                >
                  {t("sample_list.header_contact")}
                </th>
                <th
                  scope="col"
                  style={{
                    textAlign: "right",
                    padding: "12px 16px",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    color: "var(--color-text-3)",
                    borderBottom: "1px solid var(--color-border)",
                  }}
                >
                  {t("sample_list.header_score")}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const scoreNum = parseInt(r.score, 10);
                return (
                  <tr
                    key={r.key}
                    style={{
                      borderBottom: "1px solid var(--color-border)",
                    }}
                  >
                    <td
                      style={{
                        padding: "16px",
                        verticalAlign: "top",
                        minWidth: 200,
                      }}
                    >
                      <div
                        style={{
                          fontWeight: 600,
                          color: "var(--color-text)",
                          marginBottom: 4,
                        }}
                      >
                        {r.name}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--color-text-3)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {r.meta}
                      </div>
                    </td>
                    <td
                      style={{
                        padding: "16px",
                        verticalAlign: "top",
                        color: "var(--color-text-2)",
                        fontFamily: "var(--font-mono)",
                        fontSize: 13,
                        lineHeight: 1.5,
                      }}
                    >
                      {r.signals}
                    </td>
                    <td
                      style={{
                        padding: "16px",
                        verticalAlign: "top",
                        color: "var(--color-text-2)",
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {r.contact}
                    </td>
                    <td
                      style={{
                        padding: "16px",
                        verticalAlign: "top",
                        textAlign: "right",
                      }}
                    >
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          padding: "4px 10px",
                          borderRadius: 6,
                          background: "var(--color-bg-2)",
                          color: scoreColor(scoreNum),
                          fontWeight: 700,
                          fontFamily: "var(--font-mono)",
                          fontSize: 14,
                          border: "1px solid var(--color-border)",
                        }}
                        aria-label={`Match score ${r.score} of 100`}
                      >
                        {r.score}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p
          style={{
            marginTop: 16,
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            color: "var(--color-text-3)",
          }}
        >
          {t("sample_list.footer")}
        </p>
      </div>

      <style>{`
        .sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0,0,0,0);
          white-space: nowrap;
          border: 0;
        }
      `}</style>
    </section>
  );
}
