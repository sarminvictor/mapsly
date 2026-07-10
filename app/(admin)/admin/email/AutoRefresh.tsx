"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Periodically re-pull the server-rendered stats (cold-email admin).
 *  Neon cost guard: skip refreshes while the tab is hidden (a backgrounded admin
 *  tab did a Prisma burst every 30s, keeping the endpoint awake 24/7), and
 *  refresh once on re-focus. */
export default function AutoRefresh({
  intervalMs = 60_000,
}: {
  intervalMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
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
