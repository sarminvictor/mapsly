// modules/agency-portal/team/accept.ts · the WP5-8 invite-accept gate.
//
// Called from /post-signin when the magic-link round-trip carried
// `?invite=<token>` (baked into redirectTo by app/[locale]/signin/actions.ts).
// Plain server module (not "use server") so both the page and the unit tests
// call it directly.
//
// Contract (docs/seat-model.md):
//   - The invite's email must match the signed-in user's email — a forwarded
//     invite link can't seat a different address.
//   - Seat cap enforced AT ACCEPT time (count < maxSeats ?? plan default) —
//     the invite-time check is a UX courtesy; this one is the gate.
//   - The invited user joins the INVITING agency (an AgencyMember upsert) —
//     never provisions a new one (the caller skips WP2-1 self-provision when
//     an invite is present).
//   - Idempotent: re-clicking an accepted invite for an already-seated user
//     reports "accepted" again (upsert + acceptedAt already set is fine).

import prisma from "@/lib/prisma";

import { seatCapFor } from "./seats";

export type AcceptInviteStatus =
  | "accepted"
  | "seat_limit"
  | "invalid" // unknown/expired/revoked token
  | "email_mismatch"
  | "error";

export interface AcceptInviteResult {
  status: AcceptInviteStatus;
  agencyId?: string;
}

/**
 * Resolve + accept a pending invite for the signed-in user. Never throws —
 * /post-signin must keep routing even when acceptance fails.
 */
export async function acceptPendingInvite(
  userId: string,
  userEmail: string | null | undefined,
  token: string,
): Promise<AcceptInviteResult> {
  try {
    const invite = await prisma.agencyInvite.findUnique({
      where: { token },
      select: {
        id: true,
        agencyId: true,
        email: true,
        role: true,
        expiresAt: true,
        acceptedAt: true,
      },
    });
    if (!invite) return { status: "invalid" };
    if (invite.expiresAt.getTime() < Date.now()) return { status: "invalid" };

    const email = (userEmail ?? "").trim().toLowerCase();
    if (!email || email !== invite.email.toLowerCase()) {
      return { status: "email_mismatch" };
    }

    // Already a member of the inviting agency → idempotent success.
    const existing = await prisma.agencyMember.findUnique({
      where: { agencyId_userId: { agencyId: invite.agencyId, userId } },
      select: { id: true },
    });
    if (existing) {
      if (!invite.acceptedAt) {
        await prisma.agencyInvite.update({
          where: { id: invite.id },
          data: { acceptedAt: new Date() },
          select: { id: true },
        });
      }
      return { status: "accepted", agencyId: invite.agencyId };
    }

    // A consumed invite can't seat a SECOND user.
    if (invite.acceptedAt) return { status: "invalid" };

    // Seat cap — the real gate (docs/seat-model.md: count < cap).
    const [agency, used] = await Promise.all([
      prisma.agency.findUnique({
        where: { id: invite.agencyId },
        select: { maxSeats: true, plan: true, stripeStatus: true },
      }),
      prisma.agencyMember.count({ where: { agencyId: invite.agencyId } }),
    ]);
    if (!agency) return { status: "invalid" };
    if (used >= seatCapFor(agency)) return { status: "seat_limit" };

    await prisma.agencyMember.upsert({
      where: { agencyId_userId: { agencyId: invite.agencyId, userId } },
      update: { role: invite.role },
      create: { agencyId: invite.agencyId, userId, role: invite.role },
      select: { id: true },
    });
    await prisma.agencyInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
      select: { id: true },
    });

    console.log(
      JSON.stringify({
        level: "info",
        event: "team.invite.accepted",
        agencyId: invite.agencyId,
        userId,
        role: invite.role,
      }),
    );
    return { status: "accepted", agencyId: invite.agencyId };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "team.invite-accept.error",
        userId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { status: "error" };
  }
}
