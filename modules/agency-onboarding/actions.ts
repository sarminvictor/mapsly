/**
 * Agency onboarding · server actions.
 *
 * Reworked for the demand-driven portal. A single lean action:
 *
 *   - `updateAgencyProfile` — saves `Agency.defaultMetro` +
 *     `Agency.categoriesServed`, then redirects to `/discover` (the new
 *     demand-driven entry point). No more List seeding or lead preview.
 *
 * Auth: checks `auth()` and throws `"unauthorized"` if absent, per
 * `.claude/rules/security.md`. Then looks up the user's first
 * `AgencyMember`; throws `"forbidden"` if none.
 *
 * Validation: input parsed via Zod first, per
 * `.claude/rules/validation-and-errors.md`. No bare `formData.get()`.
 */

"use server";

import { revalidateTag } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "@/i18n/navigation";

const ProfileSchema = z.object({
  defaultMetro: z.string().min(1, "metro_required").max(64),
  categoriesServed: z.string().max(512).optional().default(""),
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
 * Save agency profile (defaultMetro + categoriesServed), then drop Tom
 * into `/discover`. `categoriesServed` is a comma-separated string from
 * the form; we split into a trimmed, deduped array capped at 8 items.
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

  // Terminal · drop into the demand-driven discover flow.
  // `redirect()` throws an internal signal.
  redirect({ href: "/discover", locale: "en" });
}
