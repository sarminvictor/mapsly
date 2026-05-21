import * as React from "react";

import type { ProspectPitchWedge, ProspectSeverity } from "../types";

/**
 * WhyQualifies · the 4 numbered "pitch wedges".
 *
 * This is the closing weapon. Tom screen-shares this section on a
 * sales call. Layout matches `_design/agency/prospect.html`.
 *
 * Server-component-safe · pure presentation, no hooks.
 */

export interface WhyQualifiesLabels {
  title: string;
  subtitle: string;
  /** Tone label · "Critical" / "Opportunity" / "Strength". */
  severityLabel: Record<ProspectSeverity, string>;
}

export interface WhyQualifiesProps {
  wedges: ProspectPitchWedge[];
  labels: WhyQualifiesLabels;
}

function severityBg(s: ProspectSeverity): string {
  switch (s) {
    case "critical":
      return "var(--color-alert, #dc2626)";
    case "warn":
      return "var(--color-warn, #b45309)";
    case "ok":
      return "var(--color-agency-indigo)";
  }
}

export function WhyQualifies({ wedges, labels }: WhyQualifiesProps) {
  return (
    <section
      aria-labelledby="why-qualifies-title"
      data-testid="why-qualifies"
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-agency-indigo-light, #c7d2fe)",
        borderRadius: 14,
        padding: "24px 28px",
        marginBottom: 22,
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "var(--color-agency-indigo)",
          marginBottom: 10,
        }}
      >
        {labels.subtitle}
      </div>
      <h2
        id="why-qualifies-title"
        style={{
          margin: 0,
          fontSize: 22,
          fontWeight: 700,
          lineHeight: 1.3,
          letterSpacing: "-0.02em",
          color: "var(--color-text)",
          marginBottom: 14,
        }}
      >
        {labels.title}
      </h2>
      <ol
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "grid",
          gap: 10,
        }}
      >
        {wedges.map((w, idx) => (
          <li
            key={`${w.severity}-${idx}-${w.headline.slice(0, 20)}`}
            data-severity={w.severity}
            style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: 12,
              alignItems: "flex-start",
              padding: "11px 14px",
              background: "var(--color-bg-3, #f3f4f6)",
              borderRadius: 8,
            }}
          >
            <div
              aria-hidden="true"
              style={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                background: severityBg(w.severity),
                color: "#fff",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                flexShrink: 0,
                fontFamily: "var(--font-mono)",
              }}
            >
              {idx + 1}
            </div>
            <div>
              <div
                style={{
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  color: "var(--color-text)",
                  fontWeight: 500,
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: severityBg(w.severity),
                    marginRight: 8,
                  }}
                >
                  {labels.severityLabel[w.severity]}
                </span>
                {w.headline}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--color-text-3)",
                  marginTop: 4,
                  fontFamily: "var(--font-mono)",
                }}
              >
                {w.evidence}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
