/**
 * Contact + tech scan orchestrator · Phase 4 (Contacts + reachability gate)
 * and Phase 6-tech (DOM/tech fingerprint).
 *
 * `scanBusinessContacts(businessId)` is the runtime that ties the pure cores to
 * the database. It MUST run inside an open CronRun (it's a worker/cron job, not
 * a user-request-path function — see .claude/rules/cost-discipline.md). The
 * cron-context invariant is enforced via `getCurrentCronRun()`.
 *
 * One homepage fetch, two enrichments:
 *   1. Contacts  — extractContactsFromHtml → upsert Contact rows → reachability
 *                  gate → Business.reachability / contactScanStatus / isHidden.
 *   2. Tech      — fingerprintTech over the SAME HTML+headers → upsert
 *                  BusinessTech rows → Business.techScanLastAt. Free ($0): it
 *                  rides the contacts fetch, no extra network call.
 *
 * The load-bearing distinction (mirrors modules/contacts/reachability.ts):
 *
 *   A FAILED fetch is NOT "unreachable". It means "we know nothing." We set
 *   contactScanStatus = "FAILED" and NEVER hide the business on a failed fetch —
 *   hiding on a transient timeout would silently delete reachable businesses
 *   from every list. Only a SUCCESSFUL scan that found zero reachable channels
 *   (plus the empty base row) hides via computeHidden.
 *
 * See:
 *   - modules/contacts/fetch-site.ts — the one polite fetch
 *   - modules/contacts/extract.ts — pure contact extraction
 *   - modules/contacts/reachability.ts — pure gate (reachability + hide)
 *   - services/tech-fingerprint/fingerprint.ts — pure tech fingerprint
 *   - .claude/rules/prisma.md §scalability — batched upserts, select-only reads
 */

import prisma from "@/lib/prisma";
import { getCurrentCronRun } from "@/lib/cost/cost-counter";

import { extractContactsFromHtml } from "@/modules/contacts/extract";
import type {
  ContactChannel,
  ContactSource,
  ExtractedContact,
} from "@/modules/contacts/extract";
import {
  reachabilityFromContacts,
  computeHidden,
  normalizePhone,
} from "@/modules/contacts/reachability";
import type {
  ReachabilityStatus,
  ContactScanStatus,
} from "@/modules/contacts/reachability";
import { fingerprintTech } from "@/services/tech-fingerprint/fingerprint";
import type { DetectedTech } from "@/services/tech-fingerprint/fingerprint";
import {
  fetchSiteHtml,
  type FetchSiteResult,
} from "@/modules/contacts/fetch-site";
import { fetchDoms } from "@/services/dom-fetcher/fetcher";
import {
  classifySiteFailure,
  looksParkedDomain,
  type SiteFailureVerdict,
} from "./site-verdict";

/**
 * Cap on the persisted site-text extract (A2). Bounds both the DB row size and
 * the later token cost when the services + AI-research jobs feed this text to
 * the model. ~24k chars ≈ the front page of most local-business sites.
 */
const MAX_SITE_TEXT_CHARS = 24_000;

/**
 * Derive readable, visible text from raw page HTML (A2). Strips <script> and
 * <style> blocks (and <noscript>/comments) FIRST so their contents don't leak
 * into the text, then removes all remaining tags, decodes the common HTML
 * entities, and collapses whitespace. Truncated to MAX_SITE_TEXT_CHARS. Returns
 * "" for empty/whitespace-only input so the caller can leave siteText null.
 * We never store raw HTML — only this cleaned extract.
 */
export function siteTextFromHtml(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, MAX_SITE_TEXT_CHARS);
}

/** Mirror of Prisma `ContactRole` (kept local so the module stays pure-ish). */
type ContactRole =
  | "OWNER"
  | "FRONT_DESK"
  | "PERSONAL"
  | "GENERIC"
  | "SUPPORT"
  | "BOOKING"
  | "SOCIAL"
  | "UNKNOWN";

/** Mirror of Prisma `BusinessTechCategory`. */
type BusinessTechCategory =
  | "CMS"
  | "FRAMEWORK"
  | "CDN"
  | "ANALYTICS"
  | "PIXEL"
  | "BOOKING"
  | "CHAT"
  | "ECOMMERCE"
  | "HOSTING"
  | "PAYMENT"
  | "CONSENT"
  | "OTHER";

