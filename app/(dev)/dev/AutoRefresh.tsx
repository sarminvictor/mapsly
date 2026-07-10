"use client";

// Client-side auto-refresh — re-runs the page's server components on an interval
// via router.refresh(). Combined with cacheLife("seconds") + cacheTag on the
// data queries, this gives a near-live view without WebSocket overhead.
//
// Neon cost guard: this dashboard is internal and often left open in a
// background tab. Each refresh is a burst of Prisma reads, and at 30s it kept
// the Neon endpoint awake 24/7 (30s ≪ the ~5-min suspend threshold). So we
// (a) SKIP refreshes while the tab is hidden — a backgrounded tab does zero DB
// work and lets Neon sleep — and (b) refresh once on re-focus so the view is
// fresh the moment it's looked at again.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AutoRefresh({
  intervalMs = 60_000,
}: {
  intervalMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      // Don't wake Neon for a tab nobody is looking at.
      if (typeof document !== "undefined" && document.hidden) return;
      router.refresh();
    }, intervalMs);

    const onVisible = () => {
      if (!document.hidden) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, intervalMs]);
  return null;
}
