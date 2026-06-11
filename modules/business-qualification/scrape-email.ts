/**
 * Email scraper · multi-path DOM scrape to surface contact emails.
 *
 * Strategy (per the brainstorm with Viktor):
 *
 *   1. Fetch homepage + 6 common contact paths in parallel
 *   2. For each HTML response, extract emails from:
 *        a. `<a href="mailto:...">` (highest-confidence)
 *        b. plain-text regex (homepage footer often has it as text)
 *   3. Dedup + score every candidate
 *   4. Return ranked list — caller picks the top one as `emailDiscovered`
 *
 * Per `.claude/rules/scalability.md` we cap concurrent fetches at 5
 * (handled by the caller) and use a polite User-Agent so site owners
 * can identify our crawl.
 *
 * No external dependencies — vanilla fetch + regex. JS-rendered sites
 * (Squarespace, some Wix templates) won't yield results; that's a
 * known limitation and the RDAP fallback covers many of those cases.
 */

import { decodeHtmlEntities } from "@/lib/text/html-entities";

const USER_AGENT =
  "Mozilla/5.0 (compatible; MapslyBot/0.1; +https://mapsly.ai/bot · sarminvictor@gmail.com)";

/**
 * Fallback UA for the rescue pass. Some WAFs (Cloudflare bot-fight,
 * Sucuri, GoDaddy firewall) hard-block anything self-identifying as a
 * bot. We always try the polite UA first; only when the ENTIRE site
 * yielded nothing do we retry the 3 highest-value pages presenting as
 * a regular browser — one-off contact discovery, not a crawl.
 */
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 6_000;

/**
 * Max concurrent requests PER HOST. Squarespace/Wix/Cloudflare WAFs
 * tag any host hit with >10 parallel requests from one IP as bot
 * traffic and drop connections. 6 in-flight is safe for ~every SMB
 * site we've tested. Wall-clock per business: ceil(30 paths / 6) ×
 * 6s = ~30s worst case, ~2–4s typical (when fast paths return early).
 */
const PER_HOST_CONCURRENCY = 6;

/**
 * Pages we probe in parallel after the homepage. Each fetch runs with
 * an independent 7s timeout, so the slowest path bounds wall-clock —
 * adding more paths doesn't slow a single scrape down meaningfully.
 *
 * Paths are bucketed into 4 source tags so the candidate scorer can
 * weight where the email came from (CONTACT > ABOUT > TEAM > BOOKING).
 * Within a tag, the order is hit-rate-prior — common paths first so
 * future early-stopping logic can prefer them.
 *
 * Coverage strategy: cover the 3 SMB site templates we see most:
 *   - WordPress / Squarespace / Wix      (canonical /contact, /about)
 *   - GoDaddy / Weebly legacy            (.html suffixes, /aboutus run-together)
 *   - Med-spa / clinic specific          (/providers, /doctors, /consultation)
 *
 * Total: ~30 paths. Wall-clock per business still ~7s (parallel).
 * Bandwidth ≈ 30 fetches, most 404 fast.
 */
