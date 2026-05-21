import * as React from "react";

import type { ThemeBucket } from "../types";

/**
 * ThemesCard · "What people are talking about" theme breakdown for the
 * right rail.
 *
 * Maria-facing. Plain English: each row shows the theme, mention count,
 * and a small flag when the theme leans negative (≥50% of mentions on
 * 1–3★ reviews).
 *
 * Per `.claude/rules/copy-voice.md`:
 *   - Show the math: "13 mentions · most in 1-3★" beats "negative skew"
 *   - No acronyms; "negative skew" gets translated to a warning glyph +
 *     plain label
 *
 * Server-component-safe.
 */

const NEGATIVE_SKEW_THRESHOLD = 0.5;

export interface ThemesCardLabels {
  title: string;
  subtitle: string;
  empty: string;
  /** Caption appended when the theme leans negative — e.g. "negative skew". */
  negativeSkew: string;
}

export interface ThemesCardProps {
  themes: ThemeBucket[];
  labels: ThemesCardLabels;
}

export function ThemesCard({ themes, labels }: ThemesCardProps) {
  return (
    <section
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 12,
        padding: "16px 18px",
      }}
    >
      <h3
        style={{
          margin: "0 0 10px",
          fontFamily: "var(--font-serif)",
          fontSize: 15,
          letterSpacing: "-0.01em",
          color: "var(--color-text)",
        }}
      >
        {labels.title}
      </h3>

      {themes.length === 0 ? (
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "var(--color-text-3)",
            lineHeight: 1.5,
          }}
        >
          {labels.empty}
        </p>
      ) : (
        <>
          <p
            style={{
              margin: "0 0 12px",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--color-text-3)",
            }}
          >
            {labels.subtitle}
          </p>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {themes.map((t) => {
              const negativeRatio = t.count > 0 ? t.negativeCount / t.count : 0;
              const isNegative = negativeRatio >= NEGATIVE_SKEW_THRESHOLD;
              return (
                <li
                  key={t.theme}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    paddingBottom: 8,
                    borderBottom: "1px solid var(--color-border)",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--color-text)",
                        fontWeight: 500,
                        textTransform: "capitalize",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {t.theme}
                    </div>
                    {isNegative ? (
                      <div
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 10,
                          color: "var(--color-alert, #b53d47)",
                          marginTop: 2,
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                        }}
                      >
                        <span aria-hidden>⚠</span>
                        {labels.negativeSkew}
                      </div>
                    ) : null}
                  </div>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 13,
                      color: isNegative
                        ? "var(--color-alert, #b53d47)"
                        : "var(--color-text-2)",
                      fontWeight: 600,
                      minWidth: 32,
                      textAlign: "right",
                    }}
                  >
                    {t.count}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
