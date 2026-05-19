"use client";

// Client-side auto-refresh — re-runs the page's server components every 30s
// via router.refresh(). Combined with cacheLife("seconds") + cacheTag on the
// data queries, this gives a near-live view without WebSocket overhead.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function AutoRefresh({
  intervalMs = 30_000,
}: {
  intervalMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
