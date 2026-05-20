import * as React from "react";
import { cn } from "@/lib/ui/cn";

/**
 * FixCard · one prioritized recommendation in the "highest-impact fixes" list.
 *
 * Per `.claude/rules/ui-ux-smb.md`:
 *   - Numbered serif circle on the left (1, 2, 3 — top-3 fixes)
 *   - Plain-English action in the middle
 *   - Optional mono meta line — the "signal trigger" (Maria can ignore)
 *   - Big impact metric on the right · serif · success-green by default
 *
 * Used as repeating rows inside a single "Your 3 highest-impact fixes" Card.
 * One FixCard per fix · no internal divider · parent Card gives the surround.
 *
 * Server-component-safe.
 *
 * Note on styling: see the head comment in `AlertCard.tsx` — this library
 * mirrors `components/ui/*` and uses inline styles + CSS variables.
 */

export type FixCardTone = "good" | "warn" | "neutral";

export interface FixCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Rank in the priority list (1 = highest). Renders as the leading circle. */
  rank: number;
  /** The action — plain English imperative ("Reply to 20 unanswered reviews"). */
  title: React.ReactNode;
  /** Optional secondary line — why this surfaced (signal trigger). Mono. */
  meta?: React.ReactNode;
  /** Big impact value — e.g. "+0.7", "+5 patients/mo". */
  impact: React.ReactNode;
  /** Smaller line under impact — e.g. "grade lift", "est. monthly". */
  impactSub?: React.ReactNode;
  /** Color of the impact metric. Default 'good' (success-green). */
  tone?: FixCardTone;
}

function impactColor(tone: FixCardTone): string {
  switch (tone) {
    case "good":
      return "var(--color-success)";
    case "warn":
      return "var(--color-gold)";
    case "neutral":
    default:
      return "var(--color-text)";
  }
}

export function FixCard({
  rank,
  title,
  meta,
  impact,
  impactSub,
  tone = "good",
  className,
  style,
  ...rest
}: FixCardProps) {
  return (
    <div
      className={cn("mapsly-fix-card", className)}
      data-variant="fix"
      data-tone={tone}
      data-audience="smb"
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 14,
        alignItems: "center",
        padding: "14px 16px",
        background: "var(--color-bg-3)",
        borderRadius: 10,
        ...style,
      }}
      {...rest}
    >
      <span
        aria-hidden
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: "50%",
          background: "rgba(195,85,58,0.10)",
          color: "var(--color-coral)",
          fontFamily: "var(--font-serif)",
          fontWeight: 700,
          fontSize: 13,
          flexShrink: 0,
        }}
      >
        {rank}
      </span>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            lineHeight: 1.45,
            color: "var(--color-text)",
          }}
        >
          {title}
        </div>
        {meta != null ? (
          <div
            style={{
              marginTop: 3,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--color-text-3)",
              lineHeight: 1.4,
            }}
          >
            {meta}
          </div>
        ) : null}
      </div>

      <div
        style={{
          textAlign: "right",
          whiteSpace: "nowrap",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 18,
            fontWeight: 600,
            lineHeight: 1.2,
            color: impactColor(tone),
          }}
        >
          {impact}
        </div>
        {impactSub != null ? (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--color-text-3)",
              marginTop: 2,
            }}
          >
            {impactSub}
          </div>
        ) : null}
      </div>
    </div>
  );
}
