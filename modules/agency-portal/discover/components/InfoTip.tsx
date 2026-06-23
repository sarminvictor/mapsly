"use client";

// InfoTip · a hover/focus glossary tooltip (Phase 9). Tom knows the jargon but
// forgets specifics — every signal name in the portal can carry one of these
// (per .claude/rules/ui-ux-agency.md: "Tooltips for every signal name").
//
// Accessible: the trigger is a real <button> with aria-describedby pointing at
// the tooltip; the tooltip shows on hover AND keyboard focus, and Escape closes
// it. Color is never the only signal — the "?" glyph carries the affordance.

import { useId, useState } from "react";

export interface InfoTipProps {
  /** The glossary body shown in the tooltip. */
  text: string;
  /** Accessible label for the trigger (defaults to "More info"). */
  triggerLabel?: string;
}

export function InfoTip({ text, triggerLabel = "More info" }: InfoTipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={triggerLabel}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 text-[10px] font-semibold leading-none text-slate-500 hover:border-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
      >
        <span aria-hidden>?</span>
      </button>
      {open ? (
        <span
          id={id}
          role="tooltip"
          className="absolute left-1/2 top-full z-20 mt-1 w-56 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs leading-snug text-slate-600 shadow-lg"
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}
