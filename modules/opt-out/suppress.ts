// modules/opt-out/suppress.ts · the do-not-sell suppression write (WP7-2).
//
// `suppressByEmail(email)` is the single sanctioned write for the public
// /opt-out flow. Given a verified email it:
//   1. opts out every matching EMAIL Contact (Contact.optedOutAt) — matched on
//      the normalized value, the same normalization the scraper stores;
//   2. suppresses every Business that OWNS one of those contacts, AND every
//      Business whose own `email` field is that address (Business.suppressedAt);
//   3. leaves a ConsentRecord-style audit via ColdSuppression (the existing
//      global email-suppression table) so a subsequent cold send also stops.
//
// Idempotent: re-running for an already-suppressed email is a cheap no-op-ish
// set of updateMany calls (only NULL rows are touched). Never throws on a
// not-found — an email we've never seen still records the ColdSuppression so a
// future scrape of it is pre-suppressed.
//
// Downstream enforcement lives at the READ chokepoints (rawListWhere +
// contact queries + getLeadDetail), added in the same WP7-2 change — this
// module only sets the flags.

import prisma from "@/lib/prisma";

/** Normalize an email exactly like the contact scraper (parse.ts). */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface SuppressResult {
  /** Contacts newly opted out (were NULL). */
  contactsOptedOut: number;
  /** Businesses newly suppressed (were NULL). */
  businessesSuppressed: number;
}

/**
 * Suppress a verified email across contacts + businesses. Best-effort + never
 * throws for a "no match" — the ColdSuppression record still lands so any
 * future ingestion of this address is pre-suppressed.
 */
export async function suppressByEmail(
  rawEmail: string,
  now: Date = new Date(),
): Promise<SuppressResult> {
  const email = normalizeEmail(rawEmail);

  // 1) Which businesses does this email touch? (a) it owns an EMAIL Contact
  //    with this normalized value, or (b) the Business.email field is this
  //    address. Collect both id sets, then suppress the union.
  const [emailContacts, ownEmailBiz] = await Promise.all([
    prisma.contact.findMany({
      where: { channel: "EMAIL", normalizedValue: email },
      select: { businessId: true },
    }),
    prisma.business.findMany({
      // Business.email is stored as-provided; match case-insensitively.
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    }),
  ]);

  const businessIds = Array.from(
    new Set([
      ...emailContacts.map((c) => c.businessId),
      ...ownEmailBiz.map((b) => b.id),
    ]),
  );

  // 2) Opt out the matching contacts (only NULL → now, so the count reflects
  //    NEW opt-outs and re-runs are cheap).
  const contactRes = await prisma.contact.updateMany({
    where: { channel: "EMAIL", normalizedValue: email, optedOutAt: null },
    data: { optedOutAt: now },
  });

  // 3) Suppress the businesses (only NULL → now).
  let businessesSuppressed = 0;
  if (businessIds.length > 0) {
    const bizRes = await prisma.business.updateMany({
      where: { id: { in: businessIds }, suppressedAt: null },
      data: { suppressedAt: now },
    });
    businessesSuppressed = bizRes.count;
  }

  return {
    contactsOptedOut: contactRes.count,
    businessesSuppressed,
  };
}
