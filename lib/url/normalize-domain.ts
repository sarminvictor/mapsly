/**
 * Normalize a domain or URL into a comparable host string. Returns
 * lowercased hostname without `www.` prefix. Returns null on parse
 * failure or unsupported URL shape.
 *
 *   normalizeDomain("https://www.SoleaBrickell.com/about") → "soleabrickell.com"
 *   normalizeDomain("soleabrickell.com")                    → "soleabrickell.com"
 *   normalizeDomain("blog.example.com")                     → "blog.example.com"
 *   normalizeDomain("")                                     → null
 *   normalizeDomain(null)                                   → null
 *
 * Used by:
 *   - services/dataforseo/* · target param for ranked_keywords + others
 *   - modules/search-visibility/discover-keywords · per-business host
 *   - Any place we compare two business domains for identity
 */
export function normalizeDomain(
  input: string | null | undefined,
): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}
