// modules/agency-portal/provision.ts · self-serve agency creation (WP2-1).
//
// The productized version of scripts/e2e-provision-agency.ts: a user who signed
// in with EXPLICIT agency intent (`?audience=agency`, carried through the
// magic-link round-trip from the /for-agencies CTAs) gets a real
// Agency + AgencyMember(OWNER) + AgencyWallet on first arrival — no manual
// provisioning step, no dead end at /home.
//
// Invariants:
//   - Idempotent: an existing membership short-circuits (oldest membership
//     wins, mirroring WalletPill / the welcome page). Re-running never creates
//     a second agency for the same user.
//   - The free-tier credit grant does NOT happen here — /welcome's
//     `grantFreeTierIfNew` stays the single grant path (it runs the moment the
//     user lands there). This module only guarantees the wallet ROW exists.
//   - Callers gate on explicit intent: this is never called for a plain
//     sign-in, so an existing SMB owner is never silently converted (see
//     app/[locale]/post-signin/page.tsx for the guard).
//
// Naming (Tom-persona decision): the agency name/slug derive from the user's
// email domain — an agency owner signing up as tom@anchorlocal.com gets
// "Anchorlocal" / `anchorlocal`, which reads right in the portal header and is
// editable later in agency settings. Free-mail domains (gmail etc.) carry no
// brand, so those fall back to the local part (tom.smith@gmail.com → "Tom
// Smith" / `tom-smith`).

import prisma from "@/lib/prisma";
import { getOrCreateWallet } from "@/modules/cost/server";
import { trackProductEvent } from "@/lib/analytics/product-events";
import { isDisposableEmailDomain } from "./disposable-domains";

/** Consumer mail domains that carry no agency brand — use the local part. */
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "pm.me",
  "gmx.com",
  "mail.com",
  "yandex.com",
  "zoho.com",
]);

/** How many `slug`, `slug-2`, … candidates to try before the time-based tail. */
const MAX_SLUG_ATTEMPTS = 20;

export interface AgencyNameParts {
  name: string;
  slug: string;
}

/**
 * Derive a display name + URL slug from an email. Pure — exported for tests.
 * Brand domain wins ("tom@anchorlocal.com" → "Anchorlocal"/"anchorlocal");
 * free-mail falls back to the local part ("tom.smith@gmail.com" →
 * "Tom Smith"/"tom-smith"). Never returns an empty slug.
 */
export function agencyNameFromEmail(email: string): AgencyNameParts {
  const [local = "", domain = ""] = email.trim().toLowerCase().split("@");
  const base =
    domain && !FREE_MAIL_DOMAINS.has(domain)
      ? domain.split(".")[0]
      : // Strip "+tag" sub-addressing so test+foo@… doesn't leak the tag.
        local.split("+")[0];
  const slug =
    base
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/g, "") || "agency";
  const name =
    slug
      .split("-")
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ") || "My agency";
  return { name, slug };
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "P2002"
  );
}

export interface ProvisionResult {
  agencyId: string | null;
  /** False when the user already had a membership (idempotent no-op). */
  created: boolean;
  /**
   * WP7-5 · set when provisioning was refused for trial-abuse reasons
   * (disposable email domain). The caller shows a "use a business email"
   * message instead of routing into the portal. Absent on success.
   */
  blocked?: "disposable_email";
}

/**
 * Create the Agency + AgencyMember(OWNER) + AgencyWallet trio for a user who
 * signed in with agency intent. Safe to call repeatedly — an existing
 * membership returns immediately. Emits the `agency_created` product event on
 * a real creation (fire-and-forget).
 */
export async function provisionAgencyForUser(
  userId: string,
  email: string,
): Promise<ProvisionResult> {
  // Idempotency: oldest membership wins (same rule every portal page uses).
  const existing = await prisma.agencyMember.findFirst({
    where: { userId },
    orderBy: { createdAt: "asc" },
    select: { agencyId: true },
  });
  if (existing) return { agencyId: existing.agencyId, created: false };

  // WP7-5 · trial-abuse containment: never mint a fresh agency (+ its free-tier
  // grant) for a throwaway email. An existing member above is unaffected — this
  // only blocks NEW disposable-domain signups from farming free credits. Real
  // agencies on Gmail/Outlook/branded domains are NOT disposable and pass.
  if (isDisposableEmailDomain(email)) {
    void trackProductEvent({
      type: "agency_provision_blocked",
      userId,
      props: { reason: "disposable_email" },
    });
    return { agencyId: null, created: false, blocked: "disposable_email" };
  }

  const { name, slug } = agencyNameFromEmail(email);

  // Unique-ify the slug: `anchorlocal`, `anchorlocal-2`, … Retrying on the DB's
  // unique violation (not a pre-read) so two concurrent signups can't race the
  // same candidate. Plan defaults to SOLO with no stripeStatus = the free state
  // (same as scripts/e2e-provision-agency.ts).
  let agencyId: string | null = null;
  for (let i = 0; i < MAX_SLUG_ATTEMPTS && agencyId === null; i += 1) {
    const candidate = i === 0 ? slug : `${slug}-${i + 1}`;
    try {
      const agency = await prisma.agency.create({
        data: { name, slug: candidate },
        select: { id: true },
      });
      agencyId = agency.id;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  if (agencyId === null) {
    // 20 taken variants of one domain slug — practically unreachable. A
    // time-based tail keeps the flow moving instead of failing the signup.
    // (Runs post-auth() in a dynamic request, so Date.now() is PPR-safe.)
    const agency = await prisma.agency.create({
      data: { name, slug: `${slug}-${Date.now().toString(36)}` },
      select: { id: true },
    });
    agencyId = agency.id;
  }

  // Upsert (not create) so a partial earlier attempt (agency created, member
  // insert crashed) heals on retry instead of throwing on the unique pair.
  await prisma.agencyMember.upsert({
    where: { agencyId_userId: { agencyId, userId } },
    update: { role: "OWNER" },
    create: { agencyId, userId, role: "OWNER" },
    select: { id: true },
  });

  // Wallet ROW only — the 50-credit free grant stays /welcome's job
  // (grantFreeTierIfNew, the single grant path).
  await getOrCreateWallet(agencyId);

  // WP6-4 foundation: activation funnel starts here. Fire-and-forget.
  void trackProductEvent({
    type: "agency_created",
    agencyId,
    userId,
    props: { source: "post-signin", slug },
  });

  return { agencyId, created: true };
}
