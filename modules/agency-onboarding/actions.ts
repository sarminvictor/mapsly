/**
 * Agency onboarding · server actions.
 *
 * Three actions matching the 3-step flow:
 *   - `updateAgencyProfile` — Step 1. Saves `Agency.defaultMetro` +
 *     `Agency.categoriesServed` then redirects to `?step=2`.
 *   - `chooseServiceTemplate` — Step 2. Creates a `List` row seeded
 *     with the chosen service template; redirects to `?step=3`.
 *   - `finishAgencyOnboarding` — Step 3 terminal. Revalidates +
 *     redirects to `/lists` (drops into lists view).
 *
 * Auth: every action checks `auth()` and throws `"unauthorized"` if
 * absent, per `.claude/rules/security.md`. Then looks up the user's
 * first `AgencyMember`; throws `"forbidden"` if none.
 *
 * Validation: every action parses input via Zod first, per
 * `.claude/rules/validation-and-errors.md`. No bare `formData.get()`.
 */

"use server";

import { revalidateTag } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "@/i18n/navigation";
import { SERVICE_TEMPLATES } from "@/modules/agency-portal/lists/service-templates";

const TEMPLATE_KEYS = SERVICE_TEMPLATES.map((t) => t.key) as [
  string,
  ...string[],
];

const ProfileSchema = z.object({
  defaultMetro: z.string().min(1, "metro_required").max(64),
  categoriesServed: z.string().max(512).optional().default(""),
});

const TemplateSchema = z.object({
  templateKey: z.enum(TEMPLATE_KEYS),
});

/** Look up the first AgencyMember row for the signed-in user. */
async function requireMembership(userId: string) {
  const membership = await prisma.agencyMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, agencyId: true },
  });
  if (!membership) throw new Error("forbidden");
  return membership;
}

/**
 * Step 1 · save agency profile (defaultMetro + categoriesServed).
 * categoriesServed is a comma-separated string from the form; we split
 * into trimmed array, dedupe, and cap at 8 items.
 */
export async function updateAgencyProfile(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  const userId = session.user.id;

  const parsed = ProfileSchema.parse({
    defaultMetro: formData.get("defaultMetro"),
    categoriesServed: formData.get("categoriesServed") ?? "",
  });

  const categories = Array.from(
    new Set(
      parsed.categoriesServed
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= 64),
    ),
  ).slice(0, 8);

  const membership = await requireMembership(userId);

  await prisma.agency.update({
    where: { id: membership.agencyId },
    data: {
      defaultMetro: parsed.defaultMetro,
      categoriesServed: categories,
    },
  });

  revalidateTag(`agency-onboarding-${userId}`, "minutes");

  // Advance the wizard. `redirect()` throws an internal signal.
  redirect({
    href: { pathname: "/setup", query: { step: 2 } },
    locale: "en",
  });
}

/**
 * Step 2 · create a List row for the chosen template so Tom has a
 * pre-seeded first list to land on. Idempotent: if a List with the same
 * serviceType already exists in this agency, skip create + still
 * advance.
 */
export async function chooseServiceTemplate(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  const userId = session.user.id;

  const parsed = TemplateSchema.parse({
    templateKey: formData.get("templateKey"),
  });

  const template = SERVICE_TEMPLATES.find((t) => t.key === parsed.templateKey);
  if (!template) throw new Error("invalid_template");

  const membership = await requireMembership(userId);

  // Idempotency · skip create if a list for this serviceType exists.
  const existing = await prisma.list.findFirst({
    where: { agencyId: membership.agencyId, serviceType: template.serviceType },
    select: { id: true },
  });

  if (!existing) {
    await prisma.list.create({
      data: {
        agencyId: membership.agencyId,
        ownerMemberId: membership.id,
        name: template.key, // template label lives in i18n; we store the key as the name baseline.
        serviceType: template.serviceType,
        refreshCadence: "WEEKLY",
        isActive: true,
        filterJson: {},
      },
    });
  }

  revalidateTag(`agency-onboarding-${userId}`, "minutes");
  revalidateTag(`agency-lists-${userId}`, "minutes");

  redirect({
    href: { pathname: "/setup", query: { step: 3 } },
    locale: "en",
  });
}

/**
 * Step 3 terminal · drop into the lists view.
 */
export async function finishAgencyOnboarding() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  const userId = session.user.id;

  revalidateTag(`agency-onboarding-${userId}`, "minutes");
  revalidateTag(`agency-lists-${userId}`, "minutes");

  redirect({ href: "/lists", locale: "en" });
}
