"use client";

import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

/**
 * Landing top-bar shell. Transparent at the very top of the page, then fades to
 * a solid white background with a hairline divider once the user scrolls — so
 * the menu stays legible over content. SSR renders the transparent state (top
 * of page), the scroll listener takes over after hydration.
 */
export function StickyHeader({ children }: { children: ReactNode }) {
  const [scrolled, setScrolled] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    const onResize = () => setIsMobile(window.innerWidth <= 560);
    onScroll();
    onResize();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // On mobile, once scrolled, slim the bar: shorter padding + a shorter inner
  // row (the inner row reads the --landing-topbar-h custom property).
  const compact = scrolled && isMobile;

  const style: CSSProperties = {
    position: "sticky",
    top: 0,
    zIndex: 20,
    paddingTop: compact ? 8 : 16,
    paddingBottom: compact ? 8 : scrolled ? 16 : 0,
    background: scrolled ? "#fff" : "transparent",
    boxShadow: scrolled ? "0 1px 0 rgba(28, 25, 22, 0.06)" : "none",
    transition:
      "background 0.25s ease, box-shadow 0.25s ease, padding 0.25s ease",
    ["--landing-topbar-h" as string]: compact ? "52px" : "66px",
  };

  return (
    <header className="landing-sticky-header" style={style}>
      {children}
    </header>
  );
}
