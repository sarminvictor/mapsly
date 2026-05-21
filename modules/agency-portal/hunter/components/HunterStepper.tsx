/**
 * HunterStepper · 3-step indicator showing where the user is in the flow.
 *
 * Server component. Per `.claude/rules/ui-ux-agency.md`:
 *   - Dense, mono-flavored, indigo accent on the active step
 *   - Past steps render as muted-but-done, future steps as ghosted
 *   - No interactivity in this slice — clickable navigation lands in F.2.4
 */

import * as React from "react";

export interface HunterStepperProps {
  currentStep: 1 | 2 | 3;
  labels: { step1: string; step2: string; step3: string };
}

const STEP_KEYS = ["step1", "step2", "step3"] as const;

export function HunterStepper({ currentStep, labels }: HunterStepperProps) {
  return (
    <ol
      role="list"
      aria-label="Hunter steps"
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 10,
        margin: 0,
        padding: 0,
        listStyle: "none",
        fontFamily: "var(--font-sans)",
        fontSize: 13,
      }}
    >
      {STEP_KEYS.map((key, idx) => {
        const stepNum = (idx + 1) as 1 | 2 | 3;
        const isActive = stepNum === currentStep;
        const isDone = stepNum < currentStep;
        const bg = isActive
          ? "rgba(91,61,245,0.10)"
          : "var(--color-bg-2)";
        const color = isActive
          ? "var(--color-agency-indigo)"
          : isDone
          ? "var(--color-text)"
          : "var(--color-text-3)";
        const borderColor = isActive
          ? "var(--color-agency-indigo)"
          : "var(--color-border)";
        return (
          <li
            key={key}
            aria-current={isActive ? "step" : undefined}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              borderRadius: 999,
              background: bg,
              color,
              border: "1px solid",
              borderColor,
              fontWeight: isActive ? 600 : 500,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                background: isActive
                  ? "var(--color-agency-indigo)"
                  : isDone
                  ? "var(--color-text)"
                  : "transparent",
                color: isActive || isDone ? "#fff" : "var(--color-text-3)",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                fontWeight: 700,
                border:
                  isActive || isDone
                    ? "none"
                    : "1px solid var(--color-border)",
              }}
            >
              {stepNum}
            </span>
            {labels[key]}
          </li>
        );
      })}
    </ol>
  );
}
