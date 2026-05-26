"use server";

/**
 * SMB "My Business" · server actions for the services editor.
 *
 * Surface:
 *
 *   - `addService` — append a new service to Maria's business.
 *   - `renameService` — change a service's name / category / description.
 *   - `removeService` — soft-delete (isActive=false) so the auto-detector
 *     doesn't re-add it on next cron pass. Hard-delete is reserved for
 *     manual-source rows the user explicitly wants gone.
 *   - `restoreService` — flip isActive back to true.
 *   - `reorderServices` — accept an ordered list of ids, update sortOrder.
 *
 * Per `.claude/rules/security.md`:
 *   - Every action calls `auth()` at the top.
 *   - Ownership check: the service must belong to a Business owned by
 *     the session user. Cross-user mutation attempts throw.
 *
 * Per `.claude/rules/validation-and-errors.md`:
 *   - Every input goes through Zod first.
 *   - Server actions throw on validation failure (the form handler
 *     surfaces the error via a Next error boundary).
 *
 * Per `.claude/rules/caching.md`:
 *   - Every mutation revalidates the `smb-my-business-${userId}` tag
 *     plus any analysis-page tags that depend on the services lens.
 *     For v1 we revalidate the my-business tag only — analysis pages
 *     will gain service-context dependencies in Phase 2 follow-ups.
 */

import { revalidateTag } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

const ServiceNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(80, "Name too long");

const ServiceCategorySchema = z
  .string()
  .trim()
  .max(60, "Category too long")
  .optional()
  .or(z.literal(""));

const ServiceDescriptionSchema = z
  .string()
  .trim()
  .max(500, "Description too long")
  .optional()
  .or(z.literal(""));

const AddServiceSchema = z.object({
  name: ServiceNameSchema,
  category: ServiceCategorySchema,
  description: ServiceDescriptionSchema,
});

const RenameServiceSchema = z.object({
  serviceId: z.string().min(1),
  name: ServiceNameSchema,
  category: ServiceCategorySchema,
  description: ServiceDescriptionSchema,
});

const ServiceIdSchema = z.object({
  serviceId: z.string().min(1),
});

const ReorderSchema = z.object({
  serviceIds: z
    .string()
    .transform((raw) => {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })
    .pipe(z.array(z.string().min(1)).min(1).max(200)),
});

/**
 * Resolve the active business owned by the current user. Throws when
 * there's no session or no claimed business — both are user-facing
 * configuration problems, not crashes.
 */
async function resolveOwnedBusinessId(): Promise<{
  userId: string;
  businessId: string;
}> {
  const session = await auth();
  if (!session?.user?.id) {
    throw new Error("unauthorized");
  }

  const business = await prisma.business.findFirst({
    where: { ownerUserId: session.user.id, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!business) {
    throw new Error("no_business_claimed");
  }

  return { userId: session.user.id, businessId: business.id };
}

/**
 * Ensure the given service belongs to the user's active business.
 * Returns the row so the caller can branch on source / isActive.
 */
async function loadOwnedService(serviceId: string): Promise<{
  userId: string;
  businessId: string;
}> {
  const { userId, businessId } = await resolveOwnedBusinessId();

  const service = await prisma.businessService.findFirst({
    where: { id: serviceId, businessId },
    select: { id: true },
  });

  if (!service) {
    throw new Error("forbidden");
  }

  return { userId, businessId };
}

export async function addService(formData: FormData): Promise<void> {
  const { userId, businessId } = await resolveOwnedBusinessId();

  const parsed = AddServiceSchema.parse({
    name: formData.get("name"),
    category: formData.get("category") ?? "",
    description: formData.get("description") ?? "",
  });

  const tail = await prisma.businessService.findFirst({
    where: { businessId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const nextSortOrder = (tail?.sortOrder ?? -1) + 1;

  await prisma.businessService.create({
    data: {
      businessId,
      name: parsed.name,
      category: parsed.category ? parsed.category : null,
      description: parsed.description ? parsed.description : null,
      sortOrder: nextSortOrder,
      isActive: true,
      source: "manual",
    },
  });

  revalidateTag(`smb-my-business-${userId}`, "minutes");
}

export async function renameService(formData: FormData): Promise<void> {
  const parsed = RenameServiceSchema.parse({
    serviceId: formData.get("serviceId"),
    name: formData.get("name"),
    category: formData.get("category") ?? "",
    description: formData.get("description") ?? "",
  });

  const { userId } = await loadOwnedService(parsed.serviceId);

  await prisma.businessService.update({
    where: { id: parsed.serviceId },
    data: {
      name: parsed.name,
      category: parsed.category ? parsed.category : null,
      description: parsed.description ? parsed.description : null,
    },
  });

  revalidateTag(`smb-my-business-${userId}`, "minutes");
}

export async function removeService(formData: FormData): Promise<void> {
  const parsed = ServiceIdSchema.parse({
    serviceId: formData.get("serviceId"),
  });
  const { userId } = await loadOwnedService(parsed.serviceId);

  // Soft-delete: keep the row so the auto-detector knows not to re-add.
  await prisma.businessService.update({
    where: { id: parsed.serviceId },
    data: { isActive: false },
  });

  revalidateTag(`smb-my-business-${userId}`, "minutes");
}

export async function restoreService(formData: FormData): Promise<void> {
  const parsed = ServiceIdSchema.parse({
    serviceId: formData.get("serviceId"),
  });
  const { userId } = await loadOwnedService(parsed.serviceId);

  await prisma.businessService.update({
    where: { id: parsed.serviceId },
    data: { isActive: true },
  });

  revalidateTag(`smb-my-business-${userId}`, "minutes");
}

export async function reorderServices(formData: FormData): Promise<void> {
  const parsed = ReorderSchema.parse({
    serviceIds: formData.get("serviceIds"),
  });
  const { userId, businessId } = await resolveOwnedBusinessId();

  // Validate every id belongs to this business before mutating.
  const owned = await prisma.businessService.findMany({
    where: { businessId, id: { in: parsed.serviceIds } },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((s) => s.id));
  for (const id of parsed.serviceIds) {
    if (!ownedIds.has(id)) {
      throw new Error("forbidden");
    }
  }

  await prisma.$transaction(
    parsed.serviceIds.map((id, idx) =>
      prisma.businessService.update({
        where: { id },
        data: { sortOrder: idx },
      }),
    ),
  );

  revalidateTag(`smb-my-business-${userId}`, "minutes");
}