/** What a single business scan reports back to the caller / cron summary. */
export interface ContactScanSummary {
  readonly businessId: string;
  /** "OK" | "FAILED" — the contactScanStatus we wrote. "SKIPPED" when there's
   *  no website and no DfS contactInfo to work from (left for the DfS path). */
  readonly status: ContactScanStatus | "SKIPPED";
  /** Number of Contact rows upserted this run (0 on FAILED / SKIPPED). */
  readonly contactsUpserted: number;
  /** Number of BusinessTech rows upserted this run. */
  readonly techUpserted: number;
  /** Reachability classification written (null on FAILED / SKIPPED). */
  readonly reachability: ReachabilityStatus | null;
  /** Distinct reachable channel count (0 on FAILED / SKIPPED). */
  readonly reachableChannelCount: number;
  /** Whether the business ended up hidden (always false on FAILED). */
  readonly isHidden: boolean;
  /**
   * INC-59 · a NAMED PERMANENT failure verdict when the evidence is
   * authoritative — "site_gone_dns" (domain doesn't resolve), "site_gone_conn"
   * (nothing listening), "domain_parked" (registrar/broker lander, not the
   * business's site). The dispatch worker maps it to `contacts_<verdict>`,
   * which isNonRetryableFailure treats as permanent on the FIRST strike —
   * no more three-run retry treadmills on a domain that doesn't exist.
   * Undefined for OK/SKIPPED and for failures that may be transient.
   */
  readonly failureReason?: SiteFailureVerdict | "domain_parked";
}

/** The subset of Business columns the scan reads — explicit select (perf). */
interface BusinessForScan {
  id: string;
  website: string | null;
  phone: string | null;
  email: string | null;
  contactInfo: unknown;
  permanentlyClosed: boolean;
}

/** Generic role-inbox local parts → GENERIC (not a specific person). */
const GENERIC_EMAIL_LOCALS = new Set([
  "info",
  "contact",
  "hello",
  "hi",
  "admin",
  "sales",
  "office",
  "team",
  "service",
  "services",
  "mail",
  "email",
  "general",
  "marketing",
  "accounts",
  "accounting",
  "billing",
  "hr",
  "careers",
  "jobs",
  "reception",
  "frontdesk",
  "front-desk",
  "enquiries",
  "inquiries",
  "enquiry",
  "inquiry",
  "bookings",
  "booking",
  "appointments",
  "noreply",
  "no-reply",
  "donotreply",
  "webmaster",
  "postmaster",
]);
const SUPPORT_EMAIL_LOCALS = new Set(["support", "help", "helpdesk", "care"]);

/**
 * Classify an extracted contact into a ContactRole. Socials → SOCIAL, booking →
 * BOOKING. For EMAIL we now actually refine (was always UNKNOWN — the deferred
 * "role refiner" never existed): a generic role inbox (`info@`, `sales@`) →
 * GENERIC, a support inbox → SUPPORT, and a name-shaped local part
 * (`maria@`, `maria.gomez@`) → PERSONAL. Phones stay UNKNOWN (a number carries
 * no role signal). Lets the workbench filter "reach a person, not a mailbox".
 */
function roleForContact(channel: ContactChannel, value: string): ContactRole {
  switch (channel) {
    case "FACEBOOK":
    case "INSTAGRAM":
    case "LINKEDIN":
    case "TIKTOK":
    case "YOUTUBE":
    case "X":
    case "YELP":
      return "SOCIAL";
    case "BOOKING_URL":
      return "BOOKING";
    case "EMAIL": {
      const local = (value.split("@")[0] ?? "").toLowerCase().trim();
      if (!local) return "UNKNOWN";
      if (GENERIC_EMAIL_LOCALS.has(local)) return "GENERIC";
      if (SUPPORT_EMAIL_LOCALS.has(local)) return "SUPPORT";
      // A single name token, or first.last / first_last / first-last → a person.
      if (/^[a-z]{2,20}$/.test(local)) return "PERSONAL";
      if (/^[a-z]+[._-][a-z]+$/.test(local)) return "PERSONAL";
      return "UNKNOWN";
    }
    default:
      return "UNKNOWN";
  }
}

