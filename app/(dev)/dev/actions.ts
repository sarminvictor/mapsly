"use server";

import { revalidateTag } from "next/cache";

// Forces a refresh of every dev-dashboard cache tag. Used by the Refresh button.
// Next 16's revalidateTag with cacheComponents enabled requires the cacheLife
// profile as the second argument (see INC-2026-05-19-13).
export async function refreshDashboard() {
  // services + cost cards: cached for days; only bust on explicit Refresh
  revalidateTag("dev-dashboard-services", "days");
  // Everything else: short-lived so AutoRefresh keeps them current
  for (const tag of [
    "dev-dashboard-github",
    "dev-dashboard-content",
    "dev-dashboard-plan",
    "dev-dashboard-sessions",
    "dev-dashboard-blockers",
    "dev-dashboard-cron",
    "dev-dashboard-enhance",
    "dev-dashboard-cost",
    "dev-dashboard-dora",
    "dev-dashboard-loop",
  ]) {
    revalidateTag(tag, "seconds");
  }
}
