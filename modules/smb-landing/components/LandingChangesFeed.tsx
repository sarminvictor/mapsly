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
 * Client component solely for the relative timestamp (`Date.now()`); the data is
 * server-fetched in `getLandingData` and passed as a plain serializable array.
 */

import type { CSSProperties } from "react";

import type { SmbEventType, SmbMarketChange } from "@/modules/smb-home/types";

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
  background: "#fbf9f5",
  borderRadius: 16,
  padding: "16px 18px",
  boxShadow: "0 16px 40px -28px rgba(28,25,22,0.22)",
};

export function LandingChangesFeed({
  events,
}: {
  events: readonly SmbMarketChange[];
}) {
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

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {events.map((e) => (
        <div
          key={e.id}
          style={{
            ...card,
            border: e.isOwn
              ? "1px solid var(--color-coral)"
              : "1px solid transparent",
            background: e.isOwn ? "rgba(195,85,58,0.05)" : "#fbf9f5",
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
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 9.5,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  fontWeight: 700,
                  color: "var(--color-text-2)",
                  background: "var(--color-bg-3)",
                  borderRadius: 999,
                  padding: "2px 9px",
                }}
              >
                {TYPE_LABEL[e.type]}
              </span>
              {e.isOwn ? (
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 9.5,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    fontWeight: 700,
                    color: "var(--color-coral)",
                  }}
                >
                  You
                </span>
              ) : null}
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
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
              fontSize: 14.5,
              lineHeight: 1.45,
              color: "var(--color-text)",
            }}
          >
            {e.body}
          </p>
          {e.delta ? (
            <p
              style={{
                margin: "10px 0 0",
                fontFamily: "var(--font-mono)",
                fontSize: 12.5,
                fontWeight: 700,
                color: toneColor(e.tone),
              }}
            >
              {e.delta}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
