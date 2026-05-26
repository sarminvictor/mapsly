// Monthly · services-detect
//
// Pre-populates `BusinessService` rows for active businesses from their
// Google categories so Maria's first visit to /(smb)/my-business shows
// a starter list rather than a blank page. Per the v0.8.x SMB portal
// restructure: "soft onboarding — prefill from Google, user can edit,
// editing not required."
//
// What this does:
//
//   1. Scans active businesses in batches (DEFAULT_LIMIT per run).
//   2. For each, calls `suggestServicesFromGoogleCategories` on its
//      primary + secondary categories.
//   3. Skips any service NAME (case-insensitive) that already exists as
//      a BusinessService for that business — whether active OR inactive.
//      This means:
//        - Maria's manual deletes stick (the soft-deleted row blocks
//          re-creation on subsequent runs)
//        - Maria's manual additions never get duplicated
//        - First sync creates the starter set; subsequent runs are no-ops
//          unless Google adds new categories
//   4. Creates only NET-NEW rows with source="auto:google", isActive=true.
//
// No external API calls — pure DB compute on already-indexed
// Business.categories[] (populated by the weekly business-profile-refresh
// cron). Cost ≈ $0 + DB time.
//
// Per `.claude/rules/scalability.md`:
//   - Bounded per-run work (DEFAULT_LIMIT businesses).
//   - createMany for net-new inserts; no per-row insert loop.
//   - skipDuplicates is unnecessary here because we de-dup in app code
//     against the active+inactive name set, but we still use it as a
//     safety net against rare race conditions.
//
// Per `.claude/rules/observability.md`:
//   - CronRun.meta records { businessesScanned, businessesSeeded,
//     servicesCreated, businessesWithNoCategoryMatch } so the dashboard
//     can graph adoption.

import { revalidateTag } from "next/cache";

import prisma from "@/lib/prisma";
import { cronHandler } from "@/lib/middleware/no-live-api";
import { runBatch, statusFromOutcome } from "../../_lib/batch";
import { suggestServicesFromGoogleCategories } from "@/services/business-services-detect/from-google";

const JOB = "monthly:services-detect";
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;

interface CronMeta {
  businessesScanned: number;
  businessesSeeded: number;
  servicesCreated: number;
  businessesWithNoCategoryMatch: number;
  failures: number;
  [key: string]: number;
}

export const GET = cronHandler(JOB, async () => {
  const limit = clampLimitFromEnv(DEFAULT_LIMIT, MAX_LIMIT);

  // Prefer claimed businesses first — those are the paying customers
  // who'll see /(smb)/my-business. Within that, oldest createdAt wins
  // so newly indexed shops always get seeded on the next run.
  const businesses = await prisma.business.findMany({
    where: { isActive: true },
    select: {
      id: true,
      ownerUserId: true,
      category: true,
      categories: true,
      services: {
        // Pull BOTH active and inactive — inactive rows are intentional
        // soft-deletes that must block re-creation.
        select: { name: true },
      },
    },
    take: limit,
    orderBy: [{ isClaimed: "desc" }, { createdAt: "asc" }],
  });

  const meta: CronMeta = {
    businessesScanned: businesses.length,
    businessesSeeded: 0,
    servicesCreated: 0,
    businessesWithNoCategoryMatch: 0,
    failures: 0,
  };

  const outcome = await runBatch(businesses, async (b) => {
    const suggestions = suggestServicesFromGoogleCategories(
      b.category,
      b.categories,
    );
    if (suggestions.length === 0) {
      meta.businessesWithNoCategoryMatch += 1;
      return;
    }

    const existingNames = new Set(b.services.map((s) => s.name.toLowerCase()));
    const toCreate = suggestions.filter(
      (s) => !existingNames.has(s.name.toLowerCase()),
    );
    if (toCreate.length === 0) return;

    // Find the current max sortOrder to append at tail (per the editor's
    // ordering convention — `services_section_active` shows by sortOrder
    // asc, so new items go AFTER any manual additions).
    const tail = await prisma.businessService.findFirst({
      where: { businessId: b.id },
      orderBy: { sortOrder: "desc" },
      select: { sortOrder: true },
    });
    const baseSortOrder = (tail?.sortOrder ?? -1) + 1;

    await prisma.businessService.createMany({
      data: toCreate.map((s, idx) => ({
        businessId: b.id,
        name: s.name,
        category: s.category,
        sortOrder: baseSortOrder + idx,
        isActive: true,
        source: "auto:google",
      })),
      skipDuplicates: true,
    });

    meta.servicesCreated += toCreate.length;
    meta.businessesSeeded += 1;

    // Revalidate the my-business tag so the next page-load reflects the
    // new starter set without waiting for the cacheLife window.
    if (b.ownerUserId) {
      revalidateTag(`smb-my-business-${b.ownerUserId}`, "minutes");
    }
  });

  meta.failures = outcome.failures.length;

  return {
    itemsProcessed: outcome.attempted,
    status: statusFromOutcome(outcome),
    meta,
  };
});

function clampLimitFromEnv(defaultLimit: number, max: number): number {
  const raw = process.env.CRON_MONTHLY_LIMIT;
  if (!raw) return defaultLimit;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultLimit;
  return Math.max(1, Math.min(parsed, max));
}

export const __test = {
  clampLimitFromEnv,
};
