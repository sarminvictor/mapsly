/**
 * Deterministic tech fingerprint (Phase 6 · "tech review") — PURE core.
 *
 * `fingerprintTech` runs the {@link TECH_SIGNATURES} table over a
 * website's OWN HTML + response headers and returns the technologies it
 * recognizes. It does NO network I/O, calls NO third-party API, and runs
 * NO JavaScript — it's a pure function over already-fetched bytes, so it
 * rides the contacts page-fetch for $0.
 *
 * Detection model (Wappalyzer-style):
 *   - A signature fires when ANY of its body `patterns` match the HTML
 *     OR ANY of its `headerPatterns` match a response header.
 *   - Results are de-duped by `name`; the highest-confidence hit wins.
 *   - Output is sorted by confidence desc, then name asc, so the order
 *     is stable for golden tests + UI.
 *
 * `TechCategory` is a local union mirroring the `BusinessTechCategory`
 * Prisma enum (kept in `signatures.ts`) — this module never touches the
 * Prisma client.
 */

import { TECH_SIGNATURES } from "./signatures";
import type { TechCategory, TechSignature } from "./signatures";

export type { TechCategory } from "./signatures";

/** One detected technology, ready to persist as a BusinessTech row. */
export interface DetectedTech {
  /** Display name from the signature (e.g. "WordPress"). */
  name: string;
  /** BusinessTechCategory bucket. */
  category: TechCategory;
  /** 0..1 · confidence of the firing signature. */
  confidence: number;
  /** Always "self-fingerprint" — this detector reads the site's own bytes. */
  source: "self-fingerprint";
  /** The first matching snippet/header that fired the signature. */
  evidence?: string;
}

/** Input bytes for the fingerprint. All fields except `html` optional. */
export interface FingerprintInput {
  /** Raw HTML body of the fetched page. */
  html: string;
  /** Response headers. Keys are lowercased internally before matching. */
  headers?: Record<string, string>;
  /** The final URL after redirects (reserved for future host heuristics). */
  finalUrl?: string;
}

/**
 * Lowercase every header key so signature matching is case-insensitive
 * regardless of how the caller cased the header names.
 */
function normalizeHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  if (!headers) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = value;
  }
  return out;
}

/**
 * Test one signature against the HTML body + normalized headers.
 * Returns the matching evidence string if it fires, else `null`.
 */
function matchSignature(
  sig: TechSignature,
  html: string,
  headers: Record<string, string>,
): string | null {
  for (const pattern of sig.patterns) {
    const hit = html.match(pattern);
    if (hit) return hit[0];
  }
  if (sig.headerPatterns) {
    for (const hp of sig.headerPatterns) {
      const value = headers[hp.header.toLowerCase()];
      if (value === undefined) continue;
      if (hp.pattern.test(value)) {
        return `${hp.header}: ${value}`;
      }
    }
  }
  return null;
}

/**
 * Fingerprint a page from its own HTML + headers.
 *
 * @returns de-duped {@link DetectedTech}[] sorted by confidence desc,
 *          then name asc. Empty array when nothing matches.
 */
export function fingerprintTech(input: FingerprintInput): DetectedTech[] {
  const html = input.html ?? "";
  const headers = normalizeHeaders(input.headers);

  // De-dup by name; keep the highest-confidence hit.
  const byName = new Map<string, DetectedTech>();

  for (const sig of TECH_SIGNATURES) {
    const evidence = matchSignature(sig, html, headers);
    if (evidence === null) continue;

    const existing = byName.get(sig.name);
    if (existing && existing.confidence >= sig.confidence) continue;

    byName.set(sig.name, {
      name: sig.name,
      category: sig.category,
      confidence: sig.confidence,
      source: "self-fingerprint",
      evidence,
    });
  }

  return [...byName.values()].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return a.name.localeCompare(b.name);
  });
}

// ──────────────────────────────────────────────────────────────────────
// Convenience predicates · used by the qualification summary + UI badges
// ──────────────────────────────────────────────────────────────────────

/** True if the page carries a Meta (Facebook) advertising pixel. */
export function hasMetaPixel(techs: readonly DetectedTech[]): boolean {
  return techs.some((t) => t.name === "Meta Pixel");
}

/** True if the page embeds any booking/scheduling tool. */
export function hasBookingTool(techs: readonly DetectedTech[]): boolean {
  return techs.some((t) => t.category === "BOOKING");
}

/** True if the page runs any web-analytics tool. */
export function hasAnalytics(techs: readonly DetectedTech[]): boolean {
  return techs.some((t) => t.category === "ANALYTICS");
}
