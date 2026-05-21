/**
 * SMB settings · server queries.
 *
 * Surface: `getSmbSettingsData(userId)` — returns the viewer's owned
 * business identity + their User profile (email + display name).
 * Returns the EMPTY shape (ownedBusinessId === "") when:
 *
 *   - the user has no claimed business yet (pre-onboarding)
 *   - we're in Vercel build phase (NEXT_PHASE guard, INC-27)
 *   - Prisma throws (degrade to "looks empty" rather than 500 crash)
 *
 * Per `.claude/rules/cache-components.md` Pattern 1, every `'use cache'`
 * Prisma query short-circuits at build time because Neon WebSockets
 * cannot open from Vercel's build worker. The short-circuit returns the
 * exact-shape EMPTY constant; runtime first-request re-runs the query
 * and gets real data.
 *
 * Cache strategy per `.claude/rules/caching.md`:
 *
 *   - `'use cache'` + `cacheLife('minutes')` — settings is read-mostly
 *     and slow-changing; minutes is plenty. If/when editing lands (brand
 *     voice, notif prefs), the action will `revalidateTag` after write.
 *   - `cacheTag('smb-settings-${userId}')` — per-user. The C.8 cron
 *     refreshes business identity daily and revalidates this tag.
 *
 * Per `.claude/rules/performance.md`, `select`s are explicit — never
 * an unbounded `findMany`/`findFirst`.
 *
 * Per `.claude/rules/security.md`, this helper does NOT enforce auth —
 * the page handler MUST verify the session and dispatch `unauthorized()`
 * if missing. This function just runs `where: { ownerUserId }` against
 * whatever userId it's given.
 */

import { cacheLife, cacheTag } from "next/cache";

import prisma from "@/lib/prisma";

import { EMPTY_SMB_SETTINGS, type SmbSettingsData } from "./types";

export async function getSmbSettingsData(
  userId: string,
): Promise<SmbSettingsData> {
  "use cache";
  cacheLife("minutes");
  cacheTag(`smb-settings-${userId}`);

  if (process.env.NEXT_PHASE === "phase-production-build") {
    return EMPTY_SMB_SETTINGS;
  }

  if (!userId || typeof userId !== "string") {
    return EMPTY_SMB_SETTINGS;
  }

  try {
    const [user, business] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true },
      }),
      prisma.business.findFirst({
        where: { ownerUserId: userId, isActive: true },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          address: true,
          city: true,
          province: true,
          category: true,
          website: true,
          phone: true,
          isClaimed: true,
        },
      }),
    ]);

    if (!user) {
      return EMPTY_SMB_SETTINGS;
    }

    if (!business) {
      // User exists but has no business yet — return EMPTY for the
      // ownedBusinessId sentinel + populate User identity so the page
      // can still render "you're not connected to a business yet" with
      // their email visible (a Maria-friendly orientation cue).
      return {
        ...EMPTY_SMB_SETTINGS,
        userEmail: user.email,
        userName: user.name,
      };
    }

    return {
      ownedBusinessId: business.id,
      businessName: business.name,
      businessAddress: business.address,
      businessCity: business.city,
      businessProvince: business.province,
      businessCategory: business.category,
      businessWebsite: business.website,
      businessPhone: business.phone,
      isClaimed: business.isClaimed,
      userEmail: user.email,
      userName: user.name,
    };
  } catch {
    return EMPTY_SMB_SETTINGS;
  }
}
