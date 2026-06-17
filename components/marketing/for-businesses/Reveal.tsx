"use client";

/**
 * Reveals its children (fade-up) the first time the wrapper scrolls into view.
 * SSR renders the visible state — no-JS / SEO safe; on the client it hides
 * while still below the fold, then animates in on scroll. Honors
 * prefers-reduced-motion (stays visible, no animation). The fade/stagger
 * itself lives in fb.css, keyed off the `.is-in` class.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

export function Reveal({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // SSR renders visible (no-JS/SEO safe); hide once below the fold so the
    // fade-up can play when the wrapper scrolls into view.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-time pre-scroll reset
    setInView(false);
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold: 0.18 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const cls = [className, "fb-reveal", inView && "is-in"]
    .filter(Boolean)
    .join(" ");
  return (
    <div ref={ref} className={cls}>
      {children}
    </div>
  );
}
