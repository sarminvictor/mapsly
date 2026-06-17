"use client";

/**
 * Pins the marketing-v2 header and:
 *   • adds the frosted-glass "pill" backdrop (same params as the search input)
 *     once the page scrolls past the top (`is-scrolled`),
 *   • darkens that pill while it sits over a light/white section so the white
 *     nav stays readable (`is-over-light` — driven by `[data-fb-light]`
 *     sections crossing the header line).
 *
 * Tiny client island — the header content (logo, nav, links) stays
 * server-rendered and is passed as children.
 */
import { useEffect, useState, type ReactNode } from "react";

export function StickyHeader({ children }: { children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  const [overLight, setOverLight] = useState(false);

  useEffect(() => {
    // Sections in DOM order — in the sticky stack later siblings paint on top,
    // so the LAST section spanning the test line is the visible one. Its tone
    // decides the pill colour (e.g. green Reviews over cream Signals → dark
    // tone wins → light glass).
    const toned = Array.from(
      document.querySelectorAll<HTMLElement>("[data-fb-tone]"),
    );
    const row = document.querySelector(".fb-header-row");
    const onScroll = () => {
      setScrolled(window.scrollY > 24);
      // Test at the pill's bottom edge so the menu switches as soon as the
      // next coloured section rises up to meet it (not when it reaches the top).
      const line = row ? row.getBoundingClientRect().bottom + 4 : 60;
      let tone: string | undefined;
      for (const el of toned) {
        const r = el.getBoundingClientRect();
        if (r.top <= line && r.bottom >= line) {
          tone = el.dataset.fbTone;
        }
      }
      setOverLight(tone === "light");
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const className = [
    "fb-header",
    scrolled && "is-scrolled",
    overLight && "is-over-light",
  ]
    .filter(Boolean)
    .join(" ");

  return <header className={className}>{children}</header>;
}
