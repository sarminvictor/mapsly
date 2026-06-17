"use client";

/**
 * Scroll-triggered animations for the Mirror block:
 *   • <CountUp>   — a number that counts up from 0 when it scrolls into view.
 *   • <ScoreGauge> — the Mapsly-Score dial: the yellow arc draws its length
 *                    and the value counts up, both on scroll.
 *
 * Client leaves only — SmbMirror stays a server component and passes plain
 * numbers/strings (no `t` crosses the boundary). SSR renders the final value
 * (good for no-JS / SEO); on the client the value resets to 0 while the block
 * is still below the fold, so there's no visible flash. Honors
 * prefers-reduced-motion (jumps straight to the final state).
 */
import { useEffect, useMemo, useRef, useState } from "react";

function reducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

const DURATION = 1400;
const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3);

export function CountUp({
  value,
  decimals = 0,
  locale,
  className,
}: {
  value: number;
  decimals?: number;
  locale: string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [n, setN] = useState(value);
  const fmt = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }),
    [locale, decimals],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion()) return; // initial state already holds the final value
    // reset to 0 so the number doesn't flash its final value before the
    // scroll-triggered count-up runs (the block starts below the fold)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-time reset
    setN(0);
    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        io.disconnect();
        let start: number | null = null;
        const step = (ts: number) => {
          start ??= ts;
          const p = Math.min(1, (ts - start) / DURATION);
          setN(value * easeOutCubic(p));
          if (p < 1) raf = requestAnimationFrame(step);
          else setN(value);
        };
        raf = requestAnimationFrame(step);
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);

  return (
    <span ref={ref} className={className}>
      {fmt.format(n)}
    </span>
  );
}

// Gauge geometry — viewBox units == on-screen px (the .fb-gauge box is 217px).
const BOX = 217;
const C0 = BOX / 2;
const STROKE = 16;
const R = C0 - STROKE / 2;
const CIRC = 2 * Math.PI * R;
const GAP_DEG = 72; // gap centered at the bottom
const ARC_LEN = CIRC * ((360 - GAP_DEG) / 360);
const START_DEG = 90 + GAP_DEG / 2;

export function ScoreGauge({
  score,
  max,
  unit,
  ariaLabel,
  locale,
  decimals = 1,
}: {
  score: number;
  max: number;
  unit: string;
  ariaLabel: string;
  locale: string;
  decimals?: number;
}) {
  const fraction = Math.max(0, Math.min(1, score / max));
  const yellowLen = ARC_LEN * fraction;
  const ref = useRef<HTMLDivElement | null>(null);
  const [drawn, setDrawn] = useState(true);
  const [n, setN] = useState(score);
  const fmt = useMemo(
    () =>
      new Intl.NumberFormat(locale, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }),
    [locale, decimals],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion()) return; // initial state already holds the final value + drawn arc
    // reset before the scroll-triggered draw so the arc + number animate in
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional one-time reset
    setDrawn(false);
    setN(0);
    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        io.disconnect();
        setDrawn(true);
        let start: number | null = null;
        const step = (ts: number) => {
          start ??= ts;
          const p = Math.min(1, (ts - start) / DURATION);
          setN(score * easeOutCubic(p));
          if (p < 1) raf = requestAnimationFrame(step);
          else setN(score);
        };
        raf = requestAnimationFrame(step);
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [score]);

  const rotate = `rotate(${START_DEG} ${C0} ${C0})`;
  return (
    <div className="fb-gauge" ref={ref} role="img" aria-label={ariaLabel}>
      <svg width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden>
        <circle
          cx={C0}
          cy={C0}
          r={R}
          fill="none"
          stroke="#e7e4dd"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${ARC_LEN} ${CIRC}`}
          transform={rotate}
        />
        <circle
          cx={C0}
          cy={C0}
          r={R}
          fill="none"
          stroke="var(--fb-yellow)"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={`${yellowLen} ${CIRC}`}
          strokeDashoffset={drawn ? 0 : yellowLen}
          style={{ transition: "stroke-dashoffset 1.4s ease-out" }}
          transform={rotate}
        />
      </svg>
      <div className="fb-gauge-value">
        <span className="fb-gauge-num">{fmt.format(n)}</span>
        <span className="fb-gauge-unit">{unit}</span>
      </div>
    </div>
  );
}
