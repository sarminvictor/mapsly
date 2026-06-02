/**
 * /admin/landing-pages · server actions.
 *
 * Matches the existing admin action shape
 * `(prevState, formData) => Promise<ActionResult<T>>` so the same
 * `useActionState` + `useActionToast` pattern works. The (admin) route group
 * gates auth; each action double-checks `role === "ADMIN"` defense-in-depth.
 */

"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import prisma from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { ensureLandingForBusiness } from "@/modules/smb-landing/mint";
import { buildLandingPath } from "@/modules/smb-landing/token";

export type ActionResult<T = null> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string };

async function requireAdminSession(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("unauthorized");
  if (session.user.role !== "ADMIN") {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { role: true },
    });
    if (user?.role !== "ADMIN") throw new Error("forbidden");
  }
  return session.user.id;
}

const MintSchema = z.object({ businessId: z.string().min(1).max(128) });
const ToggleSchema = z.object({
  landingPageId: z.string().min(1).max(128),
  active: z.enum(["true", "false"]),
});

export interface MintActionResult {
  path: string;
  created: boolean;
}

/** Generate (or fetch) the landing page for a business id. */
export async function mintLandingAction(
  _prev: ActionResult<MintActionResult> | null,
  formData: FormData,
): Promise<ActionResult<MintActionResult>> {
  let userId: string;
  try {
    userId = await requireAdminSession();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const parsed = MintSchema.safeParse({
    businessId: (formData.get("businessId") ?? "").toString().trim(),
  });
  if (!parsed.success) return { ok: false, error: "Invalid business id." };

  let minted;
  try {
    minted = await ensureLandingForBusiness(parsed.data.businessId, userId);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  if (!minted) {
    return { ok: false, error: "Business not found — check the id." };
  }

  revalidatePath("/admin/landing-pages");
  const path = buildLandingPath(minted.slug, minted.token);
  return {
    ok: true,
    data: { path, created: minted.created },
    message: minted.created
      ? `Landing created · ${path}`
      : `Landing already existed · ${path}`,
  };
}

/** Revoke (or re-activate) a landing page — revoked links 404. */
export async function toggleLandingAction(
  _prev: ActionResult<{ active: boolean }> | null,
  formData: FormData,
): Promise<ActionResult<{ active: boolean }>> {
  try {
    await requireAdminSession();
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  const parsed = ToggleSchema.safeParse({
    landingPageId: formData.get("landingPageId"),
    active: formData.get("active"),
  });
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const active = parsed.data.active === "true";
  try {
    await prisma.landingPage.update({
      where: { id: parsed.data.landingPageId },
      data: { isActive: active },
    });
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }

  revalidatePath("/admin/landing-pages");
  return {
    ok: true,
    data: { active },
    message: active
      ? "Landing re-activated."
      : "Landing revoked — link now 404s.",
  };
}
