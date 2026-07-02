// Canonical email form — collapses the aliases that resolve to ONE real mailbox
// so they can't each farm a separate free-tier grant (B6).
//
//   tom+anything@gmail.com  →  tom@gmail.com   (sub-addressing, all providers)
//   t.o.m@gmail.com         →  tom@gmail.com   (Gmail ignores dots in the local part)
//   TOM@Gmail.COM           →  tom@gmail.com   (case-insensitive)
//
// Deliberately conservative: dot-stripping applies ONLY to Gmail/Googlemail
// (other providers treat dots as significant). Not a validator — assumes a
// syntactically valid address; returns the input lowercased/trimmed if it can't
// split on "@".

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/** The canonical (de-aliased) form of an email, for identity de-duplication. */
export function canonicalEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0) return trimmed;

  let local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  // Strip "+tag" sub-addressing (supported by Gmail, Outlook, Fastmail, …).
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);

  // Gmail ignores dots in the local part.
  if (GMAIL_DOMAINS.has(domain)) local = local.replace(/\./g, "");

  return local.length > 0 ? `${local}@${domain}` : trimmed;
}
