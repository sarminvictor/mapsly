"use server";

/**
 * /admin/discovery · server actions.
 *
 * Every action:
 *   1. Re-verifies admin via session (defence-in-depth · the layout
 *      already gates the page but actions can be invoked directly via
 *      the form-action endpoint, so we check again here).
 *   2. Validates input with Zod.
 *   3. Performs the operation.
 *   4. Revalidates the `admin-discovery` cache tag (page reads are
 *      `noStore()` so this is a no-op for the rendering side but kept
 *      for future when we cache aggregates).
 *   5. Returns a structured `ActionResult` for `useActionState`.
 *
 * Actions surface human-readable messages so the dialog forms can
 * render them inline without translation (admin = staff-only,
 * English-only).
 */

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { withCronRun } from "@/lib/cost/cost-counter";
import { verifyAndPromoteCellEmails } from "@/modules/business-qualification";

import {
  cellMembershipWhere,
  geocodeLocation,
  getKnownCategory,
  pingValidateLocation,
  runDiscoveryForLocation,
} from "@/modules/business-discovery";
import {
  enqueueCallbackWebhooks,
  BoxlyWorkerError,
  type WorkerJob,
} from "@/lib/boxly-worker/client";
import { getMapslyPublicUrl } from "@/lib/url/mapsly-public-url";

export type ActionResult<T = null> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string };

async function requireAdminSession(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  if (session.user.role !== "ADMIN") {
    // Fallback DB check in case JWT is stale
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });
    if (user?.role !== "ADMIN") throw new Error("forbidden");
  }
  return session.user.id;
}

/* ------------------------------------------------------------ add category */

const AddCategorySchema = z.object({
  dataforseoId: z.string().min(1),
});