const CONTACT_PATHS = [
  // Contact-themed (highest direct yield)
  { path: "/contact", source: "SCRAPE_CONTACT" as const },
  { path: "/contact-us", source: "SCRAPE_CONTACT" as const },
  { path: "/contacts", source: "SCRAPE_CONTACT" as const },
  { path: "/contactus", source: "SCRAPE_CONTACT" as const },
  { path: "/contact.html", source: "SCRAPE_CONTACT" as const },
  { path: "/contact-info", source: "SCRAPE_CONTACT" as const },
  { path: "/get-in-touch", source: "SCRAPE_CONTACT" as const },
  { path: "/reach-us", source: "SCRAPE_CONTACT" as const },
  { path: "/connect", source: "SCRAPE_CONTACT" as const },
  { path: "/info", source: "SCRAPE_CONTACT" as const },
  { path: "/locations", source: "SCRAPE_CONTACT" as const },
  { path: "/find-us", source: "SCRAPE_CONTACT" as const },

  // About-themed (often have founder/owner email)
  { path: "/about", source: "SCRAPE_ABOUT" as const },
  { path: "/about-us", source: "SCRAPE_ABOUT" as const },
  { path: "/aboutus", source: "SCRAPE_ABOUT" as const },
  { path: "/about.html", source: "SCRAPE_ABOUT" as const },
  { path: "/our-story", source: "SCRAPE_ABOUT" as const },
  { path: "/who-we-are", source: "SCRAPE_ABOUT" as const },

  // Team/Staff/Providers (best yield for personal emails)
  { path: "/team", source: "SCRAPE_TEAM" as const },
  { path: "/our-team", source: "SCRAPE_TEAM" as const },
  { path: "/staff", source: "SCRAPE_TEAM" as const },
  { path: "/our-staff", source: "SCRAPE_TEAM" as const },
  { path: "/meet-the-team", source: "SCRAPE_TEAM" as const },
  { path: "/providers", source: "SCRAPE_TEAM" as const }, // med-spa
  { path: "/our-providers", source: "SCRAPE_TEAM" as const },
  { path: "/doctors", source: "SCRAPE_TEAM" as const }, // med-spa / dental
  { path: "/our-doctors", source: "SCRAPE_TEAM" as const },
  { path: "/specialists", source: "SCRAPE_TEAM" as const },

  // Booking / appointment (sometimes booking@ or reception@)
  { path: "/book", source: "SCRAPE_BOOKING" as const },
  { path: "/book-now", source: "SCRAPE_BOOKING" as const },
  { path: "/booking", source: "SCRAPE_BOOKING" as const },
  { path: "/schedule", source: "SCRAPE_BOOKING" as const },
  { path: "/appointments", source: "SCRAPE_BOOKING" as const },
  { path: "/appointment", source: "SCRAPE_BOOKING" as const },
  { path: "/consultation", source: "SCRAPE_BOOKING" as const },
  { path: "/consultations", source: "SCRAPE_BOOKING" as const },
] as const;

/** Tags we use for the source field on each candidate. Lines up
 *  with the EmailDiscoverySource enum (without RDAP/MANUAL). */
export type EmailScrapeSource =
  | "SCRAPE_HOMEPAGE"
  | "SCRAPE_CONTACT"
  | "SCRAPE_ABOUT"
  | "SCRAPE_TEAM"
  | "SCRAPE_FOOTER"
  | "SCRAPE_BOOKING"
  | "SCRAPE_JS_BUNDLE";

export interface EmailCandidate {
  email: string;
  source: EmailScrapeSource | "RDAP" | "AI_WEB_SEARCH";
  score: number; // higher = better
  isPersonal: boolean; // firstname@ vs generic info@
  isDomainAligned: boolean; // matches the business's own domain
  isFreeProvider: boolean; // gmail/yahoo/etc.
  /** Citation/justification when the source is AI_WEB_SEARCH · URL or
   *  short reasoning. Empty string for scrape/RDAP candidates. */
  aiCitation?: string;
}

export interface ScrapeResult {
  candidates: EmailCandidate[];
  /** URLs we managed to fetch (200 OK) — useful for debugging. */
  visitedUrls: string[];
  /** URLs that errored out (timeout/4xx/5xx). */
  failedUrls: string[];
  /** True if we got NOTHING — fetch never succeeded once. */
  websiteUnreachable: boolean;
}

/**
 * Run the full scrape against a business's website. Caller passes
 * `domain` (the bare host, e.g. "whitecoatbeauty.com") so we can
 * score domain-aligned candidates higher.
 */
