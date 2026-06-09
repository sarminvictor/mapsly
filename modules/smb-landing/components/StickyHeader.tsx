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

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const style: CSSProperties = {
    position: "sticky",
    top: 0,
    zIndex: 20,
    paddingTop: 16,
    paddingBottom: scrolled ? 16 : 0,
    background: scrolled ? "#fff" : "transparent",
    boxShadow: scrolled ? "0 1px 0 rgba(28, 25, 22, 0.06)" : "none",
    transition:
      "background 0.25s ease, box-shadow 0.25s ease, padding 0.25s ease",
  };

  return <header style={style}>{children}</header>;
}
