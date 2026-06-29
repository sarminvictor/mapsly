// services/contact-scraper/vendor-domains.ts · the "not the business's own
// inbox" blocklist.
//
// Website builders, hosting providers, error trackers, and template kits leave
// their OWN email addresses embedded in the page markup
// (e.g. `webreporting@gargle.com`, `support@wixpress.com`). Scraping those as
// the SMB's contact is a correctness bug: the lead looks reachable but the
// address belongs to the vendor, not the dentist. This module is the gate.
//
// Pure + import-free. Keep the list conservative — over-blocking drops real
// leads (FAILED ≠ UNREACHABLE applies here too: a wrongly-dropped email looks
// like "no contacts found").

/**
 * Domains (or registrable parents) whose emails are NEVER the business's own.
 * Matched as exact host OR any subdomain (`*.gargle.com`). Lower-case.
 */
const VENDOR_DOMAINS: ReadonlySet<string> = new Set<string>([
  // Website builders / dental + medical site vendors
  "gargle.com",
  "wix.com",
  "wixpress.com",
  "wixsite.com",
  "squarespace.com",
  "godaddy.com",
  "secureserver.net", // GoDaddy hosting
  "weebly.com",
  "webflow.io",
  "du021.com",
  "prosites.com",
  "officite.com",
  "dentalqore.com",
  "pbhs.com",
  "smile-marketing.com",
  // Error tracking / infra / CDNs / asset hosts
  "sentry.io",
  "sentry-cdn.com",
  "wixpress.com",
  "cloudflare.com",
  "cloudflareinsights.com",
  "googleapis.com",
  "gstatic.com",
  "google-analytics.com",
  "googletagmanager.com",
  "schema.org",
  "w3.org",
  "jsdelivr.net",
  "cdnjs.com",
  "fontawesome.com",
  // Generic placeholders / examples
  "example.com",
  "example.org",
  "example.net",
  "domain.com",
  "yourdomain.com",
  "email.com",
  "sentry.wixpress.com",
]);

/**
 * Local-part prefixes that are no-reply / automated mailers, never a human
 * inbox we'd reach out to. Matched as a prefix of the address local part.
 */
const NOREPLY_LOCAL_PARTS: readonly string[] = [
  "noreply",
  "no-reply",
  "no_reply",
  "donotreply",
  "do-not-reply",
  "do_not_reply",
  "mailer-daemon",
  "postmaster",
  "bounce",
  "bounces",
];

/** Asset/file extensions that mark an "email" as an image-sprite artefact. */
const ASSET_EXT_RE = /\.(png|jpe?g|gif|svg|webp|css|js|woff2?|ico|mp4)\b/i;

/** Retina markers like "logo@2x.png" that the email regex can mistake. */
const RETINA_RE = /@\d+x\b/i;

/**
 * True when an email is NOT the business's own contact — a website-vendor
 * address, a no-reply mailer, an asset artefact, or a placeholder. Drop these
 * before they ever reach the contact list.
 */
export function isVendorEmail(email: string): boolean {
  const lower = (email ?? "").trim().toLowerCase();
  if (!lower || !lower.includes("@")) return true;

  // Asset / retina artefacts ("sprite.png@...", "logo@2x.png").
  if (ASSET_EXT_RE.test(lower)) return true;
  if (RETINA_RE.test(lower)) return true;

  const [local, domain] = lower.split("@");
  if (!domain) return true;

  // No-reply / automated mailers.
  if (NOREPLY_LOCAL_PARTS.some((p) => local.startsWith(p))) return true;

  // Vendor domain (exact or subdomain).
  for (const d of VENDOR_DOMAINS) {
    if (domain === d || domain.endsWith("." + d)) return true;
  }
  // Sentry templates frequently embed `*.sentry.*` synthetic hosts.
  if (domain.startsWith("sentry.") || domain.includes(".sentry.")) return true;

  return false;
}

/** TEST-ONLY view of the blocklist size (guards accidental list shrink). */
export const __vendorDomainCount = VENDOR_DOMAINS.size;
