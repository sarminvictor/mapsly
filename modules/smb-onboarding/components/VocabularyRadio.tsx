/**
 * Vocabulary radio group · server component.
 *
 * Form-submit-only (no live interactivity) — sits inside the page's
 * step-2 <form>. A native <input type="radio"> means we stay a server
 * component (no `'use client'`), which keeps the route streamable.
 *
 * Per `.claude/rules/accessibility.md`:
 *   - <fieldset> + <legend> groups the choices
 *   - native radios → built-in keyboard arrow navigation
 *   - visible focus ring via `:focus-visible` (handled by globals.css)
 *
 * Per `.claude/rules/ui-ux-smb.md` — warm cream cards, no jargon. The
 * labels are passed from the parent page so all copy stays in the i18n
 * messages file.
 */

import type { Vocabulary } from "../types";

interface VocabularyOption {
  value: Vocabulary;
  label: string;
}

export function VocabularyRadio({
  name,
  options,
  defaultValue,
  legend,
}: {
  name: string;
  options: ReadonlyArray<VocabularyOption>;
  defaultValue?: Vocabulary;
  legend: string;
}) {
  return (
    <fieldset
      style={{
        border: "none",
        padding: 0,
        margin: "16px 0 0",
      }}
    >
      <legend
        style={{
          padding: 0,
          marginBottom: 12,
          color: "var(--color-text-2)",
          fontSize: 15,
          lineHeight: 1.4,
        }}
      >
        {legend}
      </legend>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 10,
        }}
      >
        {options.map((opt) => {
          const checked = opt.value === defaultValue;
          return (
            <label
              key={opt.value}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "12px 14px",
                borderRadius: 12,
                border: checked
                  ? "1.5px solid var(--color-coral, #c3553a)"
                  : "1px solid var(--color-border)",
                background: "var(--color-bg-2)",
                cursor: "pointer",
                minHeight: 48,
                fontSize: 15,
              }}
            >
              <input
                type="radio"
                name={name}
                value={opt.value}
                defaultChecked={checked}
                style={{
                  width: 18,
                  height: 18,
                  accentColor: "var(--color-coral, #c3553a)",
                }}
              />
              <span>{opt.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
