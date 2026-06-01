// SMB /ads · "What you should do" — the signals/quick-actions block. Each card
// is a derived recommendation (opportunity / gap / watch), color + icon coded
// (not color alone, per a11y). Server component; copy resolved by the page.

import * as React from "react";

export type AdSuggestionTone = "opportunity" | "gap" | "watch";

export interface AdSuggestionItem {
  id: string;
  tone: AdSuggestionTone;
  title: string;
  detail: string;
}

function accentFor(tone: AdSuggestionTone): string {
  if (tone === "opportunity") return "var(--color-success, #2d8659)";
  if (tone === "watch") return "var(--color-gold, #d4a574)";
  return "var(--color-coral)";
}

function ToneIcon({ tone }: { tone: AdSuggestionTone }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (tone === "opportunity") {
    return (
      <svg {...common}>
        <path d="M9 18h6" />
        <path d="M10 22h4" />
        <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 1 0 6 8c0 1 .23 2.23 1.5 3.5.76.76 1.23 1.52 1.41 2.5" />
      </svg>
    );
  }
  if (tone === "watch") {
    return (
      <svg {...common}>
        <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
    </svg>
  );
}

export function AdSuggestions({ items }: { items: AdSuggestionItem[] }) {
  if (items.length === 0) return null;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {items.map((s) => {
        const accent = accentFor(s.tone);
        return (
          <div
            key={s.id}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-start",
              border: "1px solid var(--color-border)",
              borderLeft: `4px solid ${accent}`,
              borderRadius: "0 12px 12px 0",
              background: "var(--color-bg-2)",
              padding: "13px 16px",
            }}
          >
            <span style={{ color: accent, flexShrink: 0, marginTop: 1 }}>
              <ToneIcon tone={s.tone} />
            </span>
            <div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: 14.5,
                  color: "var(--color-text)",
                  lineHeight: 1.3,
                }}
              >
                {s.title}
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--color-text-2)",
                  marginTop: 3,
                  lineHeight: 1.45,
                }}
              >
                {s.detail}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
