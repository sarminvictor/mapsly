// services/contact-scraper/parse.ts · the PARSER side of the scrape split.
//
// `parseContacts({ html, sourceUrl })` is a PURE function over a rendered DOM
// (the HTML the dom-fetcher actor returns). It does NO network, NO Prisma, NO
// browser — every contact point is extracted by regex/URL parsing over the
// already-fetched bytes. This is the "fetch once, parse many" principle: one
// DOM feeds contacts (here), tech (services/tech-fingerprint), services, and AI.
//
// Confidence model (0–100):
//   - 90  href-derived (mailto: / tel:) — the site explicitly published it
//   - 70  recognised social / booking profile URL
//   - 60  plaintext body regex (could be a vendor, a customer, noise)
//
// Vendor / no-reply / asset emails are dropped via `isVendorEmail`
// (./vendor-domains.ts) — a `webreporting@gargle.com` is the website builder's
// inbox, not the dentist's.
//
// Local string-literal unions mirror the Prisma enums (ContactChannel,
// ContactRole, ContactSource) so this module stays pure + import-free. The
// orchestrator (modules/discovery/enrich-contacts.ts) casts them to the Prisma
// enums on write. Keep in lockstep with prisma/schema.prisma.

import { isVendorEmail } from "./vendor-domains";

// ─── Local enum mirrors (keep in sync with prisma/schema.prisma) ──────────────

/** Mirror of Prisma `ContactChannel`. */
export type ContactChannel =
  | "EMAIL"
  | "PHONE"
  | "WHATSAPP"
  | "FACEBOOK"
  | "INSTAGRAM"
  | "LINKEDIN"
  | "TIKTOK"
  | "YOUTUBE"
  | "X"
  | "YELP"
  | "BOOKING_URL"
  | "WEBSITE";

/** Mirror of Prisma `ContactRole`. */
export type ContactRole =
  | "OWNER"
  | "FRONT_DESK"
  | "PERSONAL"
  | "GENERIC"
  | "SUPPORT"
  | "BOOKING"
  | "SOCIAL"
  | "UNKNOWN";

/** Mirror of the relevant subset of Prisma `ContactSource`. */
export type ContactSource =
  | "SCRAPE_MAILTO"
  | "SCRAPE_TEL"
  | "SCRAPE_SOCIAL_META"
  | "SCRAPE_HOMEPAGE";

/** One parsed contact point, ready for the orchestrator to upsert. */
export interface ParsedContact {
  readonly channel: ContactChannel;
  /** Raw published form (for display / audit). */
  readonly value: string;
  /** Canonical form used for de-dupe + the @@unique key. */
  readonly normalizedValue: string;
  readonly role: ContactRole;
  readonly source: ContactSource;
  /** 0–100. Higher = more likely the business's own contact point. */
  readonly confidence: number;
}

export interface ParseContactsInput {
  /** The rendered DOM to parse. */
  readonly html: string;
  /** The page URL (used to resolve relative hrefs). */
  readonly sourceUrl: string;
}

// ─── Confidence constants ─────────────────────────────────────────────────────

const CONF_HREF = 90;
const CONF_PROFILE = 70;
const CONF_PLAINTEXT = 60;

// ─── Regexes ──────────────────────────────────────────────────────────────────

