import * as React from "react";
import { cn } from "@/lib/ui/cn";

/**
 * AlertCard · "what needs Maria's attention" row.
 *
 * Per `.claude/rules/ui-ux-smb.md`:
 *   - Tone-tinted background (red/gold/info/success) + icon chip
 *   - Plain-English body — use `<b>` for the lead claim
 *   - Mono meta line beneath for source + impact (the math, visible)
 *   - One CTA per card · imperative verb ("Reply & post →")
 *
 * Used in the "Needs your attention today" card on the dashboard.
 * Tone is REDUNDANT with color (label + icon convey state too) per a11y rules.
 *
 * The component does NOT default to `role="status"` / `aria-live`:
 *   - These cards are static on first render — they're not real-time
 *     notifications. Announcing every card to AT users at page load is noisy.
 *   - Callers that want live-region semantics pass `live` explicitly; this
 *     maps to `aria-live="polite"` per `.claude/rules/accessibility.md`.
 *
 * Server-component-safe: no hooks, no event handlers. Caller passes the
 * CTA as a ReactNode (Link or button) — keeps the card itself stateless.
 *
 * Note on styling: this library mirrors `components/ui/*` and uses inline
 * styles + CSS variables (rather than Tailwind utilities) so the components
 * render identically in server + client trees with no class-name FOUC. The
 * convention is project-wide; see B.0 for precedent.
 */

export type AlertTone = "bad" | "warn" | "info" | "good";

export interface AlertCardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Tone determines bg tint + icon chip color. Pair with semantic icon. */
  tone: AlertTone;
  /** Icon node (svg) — sized 14px, white-on-tone-bg chip applied by us. */
  icon: React.ReactNode;
  /** Body — the human-readable explanation. Use <b> for the lead claim. */
  body: React.ReactNode;
  /** Optional meta line — source + impact. Renders in mono, smaller. */
  meta?: React.ReactNode;
  /** Optional trailing CTA — typically a Link or button. */
  cta?: React.ReactNode;
  /** Opt-in: announce to assistive tech on mount (`aria-live="polite"`). */
  live?: boolean;
}

function toneStyles(tone: AlertTone): {
  bg: string;
  iconBg: string;
  iconFg: string;
} {
  switch (tone) {
    case "bad":
      return {
        bg: "rgba(181,61,71,0.10)",
        iconBg: "var(--color-alert)",
        iconFg: "#fff",
      };
    case "warn":
      return {
        bg: "rgba(212,165,116,0.18)",
        iconBg: "var(--color-gold)",
        iconFg: "#fff",
      };
    case "info":
      return {
        bg: "rgba(59,110,196,0.10)",
        iconBg: "var(--color-info)",
        iconFg: "#fff",
      };
    case "good":
      return {
        bg: "rgba(45,134,89,0.12)",
        iconBg: "var(--color-success)",
        iconFg: "#fff",
      };
  }
}

export function AlertCard({
  tone,
  icon,
  body,
  meta,
  cta,
  live,
  className,
  style,
  ...rest
}: AlertCardProps) {
  const t = toneStyles(tone);

  return (
    <div
      className={cn("mapsly-alert-card", className)}
      data-variant="alert"
      data-tone={tone}
      data-audience="smb"
      role={live ? "status" : undefined}
      aria-live={live ? "polite" : undefined}
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 14,
        alignItems: "start",
        padding: "14px 16px",
        background: t.bg,
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
          borderRadius: 8,
          background: t.iconBg,
          color: t.iconFg,
          flexShrink: 0,
        }}
      >
        {icon}
      </span>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 13.5,
            lineHeight: 1.4,
            color: "var(--color-text)",
          }}
        >
          {body}
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

      {cta != null ? (
        <div style={{ flexShrink: 0, alignSelf: "center" }}>{cta}</div>
      ) : null}
    </div>
  );
}
