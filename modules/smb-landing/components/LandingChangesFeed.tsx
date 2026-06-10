"use client";

/**
 * Landing · "this week — what changed" real market-events feed.
 *
 * Renders the REAL cell-wide events — the SAME `SmbMarketChange[]` source as the
 * `/home` MarketChangesFeed (own + competitor verified week-over-week moves: a
 * competitor started running ads, a rival gained reviews, a ranking shift, …),
 * restyled as warm cards for the marketing band. No fabricated stats: every card
 * is a real diff. Honest empty state when the weekly diff hasn't surfaced
 * anything yet (the feed warms up as week-over-week history accrues).
 *
 * The cards auto-rotate as a vertical ticker: the top card glides up and out,
 * the rest rise, and the cycled card re-enters at the bottom (under the fade) —
 * looping every `INTERVAL_MS`. The loop is seamless: once the upward glide ends
 * we move the first event to the end of the array and snap the track back to 0
 * with the transition disabled, so the rotated order at offset 0 looks identical
 * to the original order glided up by one card.
 *
 * Pauses on hover / keyboard focus and honours `prefers-reduced-motion` (static
 * feed, no motion) per WCAG 2.2.2.
 *
 * Client component for the relative timestamp + the ticker; the data is
 * server-fetched in `getLandingData` and passed as a plain serializable array.
 */

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import type { SmbEventType, SmbMarketChange } from "@/modules/smb-home/types";

const INTERVAL_MS = 4500;
const TRANSITION_MS = 600;
const GAP = 7;

const TYPE_LABEL: Record<SmbEventType, string> = {
  rating: "Rating",
  reviews: "Reviews",
  ads: "Ads",
  search: "Search",
  photos: "Photos",
  website: "Website",
  services: "Services",
};

function toneColor(tone: SmbMarketChange["tone"]): string {
  return tone === "good"
    ? "var(--color-success)"
    : tone === "bad"
      ? "var(--color-coral)"
      : "var(--color-text-2)";
}

function relativeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diff = Date.now() - then;
  const days = Math.floor(diff / 86_400_000);
  if (days >= 1) return `${days}d ago`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours >= 1) return `${hours}h ago`;
  return "just now";
}

const card: CSSProperties = {
  background: "#F5F5F5",
  borderRadius: 16,
  padding: "16px 18px",
};

function ChangeCard({ e }: { e: SmbMarketChange }) {
  return (
    <div
      style={{
        ...card,
        border: e.isOwn
          ? "1px solid var(--color-coral)"
          : "1px solid transparent",
        background: e.isOwn ? "rgba(195,85,58,0.05)" : "#F5F5F5",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          justifyContent: "space-between",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontFamily: "var(--font-landing-body)",
              fontSize: 9.5,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 600,
              color: "#fff",
              background: "#FCC800",
              borderRadius: 999,
              padding: "5px 14px",
            }}
          >
            {TYPE_LABEL[e.type]}
          </span>
          {e.isOwn ? (
            <span
              style={{
                fontFamily: "var(--font-landing-body)",
                fontSize: 9.5,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                fontWeight: 600,
                color: "var(--color-coral)",
              }}
            >
              You
            </span>
          ) : null}
        </span>
        <span
          style={{
            fontFamily: "var(--font-landing-body)",
            fontSize: 10.5,
            color: "var(--color-text-3)",
            whiteSpace: "nowrap",
          }}
        >
          {relativeAgo(e.at)}
        </span>
      </div>
      <p
        style={{
          margin: "12px 0 0",
          fontFamily: "var(--font-landing-head)",
          fontSize: 22,
          lineHeight: 1.3,
          color: "var(--color-text)",
        }}
      >
        {e.body}
      </p>
      {e.delta ? (
        <p
          style={{
            margin: "10px 0 0",
            fontFamily: "var(--font-landing-body)",
            fontSize: 12.5,
            fontWeight: 600,
            color: toneColor(e.tone),
          }}
        >
          {e.delta}
        </p>
      ) : null}
    </div>
  );
}

export function LandingChangesFeed({
  events,
}: {
  events: readonly SmbMarketChange[];
}) {
  const [order, setOrder] = useState<SmbMarketChange[]>([...events]);
  const [lift, setLift] = useState(0);
  const [animate, setAnimate] = useState(false);
  const firstRef = useRef<HTMLDivElement | null>(null);
  const paused = useRef(false);

  // Need enough cards to actually fill + cycle past the viewport.
  const canRotate = events.length >= 3;

  useEffect(() => {
    if (!canRotate) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => {
      if (paused.current) return;
      const h = (firstRef.current?.offsetHeight ?? 140) + GAP;
      setLift(h);
      setAnimate(true);
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, [canRotate]);

  if (events.length === 0) {
    return (
      <div
        style={{
          ...card,
          textAlign: "center",
          color: "var(--color-text-2)",
          fontSize: 14.5,
          lineHeight: 1.55,
        }}
      >
        No verified market moves this week yet. Your weekly digest of every
        competitor move starts the moment we&apos;ve tracked a full week.
      </div>
    );
  }

  if (!canRotate) {
    return (
      <div style={{ display: "grid", gap: GAP }}>
        {events.map((e) => (
          <ChangeCard key={e.id} e={e} />
        ))}
      </div>
    );
  }

  const onTransitionEnd = () => {
    if (lift === 0) return;
    // Seamless reset: rotate first → last and snap back to 0 with no transition.
    setAnimate(false);
    setOrder((o) => [...o.slice(1), o[0]]);
    setLift(0);
  };

  return (
    <div
      className="landing-changes-viewport"
      style={{ overflow: "hidden" }}
      onMouseEnter={() => {
        paused.current = true;
      }}
      onMouseLeave={() => {
        paused.current = false;
      }}
      onFocusCapture={() => {
        paused.current = true;
      }}
      onBlurCapture={() => {
        paused.current = false;
      }}
    >
      <div
        onTransitionEnd={onTransitionEnd}
        style={{
          display: "grid",
          gap: GAP,
          transform: `translateY(-${lift}px)`,
          transition: animate
            ? `transform ${TRANSITION_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`
            : "none",
        }}
      >
        {order.map((e, i) => (
          <div key={e.id} ref={i === 0 ? firstRef : undefined}>
            <ChangeCard e={e} />
          </div>
        ))}
      </div>
    </div>
  );
}
