"use server";

/**
 * WP7-13 · taxonomy-miss capture.
 *
 * When the market builder's category combobox has no match for what the user
 * typed, the empty state offers "request this category". This action records
 * that request as a `category_requested` ProductEvent so the taxonomy can be
 * grown from real demand instead of a silent empty result. Fire-and-forget from
 * the client (never blocks the flow); auth-gated + Zod-validated; no external
 * API, no spend — so it's STAFF-allowed. Returns a plain ok/failed.
 */

import { z } from "zod";

import { auth } from "@/lib/auth";
import { callerAgencyMember } from "@/modules/agency-portal/roles";
import { trackProductEvent } from "@/lib/analytics/product-events";

const Input = z.object({
  /** The raw category text the user typed (trimmed, bounded). */
  query: z.string().min(1).max(120),
});

export type RequestCategoryResult = { status: "ok" } | { status: "failed" };

export async function requestCategoryAction(
  input: unknown,
): Promise<RequestCategoryResult> {
  const session = await auth();
  if (!session?.user?.id) return { status: "failed" };

  const parsed = Input.safeParse(input);
  if (!parsed.success) return { status: "failed" };

  try {
    const member = await callerAgencyMember(session.user.id);
    void trackProductEvent({
      type: "category_requested",
      agencyId: member?.agencyId ?? null,
      userId: session.user.id,
      props: { query: parsed.data.query.slice(0, 120) },
    });
    return { status: "ok" };
  } catch {
    // Best-effort capture — a failure here must never surface to the user.
    return { status: "failed" };
  }
}
