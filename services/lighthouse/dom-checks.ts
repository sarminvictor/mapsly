// services/lighthouse/dom-checks.ts · pure parsers over raw HTML.
//
// Mapsly enriches the DataForSEO Lighthouse audit with a handful of
// business-relevant DOM facts that Lighthouse itself doesn't surface:
//
//   - hasLocalBusinessSchema · is there a JSON-LD `LocalBusiness` (or a
//     subtype like MedicalBusiness, Restaurant, AutoBodyShop) on the page?
//   - hasFaqSchema · is there a JSON-LD `FAQPage` on the page? Eligible
//     for rich-snippet rendering on Google.
//   - hasPhoneAboveFold · does the visible top of the page contain a
//     phone number a patient/customer can call?
//   - hasBookingCtaAboveFold · does the visible top of the page contain a
//     book/reserve/schedule call-to-action?
//   - napConsistent · does the page mention the canonical Name, Address,
//     and Phone we have on file? Mismatched NAP across web properties is
//     a documented local-SEO drag (Google's local pack uses NAP as a
//     dedup signal).
//
// Why this is a pure module: every public function takes HTML (a string)
// and returns a boolean. No fetch, no DOM library, no side effects. The
// downstream composer in `audit.ts` is the only thing that performs the
// network fetch and binds these checks together. This separation makes
// every check trivially unit-testable with hand-rolled HTML fixtures.
//
// Why regex over a real DOM library: we explicitly avoid adding cheerio,
// linkedom, jsdom, or node-html-parser. The DOM checks we need are small
// surface-area string searches; pulling in a 50-200 KB HTML parser for
// five regex checks is not worth the bundle / cold-start / supply-chain
// tax. The cost of imprecise regex on adversarial HTML is acceptable
// because:
//   1. We control the cron schedule, not the page content; we can audit
//      mis-parses later from raw HTML stored in BusinessSnapshot.
//   2. JSON-LD scripts have a stable, well-known shape (top-level @type)
//      that survives even minified HTML.
//   3. Phone numbers + CTAs use plain-text patterns; nothing fancy.
//
// Above-the-fold heuristic: the first ~6 KB of the body (after the
// closing </head>) is what an average mobile viewport renders before
// any scroll. Lighthouse's own "above the fold" definition is the
// initial viewport at audit-time; a 6 KB body slice is a defensible
// static proxy that doesn't require a headless browser.

/** Approx bytes of body HTML we treat as "above the fold" for static
 *  parsing. Tuned for mobile portrait (~360x640 viewport renders ~6KB
 *  of typical responsive HTML). */
export const ABOVE_FOLD_BYTES = 6_000;

/** Known schema.org LocalBusiness subtypes Mapsly surfaces in the local
 *  business universe. Keep alphabetized; add when a new vertical lands. */
export const LOCAL_BUSINESS_TYPES = new Set([
  "AnimalShelter",
  "ArchiveOrganization",
  "AutoBodyShop",
  "AutoDealer",
  "AutomotiveBusiness",
  "AutoPartsStore",
  "AutoRental",
  "AutoRepair",
  "AutoWash",
  "BarOrPub",
  "BeautySalon",
  "Brewery",
  "CafeOrCoffeeShop",
  "ChildCare",
  "Dentist",
  "DryCleaningOrLaundry",
  "EmploymentAgency",
  "EntertainmentBusiness",
  "FastFoodRestaurant",
  "FinancialService",
  "FoodEstablishment",
  "GeneralContractor",
  "GovernmentOffice",
  "HairSalon",
  "HealthAndBeautyBusiness",
  "Hospital",
  "HomeAndConstructionBusiness",
  "HousePainter",
  "HVACBusiness",
  "InsuranceAgency",
  "LegalService",
  "Library",
  "LocalBusiness",
  "Locksmith",
  "LodgingBusiness",
  "MedicalBusiness",
  "MedicalClinic",
  "MovingCompany",
  "NailSalon",
  "Notary",
  "Optician",
  "Physician",
  "Plumber",
  "PoliceStation",
  "PostOffice",
  "ProfessionalService",
  "RealEstateAgent",
  "Restaurant",
  "RoofingContractor",
  "Store",
  "TattooParlor",
  "Veterinary",
]);

/** Booking / appointment CTA verbs. Lowercase, matched as whole-word. */
export const BOOKING_CTA_VERBS = [
  "book now",
  "book a",
  "book an",
  "book your",
  "book online",
  "book appointment",
  "reserve now",
  "reserve a",
  "reserve your",
  "schedule now",
  "schedule a",
  "schedule an",
  "schedule online",
  "schedule appointment",
  "schedule consultation",
  "schedule your",
  "request appointment",
  "request consultation",
  "request a quote",
  "request quote",
  "make an appointment",
  "make appointment",
  "get a quote",
  "get an estimate",
  "get started",
  "start booking",
];

// ---- Helpers ------------------------------------------------------------

/** Slice of the HTML that approximates the above-the-fold portion. We
 *  start from the first `<body` tag (or position 0 if absent) and take
 *  up to ABOVE_FOLD_BYTES code units. */