export async function addCategory(
  _prev: ActionResult<{ categoryId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ categoryId: string }>> {
  let userId: string;
  try {
    userId = await requireAdminSession();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const parsed = AddCategorySchema.safeParse({
    dataforseoId: formData.get("dataforseoId"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Pick a category from the list." };
  }

  // Pull from curated list — rejects unknown IDs
  let known;
  try {
    known = getKnownCategory(parsed.data.dataforseoId);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const existing = await prisma.businessCategory.findUnique({
    where: { dataforseoId: known.dataforseoId },
    select: { id: true },
  });
  if (existing) {
    return { ok: false, error: `"${known.label}" is already in the registry.` };
  }

  const created = await prisma.businessCategory.create({
    data: {
      dataforseoId: known.dataforseoId,
      label: known.label,
      groupKey: known.groupKey,
      verifiedAt: new Date(),
      createdByUserId: userId,
    },
    select: { id: true },
  });

  revalidateTag("admin-discovery", "seconds");
  revalidatePath("/admin/discovery");

  return {
    ok: true,
    data: { categoryId: created.id },
    message: `Added ${known.label} to the registry.`,
  };
}

/* ------------------------------------------------------------ add location */

const AddLocationSchema = z.object({
  categoryId: z.string().min(1),
  city: z.string().min(2).max(120),
  province: z.string().max(60).optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/, "Use a 2-letter country code (US, CA)"),
  radiusKm: z.coerce.number().int().min(1).max(50),
});

export async function addLocation(
  _prev: ActionResult<{ locationId: string }> | null,
  formData: FormData,
): Promise<ActionResult<{ locationId: string }>> {
  let userId: string;
  try {
    userId = await requireAdminSession();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const parsed = AddLocationSchema.safeParse({
    categoryId: formData.get("categoryId"),
    city: (formData.get("city") as string | null)?.trim(),
    province: (formData.get("province") as string | null)?.trim() || undefined,
    country: ((formData.get("country") as string | null) ?? "")
      .toUpperCase()
      .trim(),
    radiusKm: formData.get("radiusKm"),
  });
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, error: first?.message ?? "Invalid input." };
  }

  const category = await prisma.businessCategory.findUnique({
    where: { id: parsed.data.categoryId },
    select: { id: true, dataforseoId: true, label: true },
  });
  if (!category) {
    return { ok: false, error: "Unknown category." };
  }

  // Duplicate check before any external calls. We use `findFirst` instead
  // of `findUnique` because the composite unique includes `province` which
  // is nullable — Postgres treats NULL as always-distinct in unique
  // constraints, so the composite unique is effectively partial. `findFirst`
  // with an explicit equality is the safe lookup that matches both null and
  // string provinces.
  const dupe = await prisma.trackedLocation.findFirst({
    where: {
      categoryId: category.id,
      city: parsed.data.city,
      province: parsed.data.province ?? null,
      country: parsed.data.country,
    },
    select: { id: true },
  });
  if (dupe) {
    return {
      ok: false,
      error: `${parsed.data.city}, ${parsed.data.country} is already tracked for ${category.label}.`,
    };
  }

  // Geocode (free, no key required)
  const geo = await geocodeLocation({
    city: parsed.data.city,
    province: parsed.data.province ?? null,
    country: parsed.data.country,
  });
  if (!geo) {
    return {
      ok: false,
      error: `Couldn't find "${parsed.data.city}, ${parsed.data.country}" — check spelling or try a more specific name.`,
    };
  }

  // Ping DataForSEO (costs $0.001) to confirm the cell yields data
  const ping = await pingValidateLocation({
    dataforseoCategoryId: category.dataforseoId,
    lat: geo.lat,
    lng: geo.lng,
    radiusKm: parsed.data.radiusKm,
  });
  if (!ping.ok) {
    return { ok: false, error: ping.message };
  }

  const created = await prisma.trackedLocation.create({
    data: {
      categoryId: category.id,
      city: parsed.data.city,
      province: parsed.data.province ?? null,
      country: parsed.data.country,
      lat: geo.lat,
      lng: geo.lng,
      radiusKm: parsed.data.radiusKm,
      verifiedAt: new Date(),
      createdByUserId: userId,
    },
    select: { id: true },
  });

  revalidateTag("admin-discovery", "seconds");
  revalidatePath("/admin/discovery");

  return {
    ok: true,
    data: { locationId: created.id },
    message: `Added ${parsed.data.city} (sample: "${ping.sampleName}").`,
  };
}

/* ----------------------------------------------------------- run discovery */

const RunDiscoverySchema = z.object({
  trackedLocationId: z.string().min(1),
  // Runner paginates internally in ≤1000-row DfS pages; 10000 = DfS's
  // offset ceiling — full coverage of even the densest city cell
  // (see modules/business-discovery/pagination.ts).
  limit: z.coerce.number().int().min(1).max(10_000).default(100),
});

export type RunDiscoveryResult = {
  runId: string;
  newBusinesses: number;
  duplicates: number;
  totalReturned: number;
  totalAvailable: number | null;
  status: "OK" | "PARTIAL" | "FAILED";
};

export async function runDiscovery(
  _prev: ActionResult<RunDiscoveryResult> | null,
  formData: FormData,
): Promise<ActionResult<RunDiscoveryResult>> {
  let userId: string;
  try {
    userId = await requireAdminSession();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const parsed = RunDiscoverySchema.safeParse({
    trackedLocationId: formData.get("trackedLocationId"),
    limit: formData.get("limit") ?? 100,
  });
  if (!parsed.success) {
    return { ok: false, error: "Invalid run parameters." };
  }

  try {
    const summary = await runDiscoveryForLocation({
      trackedLocationId: parsed.data.trackedLocationId,
      triggeredByUserId: userId,
      limit: parsed.data.limit,
    });
    revalidateTag("admin-discovery", "seconds");
    revalidatePath("/admin/discovery");
    return {
      ok: true,
      data: {
        runId: summary.runId,
        newBusinesses: summary.newBusinesses,
        duplicates: summary.duplicates,
        totalReturned: summary.totalReturned,
        totalAvailable: summary.totalAvailable,
        status: summary.status,
      },
      message:
        summary.status === "OK"
          ? `Found ${summary.totalReturned}${
              summary.totalAvailable !== null
                ? ` of ${summary.totalAvailable} available`
                : ""
            } · ${summary.newBusinesses} new · ${summary.duplicates} known.`
          : (summary.errorMessage ?? "Run completed with errors."),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Discovery run failed.",
    };
  }
}

/* ------------------------------------------------------------ qualify cell */

const QualifyCellSchema = z.object({
  trackedLocationId: z.string().min(1),
});

export type QualifyCellResult = {
  queued: number;
  failed: number;
  cellBusinessCount: number;
};

/**
 * Enqueue qualification jobs for every business in the cell via Boxly
 * Worker. Returns IMMEDIATELY after the worker accepts the batch — the
 * actual scraping happens on the worker's schedule (concurrency-limited
 * with retry), one HTTP POST per business to /api/qualify-one.
 *
 * Per-business work (email scrape + RDAP + service detection) runs on
 * Vercel's 300s budget when the worker callbacks come in, well within
 * limits since each is ~30-60s.
 *
 * Failure modes:
 *   - Worker unreachable / 401 → user sees the error inline
 *   - Worker partial-success → reported via { queued, failed }
 *   - Per-business job failures → /api/qualify-one marks the row
 *     FAILED on every 5xx (best-effort, overwritten by a later
 *     successful retry) · FAILED rows stay in the pending filter so
 *     the next Qualify click retries exactly them
 */
export async function runQualifyCell(
  _prev: ActionResult<QualifyCellResult> | null,
  formData: FormData,
): Promise<ActionResult<QualifyCellResult>> {
  try {
    await requireAdminSession();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const parsed = QualifyCellSchema.safeParse({
    trackedLocationId: formData.get("trackedLocationId"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Invalid request." };
  }

  const cell = await prisma.trackedLocation.findUnique({
    where: { id: parsed.data.trackedLocationId },
    select: {
      id: true,
      city: true,
      country: true,
      lat: true,
      lng: true,
      radiusKm: true,
      category: { select: { dataforseoId: true } },
    },
  });
  if (!cell) {
    return { ok: false, error: "Location not found." };
  }

  // Cell membership shared with `qualifyCell()` — geo bounding box, see
  // modules/business-discovery/cell-membership.ts. Keeps the worker-
  // driven path identical to the direct path so tests/smoke scripts
  // stay valid.
  //
  // PENDING ONLY · the button label promises "Qualify (pending)", so
  // the enqueue matches it: NOT_QUALIFIED + FAILED. Settled rows
  // (QUALIFIED/DISQUALIFIED/UNREACHABLE) are excluded — re-processing
  // them re-billed AI and risked erasing discovered emails (the
  // "Qualify (4) sent 380+ jobs" incident, 2026-06-11). qualifyBusiness
  // has its own settled-row guard as defence-in-depth.
  const businesses = await prisma.business.findMany({
    where: {
      ...cellMembershipWhere({
        dataforseoCategoryId: cell.category.dataforseoId,
        lat: cell.lat,
        lng: cell.lng,
        radiusKm: cell.radiusKm,
        city: cell.city,
        country: cell.country,
      }),
      qualificationStatus: { in: ["NOT_QUALIFIED", "FAILED"] },
    },
    select: { id: true },
  });

  if (businesses.length === 0) {
    return {
      ok: true,
      data: { queued: 0, failed: 0, cellBusinessCount: 0 },
      message:
        "Nothing pending — every indexed business in this cell is already qualified. Run discovery to find more.",
    };
  }

  // Build one WorkerJob per business · per-task id embeds business id
  // + cell + timestamp for end-to-end idempotency. Worker callback URL
  // points at our public /api/qualify-one endpoint.
  const callbackUrl = getMapslyPublicUrl();
  const ts = Date.now();
  const jobs: WorkerJob[] = businesses.map((b) => ({
    taskId: `mapsly-qualify-${b.id}-${ts}`,
    url: `${callbackUrl}/api/qualify-one`,
    payload: { businessId: b.id, trackedLocationId: cell.id },
    callerLabel: `mapsly:qualify-business`,
    // Worst-case server time (slow-site scrape + rescue pass + AI web
    // search + service detection) can clear 90s — a 90s worker timeout
    // fired retries while the original invocation was still running
    // (duplicate concurrent qualifies). 120s is the worker's max.
    timeoutSec: 120,
  }));

  try {
    // The worker rejects batches > 500 jobs outright ("Batch too
    // large") — a dense cell post-10k-discovery would make the Qualify
    // button hard-fail with ZERO jobs queued. Chunk and accumulate.
    let queued = 0;
    let failed = 0;
    for (let i = 0; i < jobs.length; i += 500) {
      const result = await enqueueCallbackWebhooks(jobs.slice(i, i + 500));
      queued += result.queued;
      failed += result.failed;
    }
    revalidateTag("admin-discovery", "seconds");
    revalidatePath("/admin/discovery");
    return {
      ok: true,
      data: {
        queued,
        failed,
        cellBusinessCount: businesses.length,
      },
      message:
        failed === 0
          ? `Queued ${queued} pending businesses · processing in background · refresh in a few minutes to see progress.`
          : `Queued ${queued}/${businesses.length} · ${failed} rejected by worker · check logs.`,
    };
  } catch (err) {
    if (err instanceof BoxlyWorkerError) {
      return {
        ok: false,
        error: `Boxly Worker · ${err.message}${err.httpStatus ? ` (HTTP ${err.httpStatus})` : ""}`,
      };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Worker enqueue failed.",
    };
  }
}

/* ----------------------------------------------------- verify + promote */

const VerifyPromoteSchema = z.object({
  trackedLocationId: z.string().min(1),
});

export type VerifyPromoteActionResult = {
  processed: number;
  promoted: number;
  undeliverable: number;
  errors: number;
  remaining: number;
};

/**
 * SMTP-verify discovered emails for the cell's QUALIFIED businesses
 * and promote the good ones to `Business.email` + `emailVerifiedAt` —
 * the columns the cold-email enroll gate reads. Processes one bounded
 * batch per click (~60 rows, 1-2 min); the button label shows what's
 * left, the admin clicks until 0. The monthly email-verification cron
 * maintains promoted rows afterwards.
 */
export async function runVerifyPromoteEmails(
  _prev: ActionResult<VerifyPromoteActionResult> | null,
  formData: FormData,
): Promise<ActionResult<VerifyPromoteActionResult>> {
  try {
    await requireAdminSession();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const parsed = VerifyPromoteSchema.safeParse({
    trackedLocationId: formData.get("trackedLocationId"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Invalid request." };
  }

  try {
    // SMTP probes are cost-counter-tracked → need an open CronRun.
    const result = await withCronRun("admin:verify-promote-emails", () =>
      verifyAndPromoteCellEmails({
        trackedLocationId: parsed.data.trackedLocationId,
      }),
    );
    revalidateTag("admin-discovery", "seconds");
    revalidatePath("/admin/discovery");
    const promoted = result.promotedDeliverable + result.promotedInconclusive;
    return {
      ok: true,
      data: {
        processed: result.processed,
        promoted,
        undeliverable: result.undeliverable,
        errors: result.errors,
        remaining: result.remaining,
      },
      message:
        result.remaining === 0
          ? `Verified ${result.processed} · ${promoted} promoted · ${result.undeliverable} undeliverable · all done.`
          : `Verified ${result.processed} · ${promoted} promoted · ${result.undeliverable} undeliverable · ${result.remaining} left — click again.`,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Email verification failed.",
    };
  }
}

/* --------------------------------------------------------- delete location */

const DeleteLocationSchema = z.object({
  trackedLocationId: z.string().min(1),
});

/**
 * Delete a TrackedLocation. Only permitted when `businessCount === 0` —
 * we don't orphan registry rows that produced real Business inventory.
 *
 * The FK chain (TrackedLocation → DiscoveryRun via `onDelete: Cascade`)
 * removes the cell's audit trail when this fires. That's intentional:
 * an empty cell's run history isn't worth keeping. Categories with
 * remaining TrackedLocation rows stay untouched.
 */
export async function deleteLocation(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdminSession();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const parsed = DeleteLocationSchema.safeParse({
    trackedLocationId: formData.get("trackedLocationId"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Invalid request." };
  }

  const cell = await prisma.trackedLocation.findUnique({
    where: { id: parsed.data.trackedLocationId },
    select: { id: true, businessCount: true, city: true, country: true },
  });
  if (!cell) {
    return { ok: false, error: "Location not found." };
  }
  if (cell.businessCount > 0) {
    return {
      ok: false,
      error: `Cannot delete ${cell.city} — it has ${cell.businessCount} business${cell.businessCount === 1 ? "" : "es"} indexed. Pause it instead.`,
    };
  }

  await prisma.trackedLocation.delete({
    where: { id: cell.id },
  });

  revalidateTag("admin-discovery", "seconds");
  revalidatePath("/admin/discovery");
  return {
    ok: true,
    data: null,
    message: `Removed ${cell.city}, ${cell.country}.`,
  };
}

/* --------------------------------------------------------- delete category */

const DeleteCategorySchema = z.object({
  categoryId: z.string().min(1),
});

/**
 * Delete a BusinessCategory. Only permitted when the category has zero
 * TrackedLocation rows — admin must delete (or wait for) all child
 * locations first. This forces the cleanup order so audit history
 * never disappears in a single click.
 */
export async function deleteCategory(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  try {
    await requireAdminSession();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const parsed = DeleteCategorySchema.safeParse({
    categoryId: formData.get("categoryId"),
  });
  if (!parsed.success) {
    return { ok: false, error: "Invalid request." };
  }

  const cat = await prisma.businessCategory.findUnique({
    where: { id: parsed.data.categoryId },
    select: {
      id: true,
      label: true,
      _count: { select: { trackedLocations: true } },
    },
  });
  if (!cat) {
    return { ok: false, error: "Category not found." };
  }
  if (cat._count.trackedLocations > 0) {
    return {
      ok: false,
      error: `Cannot delete ${cat.label} — it has ${cat._count.trackedLocations} location${cat._count.trackedLocations === 1 ? "" : "s"}. Remove them first.`,
    };
  }

  await prisma.businessCategory.delete({
    where: { id: cat.id },
  });

  revalidateTag("admin-discovery", "seconds");
  revalidatePath("/admin/discovery");
  return {
    ok: true,
    data: null,
    message: `Removed ${cat.label} from the registry.`,
  };
}
