/**
 * Signature table for the deterministic, Wappalyzer-style tech
 * fingerprint (Phase 6 · "tech review").
 *
 * Every entry describes ONE technology and how to recognize it from a
 * website's OWN HTML/headers — no third-party API, no AI, no JS
 * execution. This rides the contacts page-fetch we already do ($0).
 *
 * Matching rules (see `fingerprint.ts`):
 *   - `patterns` are tested against the raw HTML body (case-insensitive
 *     via the regex's own `i` flag — declare it).
 *   - `headerPatterns` are tested against lowercased response header
 *     names + their values.
 *   - A signature fires if ANY of its patterns OR header patterns match.
 *   - `confidence` (0..1) is how sure we are when the signature fires.
 *     De-dup keeps the highest confidence per `name`.
 *
 * `TechCategory` is a LOCAL union mirroring the `BusinessTechCategory`
 * Prisma enum. We intentionally do NOT import the generated enum here so
 * this module stays pure (no Prisma client, no build coupling). Keep the
 * two in sync by hand.
 */

/** Local mirror of the `BusinessTechCategory` Prisma enum values. */
export type TechCategory =
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

/** A header-name + value pattern. Both are matched case-insensitively. */
export interface HeaderPattern {
  /** Header name, lowercase (e.g. "cf-ray", "x-served-by"). */
  header: string;
  /** Regex tested against the header's value. Use a match-anything
   *  regex (dot-star with the `i` flag) to match presence-of-header
   *  regardless of value. */
  pattern: RegExp;
}

/** One technology signature. */
export interface TechSignature {
  /** Display name · what the UI shows (e.g. "WordPress"). */
  name: string;
  /** Which BusinessTechCategory bucket this lands in. */
  category: TechCategory;
  /** HTML-body regexes. Any match fires the signature. */
  patterns: RegExp[];
  /** Optional response-header patterns. Any match fires the signature. */
  headerPatterns?: HeaderPattern[];
  /** 0..1 · confidence when the signature fires. */
  confidence: number;
}

/**
 * The signature table. Ordered loosely by category for readability;
 * order does not affect matching (every signature is evaluated).
 */
