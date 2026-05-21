/**
 * HunterPreviewBar · sticky bottom bar showing live match count + save CTA.
 *
 * In this scaffold slice the count is a hardcoded `0` placeholder — F.2.1
 * will wire it to the D.4 evaluator via a debounced (400ms) live update.
 * The "Save as list" button is disabled until step 3 is reached and the
 * count > 0; until then it shows a muted hint explaining what's missing.
 *
 * Server component (renders static markup; F.2.3 will replace the
 * disabled button with a `useTransition`'d server action).
 *
 * Per `.claude/rules/ui-ux-agency.md`: sticky, dense, indigo accent on
 * the count, mono caption for the filter-summary line.
 */

import * as React from "react";

export interface HunterPreviewBarLabels {
  countSuffix: string;
  countPlaceholder: string;
  loading: string;
  summaryStep1: string;
  summaryStep2: string;
  summaryStep3: string;
  saveCta: string;
  saveDisabledHint: string;
}

export interface HunterPreviewBarProps {
  matchCount: number;
  currentStep: 1 | 2 | 3;
  labels: HunterPreviewBarLabels;
}

export function HunterPreviewBar({
  matchCount,
  currentStep,
  labels,
}: HunterPreviewBarProps) {
  const summary =
    currentStep === 1
      ? labels.summaryStep1
      : currentStep === 2
        ? labels.summaryStep2
        : labels.summaryStep3;

  const canSave = currentStep === 3 && matchCount > 0;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "sticky",
        bottom: 16,
        zIndex: 5,
        marginTop: 8,
        background: "var(--color-bg)",
        border: "1px solid var(--color-border)",
        borderRadius: 14,
        padding: "14px 18px",
        boxShadow:
          "0 8px 24px rgba(15, 17, 34, .10), 0 1px 2px rgba(15, 17, 34, .06)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 28,
            fontWeight: 700,
            color: "var(--color-agency-indigo)",
            letterSpacing: "-0.01em",
          }}
        >
          {matchCount > 0
            ? matchCount.toLocaleString()
            : labels.countPlaceholder}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--color-text-3)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          {labels.countSuffix}
        </span>
      </div>

      <div
        style={{
          flex: "1 1 240px",
          minWidth: 0,
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--color-text-3)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {summary}
      </div>

      <button
        type="button"
        disabled={!canSave}
        title={canSave ? undefined : labels.saveDisabledHint}
        style={{
          padding: "10px 18px",
          borderRadius: 8,
          border: "none",
          background: canSave
            ? "var(--color-agency-indigo)"
            : "var(--color-bg-3)",
          color: canSave ? "#fff" : "var(--color-text-3)",
          fontFamily: "var(--font-sans)",
          fontSize: 13,
          fontWeight: 600,
          cursor: canSave ? "pointer" : "not-allowed",
        }}
      >
        {labels.saveCta}
      </button>
    </div>
  );
}
