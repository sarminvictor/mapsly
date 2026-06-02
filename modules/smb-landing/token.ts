/**
 * Landing-page URL token helpers.
 *
 * A landing URL looks like:
 *
 *   /l/the-injectionist-and-aesthetics-4820731965540827
 *      └──────────── slug ───────────┘ └──── token ────┘
 *
 * The **token** is the only key we query by — a 16-digit cryptographically
 * random numeric string (~53 bits). The **slug** is cosmetic (so the emailed
 * link reads like the business) but is verified against the stored slug on
 * lookup (mismatch → 404), so a recipient can't edit the URL to probe other
 * businesses. Combined with no-index + rate-limiting + no enumeration, the
 * page is effectively un-guessable. Rotating the token revokes a leaked link.
 *
 * Pure module — no DB, no Node-only APIs (Web Crypto works on every runtime).
 */

/** Number of digits in a landing token. */
const TOKEN_LEN = 16;

/** Matches a valid landing token: 16 digits, first non-zero (always 16 chars). */
const TOKEN_RE = /^[1-9][0-9]{15}$/;

/**
 * Generate a fresh 16-digit numeric landing token using Web Crypto. The first
 * digit is 1–9 so the string is always exactly 16 chars (no leading-zero loss).
 */
export function generateLandingToken(): string {
  const r = new Uint32Array(TOKEN_LEN);
  globalThis.crypto.getRandomValues(r);
  let s = String(1 + (r[0] % 9)); // 1–9
  for (let i = 1; i < TOKEN_LEN; i++) s += String(r[i] % 10);
  return s;
}

/** Type-guard: is this a syntactically valid landing token? */
export function isValidLandingToken(input: unknown): input is string {
  return typeof input === "string" && TOKEN_RE.test(input);
}

/**
 * Slugify a business name into the cosmetic URL segment: lowercase ASCII,
 * accents stripped, non-alphanumerics collapsed to single hyphens, trimmed,
 * capped. Falls back to "business" for empty/symbol-only names.
 */
export function slugifyBusinessName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return slug || "business";
}

/**
 * Parse the `[token]` route param (`slug-1234567890123456`) into its parts.
 * Returns null when there's no valid trailing 16-digit token. The token is
 * always re-validated against the DB; the slug is returned for the cosmetic
 * mismatch check.
 */
export function parseLandingParam(
  param: string,
): { slug: string; token: string } | null {
  const m = /^(.+)-([1-9][0-9]{15})$/.exec(param);
  if (!m) return null;
  return { slug: m[1], token: m[2] };
}

/** Build the path segment for a landing URL. */
export function buildLandingPath(slug: string, token: string): string {
  return `/l/${slug}-${token}`;
}
