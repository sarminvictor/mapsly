/**
 * Layer 4 · scrape services from the business website's dedicated
 * service-listing pages (`/services`, `/treatments`, `/menu`, etc.).
 *
 * Mirrors the email-scrape architecture:
 *   - parallel fetch of 7 likely paths with per-host concurrency cap
 *   - 6s timeout per request
 *   - polite User-Agent + standard browser-like headers
 *   - HTML-entity decoding before text matching
 *
 * Extraction strategy:
 *   1. Strip out <script>, <style>, <noscript> blocks (kill JS strings
 *      + CSS rules that would otherwise pollute the taxonomy match).
 *   2. Extract heading + list-item text — those are where service
 *      menus live. Pulls from h1-h4, li, and common "service card"
 *      patterns.
 *   3. Concatenate, taxonomy-match, return candidates.
 *
 * Reliability is HIGH because service pages are the business's own
 * declaration of what they sell. Confidence 0.8 — beats description
 * (0.7) but doesn't outrank explicit DfS category mapping (0.9 in
 * the merger).
 */

import { decodeHtmlEntities } from "@/lib/text/html-entities";

import type { ServiceCandidate, ServiceTaxonomyEntry } from "./types";

const USER_AGENT =
  "Mozilla/5.0 (compatible; MapslyBot/0.1; +https://mapsly.ai/bot · sarminvictor@gmail.com)";
const FETCH_TIMEOUT_MS = 6_000;
const PER_HOST_CONCURRENCY = 4;
const DOM_CONFIDENCE = 0.8;
const JS_BUNDLE_CONFIDENCE = 0.65; // less than DOM (bundles may include dev/unused features)
const MAX_JS_BUNDLES = 3;
const JS_MAX_BYTES = 4_000_000;

const SERVICE_PATHS: readonly string[] = [
  "/",
  "/services",
  "/our-services",
  "/treatments",
  "/menu",
  "/procedures",
  "/what-we-offer",
  "/service-menu",
] as const;

const SCRIPT_SRC_RE = /<script[^>]+src=["']([^"'#?]+)/gi;

export interface ServicePageScrapeResult {
  candidates: ServiceCandidate[];
  visitedUrls: string[];
  failedUrls: string[];
}

export async function scrapeServicesFromWebsite(input: {
  website: string;
  taxonomy: readonly ServiceTaxonomyEntry[];
}): Promise<ServicePageScrapeResult> {
  if (!input.website || input.taxonomy.length === 0) {
    return { candidates: [], visitedUrls: [], failedUrls: [] };
  }
  // Strip query string + fragment + trailing slash from the website so
  // path probes don't produce malformed URLs like
  //   `https://example.com/?utm_source=Google&utm_medium=GMB/services`.
  // See `modules/business-qualification/scrape-email.ts` for the
  // discovery and Calgary scrape diagnostic that surfaced this.
  const base = (() => {
    try {
      const u = new URL(input.website);
      return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
    } catch {
      return input.website.replace(/\/+$/, "");
    }
  })();

  // Concurrency-capped worker pool (same pattern as scrape-email.ts).
  // We also keep raw HTML for the homepage so the SPA fallback can
  // pull <script src> URLs off it.
  const queue = [...SERVICE_PATHS];
  const results: Array<{
    url: string;
    path: string;
    ok: boolean;
    text: string;
    rawHtml?: string;
  }> = [];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const path = queue.shift();
      if (!path) return;
      const url = base + path;
      try {
        const r = await fetchPageText(url, path === "/");
        results.push({ url, path, ...r });
      } catch {
        results.push({ url, path, ok: false, text: "" });
      }
    }
  }
  await Promise.all(
    Array.from({ length: PER_HOST_CONCURRENCY }, () => worker()),
  );

  const visitedUrls: string[] = [];
  const failedUrls: string[] = [];
  const combinedText: string[] = [];
  let homepageHtml: string | undefined;

  for (const r of results) {
    if (r.ok) {
      visitedUrls.push(r.url);
      combinedText.push(r.text);
      if (r.path === "/" && r.rawHtml) homepageHtml = r.rawHtml;
    } else {
      failedUrls.push(r.url);
    }
  }

  const candidates: ServiceCandidate[] = [];
  const combined = combinedText.join(" \n ").toLowerCase();

  for (const entry of input.taxonomy) {
    const matched = firstSynonymMatch(combined, entry.synonyms);
    if (matched) {
      candidates.push({
        canonicalKey: entry.canonicalKey,
        displayName: entry.displayName,
        group: entry.group,
        confidence: DOM_CONFIDENCE,
        sourceHint: "auto:dom",
        evidence: matched,
      });
    }
  }

  // SPA fallback · if the HTML pages yielded ≤2 services, the site is
  // probably client-side rendered (React/Vite/Next) — every path
  // returned the same shell with no taxonomy hits. Fetch the JS
  // bundle(s) and taxonomy-match against the bundled strings.
  const matchedKeys = new Set(candidates.map((c) => c.canonicalKey));
  const shouldTryBundles = candidates.length <= 2 && homepageHtml;

  if (shouldTryBundles && homepageHtml) {
    const scriptUrls = extractSameOriginScriptUrls(homepageHtml, base).slice(
      0,
      MAX_JS_BUNDLES,
    );
    if (scriptUrls.length > 0) {
      const bundleTexts = await Promise.all(
        scriptUrls.map((url) =>
          fetchJsBundleText(url).catch(() => ({
            url,
            ok: false,
            text: "",
          })),
        ),
      );
      for (const b of bundleTexts) {
        if (!b.ok) {
          failedUrls.push(b.url);
          continue;
        }
        visitedUrls.push(b.url);
        const bundleLower = b.text.toLowerCase();
        for (const entry of input.taxonomy) {
          if (matchedKeys.has(entry.canonicalKey)) continue;
          const matched = firstSynonymMatch(bundleLower, entry.synonyms);
          if (matched) {
            candidates.push({
              canonicalKey: entry.canonicalKey,
              displayName: entry.displayName,
              group: entry.group,
              confidence: JS_BUNDLE_CONFIDENCE,
              sourceHint: "auto:js-bundle",
              evidence: matched,
            });
            matchedKeys.add(entry.canonicalKey);
          }
        }
      }
    }
  }

  return { candidates, visitedUrls, failedUrls };
}

