// modules/contacts/site-verdict.ts · INC-59 — name the PERMANENT website
// failures instead of retrying them forever.
//
// The contacts scan used to collapse every fetch failure into one retryable
// "we know nothing" bucket, so a domain that DOESN'T EXIST IN DNS
// (livingwaterplumbing.ca → NXDOMAIN) burned the full retry ladder in three
// separate runs, showed "failed · retry" forever, and only the generic
// 3-distinct-runs cap eventually stopped the treadmill. The evidence was in
// our hands the whole time — Node/Playwright hand us the error code, and a
// parked "buy this domain" page hands us its own fingerprint.
//
// Two CHEAP, deterministic verdicts (both pure — no I/O — and unit-tested):
//
//   · classifySiteFailure(errorCode) — authoritative network-level "gone":
//     DNS-not-resolved / connection-refused. ONE strike is enough (NXDOMAIN is
//     not a mood); the reason feeds isNonRetryableFailure → the permanent-
//     failure lifecycle skips + quote-excludes the pair immediately, and the
//     30-day recovery window re-probes monthly in case the site comes back.
//
//   · looksParkedDomain(html) — the domain resolves and serves a page, but
//     it's a registrar/broker parking page ("this domain may be for sale"),
//     not the business's site. Also stops us extracting the BROKER's contact
//     form as the business's contacts.
//
// DELIBERATELY NOT HERE (follow-ups, not cheap): persistent HTTP 5xx/403
// (can't cheaply tell a bad deploy from a dead site — the 3-distinct-runs cap
// covers them), identity-mismatch (domain resold to another real business),
// and a Business.websiteStatus column + workbench chips + registry signals
// (website_dead / domain_parked — a premium agency signal).

/** Permanent website-failure verdicts (the reason-string suffixes). */
export type SiteFailureVerdict = "site_gone_dns" | "site_gone_conn";

// Node (undici) + Chromium net-error spellings for "this host does not
// resolve". EAI_AGAIN is deliberately EXCLUDED — it's a transient resolver
// failure (our DNS hiccup), not evidence the domain is gone.
const DNS_GONE_RE =
  /^(ENOTFOUND|EAI_NONAME)$|ERR_NAME_NOT_RESOLVED|NXDOMAIN|DNS_PROBE_FINISHED_NXDOMAIN/i;

// "Resolves, but nothing is listening" — dead hosting.
const CONN_GONE_RE =
  /^(ECONNREFUSED|EHOSTUNREACH|ENETUNREACH)$|ERR_CONNECTION_REFUSED|ERR_ADDRESS_UNREACHABLE/i;

/**
 * Classify a fetch failure's error code into a PERMANENT verdict, or null when
 * the failure is (or may be) transient — timeouts, resets, 5xx, WAF blocks all
 * return null and stay on the retry ladder + the cross-run cap.
 */
export function classifySiteFailure(
  errorCode: string | null | undefined,
): SiteFailureVerdict | null {
  if (!errorCode) return null;
  if (DNS_GONE_RE.test(errorCode)) return "site_gone_dns";
  if (CONN_GONE_RE.test(errorCode)) return "site_gone_conn";
  return null;
}

// ── Parked-domain fingerprints ───────────────────────────────────────────────

// Phrases a parking/for-sale lander shows the visitor. Matched against the
// TITLE + the first chunk of visible text (never deep body prose, so a real
// site blogging about domains doesn't trip it).
const PARKED_PHRASES_RE =
  /this (?:domain|website|site) (?:name )?(?:may be|is|could be) for sale|buy this domain|purchase this domain|domain (?:is )?parked|parked free,? courtesy|make an offer on this domain|inquire about this domain|get this domain|domain name is for sale|is this your domain\?|renew(?:ing)? this domain|related searches/i;

// Parking/broker providers whose scripts, iframes, or redirect targets appear
// in the raw HTML of parked landers. Presence of ANY is decisive on its own.
const PARKED_PROVIDERS_RE =
  /sedoparking\.com|parkingcrew\.(?:net|com)|bodis\.com|parklogic\.com|dnparking|hugedomains\.com|afternic\.com|dan\.com\/buy-domain|buydomains\.com|domainmarket\.com|undeveloped\.com|sav\.com\/domains|smartname\.com|voodoo\.com\/park|above\.com|domainnamesales\.com|cashparking|godaddy\.com\/park/i;

/** Parked landers are small. A big page with a "for sale" phrase is far more
 *  likely a real site quoting one — cap phrase-only detection by size. */
const PARKED_MAX_HTML_BYTES = 250_000;

/** How much leading visible text the phrase check reads (title + hero). */
const PARKED_TEXT_WINDOW = 4_000;

/** Strip tags/scripts to visible text (cheap, good enough for fingerprints). */
function visibleTextOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the fetched page is a registrar/broker PARKING page — the domain
 * resolved and served content, but it isn't the business's website anymore.
 * Deterministic: provider fingerprint anywhere in the HTML is decisive; a
 * for-sale phrase counts only in the title/leading text of a small page.
 */
export function looksParkedDomain(html: string | null | undefined): boolean {
  if (!html) return false;
  if (PARKED_PROVIDERS_RE.test(html)) return true;
  if (html.length > PARKED_MAX_HTML_BYTES) return false;
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch?.[1] ?? "";
  if (PARKED_PHRASES_RE.test(title)) return true;
  const lead = visibleTextOf(html).slice(0, PARKED_TEXT_WINDOW);
  return PARKED_PHRASES_RE.test(lead);
}
