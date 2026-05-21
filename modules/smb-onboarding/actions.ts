/**
 * SMB onboarding · server actions.
 *
 * Three actions:
 *   - `finishOnboarding` — terminal "Finish setup" → redirects to
 *     `/dashboard`. Marking a `User.onboardedAt` flag is OUT OF SCOPE
 *     for E.7 (no schema migration this task — that needs a separate
 *     `prisma db push` + RFC). TODO when we add the column.
 *   - `inviteTeammate` — accepts an email + role. There's no
 *     `Invitation` model yet, so this is a no-op stub that validates
 *     input and silently succeeds. Wired up properly in a follow-up
 *     once the schema lands.
 *
 * Auth: every action checks `auth()` and throws `"unauthorized"` if
 * absent, per `.claude/rules/security.md`.
 *
 * Validation: every action parses input via Zod first, per
 * `.claude/rules/validation-and-errors.md`. No bare `formData.get()`.
 */

"use server";

import { revalidateTag } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { redirect } from "@/i18n/navigation";

const InviteSchema = z.object({
  email: z.string().email("invalid_email"),
  role: z.enum(["owner", "manager", "staff"]),
});

/**
 * Stub for inviting a teammate. Until the `Invitation` model lands,
 * this validates input and returns silently. Failure to validate
 * surfaces as a thrown error which the form re-renders next to the
 * field (per Next.js server-action error contract).
 */
export async function inviteTeammate(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");

  // Validate — discards anything not in the schema. Throws if email
  // looks malformed so the inline form can re-render with the error.
  InviteSchema.parse({
    email: formData.get("email"),
    role: formData.get("role"),
  });

  // TODO(E.7-followup): create Invitation row + Resend transactional
  // email when the `Invitation` model + cohort email template land.
  // For now: silent success. The user already advances to the next
  // step on submit (button name="action" value="next").
  revalidateTag(`smb-onboarding-${session.user.id}`, "minutes");
}

/**
 * Terminal action. Redirects to `/dashboard`. Once `User.onboardedAt`
 * exists, set it here so we never re-show the wizard.
 */
export async function finishOnboarding() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");

  // TODO(E.7-followup): `await prisma.user.update({ where: { id }, data: { onboardedAt: new Date() } });`
  // — requires schema migration; not in scope for this task.
  revalidateTag(`smb-onboarding-${session.user.id}`, "minutes");

  // `redirect()` throws an internal Next.js signal — never reached
  // past this line. We don't return.
  redirect({ href: "/dashboard", locale: "en" });
}
