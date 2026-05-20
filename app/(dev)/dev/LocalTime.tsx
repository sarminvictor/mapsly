"use client";

import { useEffect, useState } from "react";

interface LocalTimeProps {
  /** ISO 8601 timestamp string (UTC) */
  iso: string;
  /** Style: 'relative' shows "2h ago", 'absolute' shows "May 20, 18:34", 'both' shows both */
  mode?: "relative" | "absolute" | "both";
  /** Inline style applied to wrapper */
  style?: React.CSSProperties;
  /** className applied to wrapper */
  className?: string;
}

/**
 * Renders an ISO timestamp in the browser's local timezone.
 *
 * Server-rendered version shows UTC-formatted absolute time as a fallback
 * (so there's something useful before hydration). After hydration the
 * client replaces it with localized output.
 */
export default function LocalTime({
  iso,
  mode = "both",
  style,
  className,
}: LocalTimeProps) {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Defer setState so we don't cascade a re-render in the same effect tick.
    queueMicrotask(() => setHydrated(true));
  }, []);

  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return (
      <span className={className} style={style}>
        —
      </span>
    );
  }

  // Server-side / pre-hydration: render a stable UTC-ish fallback so the markup
  // is identical on server + first client paint (no hydration mismatch).
  if (!hydrated) {
    const utcLabel = d.toISOString().slice(5, 16).replace("T", " ") + " UTC";
    return (
      <span
        className={className}
        style={style}
        suppressHydrationWarning
        title={iso}
      >
        {utcLabel}
      </span>
    );
  }

  const rel = formatRelative(d);
  const abs = formatAbsolute(d);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const display =
    mode === "relative" ? rel : mode === "absolute" ? abs : `${rel} · ${abs}`;

  return (
    <span
      className={className}
      style={style}
      title={`${abs} (${tz})\n${iso}`}
      suppressHydrationWarning
    >
      {display}
    </span>
  );
}

function formatRelative(d: Date): string {
  const seconds = Math.round((Date.now() - d.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(seconds / 3600);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(seconds / 86400);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatAbsolute(d: Date): string {
  // "May 20, 18:34" in user's local timezone
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
