/**
 * Agency settings · server actions.
 *
 *   - `updateAgencyProfile` — OWNER or ADMIN only. Saves
 *     `Agency.defaultMetro`, `Agency.name`, `Agency.categoriesServed`
 *     then redirects back to `/agency-settings`.
 *   - `setLocalePreference` — any signed-in viewer (incl. STAFF). Writes
 *     the `NEXT_LOCALE` cookie so the next render uses the chosen
 *     locale (no `User.preferredLocale` column yet · cookie is the
 *     source of truth per `.claude/rules/i18n.md`).
 *
 * Auth: every action checks `auth()` first and throws `"unauthorized"`
 * if absent, per `.claude/rules/security.md`. Profile mutations also
 * verify the viewer's `AgencyMember.role` is OWNER or ADMIN — STAFF
 * cannot edit agency profile per the F.9 spec.
 *
 * Validation: every action parses input via Zod first, per
 * `.claude/rules/validation-and-errors.md`. No bare `formData.get()`.
 */

"use server";

import { revalidateTag } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";

import { auth, signOut } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { redirect } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

const ProfileSchema = z.object({
  name: z.string().min(1, "name_required").max(80),
  defaultMetro: z.string().max(64).optional().default(""),
  categoriesServed: z.string().max(512).optional().default(""),
});

const LocaleSchema = z.object({
  locale: z.enum(routing.locales as readonly [string, ...string[]]),
});

/** Look up the viewer's first AgencyMember row. */
async function requireMembership(userId: string) {
  const membership = await prisma.agencyMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, agencyId: true, role: true },
  });
  if (!membership) throw new Error("forbidden");
  return membership;
}

/**
 * Update agency profile fields (name, defaultMetro, categoriesServed).
 * OWNER or ADMIN only · STAFF gets a thrown `"forbidden"`.
 */
export async function updateAgencyProfile(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  const userId = session.user.id;

  const parsed = ProfileSchema.parse({
    name: formData.get("name"),
    defaultMetro: formData.get("defaultMetro") ?? "",
    categoriesServed: formData.get("categoriesServed") ?? "",
  });

  const membership = await requireMembership(userId);
  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    throw new Error("forbidden");
  }

  const categories = Array.from(
    new Set(
      parsed.categoriesServed
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= 64),
    ),
  ).slice(0, 8);

  await prisma.agency.update({
    where: { id: membership.agencyId },
    data: {
      name: parsed.name,
      defaultMetro: parsed.defaultMetro.length > 0 ? parsed.defaultMetro : null,
      categoriesServed: categories,
    },
  });

  revalidateTag(`agency-settings-${userId}`, "minutes");
  // Refresh the cached onboarding view too · same Agency row backs it.
  revalidateTag(`agency-onboarding-${userId}`, "minutes");

  redirect({ href: "/agency-settings", locale: "en" });
}

/**
 * Write the `NEXT_LOCALE` cookie. Allowed for every signed-in member
 * (incl. STAFF · this is a personal preference, not an agency setting).
 *
 * The cookie is 1y max-age, same-site=lax, secure in production. Not
 * httpOnly so next-intl can read it from client-side locale-aware
 * components (matches `modules/smb-settings/actions.ts`).
 */
export async function setLocalePreference(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");

  const parsed = LocaleSchema.parse({
    locale: formData.get("locale"),
  });

  const cookieStore = await cookies();
  cookieStore.set("NEXT_LOCALE", parsed.locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });

  // Tag invalidation isn't strictly required (the cookie change is
  // request-scoped) but bumping the tag ensures the next page render
  // picks up the new locale even if the user clicks through quickly.
  revalidateTag(`agency-settings-${session.user.id}`, "minutes");

  redirect({ href: "/agency-settings", locale: parsed.locale });
}

/**
 * Sign-out — invalidates NextAuth JWT session + redirects to "/".
 * Used by the Sign-out section's <form action={...}>; lets us avoid the
 * `<a href="/api/auth/signout">` pattern that ESLint's
 * `@next/next/no-html-link-for-pages` rule rejects.
 */
export async function signOutFromAgencySettings(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