function firstSynonymMatch(
  haystack: string,
  synonyms: readonly string[],
): string | null {
  for (const syn of synonyms) {
    const re = new RegExp(`\\b${escapeRegex(syn)}\\b`, "i");
    if (re.test(haystack)) return syn;
  }
  return null;
}

/* ─────────────────────────────────────────────── fetch + extract */

async function fetchPageText(
  url: string,
  keepRawHtml: boolean,
): Promise<{ ok: boolean; text: string; rawHtml?: string }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) return { ok: false, text: "" };
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("html") && !ct.includes("text")) {
    return { ok: false, text: "" };
  }
  const html = await res.text();
  return {
    ok: true,
    text: extractRelevantText(html),
    rawHtml: keepRawHtml ? html : undefined,
  };
}

/**
 * Extract every <script src> URL from the homepage HTML and return
 * the ones that point to the same origin. CDN scripts (Google Tag
 * Manager, jQuery on a CDN, etc.) never contain the business's own
 * service names — strip them.
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
      if (abs.protocol !== "https:" && abs.protocol !== "http:") continue;
      if (abs.host.toLowerCase() !== baseHost) continue;
      const url = abs.toString();
      if (!out.includes(url)) out.push(url);
    } catch {
      // Skip malformed
    }
  }
  return out;
}

async function fetchJsBundleText(
  url: string,
): Promise<{ url: string; ok: boolean; text: string }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/javascript,*/*",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: "follow",
  });
  if (!res.ok) return { url, ok: false, text: "" };

  const contentLength = Number(res.headers.get("content-length") ?? 0);
  if (contentLength > 0 && contentLength > JS_MAX_BYTES) {
    return { url, ok: false, text: "" };
  }
  const text = await res.text();
  if (text.length > JS_MAX_BYTES) return { url, ok: false, text: "" };
  return { url, ok: true, text };
}

/**
 * Strip <script>, <style>, <noscript> blocks, then extract heading +
 * list-item + service-card text. We use crude regex rather than a
 * full HTML parser — fast enough and the taxonomy match downstream
 * tolerates noise.
 */
function extractRelevantText(html: string): string {
  const cleaned = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ");

  const out: string[] = [];

  // Headings · h1-h4
  for (const m of cleaned.matchAll(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/gi)) {
    out.push(stripTags(m[1] ?? ""));
  }
  // List items
  for (const m of cleaned.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    out.push(stripTags(m[1] ?? ""));
  }
  // Common service-card patterns — divs with "service" in class/id
  for (const m of cleaned.matchAll(
    /<(?:div|article|section)\b[^>]*class\s*=\s*["'][^"']*service[^"']*["'][^>]*>([\s\S]{0,1000}?)<\/(?:div|article|section)>/gi,
  )) {
    out.push(stripTags(m[1] ?? ""));
  }
  // Also keep meta description as a safety net
  for (const m of cleaned.matchAll(
    /<meta\s+name\s*=\s*["']description["']\s+content\s*=\s*["']([^"']+)["']/gi,
  )) {
    out.push(m[1] ?? "");
  }

  return out.join(" \n ");
}

/**
 * Strip HTML tags, normalize whitespace, then decode entities via
 * the shared decoder (handles numeric decimal + hex + named subset).
 * Order matters: strip tags FIRST so a `&lt;script&gt;` in the source
 * text isn't decoded into actual script markup before we remove it.
 */
function stripTags(s: string): string {
  return decodeHtmlEntities(
    s
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
