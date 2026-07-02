// modules/agency-portal/roles.ts · the WP5-8 role gate for credit-spending
// actions.
//
// Per docs/seat-model.md, the pooled wallet is protected by role: billing,
// plan changes, and ANY credit-spending action (enrichment runs, top-ups,
// touch generation/regeneration/polish) are OWNER/ADMIN only. STAFF seats
// triage leads, edit touches, and export — they never spend the wallet.
// (Stripe checkout already enforces this via its own `canManage`; this helper
// is the same gate for server actions outside modules/billing.)

import prisma from "@/lib/prisma";

export type AgencyRole = "OWNER" | "ADMIN" | "STAFF";

export interface CallerMember {
  memberId: string;
  agencyId: string;
  role: AgencyRole;
}

/** The caller's agency membership (oldest wins — the portal-wide rule). */
export async function callerAgencyMember(
  userId: string,
): Promise<CallerMember | null> {
  const member = await prisma.agencyMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { id: true, agencyId: true, role: true },
  });
  return member
    ? {
        memberId: member.id,
        agencyId: member.agencyId,
        role: member.role as AgencyRole,
      }
    : null;
}

/** May this role spend agency credits? (docs/seat-model.md · OWNER/ADMIN.) */
export function canSpendCredits(role: AgencyRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/**
 * The caller's membership IF it can spend credits, else null. Callers map
 * null → `{ status: "forbidden" }` (no distinction between "not a member" and
 * "STAFF" — we never confirm wallet structure to an unauthorized caller).
 */
export async function requireSpendMember(
  userId: string,
): Promise<CallerMember | null> {
  const member = await callerAgencyMember(userId);
  if (!member || !canSpendCredits(member.role)) return null;
  return member;
}
