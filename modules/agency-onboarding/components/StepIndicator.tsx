/**
 * Agency onboarding step indicator · server component (pure presentation).
 *
 * Shows "Step N of 3" + a horizontal pill row for the three step
 * labels. Past + current steps highlighted in indigo (agency palette);
 * future steps muted. Mobile-first: pills wrap on narrow widths.
 *
 * Per `.claude/rules/accessibility.md` — semantic <ol> with
 * `aria-current="step"` on the active item so screen readers
 * announce progress.
 *
 * Mirrors `modules/smb-onboarding/components/StepIndicator.tsx` but
 * uses the agency indigo accent instead of coral.
 */

import type { OnboardingStep } from "../types";
import { TOTAL_STEPS } from "../types";

interface StepIndicatorLabels {
  step1: string;
  step2: string;
  step3: string;
  countLabel: string; // "Step {current} of {total}"
}

export function StepIndicator({
  current,
  labels,
}: {
  current: OnboardingStep;
  labels: StepIndicatorLabels;
}) {
  const items: Array<{ n: OnboardingStep; label: string }> = [
    { n: 1, label: labels.step1 },
    { n: 2, label: labels.step2 },
    { n: 3, label: labels.step3 },
  ];

  const count = labels.countLabel
    .replace("{current}", String(current))
    .replace("{total}", String(TOTAL_STEPS));

  return (
    <nav aria-label={count} style={{ marginBottom: 24 }}>
      <p
        style={{
          margin: "0 0 12px",
          fontSize: 13,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
          color: "var(--color-text-3, var(--color-text-2))",
        }}
      >
        {count}
      </p>
      <ol
        style={{
          listStyle: "none",
          padding: 0,
          margin: 0,
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        {items.map((item) => {
          const isCurrent = item.n === current;
          const isPast = item.n < current;
          const active = isCurrent || isPast;
          return (
            <li
              key={item.n}
              aria-current={isCurrent ? "step" : undefined}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                borderRadius: 999,
                background: active
                  ? "var(--color-agency-indigo, #5b3df5)"
                  : "var(--color-bg-2)",
                color: active ? "#fff" : "var(--color-text-2)",
                fontSize: 14,
                fontWeight: 500,
                minHeight: 36,
              }}
            >
              <span
                aria-hidden
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: active
                    ? "rgba(255,255,255,0.2)"
                    : "var(--color-bg-3, var(--color-bg))",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                {item.n}
              </span>
              {item.label}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
