/**
 * RDAP lookup · free + public · finds emails registered on the domain.
 *
 * RDAP (Registration Data Access Protocol · RFC 9082) is the modern
 * replacement for WHOIS over port 43. It speaks JSON, every ICANN
 * registrar runs a server, and `rdap.org` aggregates them so we
 * don't have to manage the bootstrap registry ourselves.
 *
 * What we can get:
 *   - registrant email (if not privacy-redacted)
 *   - admin contact email
 *   - tech contact email
 *
 * Realistic hit rate ~10–25% — most consumer domains have privacy
 * protection enabled, which routes through proxy emails like
 * `xxx@whoisproxy.com` or `xxx@domainsbyproxy.com`. We filter those
 * out so they don't pollute the candidate set.
 *
 * Cost: $0. Rate limit: rdap.org is "be nice" — we cap one lookup
 * per ~2s/domain by virtue of how the qualify-cell loop runs.
 */

import { buildCandidate, type EmailCandidate } from "./scrape-email";

const RDAP_URL = "https://rdap.org/domain";

const RDAP_TIMEOUT_MS = 8_000;

/** Privacy-proxy hosts we drop from candidates. Not exhaustive — these
 *  are the ones we've seen in practice. Add more as we encounter them. */
const PROXY_HOSTS =
  /(?:whoisproxy|whoisguard|domainsbyproxy|privacyguardian|privatewhois|withheldforprivacy|contactprivacy|privacyprotect|proxyprotect|domain-privacy|registrar-servers|privacy|proxy)/i;

export interface RdapResult {
  candidates: EmailCandidate[];
  /** True when we got an HTTP 200 from the RDAP server. */
  ok: boolean;
  /** True when the domain was found but every contact was privacy-protected. */
  proxiedOnly: boolean;
}

/**
 * Fetch RDAP for `domain`, walk every entity's vCard, extract emails.
 * Returns empty candidates on network error / 4xx / malformed payload.
 */
export async function rdapLookup(domain: string | null): Promise<RdapResult> {
  if (!domain || typeof domain !== "string") {
    return { candidates: [], ok: false, proxiedOnly: false };
  }
  const cleanDomain = domain.toLowerCase().replace(/^www\./, "");

  try {
    const res = await fetch(`${RDAP_URL}/${encodeURIComponent(cleanDomain)}`, {
      headers: {
        Accept: "application/rdap+json",
        // rdap.org asks callers to identify · do it
        "User-Agent":
          "MapslyBot/0.1 (+https://mapsly.ai · sarminvictor@gmail.com)",
      },
      signal: AbortSignal.timeout(RDAP_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { candidates: [], ok: false, proxiedOnly: false };
    }
    const data = (await res.json()) as RdapDomainResponse;
    const rawEmails = extractEmailsFromRdap(data);

    // Partition into real vs proxy
    const real: string[] = [];
    let sawProxy = false;
    for (const email of rawEmails) {
      const host = email.split("@")[1] ?? "";
      if (PROXY_HOSTS.test(host)) {
        sawProxy = true;
      } else {
        real.push(email);
      }
    }

    // RDAP candidates ONLY count when domain-aligned. Registrar abuse
    // contacts (e.g., abuse@directnic.com, abuse@namecheap.com) and
    // resold-domain support inboxes routinely surface here — they're
    // not the owner's email. Anything whose host isn't the business's
    // own domain is dropped.
    const candidates = real
      .map((email) => buildCandidate(email, "RDAP", cleanDomain))
      .filter((c) => c.isDomainAligned);

    return {
      candidates,
      ok: true,
      proxiedOnly: candidates.length === 0 && sawProxy,
    };
  } catch {
    return { candidates: [], ok: false, proxiedOnly: false };
  }
}

/* ----------------------------------------------------- RDAP payload walk */

interface RdapDomainResponse {
  entities?: RdapEntity[];
}
interface RdapEntity {
  vcardArray?: VCardArray;
  entities?: RdapEntity[];
}
type VCardArray = ["vcard", VCardField[]];
type VCardField = [string, Record<string, unknown>, string, unknown];

/**
 * Walk the recursive entities[] tree, pulling any vCard field whose
 * type is "email" and whose value is a sensible-looking string.
 *
 * vCard 4.0 emails are encoded as:
 *   ["email", { "type": "work" }, "text", "someone@example.com"]
 *
 * Some registrars use array values (alternate emails); we accept both.
 */
function extractEmailsFromRdap(data: RdapDomainResponse): string[] {
  const out: string[] = [];
  const visit = (entities: RdapEntity[] | undefined) => {
    if (!Array.isArray(entities)) return;
    for (const entity of entities) {
      const vcard = entity.vcardArray?.[1];
      if (Array.isArray(vcard)) {
        for (const item of vcard) {
          if (item[0] === "email") {
            const value = item[3];
            if (typeof value === "string" && value.includes("@")) {
              out.push(value.toLowerCase());
            } else if (Array.isArray(value)) {
              for (const v of value) {
                if (typeof v === "string" && v.includes("@"))
                  out.push(v.toLowerCase());
              }
            }
          }
        }
      }
      visit(entity.entities);
    }
  };
  visit(data.entities);
  return Array.from(new Set(out));
}