/** True when DataForSEO already gave us at least one usable contact channel. */
function hasDfsContactInfo(contactInfo: unknown): boolean {
  if (contactInfo == null) return false;
  if (Array.isArray(contactInfo)) return contactInfo.length > 0;
  if (typeof contactInfo === "object") {
    return Object.keys(contactInfo as Record<string, unknown>).length > 0;
  }
  return false;
}

/**
 * Upsert one Contact row, keyed on the model's @@unique([businessId, channel,
 * normalizedValue]). Re-scans update lastSeenAt + confidence (highest wins);
 * the first scan creates with firstSeenAt = now.
 */
async function upsertContact(
  businessId: string,
  c: ExtractedContact,
): Promise<void> {
  const now = new Date();
  await prisma.contact.upsert({
    where: {
      businessId_channel_normalizedValue: {
        businessId,
        channel: c.channel,
        normalizedValue: c.normalizedValue,
      },
    },
    create: {
      businessId,
      channel: c.channel,
      value: c.value,
      normalizedValue: c.normalizedValue,
      role: roleForContact(c.channel, c.value),
      source: c.source as ContactSource,
      confidence: Math.round(c.confidence),
      firstSeenAt: now,
      lastSeenAt: now,
    },
    update: {
      value: c.value,
      lastSeenAt: now,
      confidence: Math.round(c.confidence),
    },
  });
}

/**
 * Upsert one BusinessTech row. The model has no @@unique, so we emulate upsert:
 * find the existing (businessId, name) row → update its confidence/detectedAt,
 * else create. Keeps a single row per detected technology per business.
 */
async function upsertTech(businessId: string, t: DetectedTech): Promise<void> {
  const existing = await prisma.businessTech.findFirst({
    where: { businessId, name: t.name },
    select: { id: true },
  });
  const data = {
    businessId,
    name: t.name,
    category: t.category as BusinessTechCategory,
    confidence: t.confidence,
    source: t.source,
    detectedAt: new Date(),
  };
  if (existing) {
    await prisma.businessTech.update({ where: { id: existing.id }, data });
  } else {
    await prisma.businessTech.create({ data });
  }
}

/**
 * Scan one business: fetch its homepage once, extract contacts + fingerprint
 * tech off the same bytes, then persist + classify. MUST run inside a CronRun.
 *
 * Outcome matrix:
 *   - no website, no DfS contactInfo → SKIPPED (leave for the DfS path).
 *   - no website, has DfS contactInfo → contactScanStatus = "OK" (DfS covers it).
 *   - website + fetch fails           → contactScanStatus = "FAILED" (NEVER hide).
 *   - website + fetch succeeds        → upsert contacts + tech, compute
 *                                       reachability + isHidden, status = "OK".
 */
/**
 * Headless-browser fallback for the contacts fetch. The polite direct fetch
 * (`fetchSiteHtml`) is 403'd by WAFs (Squarespace/Cloudflare) that fingerprint
 * the Node HTTP client — but the dom-fetcher actor drives a real Playwright
 * browser over a residential proxy, so it loads those sites and returns the
 * rendered HTML (contacts + email + tech ride the same bytes). Returns a
 * {@link FetchSiteResult}; `ok:false` when the actor also can't get it (genuinely
 * dead site). Never throws. Costs one dom-fetch (already the contacts unit
 * price) — only paid when the free direct fetch failed. The actor doesn't
 * surface response headers, so `headers` is empty (tech fingerprinting still
 * works off the HTML, its primary signal).
 */
async function fetchViaDomFetcher(website: string): Promise<FetchSiteResult> {
  try {
    const { results } = await fetchDoms({ urls: [website] });
    const r = results[0];
    if (r && !r.failed && r.html && r.html.length > 0) {
      return {
        ok: true,
        html: r.html,
        finalUrl: r.finalUrl ?? website,
        headers: {},
      };
    }
    // INC-59 · keep the actor's error string (e.g. net::ERR_NAME_NOT_RESOLVED)
    // — it's the evidence the site-gone verdict is classified from.
    return {
      ok: false,
      html: "",
      finalUrl: "",
      headers: {},
      errorCode: r?.error ?? undefined,
    };
  } catch {
    // Actor error / cost-ceiling / timeout → treat as still-failed (the caller
    // records FAILED, which the retry ladder re-attempts later).
  }
  return { ok: false, html: "", finalUrl: "", headers: {} };
}

