"use server";

/**
 * Workbench touch-mutation server actions (Touchpoints tab).
 *
 * Both auth-gated + Zod-validated + agency-scoped per `.claude/rules/security.md`.
 * Pure DB — no external API — so they're request-path-safe
 * (`.claude/rules/cost-discipline.md`). They mirror the result-union style of the
 * other discovery actions (ok / unauthorized / forbidden / invalid_input / error).
 *
 * Agency scope (WP5, finishing WP0-1): a stamped draft is mutable iff its
 * `agencyId` matches the caller's agency (one comparison); a legacy
 * null-agencyId row falls back to the pre-WP5 cellKey walk and is backfilled
 * on success (adopt-on-write) — see modules/outreach/draft-scope.ts.
 *
 *   - saveTouchBodyAction · persist an in-place edit of a draft body (+ subject).
 *   - setTouchSentAction · flip a draft's status between "draft" and "sent".
 */

import { z } from "zod";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { canAgencyMutateDraft } from "@/modules/outreach/draft-scope";

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
 * Confirm the caller's agency may mutate this draft. Stamped drafts compare
 * `agencyId` directly (replaces the 4-query cellKey walk); legacy null rows
 * take the cellKey fallback + adopt-on-write backfill inside
 * canAgencyMutateDraft. Returns true when permitted.
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
    select: { id: true, agencyId: true, businessId: true },
  });
  if (!draft) return false;

  return canAgencyMutateDraft(member.agencyId, draft);
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
