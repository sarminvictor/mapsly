// modules/website-intel · shared website-audit collector.
//
// THE single source of truth for "audit a business's website." Both the
// weekly cron (`app/api/cron/weekly/lighthouse-audit`) AND the admin manual
// trigger (`triggerWebsiteScanAction` / `…BulkAction`) call this, so a manual
// run produces byte-for-byte the same LighthouseAudit rows + cache
// revalidation as the cron — mirroring how `collect-ads-intel.ts` unifies the
// ads path.
//
// Per business: `lighthouseFullAudit` (DataForSEO Lighthouse Live + our DOM
// checks) → persist a `LighthouseAudit` row → revalidate the business +
// owner's `/website` caches. Sequential (one Lighthouse call is the most
// expensive single API in the stack); callers bound the batch size.
//
// MUST run inside an open CronRun — `lighthouseFullAudit`'s adapter enforces
// the no-live-api boundary + records spend. The cron provides it via
// `cronHandler`; the admin action via `withCronRun("admin:website-scan")`.

import { revalidateTag } from "next/cache";
import prisma from "@/lib/prisma";
import { lighthouseFullAudit, toPersistRow } from "@/services/lighthouse";
import { lighthouseAudit } from "@/services/dataforseo/lighthouse";

export interface CollectWebsiteResult {
  /** Input ids that resolved to a real business. */
  businesses: number;
  /** LighthouseAudit rows inserted this run. */
  audited: number;
  /** Resolved businesses skipped because they have no website on record. */
  skippedNoWebsite: number;
  /** Per-business failures (the audit threw); never tanks the batch. */
  errors: Array<{ businessId: string; website: string | null; error: string }>;
}

/**
 * Audit the website of each business id, newest audit wins. Returns a summary
 * the caller maps into its CronRun meta / action toast.
 */
export async function collectWebsiteForBatch(
  businessIds: readonly string[],
): Promise<CollectWebsiteResult> {
  const result: CollectWebsiteResult = {
    businesses: 0,
    audited: 0,
    skippedNoWebsite: 0,
    errors: [],
  };
  if (businessIds.length === 0) return result;

  const businesses = await prisma.business.findMany({
    where: { id: { in: [...businessIds] } },
    select: {
      id: true,
      slug: true,
      name: true,
      address: true,
      phone: true,
      website: true,
      ownerUserId: true,
    },
  });
  result.businesses = businesses.length;

  const slugsToRevalidate = new Set<string>();
  const ownersToRevalidate = new Set<string>();

  for (const biz of businesses) {
    if (!biz.website) {
      result.skippedNoWebsite += 1;
      continue;
    }
    try {
      const audit = await lighthouseFullAudit({
        url: biz.website,
        nap: {
          name: biz.name,
          address: biz.address ?? "",
          phone: biz.phone ?? "",
        },
      });
      // `toPersistRow` carries a `rawJson` field that LighthouseAudit has no
      // column for — strip it before create (Prisma rejects unknown args at
      // runtime; the previous inline cron spread relied on it being ignored).
      const { rawJson: _rawJson, ...row } = toPersistRow(audit, biz.id);

      // Second, desktop-preset Lighthouse pass (scores only — DOM checks are
      // preset-independent so we don't re-run them). Best-effort: a desktop
      // failure must not lose the mobile audit. The DOM/HTML leg is NOT re-run.
      let desktop = {
        desktopPerformance: null as number | null,
        desktopLcp: null as number | null,
        desktopInp: null as number | null,
        desktopCls: null as number | null,
      };
      try {
        const d = await lighthouseAudit({
          url: biz.website,
          for_mobile: false,
        });
        desktop = {
          desktopPerformance: d.performance,
          desktopLcp:
            d.lcpMs != null ? Number((d.lcpMs / 1000).toFixed(3)) : null,
          desktopInp: d.tbtMs, // TBT-as-INP proxy, same as the mobile column
          desktopCls: d.cls,
        };
      } catch {
        // Desktop is supplementary; keep nulls and ship the mobile audit.
      }

      await prisma.lighthouseAudit.create({ data: { ...row, ...desktop } });
      result.audited += 1;
      slugsToRevalidate.add(biz.slug);
      if (biz.ownerUserId) ownersToRevalidate.add(biz.ownerUserId);
    } catch (err) {
      result.errors.push({
        businessId: biz.id,
        website: biz.website,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      });
    }
  }

  // Revalidate after the batch — granular tags only (caching.md). Guarded:
  // `revalidateTag` only works inside a Next request/render scope (the cron
  // route + the admin server action both qualify). From a standalone script
  // the rows are already written; the next cached read picks them up.
  try {
    for (const slug of slugsToRevalidate) {
      revalidateTag(`business-${slug}-lighthouse`, "weeks");
      revalidateTag(`business-${slug}`, "weeks");
    }
    for (const ownerUserId of ownersToRevalidate) {
      revalidateTag(`smb-website-${ownerUserId}`, "hours");
    }
  } catch {
    // Non-request scope — never fail the audit run on a cache hint.
  }

  return result;
}
