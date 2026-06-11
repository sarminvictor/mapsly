"use client";

/**
 * Vocabulary radio group · client component.
 *
 * `'use client'` because selecting a medical vocabulary (med-spa,
 * dental) reveals a quiet reassurance line under the selector — reply
 * drafts are HIPAA-aware and never confirm someone was a patient. That
 * needs live selection state. The radios stay native and submit through
 * the surrounding step <form>; this is a leaf component so the route
 * stays streamable (per `.claude/rules/performance.md`).
 *
 * Per `.claude/rules/accessibility.md`:
 *   - <fieldset> + <legend> groups the choices
 *   - native radios → built-in keyboard arrow navigation
 *   - visible focus ring via `:focus-visible` (handled by globals.css)
 *   - the medical note lives in an always-mounted `aria-live="polite"`
 *     region so screen readers announce it when it appears
 *
 * Per `.claude/rules/ui-ux-smb.md` — warm cream cards, no jargon. All
 * copy (labels + note) is passed from the parent page as plain strings
 * so it stays in the i18n messages file and no function props cross the
 * server→client boundary (cache-components Pattern 4).
 */

import { useState } from "react";

import { MEDICAL_VOCABULARIES, type Vocabulary } from "../types";

interface VocabularyOption {
  value: Vocabulary;
  label: string;
}

export function VocabularyRadio({
  name,
  options,
  defaultValue,
  legend,
  medicalNote,
}: {
  name: string;
  options: ReadonlyArray<VocabularyOption>;
  defaultValue?: Vocabulary;
  legend: string;
  /** Quiet line shown under the selector when a medical vocabulary
   *  (see `MEDICAL_VOCABULARIES`) is selected. Pre-resolved string. */
  medicalNote?: string;
}) {
  const [selected, setSelected] = useState<Vocabulary | undefined>(
    defaultValue,
  );
  const showMedicalNote =
    medicalNote !== undefined &&
    selected !== undefined &&
    MEDICAL_VOCABULARIES.includes(selected);

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
          const checked = opt.value === selected;
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
                checked={checked}
                onChange={() => setSelected(opt.value)}
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
      {medicalNote !== undefined && (
        <p
          aria-live="polite"
          style={{
            margin: "12px 0 0",
            fontSize: 13,
            lineHeight: 1.5,
            color: "var(--color-text-2)",
          }}
        >
          {showMedicalNote ? medicalNote : ""}
        </p>
      )}
    </fieldset>
  );
}
