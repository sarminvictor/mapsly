"use client";

// useCountUp · animate a number from 0 → target over ~900ms with cubic ease-out,
// honoring prefers-reduced-motion (jumps to the final value). The brand
// count-up signature on the Preview/Discover KPI tiles. Mirrors the prototype's
// runCountUps. English-only / presentational only.

import { useEffect, useRef, useState } from "react";

export function useCountUp(target: number, durationMs = 900): number {
  const [value, setValue] = useState(0);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    // Reduced motion or non-positive target: jump straight to the final value,
    // but schedule it (no synchronous setState inside the effect body).
    if (reduce || target <= 0) {
      raf.current = requestAnimationFrame(() => setValue(target));
      return () => {
        if (raf.current != null) cancelAnimationFrame(raf.current);
      };
    }

    const start = performance.now();
    function tick(now: number) {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // cubic ease-out
      setValue(Math.round(target * eased));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
    };
  }, [target, durationMs]);

  return value;
}