export function aboveFoldSlice(
  html: string,
  bytes: number = ABOVE_FOLD_BYTES,
): string {
  const bodyOpen = html.search(/<body\b/i);
  const start = bodyOpen >= 0 ? bodyOpen : 0;
  return html.slice(start, start + bytes);
}

/** Strip HTML tags and decode the handful of entities that materially
 *  affect substring search. We don't aim for a full entity decoder —
 *  &amp; &nbsp; &#x20; cover ~95% of business pages. */
export function stripTags(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract every JSON-LD payload from a page. Returns parsed objects
 *  (arrays expanded), skipping anything that doesn't parse cleanly. */
export function extractJsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  // <script type="application/ld+json" ...>...</script> — type attr can
  // be in any position, optionally quoted, optionally followed by more
  // attrs (e.g. nonce). [\s\S]*? for the body so '.' matches newlines.
  const re =
    /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const x of parsed) out.push(x);
      } else {
        out.push(parsed);
      }
    } catch {
      // Malformed JSON in a content script — silently skip. A future
      // hardening pass can attempt a permissive parser; for now the
      // common case (well-formed schema markup from a CMS plugin) wins.
    }
  }
  return out;
}

/** Recursively collect every `@type` value from a parsed JSON-LD blob.
 *  Schema.org allows @type to be a string OR an array of strings; nested
 *  @graph blocks are flattened too. */
export function collectJsonLdTypes(node: unknown): string[] {
  const out: string[] = [];
  if (Array.isArray(node)) {
    for (const x of node) out.push(...collectJsonLdTypes(x));
    return out;
  }
  if (node && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const t = obj["@type"];
    if (typeof t === "string") out.push(t);
    if (Array.isArray(t)) {
      for (const v of t) if (typeof v === "string") out.push(v);
    }
    const graph = obj["@graph"];
    if (graph !== undefined) out.push(...collectJsonLdTypes(graph));
    // Schema.org sub-entities can carry their own @type — for example
    // a LocalBusiness whose address is a PostalAddress. Walk all values
    // so the LocalBusiness check covers schema-graph layouts as well.
    for (const k of Object.keys(obj)) {
      if (k === "@type" || k === "@graph") continue;
      const v = obj[k];
      if (v && typeof v === "object") out.push(...collectJsonLdTypes(v));
    }
  }
  return out;
}

// ---- Public checks ------------------------------------------------------

/** True if the page declares a JSON-LD LocalBusiness or any documented
 *  subtype. */
export function hasLocalBusinessSchema(html: string): boolean {
  const blocks = extractJsonLdBlocks(html);
  for (const block of blocks) {
    const types = collectJsonLdTypes(block);
    for (const t of types) {
      if (LOCAL_BUSINESS_TYPES.has(t)) return true;
    }
  }
  return false;
}

/** True if the page declares a JSON-LD FAQPage entity. */
export function hasFaqSchema(html: string): boolean {
  const blocks = extractJsonLdBlocks(html);
  for (const block of blocks) {
    const types = collectJsonLdTypes(block);
    if (types.includes("FAQPage")) return true;
  }
  return false;
}

/** Pull every plausible US/CA phone number from a string. Returns a set
 *  of digit-only canonical forms (10 or 11 digits, leading 1 dropped). */
