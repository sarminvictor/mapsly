"use server";

/**
 * Share-link server action · F.8.
 *
 * Called from the Prospect Hero "Share with prospect" button. Returns
 * either a successful `{ url, expiresAt, isNew }` payload or a typed
 * error so the client can render copy that matches the failure mode.
 *
 * Per `.claude/rules/validation-and-errors.md`:
 *
 *   - Auth is checked at the top · anonymous → `unauthorized` error.
 *   - Input is Zod-validated · invalid → `invalid_input`.
 *   - Cross-agency leak guard lives in `getOrCreateShareLink` · we
 *     surface its `null` return as `forbidden` so callers never see
 *     a 500 for a permission denial.
 *
 * Per `.claude/rules/security.md` + `.claude/rules/conventions.md`:
 *
 *   - Server action · Next.js handles CSRF via the same-origin /
 *     `Origin` header check.
 *   - No PII in error payloads · just a discriminated status.
 */

import { headers } from "next/headers";
import { z } from "zod";

import { auth } from "@/lib/auth";

import {
  DEFAULT_SHARE_TTL_DAYS,
  buildShareUrl,
  getOrCreateShareLink,
} from "./share-link";

/* ============================================================ schema */

const CreateShareLinkInput = z.object({
  businessId: z.string().min(1).max(120),
});

/* ============================================================ result */

export type CreateShareLinkResult =
  | {
      status: "ok";
      url: string;
      publicShareId: string;
      expiresAt: string; // ISO string · Date serializes weirdly across the action boundary
      isNew: boolean;
    }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "invalid_input"; message: string }
  | { status: "error" };

/* ============================================================ origin */

/**
 * Resolve the absolute origin to embed in the share URL. Priority:
 *
 *   1. `NEXT_PUBLIC_APP_URL` · production / preview deploys set this
 *      to `https://mapsly.ai` (or the per-branch preview URL).
 *   2. The `Host` header on the current request · dev fallback so
 *      `http://localhost:3000` and `http://dev.localhost:3000` both
 *      Just Work without env wiring.
 *
 * Returns `null` if neither is usable.
 */
async function resolveOrigin(): Promise<string | null> {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (envUrl) {
    try {
      const u = new URL(envUrl);
      return u.origin;
    } catch {
      // fall through to header-based resolution
    }
  }
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (!host) return null;
    const proto = h.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host}`;
  } catch {
    return null;
  }
}

/* ============================================================ action */

/**
 * Create (or fetch the existing) share link for the given business.
 *
 * Auth: the caller must be a member of an agency that has the
 * business on at least one Lead (cross-agency leak guard).
 */
export async function createShareLinkAction(
  input: unknown,
): Promise<CreateShareLinkResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "unauthorized" };

  const parsed = CreateShareLinkInput.safeParse(input);
  if (!parsed.success) {
    return {
      status: "invalid_input",
      message: parsed.error.issues[0]?.message ?? "invalid input",
    };
  }

  const origin = await resolveOrigin();
  if (!origin) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "reports.share_link.no_origin",
      }),
    );
    return { status: "error" };
  }

  const record = await getOrCreateShareLink({
    businessId: parsed.data.businessId,
    userId: session.user.id,
    ttlDays: DEFAULT_SHARE_TTL_DAYS,
  });

  if (!record) {
    // null can mean cross-agency probe / no membership / DB error.
    // We surface `forbidden` because that's the most actionable
    // outcome for the calling UI; pathological errors are logged
    // inside `getOrCreateShareLink`.
    return { status: "forbidden" };
  }

  return {
    status: "ok",
    url: buildShareUrl({ origin, publicShareId: record.publicShareId }),
    publicShareId: record.publicShareId,
    expiresAt: record.expiresAt.toISOString(),
    isNew: record.isNew,
  };
}
