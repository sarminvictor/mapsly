/**
 * Contact extractors · Phase 4 (Contacts + reachability gate)
 *
 * PURE functions over an HTML string — no network, no DOM, no Prisma. These
 * power the contact-scan cron (parses a fetched homepage / contact page) and
 * are 100%-unit-tested because a missed email/phone = a business that looks
 * "unreachable" and silently drops out of every enrichment list.
 *
 * The three primitives:
 *   - extractEmails(html)   → mailto: hrefs (high confidence) + plaintext regex
 *   - extractPhones(html)   → tel: hrefs (high confidence) + US phone regex
 *   - extractSocials(html)  → recognised social profile URLs (host + path)
 *
 * and the unified roll-up:
 *   - extractContactsFromHtml(html, baseUrl?) → de-duped ExtractedContact[]
 *
 * Local string-literal unions mirror the Prisma enums (ContactChannel,
 * ContactSource) deliberately — this module stays pure and import-free so the
 * generated Prisma client is never pulled into a unit test. Keep these in
 * lockstep with prisma/schema.prisma when the enums change.
 *
 * Confidence (0–100) heuristic:
 *   - 95  href-derived (mailto:/tel:) — the site explicitly published it
 *   - 90  recognised social profile URL
 *   - 60  plaintext regex match (could be a customer, a vendor, noise)
 *
 * See:
 *   - .claude/rules/conventions.md — naming, @/ alias, strict TS
 *   - .claude/rules/testing.md §"Signal scoring" — 100% formula coverage
 *   - modules/contacts/reachability.ts — consumes the channel mix
 */

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

/** Mirror of Prisma `ContactSource` (the extraction provenance). */
export type ContactSource =
  | "SCRAPE_MAILTO"
  | "SCRAPE_TEL"
  | "SCRAPE_SOCIAL_META"
  | "SCRAPE_JSONLD"
  | "SCRAPE_HOMEPAGE"
  | "DFS_LISTING";

/**
 * One extracted contact point. `value` is the raw form as published (for
 * display / audit); `normalizedValue` is the canonical form used for de-dupe,
 * storage, and the reachability gate. They differ for emails (case) and
 * phones (E.164) but are usually identical for social URLs.
 */
export interface ExtractedContact {
  readonly channel: ContactChannel;
  readonly value: string;
  readonly normalizedValue: string;
  readonly source: ContactSource;
  /** 0–100. Higher = more likely the business's own contact point. */
  readonly confidence: number;
}

// ─── Confidence constants ─────────────────────────────────────────────────────

const CONF_HREF = 95;
const CONF_SOCIAL = 90;
const CONF_PLAINTEXT = 60;

// ─── Shared regexes ───────────────────────────────────────────────────────────