export async function scanBusinessContacts(
  businessId: string,
): Promise<ContactScanSummary> {
  // Cron-context invariant: external fetches must never run in a user request
  // path. Throwing here matches the cost-counter "no live API" enforcement.
  if (!getCurrentCronRun()) {
    throw new Error(
      `[scanBusinessContacts] called outside an open CronRun. ` +
        `Run inside withCronRun(...) — see .claude/rules/cost-discipline.md.`,
    );
  }

  const business = (await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      website: true,
      phone: true,
      email: true,
      contactInfo: true,
      permanentlyClosed: true,
    },
  })) as BusinessForScan | null;

  if (!business) {
    throw new Error(`[scanBusinessContacts] business not found: ${businessId}`);
  }

  const website = (business.website ?? "").trim();

  // ── No website ────────────────────────────────────────────────────────────
  if (!website) {
    // DfS-listing fallback: a website-less business still has its DfS phone —
    // persist it as a DFS_LISTING Contact so it's reachable (PHONE_ONLY), not
    // silently dropped from every list.
    const dfsPhone = normalizePhone(business.phone ?? "");
    if (dfsPhone) {
      const now = new Date();
      await upsertContact(businessId, {
        channel: "PHONE",
        value: (business.phone ?? "").trim(),
        normalizedValue: dfsPhone,
        source: "DFS_LISTING",
        confidence: 80,
      });
      await prisma.business.update({
        where: { id: businessId },
        data: {
          reachability: "PHONE_ONLY",
          reachableChannelCount: 1,
          reachabilityComputedAt: now,
          contactScanStatus: "OK",
          contactsExtractedAt: now,
          isHidden: false,
          hiddenReason: null,
        },
      });
      return {
        businessId,
        status: "OK",
        contactsUpserted: 1,
        techUpserted: 0,
        reachability: "PHONE_ONLY",
        reachableChannelCount: 1,
        isHidden: false,
      };
    }
    if (hasDfsContactInfo(business.contactInfo)) {
      // DfS has some contact channels but no usable phone — mark OK so the
      // business isn't re-fetched; richer DfS-contactInfo parsing is a follow-up.
      await prisma.business.update({
        where: { id: businessId },
        data: { contactScanStatus: "OK", contactsExtractedAt: new Date() },
      });
      return {
        businessId,
        status: "OK",
        contactsUpserted: 0,
        techUpserted: 0,
        reachability: null,
        reachableChannelCount: 0,
        isHidden: false,
      };
    }
    // Nothing to work from yet — leave contactScanStatus as-is for the DfS path.
    return {
      businessId,
      status: "SKIPPED",
      contactsUpserted: 0,
      techUpserted: 0,
      reachability: null,
      reachableChannelCount: 0,
      isHidden: false,
    };
  }

  // ── Fetch the homepage ──────────────────────────────────────────────────────
  // First the free, polite direct fetch. WAF'd sites (Squarespace, Cloudflare,
  // …) 403 the plain Node fetch on its HTTP-client/TLS fingerprint even though a
  // real browser loads them fine — so on ANY failure, fall back to the headless
  // dom-fetcher (residential proxy + Playwright), the same actor the contacts
  // price already covers, so a WAF doesn't cost us the contacts + email.
  const direct = await fetchSiteHtml(website);
  let fetched = direct;
  if (!fetched.ok) {
    // INC-59 · when the direct fetch already proved the domain GONE
    // (NXDOMAIN / connection refused), don't burn a paid dom-fetch on it —
    // a headless browser can't render a domain that doesn't resolve.
    if (!classifySiteFailure(direct.errorCode)) {
      fetched = await fetchViaDomFetcher(website);
    }
  }

  // ── Fetch failed → FAILED, NEVER hidden ─────────────────────────────────────
  if (!fetched.ok) {
    // A FAILED scan means "we know nothing" — explicitly do NOT touch isHidden
    // / reachability (FAILED ≠ UNREACHABLE). WP1-7: do NOT stamp
    // contactsExtractedAt on a FAILED fetch — the freshness cursor must stay
    // untouched so a transient site-down doesn't lock this business out of a
    // re-scan for 90 days. The dispatch CONTACTS worker maps this FAILED result
    // to a non-billable outcome (WP1-2), so the 3-attempt retry ladder + the
    // stuck-reset re-attempt it, and the run's settle refunds it.
    //
    // INC-59 · EXCEPT when the failure is authoritatively PERMANENT: a domain
    // that doesn't resolve (NXDOMAIN) or refuses every connection isn't
    // "transient site-down" — retrying it burns runs and shows a lying
    // "failed · retry" forever. Classify from EITHER fetch path's error code
    // (the direct Node fetch usually carries the DNS verdict; the actor's
    // net::ERR_* string is the fallback evidence).
    const failureReason =
      classifySiteFailure(direct.errorCode) ??
      classifySiteFailure(fetched.errorCode) ??
      undefined;
    await prisma.business.update({
      where: { id: businessId },
      data: {
        contactScanStatus: "FAILED",
      },
    });
    return {
      businessId,
      status: "FAILED",
      contactsUpserted: 0,
      techUpserted: 0,
      reachability: null,
      reachableChannelCount: 0,
      isHidden: false,
      ...(failureReason ? { failureReason } : {}),
    };
  }

  // ── INC-59 · parked-domain gate ─────────────────────────────────────────────
  // The domain resolved and served a page — but if it's a registrar/broker
  // PARKING lander ("this domain may be for sale"), it is NOT the business's
  // website: extracting from it would store the BROKER's links as the
  // business's contacts. Verdict is permanent (first strike); the 30-day
  // recovery window re-probes in case the business re-launches on the domain.
  if (looksParkedDomain(fetched.html)) {
    await prisma.business.update({
      where: { id: businessId },
      data: {
        contactScanStatus: "FAILED",
      },
    });
    return {
      businessId,
      status: "FAILED",
      contactsUpserted: 0,
      techUpserted: 0,
      reachability: null,
      reachableChannelCount: 0,
      isHidden: false,
      failureReason: "domain_parked",
    };
  }

  // ── Fetch succeeded → contacts + tech off the same bytes ────────────────────
  const contacts = extractContactsFromHtml(fetched.html, fetched.finalUrl);
  for (const c of contacts) {
    await upsertContact(businessId, c);
  }

  // Tech enrichment rides the same fetch at $0.
  const techs = fingerprintTech({
    html: fetched.html,
    headers: fetched.headers,
    finalUrl: fetched.finalUrl,
  });
  for (const t of techs) {
    await upsertTech(businessId, t);
  }

  // Reachability classification from the extracted channel mix.
  const { status: reachability, reachableChannelCount } =
    reachabilityFromContacts(contacts);

  const now = new Date();

  // A2 · persist a cleaned, truncated text extract of the page so the services +
  // AI-research jobs can read the REAL website (menu + positioning copy), not
  // just the thin Google listing. We derive visible text (scripts/styles/tags
  // stripped) and cap it — never store raw HTML. Empty extract → leave null.
  const siteText = siteTextFromHtml(fetched.html);

  // Compute hide AFTER reachability — the OK + zero-reach + empty-base-row case
  // is the only path that hides (computeHidden mirrors the enrichability gate).
  const hidden = computeHidden({
    website: business.website,
    phone: business.phone,
    email: business.email,
    reachableChannelCount,
    contactScanStatus: "OK",
    isPermanentlyClosed: business.permanentlyClosed,
  });

  await prisma.business.update({
    where: { id: businessId },
    data: {
      reachability,
      reachableChannelCount,
      reachabilityComputedAt: now,
      contactScanStatus: "OK",
      contactsExtractedAt: now,
      techScanLastAt: now,
      ...(siteText
        ? { siteText, siteTextAt: now }
        : { siteText: null, siteTextAt: null }),
      isHidden: hidden.isHidden,
      hiddenReason: hidden.hiddenReason,
    },
  });

  return {
    businessId,
    status: "OK",
    contactsUpserted: contacts.length,
    techUpserted: techs.length,
    reachability,
    reachableChannelCount,
    isHidden: hidden.isHidden,
  };
}
