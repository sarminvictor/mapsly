/**
 * HTML entity decoder · shared by email + service scrapers.
 *
 * Handles the subset of entities that commonly appear in obfuscated
 * contact/service text on SMB sites:
 *
 *   - decimal numeric:  &#64;     → @
 *   - hex numeric:      &#x40;    → @
 *   - named (subset):   &commat;  &period;  &num;
 *   - structural:       &amp;     &lt;      &gt;      &quot;     &apos;     &nbsp;
 *
 * Other entities are passed through untouched — downstream regex /
 * shape filters will drop anything still malformed.
 *
 * Pure function · no IO · O(n) over the input length.
 */

export function decodeHtmlEntities(s: string): string {
  if (!s.includes("&")) return s; // fast path · most strings have no entities

  return s
    .replace(/&#(\d{1,7});/g, (m, n) => {
      const code = parseInt(n, 10);
      return Number.isFinite(code) && code > 0 && code < 0x10ffff
        ? String.fromCharCode(code)
        : m;
    })
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, h) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) && code > 0 && code < 0x10ffff
        ? String.fromCharCode(code)
        : m;
    })
    .replace(/&commat;/gi, "@")
    .replace(/&period;/gi, ".")
    .replace(/&num;/gi, "#")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/g, "&"); // last · so &amp;#64; → &#64; → @ in a second pass would require re-calling
}
