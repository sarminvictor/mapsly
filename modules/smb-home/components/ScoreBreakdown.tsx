import * as React from "react";
import { cn } from "@/lib/ui/cn";

/**
 * ScoreBreakdown · the 6-dimension sub-score bar list.
 *
 * Per `.claude/rules/ui-ux-smb.md`:
 *   - Bar chart only — no radar / scatter (Maria can't read them)
 *   - Each row: dim name (+ optional info-tip), horizontal bar, numeric value
 *   - Tone color derives from value (green ≥ 67, gold 34–66, red ≤ 33) unless
 *     explicitly overridden — keeps "you're bad here" visually unmissable
 *   - Optional footer/caption for a one-line "top of city in X, bottom in Y"
 *
 * Used in the "Score breakdown · vs market leader" card on the SMB dashboard.
 * Each Dimension is one of the 6 sub-scores composing the Mapsly Score.
 *
 * Server-component-safe.
 *
 * Note on the bar transition: animation honors `prefers-reduced-motion` via
 * the global rule in `app/globals.css` — no per-component check needed.
 */

export type ScoreTone = "good" | "warn" | "bad" | "neutral";

export interface ScoreDimension {
  /** Stable identifier — used as the React key. */
  id: string;
  /** Dimension name. */
  name: React.ReactNode;
  /** 0–`max` numeric score. */
  value: number;
  /** Upper bound (default 100). */
  max?: number;
  /** Override the tone color. Default derives from value/max ratio. */
  tone?: ScoreTone;
  /** Plain-English info-tip explaining what this dimension measures. */
  infoTip?: string;
}

export interface ScoreBreakdownProps extends React.HTMLAttributes<HTMLDivElement> {
  dimensions: ReadonlyArray<ScoreDimension>;
  /** Optional caption rendered below the bars. */
  caption?: React.ReactNode;
}

function deriveTone(value: number, max: number): ScoreTone {
  if (max <= 0) return "neutral";
  const pct = (value / max) * 100;
  if (pct >= 67) return "good";
  if (pct >= 34) return "warn";
  return "bad";
}

function barFill(tone: ScoreTone): string {
  switch (tone) {
    case "good":
      return "linear-gradient(90deg, var(--color-success), var(--color-success-2))";
    case "warn":
      return "linear-gradient(90deg, var(--color-gold), var(--color-gold-2))";
    case "bad":
      return "var(--color-alert)";
    case "neutral":
    default:
      return "var(--color-text-3)";
  }
}

function valueColor(tone: ScoreTone): string {
  switch (tone) {
    case "good":
      return "var(--color-success)";
    case "warn":
      return "var(--color-text)";
    case "bad":
      return "var(--color-alert)";
    case "neutral":
    default:
      return "var(--color-text)";
  }
}

function clampPct(value: number, max: number): number {
  if (max <= 0) return 0;
  const pct = (value / max) * 100;
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

/**
 * Internal · keyboard-accessible info-tip indicator. Real <button> so
 * Tab + Enter reveals the tip via CSS `:focus-visible`.
 */
function InfoTip({ text }: { text: string }) {
  return (
    <button
      type="button"
      aria-label={text}
      title={text}
      data-tip={text}
      className="info-tip"
      tabIndex={0}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 14,
        height: 14,
        borderRadius: "50%",
        background: "var(--color-bg-3)",
        color: "var(--color-text-3)",
        fontSize: 10,
        fontWeight: 700,
        cursor: "help",
        border: "none",
        padding: 0,
        flexShrink: 0,
        fontFamily: "var(--font-mono)",
      }}
    >
      i
    </button>
  );
}

export function ScoreBreakdown({
  dimensions,
  caption,
  className,
  style,
  ...rest
}: ScoreBreakdownProps) {
  return (
    <div
      className={cn("mapsly-score-breakdown", className)}
      data-variant="score-breakdown"
      data-audience="smb"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        ...style,
      }}
      {...rest}
    >
      {dimensions.map((dim) => {
        const max = dim.max ?? 100;
        const tone = dim.tone ?? deriveTone(dim.value, max);
        const pct = clampPct(dim.value, max);
        const fill = barFill(tone);
        const vColor = valueColor(tone);

        return (
          <div
            key={dim.id}
            className="mapsly-score-row"
            data-tone={tone}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 14,
              alignItems: "center",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--color-text-2)",
                  lineHeight: 1.4,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                {dim.name}
                {dim.infoTip ? <InfoTip text={dim.infoTip} /> : null}
              </div>
              <div
                role="progressbar"
                aria-valuenow={dim.value}
                aria-valuemin={0}
                aria-valuemax={max}
                aria-label={
                  typeof dim.name === "string"
                    ? `${dim.name} score ${dim.value} out of ${max}`
                    : undefined
                }
                style={{
                  position: "relative",
                  height: 6,
                  background: "rgba(28,25,22,0.06)",
                  borderRadius: 3,
                  marginTop: 5,
                  overflow: "hidden",
                }}
              >
                <div
                  aria-hidden
                  style={{
                    height: "100%",
                    width: `${pct}%`,
                    borderRadius: 3,
                    background: fill,
                    transition: "width 240ms ease-out",
                  }}
                />
              </div>
            </div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                fontWeight: 600,
                color: vColor,
                whiteSpace: "nowrap",
                textAlign: "right",
                minWidth: 50,
              }}
            >
              {dim.value}
            </div>
          </div>
        );
      })}

      {caption != null ? (
        <div
          style={{
            marginTop: 6,
            padding: "12px 14px",
            background: "var(--color-bg-3)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--color-text-2)",
            lineHeight: 1.5,
          }}
        >
          {caption}
        </div>
      ) : null}
    </div>
  );
}
