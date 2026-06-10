"use client";

/**
 * Scroll-triggered count-up animations for the landing's stat numbers.
 *
 * `CountUp` animates a single numeric span from 0 → target the first time it
 * scrolls into view (IntersectionObserver + requestAnimationFrame, easeOut).
 * `ScoreGauge` is the hero gauge — the arc fill and the number animate together.
 *
 * SSR renders the FINAL value (hydration-safe, correct with JS disabled, SEO),
 * then the client resets to 0 and counts up once in view. `prefers-reduced-
 * motion` and missing IntersectionObserver both fall back to the final value
 * with no animation.
 */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

const SERIF = "var(--font-landing-head)";
const nf = new Intl.NumberFormat("en-US");

/**
 * Returns a callback ref + the current animated value. Starts at `target`
 * (SSR/hydration parity), resets to 0 on mount, and eases to `target` the first
 * time the node intersects the viewport.
 */
function useScrollCount(target: number, durationMs = 1100) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  const [val, setVal] = useState(target);
  // `done` flips true only once the count-up has reached the target — used to
  // hold any post-count effect (e.g. the critical pulse) until the number lands.
  const [done, setDone] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (!node) return;
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    // Reduced motion / no IntersectionObserver: leave the value at its final
    // (initial) state — no animation. (No setState here, so the count-up
    // never fires synchronously in the effect body.)
    if (reduce || typeof IntersectionObserver === "undefined") return;

    let raf = 0;
    const obs = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting || started.current) return;
        started.current = true;
        obs.disconnect();
        // Reset to 0, then ease up — all setState lives in this subscription
        // callback, not the effect body.
        setVal(0);
        setDone(false);
        const t0 = performance.now();
        const step = (now: number) => {
          const p = Math.min(1, (now - t0) / durationMs);
          const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
          setVal(target * eased);
          if (p < 1) {
            raf = requestAnimationFrame(step);
          } else {
            setVal(target);
            setDone(true);
          }
        };
        raf = requestAnimationFrame(step);
      },
      { threshold: 0.5, rootMargin: "0px 0px -10% 0px" },
    );
    obs.observe(node);
    return () => {
      obs.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [node, target, durationMs]);

  return { setNode, val, done };
}

export function CountUp({
  value,
  decimals = 0,
  grouping = false,
  prefix = "",
  suffix = "",
  durationMs,
  critical = false,
  unit,
}: {
  value: number;
  decimals?: number;
  grouping?: boolean;
  prefix?: string;
  suffix?: string;
  durationMs?: number;
  critical?: boolean;
  unit?: ReactNode;
}) {
  const { setNode, val, done } = useScrollCount(value, durationMs);
  const fmt = (n: number) =>
    grouping ? nf.format(Math.round(n)) : n.toFixed(decimals);
  const finalText = `${prefix}${fmt(value)}${suffix}`;
  const liveText = `${prefix}${fmt(val)}${suffix}`;

  // Inner inline-block reserves the FINAL value's width via a hidden sizer, so
  // the surrounding text never reflows while the number counts up (no jitter);
  // the live value is overlaid, anchored to the left edge. The outer wrapper
  // carries the critical pulse (after the count lands) AND any `unit` — so a
  // red unit (e.g. "ads") pulses together with the number, not just the digits.
  return (
    <span
      ref={setNode}
      className={critical && done ? "landing-critical-pulse" : undefined}
    >
      <span
        aria-label={finalText}
        style={{ position: "relative", display: "inline-block" }}
      >
        <span
          aria-hidden
          style={{ visibility: "hidden", whiteSpace: "nowrap" }}
        >
          {finalText}
        </span>
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            whiteSpace: "nowrap",
          }}
        >
          {liveText}
        </span>
      </span>
      {unit}
    </span>
  );
}

export function ScoreGauge({ value }: { value: number | null }) {
  const r = 50;
  const C = 2 * Math.PI * r;
  const arc = 0.75 * C; // 270° open-bottom sweep
  const target = value == null ? 0 : value;
  const { setNode, val } = useScrollCount(target);
  const frac = Math.max(0, Math.min(1, val / 10));
  const display = value == null ? "—" : val.toFixed(1);

  return (
    <div
      ref={setNode}
      role="img"
      aria-label={
        value == null ? "Not scored yet" : `${value.toFixed(1)} out of 10`
      }
      style={{ position: "relative", width: 156, height: 138 }}
    >
      <svg
        viewBox="0 0 120 120"
        width="156"
        height="156"
        style={{ position: "absolute", top: 0, left: 0 }}
      >
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="var(--color-bg-3)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${arc} ${C}`}
          transform="rotate(135 60 60)"
        />
        <circle
          cx="60"
          cy="60"
          r={r}
          fill="none"
          stroke="#fffd54"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${arc * frac} ${C}`}
          transform="rotate(135 60 60)"
        />
      </svg>
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 0,
          right: 0,
          height: 130,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span
          style={{
            fontFamily: SERIF,
            fontSize: 56,
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {display}
        </span>
        <span
          className="hero-gauge-slash"
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--color-text)",
            marginTop: 8,
          }}
        >
          / 10
        </span>
      </div>
    </div>
  );
}
