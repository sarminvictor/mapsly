"use client";

// modules/smb-reviews/components/PrivacySummaryCard.tsx
//
// S5 · The privacy-check summary card on /(smb)/reviews — the shortcut
// into the Privacy tab, now with a warning icon + a tap-friendly
// info-tip explaining the stakes (HIPAA fines).
//
// Why a client component: the info-tip needs real expand/collapse
// state. The module's existing `.info-tip` / `title` tooltips are
// hover-only — invisible on phones — so this builds the minimal
// accessible disclosure per `.claude/rules/accessibility.md`:
//
//   - a real <button> with `aria-expanded` + `aria-controls`
//   - tap / Enter / Space toggles; Escape closes and returns focus
//   - focus-visible ring via the global `button:focus-visible` rule
//   - ≥44px tap target (minHeight on the button, visual size stays small)
//   - the note stays in the DOM (`hidden` when collapsed) so
//     `aria-controls` always points at a real element
//
// The card body remains a Link to `?tab=privacy` (same mechanism as the
// tab strip). The info-tip button lives OUTSIDE the Link subtree so
// toggling it can never hijack the card's navigation.
//
// Per `.claude/rules/ui-ux-smb.md`: warm plain-English copy comes in via
// labels (resolved server-side — no function props cross this boundary,
// per cache-components Pattern 4). The icon is decorative (aria-hidden);
// the summary text carries the meaning — never color alone.

import * as React from "react";
import { useId, useRef, useState } from "react";

import { Link } from "@/i18n/navigation";

import { PrivacyWarnIcon } from "./PrivacyWarnIcon";

export interface PrivacySummaryCardLabels {
  /** Headline, count already interpolated server-side ("Privacy check:
   *  2 of your replies may need an edit…"). */
  summary: string;
  /** Link CTA line ("See which ones"). */
  cta: string;
  /** Info-tip toggle ("What's this?"). */
  infoButton: string;
  /** The stakes note — HIPAA + fines, in Maria's voice. */
  infoNote: string;
}

export interface PrivacySummaryCardProps {
  labels: PrivacySummaryCardLabels;
  /** Test hook · render with the info note already expanded. */
  defaultInfoOpen?: boolean;
}

export function PrivacySummaryCard({
  labels,
  defaultInfoOpen = false,
}: PrivacySummaryCardProps) {
  const [open, setOpen] = useState(defaultInfoOpen);
  const noteId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Escape closes the note and hands focus back to the toggle —
  // scoped to the info-tip subtree so it never swallows page keys.
  const onInfoKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  return (
    <div
      style={{
        background: "rgba(195, 85, 58, 0.08)",
        border: "1px solid var(--color-coral)",
        borderRadius: 14,
        padding: "12px 16px",
        marginBottom: 18,
      }}
    >
      <Link
        href={{ pathname: "/reviews", query: { tab: "privacy" } }}
        style={{
          display: "block",
          textDecoration: "none",
        }}
      >
        <p
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            margin: 0,
            fontSize: 14,
            lineHeight: 1.5,
            color: "var(--color-text)",
          }}
        >
          <PrivacyWarnIcon size={15} style={{ marginTop: 3 }} />
          <span>{labels.summary}</span>
        </p>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 13,
            fontWeight: 600,
            color: "var(--color-coral)",
          }}
        >
          {labels.cta} →
        </p>
      </Link>

      <div onKeyDown={onInfoKeyDown}>
        <button
          ref={buttonRef}
          type="button"
          aria-expanded={open}
          aria-controls={noteId}
          onClick={() => setOpen((v) => !v)}
          style={{
            // Visually small, tap-friendly: 44px min hit height with
            // negative margins so the card stays compact.
            display: "inline-flex",
            alignItems: "center",
            minHeight: 44,
            padding: "0 8px",
            margin: "-8px 0 -12px -8px",
            background: "none",
            border: "none",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--color-text-2)",
            textDecorationLine: "underline",
            textDecorationStyle: "dotted",
            textUnderlineOffset: 3,
            cursor: "pointer",
          }}
        >
          {labels.infoButton}
        </button>
        <p
          id={noteId}
          hidden={!open}
          style={{
            margin: "8px 0 0",
            fontSize: 13,
            lineHeight: 1.5,
            color: "var(--color-text-2)",
          }}
        >
          {labels.infoNote}
        </p>
      </div>
    </div>
  );
}
