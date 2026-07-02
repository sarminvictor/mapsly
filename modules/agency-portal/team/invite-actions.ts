"use server";

/**
 * Team-management server actions (WP5-8 · docs/seat-model.md).
 *
 *   - inviteMemberAction  · OWNER/ADMIN. Creates (or re-issues) a pending
 *     AgencyInvite + sends the magic-link invite email. Seat cap checked at
 *     invite time as a courtesy; the accept path re-checks (the real gate).
 *   - revokeInviteAction  · OWNER/ADMIN. Deletes a pending invite.
 *   - removeMemberAction  · OWNER only, never self. Frees the seat.
 *
 * Auth + Zod + agency scope per `.claude/rules/security.md`. The invite email
 * reuses the existing Resend transactional path (team/invite-email.ts); a
 * failed send does NOT undo the invite — the action returns the accept URL so
 * the owner can share it directly.
 */

import { randomBytes } from "node:crypto";

import { z } from "zod";
import { headers } from "next/headers";
import { revalidateTag } from "next/cache";

import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import {
  ACTION_MUTATE_LIMIT,
  rateLimitAction,
} from "@/lib/middleware/rate-limit";
import { callerAgencyMember } from "@/modules/agency-portal/roles";

import { sendInviteEmail } from "./invite-email";
import { seatStateFor } from "./seats";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Invite validity window (docs/seat-model.md · magic-link reuse). */
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ── inviteMemberAction ───────────────────────────────────────────────────────

const InviteInput = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .refine((v) => EMAIL_RE.test(v), "Enter a valid email"),
  // OWNER is not invitable — ownership transfers are a support path.
  role: z.enum(["ADMIN", "STAFF"]).default("STAFF"),
});

export type InviteMemberInput = z.input<typeof InviteInput>;

export type InviteMemberResult =
  | { status: "ok"; emailSent: boolean; acceptUrl: string }
  | { status: "already_member" }
  | { status: "seat_limit"; cap: number }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "rate_limited"; retryAfter: number }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

export async function inviteMemberAction(
  input: unknown,
): Promise<InviteMemberResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  // WP8-2 · invites send email — bound them per user.
  const rl = await rateLimitAction(ACTION_MUTATE_LIMIT, session.user.id);
  if (rl.limited) return { status: "rate_limited", retryAfter: rl.retryAfter };

  const parsed = InviteInput.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    const member = await callerAgencyMember(session.user.id);
    if (!member || member.role === "STAFF") return { status: "forbidden" };
    const agencyId = member.agencyId;
    const email = parsed.data.email;

    // Already seated? (Membership is keyed by userId — resolve via User.)
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existingUser) {
      const seated = await prisma.agencyMember.findUnique({
        where: {
          agencyId_userId: { agencyId, userId: existingUser.id },
        },
        select: { id: true },
      });
      if (seated) return { status: "already_member" };
    }

    // Seat-cap courtesy check (accept re-checks — that one is the gate).
    const seats = await seatStateFor(agencyId);
    if (seats.open <= 0) return { status: "seat_limit", cap: seats.cap };

    const agency = await prisma.agency.findUnique({
      where: { id: agencyId },
      select: { name: true },
    });

    // One pending invite per (agency, email): re-inviting rotates the token +
    // extends the window instead of stacking rows.
    const token = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const pending = await prisma.agencyInvite.findFirst({
      where: { agencyId, email, acceptedAt: null },
      select: { id: true },
    });
    if (pending) {
      await prisma.agencyInvite.update({
        where: { id: pending.id },
        data: {
          token,
          role: parsed.data.role,
          expiresAt,
          invitedByUserId: session.user.id,
        },
        select: { id: true },
      });
    } else {
      await prisma.agencyInvite.create({
        data: {
          agencyId,
          email,
          role: parsed.data.role,
          token,
          invitedByUserId: session.user.id,
          expiresAt,
        },
        select: { id: true },
      });
    }

    const acceptUrl = `${await currentOrigin()}/signin?invite=${token}`;
    const emailSent = await sendInviteEmail({
      to: email,
      agencyName: agency?.name ?? "Your team",
      inviterEmail: session.user.email ?? "A teammate",
      role: parsed.data.role,
      acceptUrl,
    });

    console.log(
      JSON.stringify({
        level: "info",
        event: "team.invite.created",
        agencyId,
        invitedByUserId: session.user.id,
        role: parsed.data.role,
        emailSent,
      }),
    );
    // Bust the caller's cached settings so the pending invite shows now.
    revalidateTag(`agency-settings-${session.user.id}`, "minutes");
    return { status: "ok", emailSent, acceptUrl };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "team.invite.error",
        userId: session.user.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}

// ── revokeInviteAction ───────────────────────────────────────────────────────

const RevokeInput = z.object({ inviteId: z.string().min(1).max(64) });

export type RevokeInviteResult =
  | { status: "ok" }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

export async function revokeInviteAction(
  input: unknown,
): Promise<RevokeInviteResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = RevokeInput.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    const member = await callerAgencyMember(session.user.id);
    if (!member || member.role === "STAFF") return { status: "forbidden" };

    // Scoped delete: another agency's invite id reads as forbidden.
    const deleted = await prisma.agencyInvite.deleteMany({
      where: {
        id: parsed.data.inviteId,
        agencyId: member.agencyId,
        acceptedAt: null,
      },
    });
    if (deleted.count === 0) return { status: "forbidden" };
    revalidateTag(`agency-settings-${session.user.id}`, "minutes");
    return { status: "ok" };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "team.invite-revoke.error",
        userId: session.user.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}

// ── removeMemberAction ───────────────────────────────────────────────────────

const RemoveInput = z.object({ memberId: z.string().min(1).max(64) });

export type RemoveMemberResult =
  | { status: "ok" }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

/** OWNER only, never self (docs/seat-model.md · Team card). */
export async function removeMemberAction(
  input: unknown,
): Promise<RemoveMemberResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = RemoveInput.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  try {
    const member = await callerAgencyMember(session.user.id);
    if (!member || member.role !== "OWNER") return { status: "forbidden" };

    const target = await prisma.agencyMember.findUnique({
      where: { id: parsed.data.memberId },
      select: { id: true, agencyId: true, userId: true },
    });
    // Cross-agency / missing / self all read as forbidden.
    if (
      !target ||
      target.agencyId !== member.agencyId ||
      target.userId === session.user.id
    ) {
      return { status: "forbidden" };
    }

    await prisma.agencyMember.delete({
      where: { id: target.id },
      select: { id: true },
    });
    console.log(
      JSON.stringify({
        level: "info",
        event: "team.member.removed",
        agencyId: member.agencyId,
        removedMemberId: target.id,
        byUserId: session.user.id,
      }),
    );
    revalidateTag(`agency-settings-${session.user.id}`, "minutes");
    return { status: "ok" };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "team.member-remove.error",
        userId: session.user.id,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}

/** Request origin (proto + host) for building the invite accept URL. */
async function currentOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.")
      ? "http"
      : "https");
  return `${proto}://${host}`;
}
