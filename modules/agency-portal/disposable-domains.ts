// modules/agency-portal/disposable-domains.ts · trial-abuse blocklist (WP7-5).
//
// A curated set of throwaway / disposable email-provider domains. Signing up
// with one of these is the classic free-trial-farming vector: an attacker mints
// N addresses → N agencies → N free-credit grants. Blocking the well-known
// disposable providers at agency provisioning raises the cost of farming
// without a card (we deliberately do NOT require a card for the trial — the
// door stays open for real agencies on Gmail/Outlook, which are NOT disposable).
//
// Scope: this is a HEURISTIC, not an exhaustive DEA feed. It covers the
// highest-volume throwaway providers; a real DEA service (no new paid vendor
// for MVP) can replace `isDisposableEmailDomain` later behind the same seam.

/** Well-known disposable / throwaway email domains (lowercased, no leading @). */
const DISPOSABLE_DOMAINS = new Set<string>([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "guerrillamail.biz",
  "guerrillamail.org",
  "sharklasers.com",
  "grr.la",
  "10minutemail.com",
  "10minutemail.net",
  "temp-mail.org",
  "tempmail.com",
  "tempmail.net",
  "tempmailo.com",
  "throwawaymail.com",
  "trashmail.com",
  "trashmail.de",
  "getnada.com",
  "nada.email",
  "yopmail.com",
  "yopmail.net",
  "dispostable.com",
  "maildrop.cc",
  "mailnesia.com",
  "mohmal.com",
  "fakeinbox.com",
  "spamgourmet.com",
  "mytemp.email",
  "temp-mail.io",
  "emailondeck.com",
  "moakt.com",
  "tmail.io",
  "burnermail.io",
  "mailcatch.com",
  "inboxkitten.com",
  "spam4.me",
  "vomoto.com",
]);

/**
 * True when the email's domain is a known disposable/throwaway provider.
 * Matches the exact domain OR any subdomain of a listed domain (e.g.
 * "x.mailinator.com"). Case-insensitive. Malformed input → false (let the
 * normal validation reject it — this guard only concerns the disposable check).
 */
export function isDisposableEmailDomain(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  if (!domain) return false;
  if (DISPOSABLE_DOMAINS.has(domain)) return true;
  // Subdomain match: "foo.mailinator.com" → blocked.
  for (const d of DISPOSABLE_DOMAINS) {
    if (domain.endsWith("." + d)) return true;
  }
  return false;
}