export function extractPhoneNumbers(text: string): Set<string> {
  // Match runs of digits, spaces, dashes, parens, dots, and plus that
  // look like phone numbers — at least 10 digits total once stripped.
  const candidates = new Set<string>();
  // tel: hrefs are unambiguous, prioritize them.
  const telRe = /tel:\+?[\d\-().\s]+/gi;
  let m: RegExpExecArray | null;
  while ((m = telRe.exec(text)) !== null) {
    const digits = m[0].replace(/[^\d]/g, "");
    if (digits.length >= 10) candidates.add(normalizePhone(digits));
  }
  // Generic NA pattern: (305) 555-0100, 305-555-0100, 305.555.0100,
  // +1 305 555 0100, 305 555 0100.
  const re =
    /(?<![\d-])(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
  while ((m = re.exec(text)) !== null) {
    const digits = m[0].replace(/[^\d]/g, "");
    if (digits.length >= 10) candidates.add(normalizePhone(digits));
  }
  return candidates;
}

/** Normalize a digit-only string to its canonical 10-digit form, dropping
 *  a leading "1" if present. Returns the input unchanged if it's not a
 *  US/CA-shaped number. */
export function normalizePhone(digits: string): string {
  const onlyDigits = digits.replace(/[^\d]/g, "");
  if (onlyDigits.length === 11 && onlyDigits.startsWith("1")) {
    return onlyDigits.slice(1);
  }
  return onlyDigits;
}

/** True if the above-the-fold slice of the page contains any phone
 *  number (tel: link, formatted, or plain). */
export function hasPhoneAboveFold(html: string): boolean {
  const slice = aboveFoldSlice(html);
  const text = stripTags(slice);
  // Cheap pre-check before the heavier regex: must have at least 10
  // digits in the above-fold slice. Saves regex backtracking on
  // long boilerplate intros that contain no phone.
  const digitCount = (text.match(/\d/g) ?? []).length;
  if (digitCount < 10) {
    // Still might be a tel: href without visible digits — check the
    // raw HTML slice for tel: links.
    return /tel:\+?[\d\-().\s]/i.test(slice);
  }
  return extractPhoneNumbers(text).size > 0 || /tel:/i.test(slice);
}

/** True if the above-the-fold slice contains a recognized booking CTA. */
export function hasBookingCtaAboveFold(html: string): boolean {
  const text = stripTags(aboveFoldSlice(html)).toLowerCase();
  for (const verb of BOOKING_CTA_VERBS) {
    if (text.includes(verb)) return true;
  }
  return false;
}

/**
 * NAP consistency check. All three of name + address (street portion) +
 * phone must appear somewhere in the rendered text of the page. We
 * compare on normalized forms:
 *   - name + address: lowercased, punctuation stripped, whitespace
 *     collapsed. We then check substring presence — exact equality is
 *     too strict because pages routinely abbreviate ("Street" → "St.")
 *     or add the city to the address line.
 *   - phone: digit-only canonical form (US/CA 10-digit).
 *
 * Returns null if any of the three reference values are missing — the
 * caller should treat null as "indeterminate" rather than false.
 */
export interface NapInput {
  name: string;
  /** Free-form address line — either the full mailing address or the
   *  street + city. We tokenize on commas + whitespace and require
   *  the longest tokenized chunk to appear in the page. */
  address: string;
  /** Phone number in any format (digits, parens, dashes). */
  phone: string;
}

export function napConsistent(html: string, nap: NapInput): boolean | null {
  if (!nap.name?.trim() || !nap.address?.trim() || !nap.phone?.trim()) {
    return null;
  }
  const text = stripTags(html).toLowerCase();
  // Name match: substring on normalized form.
  const name = normalizeText(nap.name);
  if (!name) return null;
  const nameMatches = text.includes(name);
  // Address match: the longest "chunk" of the address (split on commas)
  // must appear. This survives common abbreviations on the page.
  const addressChunks = nap.address
    .split(",")
    .map((s) => normalizeText(s))
    .filter((s) => s.length >= 4)
    .sort((a, b) => b.length - a.length);
  const addressMatches = addressChunks.some((chunk) => text.includes(chunk));
  // Phone match: digit canonicalization on both sides.
  const canonicalPhone = normalizePhone(nap.phone);
  const phoneMatches =
    canonicalPhone.length >= 10 &&
    extractPhoneNumbers(stripTags(html) + " " + html).has(canonicalPhone);
  return nameMatches && addressMatches && phoneMatches;
}

/** Lowercase, remove non-alphanumeric runs to single spaces, trim. */
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the raw (pre-JS) HTML carries real body content — a crawler that
 * doesn't run JavaScript still sees the page. False = JS-only shell (e.g. an
 * empty `<div id="root">` + scripts), which is a Google-indexing risk.
 *
 * Heuristic: take the <body>, drop script/style/noscript bodies + all tags +
 * entities, and count the visible text. SPA shells have almost none; a
 * server-rendered page has hundreds-plus. Conservative threshold avoids
 * false alarms on thin-but-real pages.
 */
export const MIN_SERVER_TEXT_CHARS = 250;
export function contentWithoutJs(html: string): boolean {
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch?.[1] ?? html;
  const text = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length >= MIN_SERVER_TEXT_CHARS;
}

// ---- Combined surface ---------------------------------------------------

export interface DomChecksInput {
  /** Raw HTML response body. */
  html: string;
  /** Optional canonical NAP — when provided enables napConsistent. */
  nap?: Partial<NapInput>;
}

export interface DomChecksResult {
  hasLocalBusinessSchema: boolean;
  hasFaqSchema: boolean;
  hasPhoneAboveFold: boolean;
  hasBookingCtaAboveFold: boolean;
  /** null when NAP input incomplete (cannot decide). */
  napConsistent: boolean | null;
  /** True when the page's content is in the raw HTML (crawler-readable
   *  without JS). False = JS-only shell (indexing risk). */
  contentWithoutJs: boolean;
}

/** Run every DOM check on a single HTML payload. Each check is independent
 *  so failures in one (e.g. malformed JSON-LD) never poison the rest. */
export function runDomChecks(input: DomChecksInput): DomChecksResult {
  const { html, nap } = input;
  const napFull: NapInput | null =
    nap && nap.name && nap.address && nap.phone
      ? { name: nap.name, address: nap.address, phone: nap.phone }
      : null;
  return {
    hasLocalBusinessSchema: hasLocalBusinessSchema(html),
    hasFaqSchema: hasFaqSchema(html),
    hasPhoneAboveFold: hasPhoneAboveFold(html),
    hasBookingCtaAboveFold: hasBookingCtaAboveFold(html),
    napConsistent: napFull ? napConsistent(html, napFull) : null,
    contentWithoutJs: contentWithoutJs(html),
  };
}
