"use server";

import { revalidateTag } from "next/cache";

// Forces a refresh of every dev-dashboard cache tag. Used by the Refresh button.
// Next 16's revalidateTag with cacheComponents enabled requires the cacheLife
// profile as the second argument (see INC-2026-05-19-13).
export async function refreshDashboard() {
  for (const tag of [
    "dev-dashboard-github",
    "dev-dashboard-content",
    "dev-dashboard-plan",
    "dev-dashboard-sessions",
    "dev-dashboard-services",
    "dev-dashboard-blockers",
    "dev-dashboard-cron",
    "dev-dashboard-enhance",
  ]) {
    revalidateTag(tag, "seconds");
  }
}