export const TECH_SIGNATURES: readonly TechSignature[] = [
  // ──────────────────────────────────────────────────────────────
  // CMS / site builders
  // ──────────────────────────────────────────────────────────────
  {
    name: "WordPress",
    category: "CMS",
    patterns: [
      /wp-content/i,
      /wp-json/i,
      /wp-includes/i,
      /<meta[^>]+name=["']generator["'][^>]+content=["']wordpress/i,
    ],
    confidence: 0.95,
  },
  {
    name: "Wix",
    category: "CMS",
    patterns: [/\bwix\.com\b/i, /_wixCssImports/i, /static\.wixstatic\.com/i],
    confidence: 0.95,
  },
  {
    name: "Squarespace",
    category: "CMS",
    patterns: [
      /squarespace\.com/i,
      /Static\.SQUARESPACE_CONTEXT/i,
      /squarespace-cdn\.com/i,
    ],
    confidence: 0.95,
  },
  {
    name: "Shopify",
    category: "CMS",
    patterns: [/cdn\.shopify\.com/i, /Shopify\.theme/i, /\bShopify\b/],
    confidence: 0.9,
  },
  {
    name: "Webflow",
    category: "CMS",
    patterns: [
      /\bwebflow\b/i,
      /class=["'][^"']*\bwf-/i,
      /data-wf-/i,
      /assets\.website-files\.com/i,
    ],
    confidence: 0.9,
  },
  {
    name: "GoDaddy Website Builder",
    category: "CMS",
    patterns: [
      /img\d*\.wsimg\.com/i,
      /godaddy\.com\/websites/i,
      /data-ux=["']/i, // GoDaddy O2 builder marker
    ],
    confidence: 0.85,
  },

  // ──────────────────────────────────────────────────────────────
  // Frameworks
  // ──────────────────────────────────────────────────────────────
  {
    name: "Next.js",
    category: "FRAMEWORK",
    patterns: [/__NEXT_DATA__/i, /\/_next\//i],
    confidence: 0.9,
  },
  {
    name: "React",
    category: "FRAMEWORK",
    patterns: [
      /data-reactroot/i,
      /react\.production\.min\.js/i,
      /__reactContainer/i,
    ],
    confidence: 0.7,
  },

  // ──────────────────────────────────────────────────────────────
  // CDN / security
  // ──────────────────────────────────────────────────────────────
  {
    name: "Cloudflare",
    category: "CDN",
    patterns: [/__cf\b/i, /cdn-cgi\//i, /\bcloudflare\b/i],
    headerPatterns: [
      { header: "cf-ray", pattern: /.*/ },
      { header: "server", pattern: /cloudflare/i },
    ],
    confidence: 0.9,
  },
  {
    name: "Akamai",
    category: "CDN",
    patterns: [/akamai/i],
    headerPatterns: [
      { header: "x-akamai-transformed", pattern: /.*/ },
      { header: "server", pattern: /akamai/i },
    ],
    confidence: 0.85,
  },
  {
    name: "Fastly",
    category: "CDN",
    patterns: [/fastly/i],
    headerPatterns: [
      { header: "x-served-by", pattern: /fastly/i },
      { header: "x-fastly-request-id", pattern: /.*/ },
    ],
    confidence: 0.85,
  },

  // ──────────────────────────────────────────────────────────────
  // Analytics
  // ──────────────────────────────────────────────────────────────
  {
    name: "Google Analytics 4",
    category: "ANALYTICS",
    patterns: [
      /gtag\/js/i,
      /\bG-[A-Z0-9]{6,}\b/,
      /googletagmanager\.com\/gtag/i,
    ],
    confidence: 0.9,
  },
  {
    name: "Google Tag Manager",
    category: "ANALYTICS",
    patterns: [/\bGTM-[A-Z0-9]{5,}\b/, /googletagmanager\.com\/gtm\.js/i],
    confidence: 0.9,
  },
  {
    name: "Plausible",
    category: "ANALYTICS",
    patterns: [
      /plausible\.io\/js/i,
      /data-domain=["'][^"']+["'][^>]*plausible/i,
    ],
    confidence: 0.9,
  },
  {
    name: "Hotjar",
    category: "ANALYTICS",
    patterns: [/static\.hotjar\.com/i, /\bhj\(/i, /\.hotjar\.com/i],
    confidence: 0.9,
  },
  {
    name: "Segment",
    category: "ANALYTICS",
    patterns: [/cdn\.segment\.com/i, /analytics\.load\(/i],
    confidence: 0.85,
  },

  // ──────────────────────────────────────────────────────────────
  // Advertising pixels
  // ──────────────────────────────────────────────────────────────
  {
    name: "Meta Pixel",
    category: "PIXEL",
    patterns: [/fbq\(/i, /fbevents\.js/i, /connect\.facebook\.net/i],
    confidence: 0.9,
  },
  {
    name: "TikTok Pixel",
    category: "PIXEL",
    patterns: [/\bttq\./i, /analytics\.tiktok\.com/i],
    confidence: 0.9,
  },

  // ──────────────────────────────────────────────────────────────
  // Booking / scheduling
  // ──────────────────────────────────────────────────────────────
  {
    name: "Calendly",
    category: "BOOKING",
    patterns: [/calendly\.com/i, /assets\.calendly\.com/i],
    confidence: 0.95,
  },
  {
    name: "Acuity Scheduling",
    category: "BOOKING",
    patterns: [/acuityscheduling\.com/i, /squarespace-scheduling\.com/i],
    confidence: 0.95,
  },
  {
    name: "Vagaro",
    category: "BOOKING",
    patterns: [/vagaro\.com/i, /\.vagaro\./i],
    confidence: 0.95,
  },
  {
    name: "Mindbody",
    category: "BOOKING",
    patterns: [/mindbodyonline\.com/i, /\bmindbody\b/i, /healcode/i],
    confidence: 0.95,
  },
  {
    name: "Boulevard",
    category: "BOOKING",
    patterns: [/joinblvd\.com/i, /\bjoinblvd\b/i, /blvd\.co\b/i],
    confidence: 0.95,
  },
  {
    name: "Square Appointments",
    category: "BOOKING",
    patterns: [
      /square\.site\/book/i,
      /squareup\.com\/appointments/i,
      /book\.squareup\.com/i,
    ],
    confidence: 0.9,
  },
  {
    name: "OpenTable",
    category: "BOOKING",
    patterns: [/opentable\.com/i, /\.opentable\./i],
    confidence: 0.95,
  },
  {
    name: "Resy",
    category: "BOOKING",
    patterns: [/resy\.com/i, /widgets\.resy\.com/i],
    confidence: 0.95,
  },
  // Expanded vendor coverage — these were false "no booking tool" before (the
  // signal only fires on a matched BOOKING row, so an unlisted vendor = missed).
  {
    name: "SimplyBook.me",
    category: "BOOKING",
    patterns: [/simplybook\.(me|it)/i, /widget\.simplybook/i],
    confidence: 0.95,
  },
  {
    name: "Setmore",
    category: "BOOKING",
    patterns: [/setmore\.com/i, /my\.setmore\.com/i],
    confidence: 0.95,
  },
  {
    name: "Booksy",
    category: "BOOKING",
    patterns: [/booksy\.com/i, /\bbooksy\b/i],
    confidence: 0.95,
  },
  {
    name: "Fresha",
    category: "BOOKING",
    patterns: [/fresha\.com/i, /\bfresha\b/i],
    confidence: 0.95,
  },
  {
    name: "Schedulicity",
    category: "BOOKING",
    patterns: [/schedulicity\.com/i],
    confidence: 0.95,
  },
  {
    name: "Zenoti",
    category: "BOOKING",
    patterns: [/zenoti\.com/i, /\bzenoti\b/i],
    confidence: 0.9,
  },
  {
    name: "GlossGenius",
    category: "BOOKING",
    patterns: [/glossgenius\.com/i],
    confidence: 0.95,
  },
  {
    name: "Jane",
    category: "BOOKING",
    patterns: [/jane\.app/i, /\bjaneapp\b/i],
    confidence: 0.95,
  },
  {
    name: "Tock",
    category: "BOOKING",
    patterns: [/exploretock\.com/i, /\btock\b.{0,12}reservation/i],
    confidence: 0.9,
  },
  {
    name: "SevenRooms",
    category: "BOOKING",
    patterns: [/sevenrooms\.com/i],
    confidence: 0.95,
  },
  {
    name: "Housecall Pro",
    category: "BOOKING",
    patterns: [/housecallpro\.com/i, /book\.housecallpro/i],
    confidence: 0.9,
  },
  {
    name: "DaySmart / AppointmentPlus",
    category: "BOOKING",
    patterns: [/daysmart\.com/i, /appointment-plus\.com/i, /apptplus/i],
    confidence: 0.9,
  },

  // ──────────────────────────────────────────────────────────────
  // Chat / CRM
  // ──────────────────────────────────────────────────────────────
  {
    name: "Intercom",
    category: "CHAT",
    patterns: [/widget\.intercom\.io/i, /\bIntercom\(/i, /intercomcdn\.com/i],
    confidence: 0.9,
  },
  {
    name: "Drift",
    category: "CHAT",
    patterns: [/js\.driftt\.com/i, /\bdrift\.load/i, /driftt\.com/i],
    confidence: 0.9,
  },
  {
    name: "tawk.to",
    category: "CHAT",
    patterns: [/embed\.tawk\.to/i, /\btawk\.to\b/i, /Tawk_API/i],
    confidence: 0.9,
  },
  {
    name: "HubSpot",
    category: "CHAT",
    patterns: [/js\.hs-scripts\.com/i, /js\.hsforms\.net/i, /\bhubspot\b/i],
    confidence: 0.85,
  },

  // ──────────────────────────────────────────────────────────────
  // Ecommerce
  // ──────────────────────────────────────────────────────────────
  {
    name: "WooCommerce",
    category: "ECOMMERCE",
    patterns: [
      /\bwoocommerce\b/i,
      /wc-ajax/i,
      /wp-content\/plugins\/woocommerce/i,
    ],
    confidence: 0.9,
  },

  // ──────────────────────────────────────────────────────────────
  // Consent management
  // ──────────────────────────────────────────────────────────────
  {
    name: "OneTrust",
    category: "CONSENT",
    patterns: [/cdn\.cookielaw\.org/i, /\bonetrust\b/i, /optanon/i],
    confidence: 0.9,
  },
  {
    name: "Cookiebot",
    category: "CONSENT",
    patterns: [/consent\.cookiebot\.com/i, /\bcookiebot\b/i],
    confidence: 0.9,
  },
];
