/**
 * Agency settings · server query.
 *
 * Surface: `getAgencySettings(userId)` — returns the viewer's first
 * AgencyMember's agency (profile fields + plan tier), the viewer's role
 * on that agency, and the full member roster. Locale is NOT part of
 * the cached result · the page reads it from the request cookie at
 * render time (request-scoped, uncacheable).
 *
 * Returns `EMPTY_AGENCY_SETTINGS` when:
 *
 *   - the user has no AgencyMember (stray SMB user · page redirects to
 *     /home)
 *   - we're in Vercel's build phase (NEXT_PHASE guard · INC-27 /
 *     cache-components Pattern 1)
 *   - Prisma throws (degrade to "looks empty" instead of 500)
 *
 * Per `.claude/rules/cache-components.md` Pattern 1, the build-phase
 * short-circuit AND the catch block both return the same EMPTY constant
 * so the shape parity is enforced at TypeScript compile time, not at
 * Vercel build time (INC-25).
 *
 * Cache strategy per `.claude/rules/caching.md`:
 *
 *   - `'use cache'` + `cacheLife('minutes')` — settings change on user
 *     action (profile save). Minutes is the right cap.
 *   - `cacheTag('agency-settings-${userId}')` so the profile-update
 *     server action can `revalidateTag` at the right granularity.
 *
 * Per `.claude/rules/performance.md`, every `select` is explicit — no
 * unbounded `findMany`/`findFirst`. The member roster is capped at 50
 * since agency seats max out at ~25.
 *
 * Auth: this helper does NOT enforce auth — the page handler MUST
 * verify the session and call `unauthorized()` before invoking.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";
import { seatCapFor } from "@/modules/agency-portal/team/seats";

import {
  EMPTY_AGENCY_SETTINGS,
  type AgencyMemberRoleValue,
  type AgencyPlanValue,
  type AgencySettingsData,
} from "./types";

const MEMBER_TAKE = 50;

/**
 * Per-user cached read. Tag: `agency-settings-${userId}`. Locale is
 * left as the EMPTY default (`"en"`) here · the page handler is
 * responsible for overlaying the cookie-read locale before rendering
 * (cookies are request-scoped and can't live inside a cached function).
 */
export async function getAgencySettings(
  userId: string,
): Promise<AgencySettingsData> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`agency-settings-${userId}`);

  // Build-phase short-circuit · INC-27 / cache-components Pattern 1.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_AGENCY_SETTINGS;
  }

  if (!userId || typeof userId !== "string") {
    return EMPTY_AGENCY_SETTINGS;
  }

  try {
    const membership = await prisma.agencyMember.findFirst({
      where: { userId },
      orderBy: { createdAt: "asc" },
      select: {
        role: true,
        agency: {
          select: {
            id: true,
            name: true,
            defaultMetro: true,
            categoriesServed: true,
            mailingAddress: true,
            plan: true,
            // WP5-8 · seat-cap inputs (maxSeats override + Free-state check).
            maxSeats: true,
            stripeStatus: true,
          },
        },
      },
    });

    if (!membership?.agency) return EMPTY_AGENCY_SETTINGS;

    const [members, invites] = await Promise.all([
      prisma.agencyMember.findMany({
        where: { agencyId: membership.agency.id },
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        take: MEMBER_TAKE,
        select: {
          id: true,
          userId: true,
          role: true,
          user: { select: { name: true, email: true } },
        },
      }),
      // WP5-8 · pending (unaccepted, unexpired) invites for the Team card.
      prisma.agencyInvite.findMany({
        where: {
          agencyId: membership.agency.id,
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "asc" },
        take: MEMBER_TAKE,
        select: { id: true, email: true, role: true, expiresAt: true },
      }),
    ]);

    return {
      agency: {
        id: membership.agency.id,
        name: membership.agency.name ?? "",
        defaultMetro: membership.agency.defaultMetro,
        categoriesServed: membership.agency.categoriesServed ?? [],
        mailingAddress: membership.agency.mailingAddress ?? null,
        plan: (membership.agency.plan ?? "SOLO") as AgencyPlanValue,
      },
      membership: {
        role: (membership.role ?? "STAFF") as AgencyMemberRoleValue,
      },
      members: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        userName: m.user?.name ?? null,
        userEmail: m.user?.email ?? "",
        role: (m.role ?? "STAFF") as AgencyMemberRoleValue,
      })),
      invites: invites.map((i) => ({
        id: i.id,
        email: i.email,
        role: (i.role ?? "STAFF") as AgencyMemberRoleValue,
        expiresAt: i.expiresAt.toISOString(),
      })),
      seats: {
        cap: seatCapFor(membership.agency),
        used: members.length,
      },
      // Locale stays as the EMPTY default · page overlays request cookie.
      locale: EMPTY_AGENCY_SETTINGS.locale,
    };
  } catch {
    // Degrade gracefully rather than 500-ing on a transient DB blip.
    return EMPTY_AGENCY_SETTINGS;
  }
}