/** href="mailto:..." — captures the address (optionally with ?subject= etc). */
const MAILTO_HREF_RE = /href\s*=\s*["']\s*mailto:([^"'?>]+)/gi;

/** href="tel:..." — captures the number portion. */
const TEL_HREF_RE = /href\s*=\s*["']\s*tel:([^"'>]+)/gi;

/**
 * Plaintext email. Intentionally conservative — we drop junk separately. The
 * TLD must be 2+ alpha chars so "foo@bar.1" doesn't slip through.
 */
const PLAINTEXT_EMAIL_RE =
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/**
 * US/CA phone. Tolerates +1, parens, spaces, dots, dashes. We post-validate
 * the digit count in `normalizePhone` so a bogus 4-digit run is rejected.
 */
const PLAINTEXT_PHONE_RE =
  /(?:\+?1[\s.\-]?)?\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}\b/g;

/** Any href="..." or href='...' — used to harvest candidate social URLs. */
const ANY_HREF_RE = /href\s*=\s*["']([^"']+)["']/gi;

/** Bare URLs in text (no href) — catches profile links printed in body copy. */
const BARE_URL_RE = /https?:\/\/[^\s"'<>)\]]+/gi;

// ─── Email extraction ─────────────────────────────────────────────────────────

/**
 * Domains / patterns that are never the business's real inbox. Anything whose
 * domain ends with one of these (or whose local part is a tracking pixel) is
 * dropped before it ever reaches the contact list.
 */
const JUNK_EMAIL_DOMAINS = [
  "sentry.io",
  "sentry-cdn.com",
  "example.com",
  "example.org",
  "example.net",
  "domain.com",
  "yourdomain.com",
  "email.com",
  "sentry.wixpress.com",
  "wix.com",
  "schema.org",
  "w3.org",
  "googleapis.com",
  "gstatic.com",
];

/**
 * Local-part / value substrings that mark an address as machine noise rather
 * than a human inbox: image sprites encoded as "x@2x.png", CSS data, etc.
 */
function isJunkEmail(email: string): boolean {
  const lower = email.toLowerCase();
  // Image / asset artefacts: "logo@2x.png", "sprite.png@..." etc.
  if (/\.(png|jpe?g|gif|svg|webp|css|js|woff2?)\b/.test(lower)) return true;
  if (/@\d+x\b/.test(lower)) return true; // "@2x", "@3x" retina markers
  const domain = lower.split("@")[1] ?? "";
  if (!domain) return true;
  if (JUNK_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith("." + d)))
    return true;
  // sentry/example local-or-host markers commonly embedded in templates.
  if (domain.startsWith("sentry.") || domain.includes(".sentry.")) return true;
  return false;
}

/** Lower-case + trim an email for canonical comparison/storage. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Extract emails from an HTML string. mailto: hrefs are high-confidence;
 * plaintext matches are lower-confidence. Junk (sentry, example.com, image
 * artefacts) is dropped. De-duped by normalized value with the highest
 * confidence + most specific source winning.
 */
export function extractEmails(html: string): ExtractedContact[] {
  if (!html) return [];
  const byNorm = new Map<string, ExtractedContact>();

  const add = (raw: string, source: ContactSource, confidence: number) => {
    const value = raw.trim();
    if (!value) return;
    if (isJunkEmail(value)) return;
    const normalizedValue = normalizeEmail(value);
    if (!normalizedValue.includes("@")) return;
    if (isJunkEmail(normalizedValue)) return;
    const existing = byNorm.get(normalizedValue);
    if (existing && existing.confidence >= confidence) return;
    byNorm.set(normalizedValue, {
      channel: "EMAIL",
      value,
      normalizedValue,
      source,
      confidence,
    });
  };

  for (const m of html.matchAll(MAILTO_HREF_RE)) {
    add(decodeURIComponent(stripEntities(m[1])), "SCRAPE_MAILTO", CONF_HREF);
  }
  for (const m of html.matchAll(PLAINTEXT_EMAIL_RE)) {
    add(m[0], "SCRAPE_HOMEPAGE", CONF_PLAINTEXT);
  }

  return [...byNorm.values()];
}

// ─── Phone extraction ─────────────────────────────────────────────────────────

/**
 * Normalize a phone to E.164-ish for US/CA: "+1XXXXXXXXXX". Returns null when
 * the digit run can't be a valid NANP number (not 10 digits, or 11 starting
 * with 1). Keeps the gate honest — a "123-45" snippet must not count.
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  return null;
}

/**
 * Extract phones from an HTML string. tel: hrefs are high-confidence;
 * plaintext NANP matches are lower-confidence. De-duped by E.164 value.
 */
export function extractPhones(html: string): ExtractedContact[] {
  if (!html) return [];
  const byNorm = new Map<string, ExtractedContact>();

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

// ─── Social extraction ────────────────────────────────────────────────────────

/**
 * Path segments that mean "this is a share / intent link, not a profile".
 * Excluded so a "Share on Facebook" button never gets stored as the
 * business's own Facebook page.
 */
const SOCIAL_EXCLUDE_PATH = [
  "sharer",
  "share",
  "share.php",
  "intent",
  "intent/tweet",
  "dialog",
  "plugins",
  "widgets",
  "oembed",
  "tr", // facebook tracking pixel /tr
  "login",
  "signup",
  "home",
  "watch", // youtube video, not a channel
];

interface SocialMatcher {
  readonly channel: ContactChannel;
  /** Host suffixes that identify the network (matched against URL host). */
  readonly hosts: readonly string[];
  /** Returns true when the path looks like an actual profile/page. */
  readonly isProfile: (pathname: string) => boolean;
}

const SOCIAL_MATCHERS: readonly SocialMatcher[] = [
  {
    channel: "FACEBOOK",
    hosts: ["facebook.com", "fb.com", "fb.me", "m.facebook.com"],
    isProfile: (p) => {
      const seg = firstSeg(p);
      if (!seg) return false;
      if (seg === "profile.php") return true; // /profile.php?id=...
      if (seg === "pages" || seg === "people") return true;
      return isPlainHandle(seg);
    },
  },
  {
    channel: "INSTAGRAM",
    hosts: ["instagram.com", "instagr.am"],
    isProfile: (p) => {
      const seg = firstSeg(p);
      return !!seg && isPlainHandle(seg.replace(/^@/, ""));
    },
  },
  {
    channel: "LINKEDIN",
    hosts: ["linkedin.com"],
    isProfile: (p) => {
      const seg = firstSeg(p);
      return seg === "company" || seg === "in" || seg === "school";
    },
  },
  {
    channel: "TIKTOK",
    hosts: ["tiktok.com"],
    isProfile: (p) => {
      const seg = firstSeg(p);
      return !!seg && seg.startsWith("@") && seg.length > 1;
    },
  },
  {
    channel: "YOUTUBE",
    hosts: ["youtube.com", "youtu.be"],
    isProfile: (p) => {
      const seg = firstSeg(p);
      if (!seg) return false;
      if (seg.startsWith("@") && seg.length > 1) return true;
      return seg === "channel" || seg === "c" || seg === "user";
    },
  },
  {
    channel: "X",
    hosts: ["x.com", "twitter.com", "mobile.twitter.com"],
    isProfile: (p) => {
      const seg = firstSeg(p);
      return !!seg && isPlainHandle(seg);
    },
  },
  {
    channel: "YELP",
    hosts: ["yelp.com", "yelp.ca"],
    isProfile: (p) => firstSeg(p) === "biz",
  },
  {
    channel: "WHATSAPP",
    hosts: ["wa.me", "api.whatsapp.com", "whatsapp.com"],
    isProfile: (p) => {
      const seg = firstSeg(p);
      // wa.me/15551234567  OR  api.whatsapp.com/send?phone=...
      if (!seg) return false;
      if (/^\+?\d{6,}$/.test(seg)) return true;
      return seg === "send";
    },
  },
];

/** First non-empty path segment, lower-cased (preserving a leading "@"). */
function firstSeg(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  return parts[0].toLowerCase();
}

/** A "plain handle" is alnum/._- with no reserved keyword and not a file. */
function isPlainHandle(seg: string): boolean {
  if (!seg) return false;
  if (SOCIAL_EXCLUDE_PATH.includes(seg)) return false;
  if (/\.(php|html?|aspx?|png|jpe?g|gif|svg|css|js)$/.test(seg)) return false;
  return /^[A-Za-z0-9._\-]{1,40}$/.test(seg);
}

/** True when ANY path segment is a known share/intent keyword. */
function isExcludedSocialPath(pathname: string): boolean {
  const segs = pathname
    .split("/")
    .filter(Boolean)
    .map((s) => s.toLowerCase());
  return segs.some((s) => SOCIAL_EXCLUDE_PATH.includes(s));
}

/** Strip "www." / "m." etc. leaving the registrable-ish host for matching. */
function hostMatches(host: string, suffix: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return h === suffix || h.endsWith("." + suffix);
}

/** Resolve a possibly-relative URL against an optional base; null if unusable. */
function toUrl(raw: string, baseUrl?: string): URL | null {
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

/**
 * Extract recognised social-profile URLs from an HTML string. Pulls from both
 * href="" attributes and bare URLs in body text. Share / intent / widget
 * links are excluded. De-duped by (channel, canonical URL).
 */
export function extractSocials(
  html: string,
  baseUrl?: string,
): ExtractedContact[] {
  if (!html) return [];
  const byKey = new Map<string, ExtractedContact>();

  const consider = (rawUrl: string) => {
    const c = classifySocialUrl(
      rawUrl,
      baseUrl,
      "SCRAPE_SOCIAL_META",
      CONF_SOCIAL,
    );
    if (!c) return;
    const key = c.channel + "|" + c.normalizedValue;
    if (!byKey.has(key)) byKey.set(key, c);
  };

  for (const m of html.matchAll(ANY_HREF_RE)) consider(m[1]);
  for (const m of html.matchAll(BARE_URL_RE)) consider(m[0]);

  return [...byKey.values()];
}

/**
 * Classify a single raw URL as a social-profile contact, or null if it isn't a
 * recognised profile (share/intent/widget links are excluded). Shared by
 * extractSocials (href + bare-URL harvest) and extractJsonLd (sameAs[]), with
 * the source + confidence varying by where the URL came from.
 */
function classifySocialUrl(
  rawUrl: string,
  baseUrl: string | undefined,
  source: ContactSource,
  confidence: number,
): ExtractedContact | null {
  const url = toUrl(rawUrl, baseUrl);
  if (!url) return null;
  if (isExcludedSocialPath(url.pathname)) return null;
  for (const m of SOCIAL_MATCHERS) {
    if (!m.hosts.some((h) => hostMatches(url.host, h))) continue;
    if (!m.isProfile(url.pathname)) continue;
    return {
      channel: m.channel,
      value: url.toString(),
      normalizedValue: canonicalizeSocialUrl(m.channel, url),
      source,
      confidence,
    };
  }
  return null;
}

// ─── JSON-LD structured-data extraction ───────────────────────────────────────

/** <script type="application/ld+json"> … </script> blocks (schema.org markup). */
const JSONLD_RE =
  /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** JSON-LD is structured + author-published → higher confidence than plaintext,
 *  just below an explicit mailto:/tel: href. */
const CONF_JSONLD = 90;

/**
 * Extract contacts from schema.org JSON-LD blocks. Walks every parsed object
 * for `email`, `telephone`/`phone`, and `sameAs` (social profile URLs), incl.
 * nested `contactPoint` / `@graph` / `address` shapes. Malformed JSON is skipped
 * (a broken block must never throw). De-duped within this pass; the unified
 * roll-up dedupes across passes by (channel, normalizedValue, highest confidence).
 */
export function extractJsonLd(
  html: string,
  baseUrl?: string,
): ExtractedContact[] {
  if (!html) return [];
  const out: ExtractedContact[] = [];
  const seen = new Set<string>();

  const pushEmail = (raw: string) => {
    const value = stripEntities(raw.replace(/^mailto:/i, "")).trim();
    if (!value || isJunkEmail(value)) return;
    const normalizedValue = normalizeEmail(value);
    if (!normalizedValue.includes("@") || isJunkEmail(normalizedValue)) return;
    const key = "EMAIL|" + normalizedValue;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      channel: "EMAIL",
      value,
      normalizedValue,
      source: "SCRAPE_JSONLD",
      confidence: CONF_JSONLD,
    });
  };
  const pushPhone = (raw: string) => {
    const value = stripEntities(raw).trim();
    const normalizedValue = normalizePhone(value);
    if (!normalizedValue) return;
    const key = "PHONE|" + normalizedValue;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      channel: "PHONE",
      value,
      normalizedValue,
      source: "SCRAPE_JSONLD",
      confidence: CONF_JSONLD,
    });
  };
  const pushSocial = (raw: string) => {
    const c = classifySocialUrl(raw, baseUrl, "SCRAPE_JSONLD", CONF_JSONLD);
    if (!c) return;
    const key = c.channel + "|" + c.normalizedValue;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };

  const walk = (node: unknown): void => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    if (typeof node !== "object") return;
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const key = k.toLowerCase();
      if (key === "email" && typeof v === "string") pushEmail(v);
      else if (
        (key === "telephone" || key === "phone") &&
        (typeof v === "string" || typeof v === "number")
      )
        pushPhone(String(v));
      else if (key === "sameas") {
        if (typeof v === "string") pushSocial(v);
        else if (Array.isArray(v))
          for (const u of v) if (typeof u === "string") pushSocial(u);
      } else {
        walk(v); // recurse into nested contactPoint / @graph / address / …
      }
    }
  };

  for (const m of html.matchAll(JSONLD_RE)) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      walk(JSON.parse(raw));
    } catch {
      // Malformed JSON-LD — skip silently (never throw on a broken block).
    }
  }

  return out;
}