export async function scrapeEmailsFromWebsite(input: {
  website: string;
  domain: string | null;
}): Promise<ScrapeResult> {
  const { website, domain } = input;
  if (!website) {
    return {
      candidates: [],
      visitedUrls: [],
      failedUrls: [],
      websiteUnreachable: true,
    };
  }

  // Normalise the base URL · strip the query string + fragment, then
  // the trailing slash, so appending "/contact" produces a clean URL.
  //
  // DataForSEO often returns the GBP click-through URL with tracking
  // params (e.g. `https://www.example.com/?utm_source=Google&utm_medium=GMB`).
  // Naively concatenating `/contact` yielded `...&utm_medium=GMB/contact`,
  // which then fails every fetch with a 4xx + skews the scrape result.
  // The `homepage` probe keeps the full URL (so the WAF check / redirect
  // semantics match what a real GBP click would see); only path probes
  // strip params.
  const homepage = website;
  const baseClean = (() => {
    try {
      const u = new URL(website);
      return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
    } catch {
      // Malformed URL · best-effort fall back to the legacy behaviour
      return website.replace(/\/+$/, "");
    }
  })();

  // Probe homepage first; if it fails entirely we still attempt paths
  // (some sites redirect / from a CDN but serve /contact directly).
  // Dedupe probe URLs so we don't double-fetch when homepage === baseClean.
  const probesRaw: Array<{ url: string; source: EmailScrapeSource }> = [
    { url: homepage, source: "SCRAPE_HOMEPAGE" },
    ...CONTACT_PATHS.map((p) => ({
      url: baseClean + p.path,
      source: p.source,
    })),
  ];
  const seen = new Set<string>();
  const probes = probesRaw.filter((p) =>
    seen.has(p.url) ? false : (seen.add(p.url), true),
  );

  // Bounded-concurrency runner · keeps in-flight ≤ PER_HOST_CONCURRENCY.
  // Avoids tripping WAF rate-limits that flag many-parallel as bot
  // traffic. The homepage is probed FIRST so its response sets the
  // tone (if it 403s, every subsequent path will too — fail fast).
  const results: FetchResult[] = [];
  const queue = [...probes];
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) return;
      try {
        results.push(await fetchAndExtract(next.url, next.source, domain));
      } catch {
        results.push({
          url: next.url,
          source: next.source,
          candidates: [],
          ok: false,
          footerEmails: undefined,
        });
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(PER_HOST_CONCURRENCY, probes.length) }, () =>
      worker(),
    ),
  );

  const visitedUrls: string[] = [];
  const failedUrls: string[] = [];
  const all: EmailCandidate[] = [];

  for (const r of results) {
    if (r.ok) {
      visitedUrls.push(r.url);
      all.push(...r.candidates);
    } else {
      failedUrls.push(r.url);
    }
  }

  // Footer extraction is a special-case re-pass on the homepage HTML.
  // If the homepage was successfully fetched, we tag any email that
  // appeared in the trailing 2KB of the body as SCRAPE_FOOTER (still
  // dedupped against the other passes; score nudges slightly higher
  // since footers are the canonical place for business email).
  const homepageResult = results.find((r) => r.source === "SCRAPE_HOMEPAGE");
  if (homepageResult?.ok && homepageResult.footerEmails?.length) {
    for (const email of homepageResult.footerEmails) {
      all.push(buildCandidate(email, "SCRAPE_FOOTER", domain));
    }
  }

  // SPA fallback · React/Vite/Next sites render their entire DOM
  // client-side, so the served HTML has no email — but the email is
  // almost always hardcoded as a string in the JS bundle. Scrape the
  // bundle(s) referenced by <script src="..."> tags in the homepage.
  // Only same-origin scripts; CDN scripts (Google fonts etc) are junk.
  if (homepageResult?.ok && homepageResult.html) {
    const scriptUrls = extractSameOriginScriptUrls(
      homepageResult.html,
      baseClean,
    ).slice(0, MAX_JS_BUNDLES);
    if (scriptUrls.length > 0) {
      const jsResults = await Promise.all(
        scriptUrls.map((url) =>
          fetchJsBundle(url, domain).catch(
            (): JsBundleResult => ({ url, ok: false, candidates: [] }),
          ),
        ),
      );
      for (const j of jsResults) {
        if (j.ok) {
          visitedUrls.push(j.url);
          all.push(...j.candidates);
        } else {
          failedUrls.push(j.url);
        }
      }
    }
  }

  // Rescue pass · the polite bot UA got stonewalled on EVERY probe
  // (WAF bot-block, not a dead site — dead sites also land here, the
  // retry just fails again cheaply). Re-try the 3 highest-value pages
  // as a regular browser before declaring the site unreachable. This
  // is the difference between "no email" and "blocked at the door" for
  // Cloudflare-bot-fight/Sucuri-fronted SMB sites.
  if (visitedUrls.length === 0) {
    const rescueProbes: Array<{ url: string; source: EmailScrapeSource }> = [
      { url: homepage, source: "SCRAPE_HOMEPAGE" },
      { url: baseClean + "/contact", source: "SCRAPE_CONTACT" },
      { url: baseClean + "/contact-us", source: "SCRAPE_CONTACT" },
    ];
    const rescueResults = await Promise.all(
      rescueProbes.map((p) =>
        fetchAndExtract(p.url, p.source, domain, BROWSER_UA).catch(
          (): FetchResult => ({
            url: p.url,
            source: p.source,
            candidates: [],
            ok: false,
          }),
        ),
      ),
    );
    for (const r of rescueResults) {
      if (r.ok) {
        visitedUrls.push(r.url);
        all.push(...r.candidates);
      }
    }
    // Footer + JS-bundle passes for the rescued homepage, same as the
    // primary pass.
    const rescuedHome = rescueResults.find(
      (r) => r.source === "SCRAPE_HOMEPAGE" && r.ok,
    );
    if (rescuedHome?.footerEmails?.length) {
      for (const email of rescuedHome.footerEmails) {
        all.push(buildCandidate(email, "SCRAPE_FOOTER", domain));
      }
    }
    if (rescuedHome?.html) {
      const scriptUrls = extractSameOriginScriptUrls(
        rescuedHome.html,
        baseClean,
      ).slice(0, MAX_JS_BUNDLES);
      const jsResults = await Promise.all(
        scriptUrls.map((url) =>
          fetchJsBundle(url, domain, BROWSER_UA).catch(
            (): JsBundleResult => ({ url, ok: false, candidates: [] }),
          ),
        ),
      );
      for (const j of jsResults) {
        if (j.ok) {
          visitedUrls.push(j.url);
          all.push(...j.candidates);
        }
      }
    }
  }

  return {
    candidates: rankAndDedup(all),
    visitedUrls,
    failedUrls,
    websiteUnreachable: visitedUrls.length === 0,
  };
}

