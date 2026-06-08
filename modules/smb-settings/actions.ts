"use server";

/**
 * SMB settings · server actions.
 *
 * v1 surface (E.6):
 *
 *   - `signOutFromSettings` — invalidates the NextAuth JWT session and
 *     bounces the browser back to the marketing root.
 *   - `setPreferredLocale` — writes the `NEXT_LOCALE` cookie so the
 *     next page load renders in the chosen locale. We do NOT yet
 *     persist this to `User.preferredLocale` (schema follow-up); the
 *     cookie is the source of truth in v1 per `.claude/rules/i18n.md`
 *     "Cookie `NEXT_LOCALE` wins (user set it manually)".
 *
 * Per `.claude/rules/security.md`:
 *   - Auth check at the top of every mutating action.
 *   - Zod validates the form-submitted locale against the routing
 *     locale allow-list — never trust user input on a cookie write.
 *
 * Per `.claude/rules/data-fetching.md`:
 *   - Server actions invoked via `<form action={...}>`, not API routes.
 *   - `redirect()` short-circuits the response with 303.
 */

import { z } from "zod";
import { cookies } from "next/headers";
import { revalidateTag } from "next/cache";
import { redirect } from "next/navigation";

import prisma from "@/lib/prisma";
import stripeClient from "@/lib/stripe";
import { auth, signOut } from "@/lib/auth";
import { routing } from "@/i18n/routing";

const LocaleSchema = z.object({
  locale: z.enum(routing.locales as readonly [string, ...string[]]),
});

/**
 * Sign out from the SMB settings page. Bounces to the marketing root.
 *
 * NextAuth v5's `signOut()` handles the JWT teardown and redirect — it
 * throws a Next redirect under the hood, so this function never
 * returns. The `redirectTo: "/"` keeps Maria on a familiar surface
 * (her own marketing landing) instead of a generic auth page.
 */
export async function signOutFromSettings(): Promise<void> {
  const session = await auth();
  // Anonymous calls would be a no-op for the session teardown, but we
  // still want to redirect the browser somewhere coherent. The shared
  // signOut path handles both cleanly.
  if (!session?.user?.id) {
    redirect("/");
  }
  await signOut({ redirectTo: "/" });
}

/**
 * Set the viewer's preferred locale via the `NEXT_LOCALE` cookie. Form
 * data: `{ locale: 'en' | 'es' | 'en-CA' | 'fr' }`. Redirects back to
 * the settings page so the next render reflects the chosen locale.
 *
 * The cookie is 1y max-age, same-site=lax (matches what next-intl reads),
 * and not httpOnly (next-intl needs to be able to read it on client-side
 * locale-aware components). Marked `secure` in production so it doesn't
 * leak over plain HTTP.
 */
export async function setPreferredLocale(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/signin");
  }

  const parsed = LocaleSchema.safeParse({
    locale: formData.get("locale"),
  });
  if (!parsed.success) {
    redirect("/settings?locale_error=invalid");
  }

  const cookieStore = await cookies();
  cookieStore.set("NEXT_LOCALE", parsed.data.locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1y
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    // NOT httpOnly — next-intl reads this cookie from client-side
    // components in some cases. Per `.claude/rules/i18n.md`.
  });

  // next-intl will pick up the cookie on the next page render. The
  // request-time pathname is the same so we just bounce back.
  redirect("/settings");
}

/* ============================================================ account */

export type UpdateAccountState = { status: "idle" | "saved" | "error" };

const UpdateAccountSchema = z.object({
  name: z.string().trim().max(120),
  email: z.string().trim().toLowerCase().email().max(254),
});

/**
 * Update the viewer's display name + sign-in email — the editable parts of
 * "Your account". Email is the JWT identity by `User.id` (not the email
 * string), so changing it does NOT orphan the session. On change we enforce
 * uniqueness, clear `emailVerified` (the new address re-verifies on the next
 * magic-link), and sync the Stripe customer email so invoices reach them.
 * Returns a `useActionState` status the AccountCard renders inline.
 */
export async function updateSmbAccount(
  _prev: UpdateAccountState,
  formData: FormData,
): Promise<UpdateAccountState> {
  const session = await auth();
  if (!session?.user?.id) return { status: "error" };

  const parsed = UpdateAccountSchema.safeParse({
    name: formData.get("name") ?? "",
    email: formData.get("email") ?? "",
  });
  if (!parsed.success) return { status: "error" };
  const { name, email } = parsed.data;

  try {
    const me = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, stripeCustomerId: true },
    });
    if (!me) return { status: "error" };

    // Email change — only when it actually differs. Must be unique; sync Stripe.
    if (email && email !== me.email.toLowerCase()) {
      const taken = await prisma.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (taken && taken.id !== session.user.id) return { status: "error" };
      await prisma.user.update({
        where: { id: session.user.id },
        data: { email, emailVerified: null },
      });
      if (me.stripeCustomerId) {
        await stripeClient.customers
          .update(me.stripeCustomerId, { email })
          .catch(() => {
            /* Stripe sync is best-effort — never fail the save on it */
          });
      }
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { name: name.length > 0 ? name : null },
    });
    revalidateTag(`smb-settings-${session.user.id}`, "minutes");
    return { status: "saved" };
  } catch {
    return { status: "error" };
  }
}
