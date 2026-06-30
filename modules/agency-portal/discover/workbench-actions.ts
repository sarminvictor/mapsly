"use server";

/**
 * Workbench touch-mutation server actions (Touchpoints tab).
 *
 * Both auth-gated + Zod-validated + agency-scoped per `.claude/rules/security.md`.
 * Pure DB — no external API — so they're request-path-safe
 * (`.claude/rules/cost-discipline.md`). They mirror the result-union style of the
 * other discovery actions (ok / unauthorized / forbidden / invalid_input / error).
 *
 * OutreachDraft has no direct `agencyId`, so we scope through the agency's
 * discoveries → cellKeys → the business the draft belongs to: a draft is
 * mutable only when its business sits in a cell this agency actually discovered.
 *
 *   - saveTouchBodyAction · persist an in-place edit of a draft body (+ subject).
 *   - setTouchSentAction · flip a draft's status between "draft" and "sent".
 */

import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";

// ── Input schemas ─────────────────────────────────────────────────────────

const SaveTouchBodyInput = z.object({
  draftId: z.string().min(1).max(64),
  body: z.string().min(1).max(8000),
  subject: z.string().max(400).optional(),
});

export type SaveTouchBodyInputType = z.input<typeof SaveTouchBodyInput>;

const SetTouchSentInput = z.object({
  draftId: z.string().min(1).max(64),
  sent: z.boolean(),
});

export type SetTouchSentInputType = z.input<typeof SetTouchSentInput>;

// ── Result shape ────────────────────────────────────────────────────────────

export type TouchActionResult =
  | { status: "ok" }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Confirm the caller's agency may mutate this draft: the draft's business must
 * sit in one of the agency's discovered cells. Returns true when permitted.
 */
async function callerOwnsDraft(
  userId: string,
  draftId: string,
): Promise<boolean> {
  const member = await prisma.agencyMember.findFirst({
    where: { userId },
    select: { agencyId: true },
  });
  if (!member) return false;

  const draft = await prisma.outreachDraft.findUnique({
    where: { id: draftId },
    select: { businessId: true },
  });
  if (!draft) return false;

  const business = await prisma.business.findUnique({
    where: { id: draft.businessId },
    select: { cellKey: true },
  });
  const cellKey = business?.cellKey;
  if (!cellKey) return false;

  const discoveries = await prisma.discovery.findMany({
    where: { agencyId: member.agencyId },
    select: { cellKeys: true },
  });
  const cells = new Set(discoveries.flatMap((d) => d.cellKeys));
  return cells.has(cellKey);
}

// ── saveTouchBodyAction ───────────────────────────────────────────────────────

export async function saveTouchBodyAction(
  input: unknown,
): Promise<TouchActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = SaveTouchBodyInput.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    const ok = await callerOwnsDraft(session.user.id, parsed.data.draftId);
    if (!ok) return { status: "forbidden" };

    await prisma.outreachDraft.update({
      where: { id: parsed.data.draftId },
      data: {
        body: parsed.data.body,
        ...(parsed.data.subject !== undefined
          ? { subject: parsed.data.subject }
          : {}),
      },
    });
    return { status: "ok" };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "workbench.save-touch.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}

// ── setTouchSentAction ────────────────────────────────────────────────────────

export async function setTouchSentAction(
  input: unknown,
): Promise<TouchActionResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = SetTouchSentInput.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    const ok = await callerOwnsDraft(session.user.id, parsed.data.draftId);
    if (!ok) return { status: "forbidden" };

    await prisma.outreachDraft.update({
      where: { id: parsed.data.draftId },
      data: { status: parsed.data.sent ? "sent" : "draft" },
    });
    return { status: "ok" };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "workbench.set-touch-sent.error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}