/* ------------------------------------------ SPA JS-bundle fallback */

const MAX_JS_BUNDLES = 3;
const JS_MAX_BYTES = 4_000_000; // 4 MB cap per script — abort larger
const SCRIPT_SRC_RE = /<script[^>]+src=["']([^"'#?]+)/gi;

interface JsBundleResult {
  url: string;
  ok: boolean;
  candidates: EmailCandidate[];
}

/**
 * Pull every `<script src="...">` URL from the homepage HTML and
 * return the SAME-ORIGIN ones. Cross-origin scripts (Google fonts /
 * GTM / Cloudflare loader / etc) are rejected — they're never going
 * to contain the business owner's email.
 */
function extractSameOriginScriptUrls(html: string, base: string): string[] {
  const baseHost = (() => {
    try {
      return new URL(base).host.toLowerCase();
    } catch {
      return null;
    }
  })();
  if (!baseHost) return [];

  const out: string[] = [];
  for (const m of html.matchAll(SCRIPT_SRC_RE)) {
    const raw = m[1];
    if (!raw) continue;
    try {
      const abs = new URL(raw, base);
      // Skip non-http(s) (data:, blob:, etc.)
      if (abs.protocol !== "https:" && abs.protocol !== "http:") continue;
      // Same-origin only — ignore subdomain mismatches too
      if (abs.host.toLowerCase() !== baseHost) continue;
      // De-dupe
      const url = abs.toString();
      if (!out.includes(url)) out.push(url);
    } catch {
      // Skip malformed
    }
  }
  return out;
}

async function fetchJsBundle(
  url: string,
  domain: string | null,
  userAgent: string = USER_AGENT,
): Promise<JsBundleResult> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      Accept: "application/javascript,*/*",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) return { url, ok: false, candidates: [] };

  // Bound the body read so a misconfigured bundle (multi-MB single file)
  // doesn't eat all our memory. AbortController would be cleaner; for
  // now we accept the simpler "if-too-big-drop" pattern.
  const contentLength = Number(res.headers.get("content-length") ?? 0);
  if (contentLength > 0 && contentLength > JS_MAX_BYTES) {
    return { url, ok: false, candidates: [] };
  }
  const text = await res.text();
  if (text.length > JS_MAX_BYTES) {
    return { url, ok: false, candidates: [] };
  }

  const mailtos = extractMailtoEmails(text);
  const inline = extractInlineEmails(text);
  const candidates = uniq([...mailtos, ...inline]).map((email) =>
    buildCandidate(email, "SCRAPE_JS_BUNDLE", domain),
  );
  return { url, ok: true, candidates };
}

