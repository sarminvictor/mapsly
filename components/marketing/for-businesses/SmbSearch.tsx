"use client";

/**
 * SmbSearch · hero business-name search field (the page's single CTA).
 *
 * Kept as a tiny client island ONLY so we can render a custom ~5px blinking
 * caret in brand yellow — CSS has no caret-width lever, so the native caret
 * can't be thickened. The native caret is hidden (caret-color: transparent)
 * and a 5px bar is positioned at the end of the typed text, measured against
 * an off-screen mirror span. Everything else on the page stays a pure server
 * component. The form is still a plain GET into the signin/report funnel.
 */
import { useLayoutEffect, useRef, useState } from "react";

import { ArrowGlyph } from "./fb-shared";

interface SmbSearchProps {
  /** Locale-prefixed signin path — plain string for the <form action>. */
  signinPath: string;
  placeholder: string;
  ariaLabel: string;
  cta: string;
}

// Caret base x = the input's left padding (4px), so an empty field shows the
// caret right where the first character will land.
const CARET_BASE = 4;
const CARET_WIDTH = 5;

export function SmbSearch({
  signinPath,
  placeholder,
  ariaLabel,
  cta,
}: SmbSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [caretLeft, setCaretLeft] = useState(CARET_BASE);

  const reposition = () => {
    const input = inputRef.current;
    const mirror = mirrorRef.current;
    if (!input || !mirror) return;
    const textW = mirror.getBoundingClientRect().width;
    // Pin to the visual end of the text; clamp inside the field once it scrolls.
    const x = CARET_BASE + textW - input.scrollLeft;
    setCaretLeft(Math.min(x, input.clientWidth - CARET_WIDTH));
  };

  // Recompute whenever the value changes (mirror has re-rendered by now).
  useLayoutEffect(reposition, [value]);

  return (
    <form className="fb-search" action={signinPath} method="get" role="search">
      <svg width="24" height="24" viewBox="0 0 18 18" aria-hidden>
        <circle
          cx="8"
          cy="8"
          r="5.5"
          stroke="currentColor"
          strokeWidth="1.8"
          fill="none"
        />
        <path
          d="M12.2 12.2l3.6 3.6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>

      <span className="fb-search-field">
        <input
          ref={inputRef}
          type="text"
          name="business"
          placeholder={placeholder}
          aria-label={ariaLabel}
          autoComplete="organization"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onScroll={reposition}
        />
        {/* Off-screen text mirror — width drives the caret x position. */}
        <span className="fb-search-mirror" ref={mirrorRef} aria-hidden>
          {value}
        </span>
        {focused && (
          <span className="fb-caret" aria-hidden style={{ left: caretLeft }} />
        )}
      </span>

      <button type="submit" className="fb-btn">
        {cta} <ArrowGlyph />
      </button>
    </form>
  );
}
