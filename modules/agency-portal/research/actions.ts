"use server";

// Agency · My research · card actions (rename + pin). Both mutate the Discovery
// row that backs a research card, then revalidate the directory's cache tag so
// `getResearchList` re-reads on the next render (INC-13 · revalidateTag needs the
// cacheLife profile as its 2nd arg). Auth + agency-ownership enforced on every
// call — a member can only touch their own agency's research.

import { z } from "zod";
import { revalidateTag } from "next/cache";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

const RenameInput = z.object({
  discoveryId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
});
const PinInput = z.object({
  discoveryId: z.string().min(1),
  pinned: z.boolean(),
});

export type ResearchActionResult =
  | { ok: true }
  | {
      ok: false;
      error: "unauthorized" | "forbidden" | "invalid_input" | "error";
    };

/** The agency that owns a discovery, IF the signed-in user is a member of it. */
async function ownerAgencyId(
  discoveryId: string,
  userId: string,
): Promise<string | null> {
  const member = await prisma.agencyMember.findFirst({
    where: { userId },
    select: { agencyId: true },
  });
  if (!member) return null;
  const d = await prisma.discovery.findFirst({
    where: { id: discoveryId, agencyId: member.agencyId },
    select: { agencyId: true },
  });
  return d?.agencyId ?? null;
}

export async function renameResearchAction(
  input: unknown,
): Promise<ResearchActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "unauthorized" };
  const parsed = RenameInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  try {
    const agencyId = await ownerAgencyId(
      parsed.data.discoveryId,
      session.user.id,
    );
    if (!agencyId) return { ok: false, error: "forbidden" };
    await prisma.discovery.update({
      where: { id: parsed.data.discoveryId },
      data: { name: parsed.data.name },
    });
    revalidateTag(`agency-${agencyId}-research`, "minutes");
    return { ok: true };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "research.rename.error",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return { ok: false, error: "error" };
  }
}

export async function setResearchPinnedAction(
  input: unknown,
): Promise<ResearchActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "unauthorized" };
  const parsed = PinInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  try {
    const agencyId = await ownerAgencyId(
      parsed.data.discoveryId,
      session.user.id,
    );
    if (!agencyId) return { ok: false, error: "forbidden" };
    await prisma.discovery.update({
      where: { id: parsed.data.discoveryId },
      data: { isPinned: parsed.data.pinned },
    });
    revalidateTag(`agency-${agencyId}-research`, "minutes");
    return { ok: true };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "research.pin.error",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    return { ok: false, error: "error" };
  }
}
