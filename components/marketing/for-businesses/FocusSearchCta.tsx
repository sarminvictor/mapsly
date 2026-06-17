"use client";

/**
 * FocusSearchCta · the "Get my Free Report" buttons further down the page
 * (pricing + closing CTA). Instead of navigating away, they scroll back to
 * the hero and drop the cursor into the business-name search field — so the
 * whole page funnels into one input (Maria rule: one CTA).
 *
 * Label is a plain string (resolved server-side) — no function prop crosses
 * the client boundary (`.claude/rules/cache-components.md` Pattern 4b).
 */

import { ArrowGlyph } from "./fb-shared";

interface FocusSearchCtaProps {
  label: string;
  className?: string;
  withArrow?: boolean;
}

const HERO_SEARCH_ID = "fb-hero-search";

export function FocusSearchCta({
  label,
  className = "fb-btn",
  withArrow = false,
}: FocusSearchCtaProps) {
  function focusSearch() {
    const el = document.getElementById(
      HERO_SEARCH_ID,
    ) as HTMLInputElement | null;
    if (!el) return;
    // JS scroll ignores the CSS reduced-motion rule, so honor it explicitly.
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (reduceMotion) {
      window.scrollTo({ top: 0, behavior: "auto" });
      el.focus({ preventScroll: true });
      return;
    }

    // Try focus now (works when the window is foreground), then smooth-scroll.
    // An off-screen input can silently fail to focus, and focusing AFTER the
    // scroll starts cancels the smooth animation — so we re-assert focus once
    // the scroll settles (scrollend), when the input is on-screen and there's
    // no animation left to interrupt. A timeout backstops browsers that don't
    // fire scrollend (or when already near the top).
    el.focus({ preventScroll: true });
    const settle = () => {
      el.focus({ preventScroll: true });
      window.removeEventListener("scrollend", settle);
    };
    window.addEventListener("scrollend", settle);
    window.setTimeout(settle, 1000);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <button type="button" className={className} onClick={focusSearch}>
      {label}
      {withArrow && (
        <>
          {" "}
          <ArrowGlyph />
        </>
      )}
    </button>
  );
}
