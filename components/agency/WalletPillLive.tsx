"use client";

/**
 * WalletPillLive · the client island that keeps the topbar credit balance fresh
 * (Phase 9).
 *
 * The server `WalletPill` reads the wallet once at render and hands the value
 * down as `initial`, so SSR shows the correct number immediately. This island
 * then polls `GET /api/agency/wallet` every 10s — plus an immediate refetch on
 * window focus — so a HOLD or SETTLE from an enrichment surfaces within seconds
 * instead of going stale until the next navigation.
 *
 * Polling (not SSE) is deliberate: the balance changes on the order of seconds,
 * the payload is a single integer, and a 10s poll is far simpler than a stream
 * for a glance widget. The markup is identical to the server pill so hydration
 * matches exactly.
 *
 * Degrades gracefully: a failed fetch keeps the last good value (never flashes a
 * wrong number); the interval + focus listener are cleaned up on unmount.
 */

import { useEffect, useState } from "react";

import { Link } from "@/i18n/navigation";

const POLL_MS = 10_000;

export function WalletPillLive({ initial }: { initial: number }) {
  const [credits, setCredits] = useState(initial);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      try {
        const res = await fetch("/api/agency/wallet", {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (!res.ok) return;
        const data: { credits?: number } = await res.json();
        if (!cancelled && typeof data.credits === "number") {
          setCredits(data.credits);
        }
      } catch {
        // Network blip — keep the last known value; the next tick retries.
      }
    }

    const id = setInterval(refresh, POLL_MS);
    const onFocus = () => {
      void refresh();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const empty = credits <= 0;
  const label = empty
    ? "0 credits — add"
    : `${credits.toLocaleString()} credits`;

  return (
    <Link
      href="/usage"
      className={`wallet${empty ? " low" : ""}`}
      aria-label={empty ? "Wallet empty — add credits" : `Wallet ${label}`}
    >
      <span className="coin" aria-hidden />
      <span>{label}</span>
    </Link>
  );
}