interface FetchResult {
  url: string;
  source: EmailScrapeSource;
  candidates: EmailCandidate[];
  ok: boolean;
  footerEmails?: string[];
  /** Raw HTML — populated only for SCRAPE_HOMEPAGE so the SPA fallback
   *  can extract `<script src>` URLs from it. */
  html?: string;
}

async function fetchAndExtract(
  url: string,
  source: EmailScrapeSource,
  domain: string | null,
  userAgent: string = USER_AGENT,
): Promise<FetchResult> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) {
    return { url, source, candidates: [], ok: false };
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("html") && !contentType.includes("text")) {
    return { url, source, candidates: [], ok: false };
  }
  const html = await res.text();

  const mailtos = extractMailtoEmails(html);
  const inline = extractInlineEmails(html);
  const cloudflare = extractCloudflareEmails(html);
  const deobfuscated = extractObfuscatedEmails(html);
  const candidates = uniq([
    ...mailtos,
    ...inline,
    ...cloudflare,
    ...deobfuscated,
  ]).map((email) => buildCandidate(email, source, domain));

  // Footer = last 2KB of body (rough but effective for most sites)
  const footerEmails =
    source === "SCRAPE_HOMEPAGE"
      ? uniq([
          ...extractInlineEmails(html.slice(-2048)),
          ...extractCloudflareEmails(html.slice(-2048)),
        ])
      : undefined;

  // Keep the HTML around for the homepage so the SPA fallback can
  // extract <script src> URLs from it (~hundreds of KB max).
  return {
    url,
    source,
    candidates,
    ok: true,
    footerEmails,
    html: source === "SCRAPE_HOMEPAGE" ? html : undefined,
  };
}

/* ----------------------------------------------------- extraction passes */

