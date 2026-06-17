"use client";

/**
 * Mobile swipe-slider for a row of cards + pagination dots. On desktop the
 * container is a normal grid (CSS) and the dots are hidden; on phones the
 * container becomes a horizontal scroll-snap carousel and the dots track /
 * drive the active card. The cards themselves stay server-rendered (passed
 * as children).
 */
import { useEffect, useRef, useState, type ReactNode } from "react";

export function Carousel({
  children,
  count,
  className,
  label,
}: {
  children: ReactNode;
  count: number;
  className?: string;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const step = () => {
    const el = ref.current;
    const first = el?.firstElementChild as HTMLElement | undefined;
    if (!el || !first) return 1;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    return first.getBoundingClientRect().width + gap;
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      const i = Math.round(el.scrollLeft / step());
      setActive(Math.max(0, Math.min(count - 1, i)));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [count]);

  const go = (i: number) => {
    ref.current?.scrollTo({ left: i * step(), behavior: "smooth" });
  };

  return (
    <>
      <div className={className} ref={ref}>
        {children}
      </div>
      <div className="fb-cards-dots" role="tablist" aria-label={label}>
        {Array.from({ length: count }).map((_, i) => (
          <button
            key={i}
            type="button"
            role="tab"
            aria-selected={i === active}
            aria-label={`${i + 1} / ${count}`}
            className={i === active ? "is-active" : undefined}
            onClick={() => go(i)}
          />
        ))}
      </div>
    </>
  );
}
