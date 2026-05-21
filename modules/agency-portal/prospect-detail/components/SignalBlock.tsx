import * as React from "react";

import type { ProspectSeverity, ProspectSignalBlock } from "../types";

/**
 * SignalBlock · one collapsible signal-category panel.
 *
 * Per `.claude/rules/ui-ux-agency.md`: dense, no fluff. Uses native
 * `<details>` for progressive disclosure (server-component-safe, no
 * client JS). Default-open for the first block on the page.
 */

export interface SignalBlockLabels {
  refreshedAtPrefix: string;
}

export interface SignalBlockProps {
  block: ProspectSignalBlock;
  labels: SignalBlockLabels;
  /** Render this block expanded by default. */
  defaultOpen?: boolean;
}

function severityColor(s: ProspectSeverity): string {
  switch (s) {
    case "critical":
      return "var(--color-alert, #dc2626)";
    case "warn":
      return "var(--color-warn, #b45309)";
    case "ok":
      return "var(--color-success, #166534)";
  }
}

export function SignalBlock({ block, labels, defaultOpen }: SignalBlockProps) {
  return (
    <details
      data-testid={`signal-block-${block.key}`}
      data-severity={block.severity}
      open={defaultOpen}
      style={{
        background: "var(--color-bg-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "18px 22px",
        marginBottom: 16,
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          listStyle: "none",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 14,
          fontWeight: 600,
          color: "var(--color-text)",
        }}
      >
        <span style={{ display: "inline-flex", gap: 10, alignItems: "center" }}>
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: severityColor(block.severity),
              display: "inline-block",
            }}
          />
          {block.title}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--color-text-3)",
            fontWeight: 500,
          }}
        >
          // {block.summaryLine}
        </span>
      </summary>
      <ul
        style={{
          listStyle: "none",
          padding: 0,
          margin: "14px 0 0",
          display: "grid",
          gap: 8,
        }}
        aria-label={labels.refreshedAtPrefix}
      >
        {block.bullets.map((b, idx) => (
          <li
            key={`${block.key}-${idx}`}
            style={{
              fontSize: 13,
              lineHeight: 1.5,
              color: "var(--color-text-2)",
              fontFamily: "var(--font-mono)",
              padding: "8px 12px",
              background: "var(--color-bg-3, #f3f4f6)",
              borderRadius: 6,
            }}
          >
            {b}
          </li>
        ))}
      </ul>
    </details>
  );
}