/**
 * Canonical form of a social URL: scheme+host (www-stripped) + path, no query
 * (except WhatsApp's phone / Facebook's profile.php?id which carry identity),
 * no trailing slash, lower-cased host. Keeps de-dupe stable across http/https,
 * www, and trailing-slash variants.
 */
function canonicalizeSocialUrl(channel: ContactChannel, url: URL): string {
  const host = url.host.toLowerCase().replace(/^www\./, "");
  let path = url.pathname.replace(/\/+$/, "");
  if (path === "") path = "/";

  // Identity-bearing query params we must keep.
  let query = "";
  if (channel === "WHATSAPP") {
    const phone = url.searchParams.get("phone");
    if (phone) query = "?phone=" + phone.replace(/[^\d]/g, "");
  } else if (channel === "FACEBOOK" && /profile\.php$/i.test(path)) {
    const id = url.searchParams.get("id");
    if (id) query = "?id=" + id;
  }

  return "https://" + host + path.toLowerCase() + query;
}

// ─── Unified roll-up ──────────────────────────────────────────────────────────

/**
 * Extract every contact point from an HTML string into one de-duped list.
 * De-dupe key is (channel, normalizedValue); on collision the highest
 * confidence wins (href beats plaintext). Order is emails → phones → socials,
 * each in discovery order.
 */
export function extractContactsFromHtml(
  html: string,
  baseUrl?: string,
): ExtractedContact[] {
  const all = [
    ...extractEmails(html),
    ...extractPhones(html),
    ...extractSocials(html, baseUrl),
    ...extractJsonLd(html, baseUrl),
  ];

  const byKey = new Map<string, ExtractedContact>();
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
