import * as React from "react";

import type { SignalCorrelation } from "../types";

/**
 * SignalCorrelationPanel · the "which signals predict reply" panel.
 *
 * STUB IMPLEMENTATION at F.5 · the heavy per-signal odds-ratio compute
 * lives in a follow-up D.x signal-engineering task. The component
 * renders:
 *
 *   - A populated list of correlation bars when `correlations.length > 0`
 *   - An empty-state "coming next phase" card otherwise
 *
 * Once D.x ships the population path stays the same — only the empty
 * branch becomes dead code, removable by deleting the conditional.
 *
 * Per `.claude/rules/ui-ux-agency.md`:
 *   - Tool-y, terse, jargon-OK
 *   - Numbers over adjectives ("Lift 1.4× · n=48" beats "very strong")
 *   - Sentence case throughout
 *
 * Server-component-safe · pure presentational, no hooks, no state.
 */

export interface SignalCorrelationPanelLabels {
  title: string;
  subtitle: string;
  /** Empty-state copy when correlations are not yet computed. */
  empty: string;
  /** Per-row lift formatter ("1.4×" / "1,4×" per locale). */
  formatLift: (lift: number) => string;
  /** Per-row sample-size formatter ("n=48"). */
  formatN: (n: number) => string;
}

export interface SignalCorrelationPanelProps {
  correlations: SignalCorrelation[];
  labels: SignalCorrelationPanelLabels;
}

export function SignalCorrelationPanel({
  correlations,
  labels,
}: SignalCorrelationPanelProps) {
  return (
    <section
      aria-label={labels.title}
      data-testid="signal-correlation-panel"
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "18px 20px",
        marginBottom: 22,
      }}
    >
      <header style={{ marginBottom: 12 }}>
        <h2
          style={{
            margin: 0,
            fontSize: 14,
            fontWeight: 600,
            letterSpacing: "0.02em",
            color: "var(--color-text)",
          }}
        >
          {labels.title}
        </h2>
        <p
          style={{
            margin: "4px 0 0",
            fontSize: 12,
            color: "var(--color-text-2)",
            lineHeight: 1.5,
          }}
        >
          {labels.subtitle}
        </p>
      </header>

      {correlations.length === 0 ? (
        <div
          data-testid="signal-correlation-empty"
          style={{
            padding: "20px 0 8px",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--color-text-3)",
            lineHeight: 1.5,
          }}
        >
          {labels.empty}
        </div>
      ) : (
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
          {correlations.map((c) => {
            // Clamp lift to a visual range of 0..3× for bar width
            // (positive correlation only). Lifts >3× cap at 100%.
            const widthPct = Math.max(
              4,
              Math.min(100, (c.lift / 3) * 100),
            );
            const isPositive = c.lift >= 1;
            return (
              <li
                key={c.signalKey}
                data-testid={`correlation-${c.signalKey}`}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) 80px 56px",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--color-text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.label}
                  </div>
                  <div
                    style={{
                      marginTop: 4,
                      height: 6,
                      background: "var(--color-bg-3, #eef0f5)",
                      borderRadius: 3,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${widthPct}%`,
                        height: "100%",
                        background: isPositive
                          ? "var(--color-success, #16a34a)"
                          : "var(--color-alert, #dc2626)",
                      }}
                    />
                  </div>
                </div>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--color-text)",
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {labels.formatLift(c.lift)}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--color-text-3)",
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {labels.formatN(c.sampleSize)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
