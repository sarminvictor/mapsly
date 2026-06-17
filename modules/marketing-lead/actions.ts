"use server";

/**
 * Request-free-report · server action for the /for-businesses lead form.
 *
 * An UNDISCOVERED business owner (the hero autosuggest found no landing for
 * them) submits {business name, email}. We CAPTURE the lead — we do NOT pull
 * any paid data at submit time (a real report for an unindexed business needs
 * DataForSEO + Lighthouse, produced afterward). MVP per Viktor 2026-06-17:
 * capture → confirmation email to the visitor → ops alert.
 *
 * Contract (mirrors modules/smb-landing/subscribe-action.ts):
 *   - Zod at the boundary. Server actions are CSRF-checked by Next.
 *   - PUBLIC_LIMIT rate limit by IP (fail-soft when KV is unbound).
 *   - ConsentRecord(EXPRESS) + InboundLeadRequest upsert in ONE transaction,
 *     idempotent on (email lowercased, businessName) — re-submits never leak
 *     prior state, they just refresh the row.
 *   - PII: raw IP is never stored — only the salted hash (same recipe as
 *     /api/landing-events + the weekly-score subscribe action).
 *   - Emails run in `after()` — best-effort, post-response; an email failure
 *     never undoes the captured lead.
 *   - Honest failure: DB down → { ok:false, error:"unavailable" } (telling
 *     the visitor "Done" when nothing saved would fake the capture).
 */

import { createHash } from "node:crypto";

import { headers } from "next/headers";
import { after } from "next/server";
import { z } from "zod";

import prisma from "@/lib/prisma";
import {
  LEAD_EMAIL_LIMIT,
  PUBLIC_LIMIT,
  rateLimit,
} from "@/lib/middleware/rate-limit";

import { notifyOpsNewLead, sendReportConfirmation } from "./email";

/* ============================================================ schema */

const RequestReportInput = z.object({
  businessName: z.string().trim().min(2).max(120),
  email: z.string().trim().min(3).max(320).email(),
  city: z.string().trim().max(120).optional(),
  locale: z.string().trim().max(12).optional(),
  sourceUrl: z.string().trim().max(300).optional(),
});

/* ============================================================ result */

export type RequestFreeReportResult =
  | { ok: true }
  | { ok: false; error: "invalid" | "rate_limited" | "unavailable" };

/* =========================================================== helpers */

/** Salted IP hash — IDENTICAL recipe to /api/landing-events + the weekly
 * subscribe action, so future funnel queries can join across surfaces. */
function hashIp(ip: string): string {
  const salt = process.env.AUTH_SECRET ?? "mapsly-landing";
  return createHash("sha256")
    .update(`${salt}:${ip}`)
    .digest("hex")
    .slice(0, 32);
}

/** First-hop client IP from proxy headers (rate-limit keying + hashing). */
function ipFromHeaders(h: Headers): string {
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const xri = h.get("x-real-ip");
  if (xri) return xri.trim();
  return "ip:unknown";
}

/* ============================================================ action */

export async function requestFreeReportAction(
  input: unknown,
): Promise<RequestFreeReportResult> {
  const parsed = RequestReportInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };

  const h = await headers();
  const ip = ipFromHeaders(h);

  // Rate-limit by IP. This is a WRITE, so a 429 is enforced (rateLimit fails
  // soft when KV is unbound — local dev / build).
  try {
    const limited = await rateLimit(
      new Request("https://www.mapsly.ai/_action/request-free-report"),
      PUBLIC_LIMIT,
      ip,
    );
    if (limited) return { ok: false, error: "rate_limited" };
  } catch {
    /* limiter unavailable — allow (fail-soft) */
  }

  const email = parsed.data.email.toLowerCase();
  const businessName = parsed.data.businessName;
  const city = parsed.data.city ?? null;

  // Find-or-create so a re-submit of the same (email, businessName) neither
  // writes a duplicate EXPRESS ConsentRecord (no orphaned audit rows) nor
  // re-sends the confirmation. `isNew` gates the side-effects below.
  let isNew = false;
  try {
    isNew = await prisma.$transaction(async (tx) => {
      const existing = await tx.inboundLeadRequest.findUnique({
        where: { email_businessName: { email, businessName } },
        select: { id: true },
      });
      if (existing) {
        // Re-submit: refresh context only; the original EXPRESS opt-in stands.
        await tx.inboundLeadRequest.update({
          where: { id: existing.id },
          data: {
            city: city ?? undefined,
            locale: parsed.data.locale ?? undefined,
            sourceUrl: parsed.data.sourceUrl ?? undefined,
          },
        });
        return false;
      }
      // New lead: CASL/CAN-SPAM defense file (the EXPRESS opt-in) + the row,
      // written in one transaction.
      const consent = await tx.consentRecord.create({
        data: {
          email,
          basis: "EXPRESS",
          sourceUrl:
            parsed.data.sourceUrl ?? "https://www.mapsly.ai/for-businesses",
          relevanceNote:
            "Requested a free business report via the /for-businesses search form.",
          country: "US",
        },
      });
      await tx.inboundLeadRequest.create({
        data: {
          email,
          businessName,
          city,
          locale: parsed.data.locale ?? null,
          sourceUrl: parsed.data.sourceUrl ?? null,
          consentRecordId: consent.id,
          ipHash: hashIp(ip),
        },
      });
      return true;
    });
  } catch (err) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "marketing_lead.request_report.failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { ok: false, error: "unavailable" };
  }

  // Side-effects only for a genuinely new lead, AND only if this RECIPIENT
  // email is under its own throttle (2/h) — the IP limit can't stop an
  // attacker rotating IPs to email-bomb one victim or burn sending reputation.
  if (isNew) {
    let emailThrottled = false;
    try {
      const limited = await rateLimit(
        new Request("https://www.mapsly.ai/_action/request-free-report#email"),
        LEAD_EMAIL_LIMIT,
        email,
      );
      emailThrottled = limited !== null;
    } catch {
      /* limiter unavailable — fail-soft (allow) */
    }
    if (!emailThrottled) {
      // Best-effort, AFTER the response — never block or fail the capture.
      after(async () => {
        await sendReportConfirmation({ to: email, businessName });
        await notifyOpsNewLead({ businessName, email, city });
      });
    }
  }

  return { ok: true };
}