const MAILTO_HREF_RE = /href\s*=\s*["']\s*mailto:([^"'?>]+)/gi;
const TEL_HREF_RE = /href\s*=\s*["']\s*tel:([^"'>]+)/gi;
const PLAINTEXT_EMAIL_RE =
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
/** US/CA phone: (XXX) XXX-XXXX with space/dot/dash separators. */
const PLAINTEXT_PHONE_RE = /\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/g;
const ANY_HREF_RE = /href\s*=\s*["']([^"']+)["']/gi;
const BARE_URL_RE = /https?:\/\/[^\s"'<>)\]]+/gi;

/** Generic-inbox local parts → GENERIC role (vs UNKNOWN for personal-looking). */
const GENERIC_LOCAL_PARTS: readonly string[] = [
  "info",
  "contact",
  "hello",
  "office",
  "admin",
  "team",
  "frontdesk",
  "front-desk",
  "reception",
  "appointments",
  "booking",
  "bookings",
];

// ─── Email ──────────────────────────────────────────────────────────────────

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function roleForEmail(normalized: string): ContactRole {
  const local = normalized.split("@")[0] ?? "";
  if (
    GENERIC_LOCAL_PARTS.some((p) => local === p || local.startsWith(p + "."))
  ) {
    return "GENERIC";
  }
  return "UNKNOWN";
}

function parseEmails(html: string): ParsedContact[] {
  const byNorm = new Map<string, ParsedContact>();

  const add = (raw: string, source: ContactSource, confidence: number) => {
    const value = stripEntities(raw).trim();
    if (!value) return;
    if (isVendorEmail(value)) return;
    const normalizedValue = normalizeEmail(value);
    if (!normalizedValue.includes("@")) return;
    if (isVendorEmail(normalizedValue)) return;
    const existing = byNorm.get(normalizedValue);
    if (existing && existing.confidence >= confidence) return;
    byNorm.set(normalizedValue, {
      channel: "EMAIL",
      value,
      normalizedValue,
      role: roleForEmail(normalizedValue),
      source,
      confidence,
    });
  };

  for (const m of html.matchAll(MAILTO_HREF_RE)) {
    add(decodeURIComponentSafe(m[1]), "SCRAPE_MAILTO", CONF_HREF);
  }
  for (const m of html.matchAll(PLAINTEXT_EMAIL_RE)) {
    add(m[0], "SCRAPE_HOMEPAGE", CONF_PLAINTEXT);
  }

  return [...byNorm.values()];
}

// ─── Phone ────────────────────────────────────────────────────────────────────

/**
 * Normalize a phone to digits only, E.164-ish for US/CA: 10 digits → "+1…",
 * 11 digits starting with 1 → "+1…". Returns null when the run can't be NANP.
 */
function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return null;
}

function parsePhones(html: string): ParsedContact[] {
  const byNorm = new Map<string, ParsedContact>();

  const add = (raw: string, source: ContactSource, confidence: number) => {
    const value = stripEntities(raw).trim();
    if (!value) return;
    const normalizedValue = normalizePhone(value);
    if (!normalizedValue) return;
    const existing = byNorm.get(normalizedValue);
    if (existing && existing.confidence >= confidence) return;
    byNorm.set(normalizedValue, {
      channel: "PHONE",
      value,
      normalizedValue,
      role: "UNKNOWN",
      source,
      confidence,
    });
  };

  for (const m of html.matchAll(TEL_HREF_RE)) {
    add(m[1], "SCRAPE_TEL", CONF_HREF);
  }
  for (const m of html.matchAll(PLAINTEXT_PHONE_RE)) {
    add(m[0], "SCRAPE_HOMEPAGE", CONF_PLAINTEXT);
  }

  return [...byNorm.values()];
}

// ─── Social + booking ───────────────────────────────────────────────────────

interface UrlMatcher {
  readonly channel: ContactChannel;
  readonly role: ContactRole;
  /** Host suffixes that identify the destination. */
  readonly hosts: readonly string[];
}

const SOCIAL_MATCHERS: readonly UrlMatcher[] = [
  {
    channel: "FACEBOOK",
    role: "SOCIAL",
    hosts: ["facebook.com", "fb.com", "fb.me"],
  },
  {
    channel: "INSTAGRAM",
    role: "SOCIAL",
    hosts: ["instagram.com", "instagr.am"],
  },
  { channel: "LINKEDIN", role: "SOCIAL", hosts: ["linkedin.com"] },
  { channel: "TIKTOK", role: "SOCIAL", hosts: ["tiktok.com"] },
  { channel: "YOUTUBE", role: "SOCIAL", hosts: ["youtube.com", "youtu.be"] },
  { channel: "X", role: "SOCIAL", hosts: ["x.com", "twitter.com"] },
  { channel: "YELP", role: "SOCIAL", hosts: ["yelp.com", "yelp.ca"] },
];

/** Booking-tool hosts/substrings → BOOKING_URL channel, BOOKING role. */
const BOOKING_SUBSTRINGS: readonly string[] = [
  "calendly",
  "acuity",
  "acuityscheduling",
  "nexhealth",
  "zocdoc",
  "localmed",
  "squareup",
  "setmore",
  "dentrix",
  "yapi",
  "solutionreach",
];

/** Path segments that mean "share / intent" — never a real profile. */
const EXCLUDE_PATH_SEGMENTS: ReadonlySet<string> = new Set([
  "sharer",
  "share",
  "share.php",
  "intent",
  "dialog",
  "plugins",
  "widgets",
  "oembed",
  "tr",
  "login",
  "signup",
]);

function hostMatches(host: string, suffix: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return h === suffix || h.endsWith("." + suffix);
}

function isExcludedPath(pathname: string): boolean {
  return pathname
    .split("/")
    .filter(Boolean)
    .some((s) => EXCLUDE_PATH_SEGMENTS.has(s.toLowerCase()));
}

function toUrl(raw: string, baseUrl: string): URL | null {
  const cleaned = stripEntities(raw).trim();
  if (!cleaned) return null;
  try {
    if (/^https?:\/\//i.test(cleaned)) return new URL(cleaned);
    if (cleaned.startsWith("//")) return new URL("https:" + cleaned);
    if (baseUrl) return new URL(cleaned, baseUrl);
    return null;
  } catch {
    return null;
  }
}

function parseUrlContacts(html: string, sourceUrl: string): ParsedContact[] {
  const byKey = new Map<string, ParsedContact>();

  const consider = (rawUrl: string) => {
    const url = toUrl(rawUrl, sourceUrl);
    if (!url) return;
    const full = url.toString().toLowerCase();

    // Booking first — a Calendly link can live on any host.
    if (BOOKING_SUBSTRINGS.some((s) => full.includes(s))) {
      const normalizedValue = full;
      const key = "BOOKING_URL|" + normalizedValue;
      if (!byKey.has(key)) {
        byKey.set(key, {
          channel: "BOOKING_URL",
          value: url.toString(),
          normalizedValue,
          role: "BOOKING",
          source: "SCRAPE_SOCIAL_META",
          confidence: CONF_PROFILE,
        });
      }
      return;
    }

    if (isExcludedPath(url.pathname)) return;

    for (const m of SOCIAL_MATCHERS) {
      if (!m.hosts.some((h) => hostMatches(url.host, h))) continue;
      // Require a non-empty path so the bare network homepage isn't captured.
      const hasPath = url.pathname.replace(/\/+$/, "").length > 0;
      if (!hasPath) return;
      const normalizedValue = canonicalizeUrl(url);
      const key = m.channel + "|" + normalizedValue;
      if (!byKey.has(key)) {
        byKey.set(key, {
          channel: m.channel,
          value: url.toString(),
          normalizedValue,
          role: m.role,
          source: "SCRAPE_SOCIAL_META",
          confidence: CONF_PROFILE,
        });
      }
      return;
    }
  };

  for (const m of html.matchAll(ANY_HREF_RE)) consider(m[1]);
  for (const m of html.matchAll(BARE_URL_RE)) consider(m[0]);

  return [...byKey.values()];
}

/** Canonical lower-cased URL: host www-stripped, no trailing slash, no fragment. */
function canonicalizeUrl(url: URL): string {
  const host = url.host.toLowerCase().replace(/^www\./, "");
  let path = url.pathname.replace(/\/+$/, "");
  if (path === "") path = "/";
  return ("https://" + host + path).toLowerCase();
}

// ─── Public entrypoint ────────────────────────────────────────────────────────

/**
 * Parse every contact point out of a rendered DOM. De-duped by
 * (channel, normalizedValue) — highest confidence wins. Order is
 * emails → phones → socials/booking, each in discovery order. Pure.
 */
export function parseContacts(input: ParseContactsInput): ParsedContact[] {
  const html = input.html ?? "";
  if (!html) return [];

  const all = [
    ...parseEmails(html),
    ...parsePhones(html),
    ...parseUrlContacts(html, input.sourceUrl ?? ""),
  ];

  const byKey = new Map<string, ParsedContact>();
  for (const c of all) {
    const key = c.channel + "|" + c.normalizedValue;
    const existing = byKey.get(key);
    if (!existing || c.confidence > existing.confidence) {
      byKey.set(key, c);
    }
  }
  return [...byKey.values()];
}

// ─── Internals ────────────────────────────────────────────────────────────────

/** Decode the handful of HTML entities that show up inside href values. */
function stripEntities(s: string): string {
  return s
    .replace(/&amp;/gi, "&")
    .replace(/&#0?38;/g, "&")
    .replace(/&#x26;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/gi, "'");
}

/** decodeURIComponent that never throws on a malformed mailto. */
function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(stripEntities(s));
  } catch {
    return stripEntities(s);
  }
}