const MAILTO_RE = /href\s*=\s*["']mailto:([^"'?#]+)/gi;
const INLINE_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/**
 * Cloudflare's "Email Address Obfuscation" rewrites visible emails as
 * either `<a class="__cf_email__" data-cfemail="HEX">…</a>` or
 * `<a href="/cdn-cgi/l/email-protection#HEX">`. The HEX string is:
 *   - byte 0 (first 2 chars)        = XOR key
 *   - bytes 1+                      = each XOR-key'd byte of email
 * Common on small SMB sites behind Cloudflare's free tier.
 */
const CF_EMAIL_RE =
  /(?:data-cfemail\s*=\s*["']|cdn-cgi\/l\/email-protection#)([a-f0-9]{4,})/gi;

function extractMailtoEmails(html: string): string[] {
  // Decode HTML entities first so `mailto:info&#64;example.com`
  // (or `&#x40;`, `&commat;`, etc.) becomes a plain email before regex.
  const decoded = decodeHtmlEntities(html);
  return Array.from(decoded.matchAll(MAILTO_RE))
    .map((m) =>
      safeDecodeUriComponent(m[1] ?? "")
        .trim()
        .toLowerCase(),
    )
    .filter(isValidEmailShape);
}

function extractInlineEmails(html: string): string[] {
  const decoded = decodeHtmlEntities(html);
  return Array.from(decoded.matchAll(INLINE_RE))
    .map((m) => m[0].trim().toLowerCase())
    .filter(isValidEmailShape);
}

/**
 * Find every Cloudflare-obfuscated email reference in the HTML and
 * decode it. Quiet on malformed hex (Cloudflare always pads to even
 * length, but third-party tooling sometimes mangles attrs).
 */
function extractCloudflareEmails(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(CF_EMAIL_RE)) {
    const decoded = decodeCloudflareHex(m[1] ?? "");
    if (decoded && isValidEmailShape(decoded)) {
      out.push(decoded.toLowerCase());
    }
  }
  return Array.from(new Set(out));
}

/**
 * XOR-decode a Cloudflare email-protection hex string. Returns null
 * if the input is malformed (odd length, non-hex chars, decoded byte
 * outside printable ASCII range, no `@` in result).
 */
function decodeCloudflareHex(hex: string): string | null {
  if (!/^[0-9a-f]+$/i.test(hex)) return null;
  if (hex.length < 6 || hex.length % 2 !== 0) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) {
    const byte = parseInt(hex.slice(i, i + 2), 16) ^ key;
    // Hard reject non-printable bytes — silent corruption indicator
    if (byte < 0x20 || byte > 0x7e) return null;
    out += String.fromCharCode(byte);
  }
  return out.includes("@") ? out : null;
}

/**
 * Anti-spam obfuscation patterns humans write on contact pages:
 *   "info [at] glowspa [dot] com"  ·  "info(at)glowspa(dot)com"
 *   "info {at} glowspa {dot} com"  ·  "info at glowspa dot com"
 *
 * To keep false positives out of prose ("meet us at noon...") the
 * bare-word form is only accepted when BOTH the "at" and at least one
 * "dot" are worded; bracketed/parenthesised "at" is accepted with
 * either worded or literal dots.
 */
const OBFUSCATED_BRACKET_RE =
  /\b([A-Za-z0-9._%+-]+)\s*[\[({]\s*at\s*[\])}]\s*((?:[A-Za-z0-9-]+\s*(?:[\[({]\s*dot\s*[\])}]|\.)\s*)+[A-Za-z]{2,})\b/gi;
const OBFUSCATED_WORDED_RE =
  /\b([A-Za-z0-9._%+-]+)\s+at\s+((?:[A-Za-z0-9-]+\s+dot\s+)+[A-Za-z]{2,})\b/gi;

function extractObfuscatedEmails(html: string): string[] {
  // Strip tags so "info <span>[at]</span> spa [dot] com" still matches.
  const text = decodeHtmlEntities(html.replace(/<[^>]+>/g, " "));
  const out: string[] = [];
  for (const re of [OBFUSCATED_BRACKET_RE, OBFUSCATED_WORDED_RE]) {
    for (const m of text.matchAll(re)) {
      const local = (m[1] ?? "").toLowerCase();
      const hostRaw = (m[2] ?? "").toLowerCase();
      const host = hostRaw
        .replace(/[\[({]\s*dot\s*[\])}]/g, ".")
        .replace(/\s+dot\s+/g, ".")
        .replace(/\s+/g, "")
        .replace(/\.{2,}/g, ".");
      const email = `${local}@${host}`;
      if (isValidEmailShape(email)) out.push(email);
    }
  }
  return Array.from(new Set(out));
}

function safeDecodeUriComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * File extensions that LOOK like TLDs to the email regex. Without this
 * filter, srcset markup like `<img src="logo@2x.png">` produces a
 * false-positive `logo@2x.png` candidate. (Caught a Calgary spa whose
 * "discovered" email was `macleod-trail-plastic-surgery-...@2x.png`.)
 *
 * Lowercased; check is against the post-final-dot segment.
 */
const FILE_EXTENSION_TLDS = new Set([
  // Images
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "ico",
  "bmp",
  "tiff",
  "avif",
  // Fonts
  "woff",
  "woff2",
  "ttf",
  "eot",
  "otf",
  // Web bundles
  "css",
  "js",
  "mjs",
  "json",
  "xml",
  "html",
  "htm",
  // Media
  "mp4",
  "mp3",
  "mov",
  "wav",
  "webm",
  "ogg",
  "m4a",
  "m4v",
  // Docs / archives
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "zip",
  "rar",
  "7z",
  "tar",
  "gz",
  // Source maps
  "map",
]);

function isValidEmailShape(s: string): boolean {
  if (!s) return false;
  if (s.length > 254) return false;
  // Strip surrounding whitespace and obvious decorators
  const cleaned = s.replace(/^["'<]+|[">']+$/g, "");
  if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(cleaned)) {
    return false;
  }
  // Reject when the final segment is a file extension — `logo@2x.png`,
  // `bundle.abc123.js` patterns scraped from HTML.
  const finalSegment = cleaned.split(".").pop()?.toLowerCase() ?? "";
  if (FILE_EXTENSION_TLDS.has(finalSegment)) return false;
  // Reject the retina-image local-part convention `<name>@2x`, `@3x` —
  // even when the TLD is something else, this pattern is never an email.
  const localPart = cleaned.split("@")[0] ?? "";
  if (/(?:^|[-_.])(?:2x|3x|4x)$/i.test(localPart)) return false;
  return true;
}

/* ----------------------------------------------------- scoring + ranking */

const FREE_PROVIDERS = new Set([
  "gmail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "icloud.com",
  "aol.com",
  "live.com",
  "msn.com",
  "yandex.ru",
  "yandex.com",
  "protonmail.com",
  "proton.me",
  "gmx.com",
  "mail.com",
]);

const GENERIC_LOCALS = new Set([
  "info",
  "contact",
  "hello",
  "hi",
  "admin",
  "office",
  "inquiries",
  "inquiry",
  "booking",
  "bookings",
  "appointments",
  "appointment",
  "support",
  "sales",
  "reservations",
  "schedule",
  "team",
  "general",
  "frontdesk",
]);

const JUNK_LOCALS =
  /^(example|test|noreply|no-reply|donotreply|do-not-reply|wordpress|sentry|user|placeholder|email|sample|webmaster|postmaster|hostmaster|abuse)\b/i;

/**
 * Any host containing one of these substrings → drop the candidate.
 * Covers:
 *   - Placeholder docs (example.com, test.com, domain.com, etc.)
 *   - Error-tracking SDK leaks (Sentry IDs hard-coded in JS bundles, e.g.
 *     `xxx@sentry-next.wixpress.com`, `xxx@o4504.ingest.sentry.io`)
 *   - CDN / hosting-provider noise (cloudflare, squarespace-cdn, wixpress,
 *     wixstatic)
 *   - Common transactional-email sender domains routinely embedded in
 *     theme footers ("Sent via Mailchimp", etc.)
 */
const JUNK_HOSTS =
  /(?:example|sample|test|placeholder|domain|email|wordpress|sentry|cloudflare|squarespace-cdn|wixpress|wixstatic|wix\.com|ingest\.sentry|mailchimp|sendgrid|mailgun|amazonaws|cloudfront|googleusercontent|gstatic|gtag|googletag|godaddysites|wixsite|square\.site|weeblysite|weebly\.com|myshopify)\./i;

/**
 * Hex-string local-parts of 16+ characters are nearly always
 * auto-generated identifiers (Sentry DSN public-key IDs, build hashes,
 * etc.) — never real email addresses. Belt-and-suspenders next to the
 * JUNK_HOSTS filter above.
 */
const HEX_LOCAL_RE = /^[a-f0-9]{16,}$/i;

/** Shared generic-inbox classifier · ONE vocabulary for every tier so
 *  emailCandidates audit rows label isPersonal consistently (the AI
 *  tier used to run its own narrower regex). */
export function isGenericLocalPart(local: string): boolean {
  return GENERIC_LOCALS.has(local.toLowerCase());
}

/** Build a fully-scored candidate from a raw email string. */
export function buildCandidate(
  email: string,
  source: EmailScrapeSource | "RDAP",
  ownerDomain: string | null,
): EmailCandidate {
  const lower = email.trim().toLowerCase();
  const [local, host] = lower.split("@") as [string, string | undefined];
  const safeHost = host ?? "";

  const isFreeProvider = FREE_PROVIDERS.has(safeHost);
  const isPersonal = !isGenericLocalPart(local);
  // Alignment = email host equals (or is a subdomain of) the business's
  // own domain. The stored domain often carries a `www.` prefix —
  // normalize it instead of the old reverse-inclusion branch, which
  // made `anything@godaddysites.com` "aligned" for a business hosted
  // at `mybiz.godaddysites.com` (2026-06-11 audit).
  const normalizedOwner = (ownerDomain ?? "")
    .toLowerCase()
    .replace(/^www\./, "");
  const isDomainAligned = !!(
    normalizedOwner &&
    safeHost &&
    (safeHost === normalizedOwner || safeHost.endsWith("." + normalizedOwner))
  );

  let score = 0;

  // Junk filters — drop hard
  if (
    JUNK_LOCALS.test(local) ||
    JUNK_HOSTS.test(safeHost) ||
    HEX_LOCAL_RE.test(local)
  ) {
    score -= 100;
  }

  // Source weighting (footer is the canonical place for business email)
  if (source === "SCRAPE_FOOTER") score += 30;
  else if (source === "SCRAPE_HOMEPAGE") score += 20;
  else if (source === "SCRAPE_CONTACT") score += 25;
  else if (source === "SCRAPE_ABOUT") score += 15;
  else if (source === "SCRAPE_TEAM") score += 15;
  else if (source === "SCRAPE_BOOKING") score += 10;
  else if (source === "SCRAPE_JS_BUNDLE")
    score += 18; // a bit less than HTML — bundles may include dev configs
  else if (source === "RDAP") score += 5;

  // Domain alignment: huge boost
  if (isDomainAligned) score += 50;
  else if (!isFreeProvider)
    score += 10; // custom domain even if not aligned
  else score += 0; // free provider — neutral

  // Personal beats generic for outreach
  if (isPersonal) score += 25;
  else score += 10; // generic still useful, just less

  return {
    email: lower,
    source,
    score,
    isPersonal,
    isDomainAligned,
    isFreeProvider,
  };
}

/** Dedup by email (highest-scored wins). Sorted descending by score. */
function rankAndDedup(all: EmailCandidate[]): EmailCandidate[] {
  const byEmail = new Map<string, EmailCandidate>();
  for (const c of all) {
    if (c.score < 0) continue;
    const existing = byEmail.get(c.email);
    if (!existing || c.score > existing.score) byEmail.set(c.email, c);
  }
  return Array.from(byEmail.values()).sort((a, b) => b.score - a.score);
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}
