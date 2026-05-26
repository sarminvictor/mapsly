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

import {
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
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export type RunDiscoveryResult = {
  runId: string;
  newBusinesses: number;
  duplicates: number;
  totalReturned: number;
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
        status: summary.status,
      },
      message:
        summary.status === "OK"
          ? `Found ${summary.totalReturned} businesses · ${summary.newBusinesses} new · ${summary.duplicates} known.`
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
 *   - Per-business job failures → captured in BusinessQualification
 *     state (FAILED status) when /api/qualify-one returns 5xx after
 *     the worker exhausts retries · admin can re-run later
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
      category: { select: { dataforseoId: true } },
    },
  });
  if (!cell) {
    return { ok: false, error: "Location not found." };
  }

  // Match cell membership the same way `qualifyCell()` does: by
  // (DfS-slug in categoryIds[], city, country). Keeps the worker-driven
  // path identical to the direct path so tests/smoke scripts stay valid.
  const businesses = await prisma.business.findMany({
    where: {
      categoryIds: { has: cell.category.dataforseoId },
      city: cell.city,
      country: cell.country,
    },
    select: { id: true },
  });

  if (businesses.length === 0) {
    return {
      ok: true,
      data: { queued: 0, failed: 0, cellBusinessCount: 0 },
      message: "No businesses indexed for this cell yet — run discovery first.",
    };
  }

  // Build one WorkerJob per business · per-task id embeds business id
  // + cell + timestamp for end-to-end idempotency. Worker callback URL
  // points at our public /api/qualify-one endpoint.
  const callbackUrl = readMapslyCallbackUrl();
  const ts = Date.now();
  const jobs: WorkerJob[] = businesses.map((b) => ({
    taskId: `mapsly-qualify-${b.id}-${ts}`,
    url: `${callbackUrl}/api/qualify-one`,
    payload: { businessId: b.id, trackedLocationId: cell.id },
    callerLabel: `mapsly:qualify-business`,
    timeoutSec: 90, // per-business work is 30-60s · 90s gives slack
  }));

  try {
    const result = await enqueueCallbackWebhooks(jobs);
    revalidateTag("admin-discovery", "seconds");
    revalidatePath("/admin/discovery");
    return {
      ok: true,
      data: {
        queued: result.queued,
        failed: result.failed,
        cellBusinessCount: businesses.length,
      },
      message:
        result.failed === 0
          ? `Queued ${result.queued} businesses · processing in background · refresh in a few minutes to see progress.`
          : `Queued ${result.queued}/${businesses.length} · ${result.failed} rejected by worker · check logs.`,
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

/**
 * Resolve the public-facing URL where Boxly Worker will POST per-business
 * callbacks. Prefer the explicit env var; fall back to Vercel's auto-set
 * VERCEL_URL (preview deployments) prefixed with https://.
 *
 * Apex `mapsly.ai` 307-redirects to `www.mapsly.ai` on Vercel, and most
 * HTTP clients drop the Authorization header on cross-host redirects →
 * 401. Force the www subdomain when we recognize the production apex so
 * callbacks land at the canonical host directly.
 */
function readMapslyCallbackUrl(): string {
  const raw =
    process.env.MAPSLY_PUBLIC_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    // Local dev fallback · worker (typically localhost:3001) cannot reach
    // `localhost:3000` from inside Docker / different host without a tunnel.
    // Set MAPSLY_PUBLIC_URL to an ngrok URL when testing locally.
    "http://localhost:3000";
  const trimmed = raw.replace(/\/+$/, "");
  return trimmed
    .replace(/^https?:\/\/mapsly\.ai(?=$|\/)/i, "https://www.mapsly.ai")
    .replace(/^https?:\/\/dev\.mapsly\.ai(?=$|\/)/i, "https://dev.mapsly.ai");
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

