"use client";

/**
 * HeroStats · the three animated count-up stats in the welcome hero.
 *
 * `'use client'` because the count-up uses requestAnimationFrame + a layout
 * effect (browser-only). Ports the prototype's `runCountUps`/`fmtCount`
 * (docs/portal-prototype.html ~line 12141): each value animates 0 → target
 * over 900ms with a cubic ease-out, honoring `prefers-reduced-motion` (jumps
 * straight to the final value). The first render shows the final formatted
 * value so SSR/no-JS still reads correctly, then the effect re-animates from 0.
 *
 * Props are plain data (numbers/strings) — no functions cross the boundary
 * (cache-components Pattern 4). Values are passed in so they can later be wired
 * to real counts (metros / indexed businesses / signal-registry size).
 *
 * Each `.num` carries an aria-label with the final value so screen readers get
 * the number, not the mid-animation digits.
 */

import { useEffect, useRef } from "react";

type Fmt = "plain" | "compact";

interface Stat {
  to: number;
  fmt: Fmt;
  suffix: string;
  /** Inline color override (e.g. the indigo "50+" stat). */
  color?: string;
  label: string;
}

function fmtCount(n: number, fmt: Fmt): string {
  if (fmt === "compact") {
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return Math.round(n / 1e3) + "K";
  }
  return Math.round(n).toLocaleString("en-US");
}

export function HeroStats({ stats }: { stats: Stat[] }) {
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const frames: number[] = [];

    stats.forEach((stat, i) => {
      const el = refs.current[i];
      if (!el) return;

      const final = fmtCount(stat.to, stat.fmt) + stat.suffix;
      if (reduceMotion) {
        el.textContent = final;
        return;
      }

      const dur = 900;
      const start = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / dur);
        const eased = 1 - Math.pow(1 - t, 3);
        el.textContent = fmtCount(stat.to * eased, stat.fmt) + stat.suffix;
        if (t < 1) {
          frames[i] = requestAnimationFrame(tick);
        } else {
          el.textContent = final;
        }
      };
      frames[i] = requestAnimationFrame(tick);
    });

    return () => frames.forEach((f) => f && cancelAnimationFrame(f));
  }, [stats]);

  return (
    <div className="hero-stats">
      {stats.map((stat, i) => {
        const final = fmtCount(stat.to, stat.fmt) + stat.suffix;
        return (
          <div key={stat.label}>
            <div
              ref={(node) => {
                refs.current[i] = node;
              }}
              className="num"
              style={stat.color ? { color: stat.color } : undefined}
              aria-label={final}
            >
              {final}
            </div>
            <div className="lbl">{stat.label}</div>
          </div>
        );
      })}
    </div>
  );
}
