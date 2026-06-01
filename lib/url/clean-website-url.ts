/**
 * Normalize a business website URL to its canonical form for STORAGE:
 * scheme + host + path, with the query string and fragment stripped.
 *
 * DataForSEO Maps / Google Business Profile URLs arrive with tracking params
 * (e.g. `https://www.example.com/?utm_source=Google&utm_medium=GMB`). We store
 * only the clean link so the DB holds canonical URLs and downstream consumers
 * (Lighthouse audit, email scrape, service-page detection) don't have to strip
 * params themselves.
 *
 * - Parseable http/https URL → `${origin}${pathname}` (drops `?…` and `#…`).
 * - Non-http protocol or unparseable input → returned trimmed, unchanged
 *   (never lose data we can't safely normalize).
 * - Empty / null → null.
 */
export function cleanWebsiteUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return trimmed;
    return `${u.origin}${u.pathname}`;
  } catch {
    return trimmed;
  }
}
