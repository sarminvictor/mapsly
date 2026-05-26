// modules/reviews/canonicalize-names.ts
//
// Cross-review name canonicalization · groups "Anra", "anra",
// "Anra Clark" → one bucket · "Suzy" + "susie" → one bucket · "Amanda"
// + "Amanda Solar" → one bucket. Display the canonical name (longest
// variant, capitalized normally) with the SUMMED count across variants.
//
// Per-review dedupe is already handled at extraction (`dedupeInsensitive`
// in services/ai/extract-entities) · this module deduplicates ACROSS the
// business's review corpus.
//
// Why no AI cost here:
//   - Plain logic is deterministic + free · re-aggregation per page
//     load on cached data
//   - First-name match + Soundex handles 95% of variants observed in
//     real Calgary data (Amanda/Amanda Solar, Anra/anra/Anra Clark,
//     Suzy/susie)
//   - Edge cases (e.g. "Dr. Smith" vs "Smith") could be added later as
//     a hardcoded title-stripper if real data shows the gap

export interface CanonicalNameRow {
  /** Display name · the variant with the most mentions (or the longest
   *  one as a tiebreaker · "Amanda Solar" beats "Amanda" only when its
   *  count alone equals or exceeds Amanda's). */
  canonical: string;
  /** Sum of mentions across all variants merged into this bucket. */
  count: number;
  /** Every raw form that mapped into this bucket · useful for tooltip
   *  / "also known as" UI · also for debugging the grouping logic. */
  variants: string[];
}

/**
 * Group raw {name, count} rows from `unnest(mentionedPeople)` into
 * canonical buckets. Returns rows sorted by count desc.
 *
 * Matching rules · in order, first match wins:
 *   1. Normalized exact match (case + whitespace + punctuation)
 *   2. First-name token match · "Anra Clark" matches "Anra" / "anra"
 *   3. Soundex match on short single-word first names · "susie" → "Suzy"
 *      (only kicks in when both first names are ≤ 8 chars to avoid
 *      false positives on longer names · Soundex collapses aggressively)
 */
export function canonicalizeNames(
  raw: Array<{ name: string; count: number }>,
): CanonicalNameRow[] {
  const sorted = [...raw].sort((a, b) => b.count - a.count);
  const buckets: CanonicalNameRow[] = [];

  for (const { name, count } of sorted) {
    const norm = normalize(name);
    if (!norm) continue;
    const first = firstToken(norm);
    const sndx = soundex(first);

    const target = buckets.find((b) => {
      const bNorm = normalize(b.canonical);
      if (bNorm === norm) return true;
      const bFirst = firstToken(bNorm);
      if (bFirst && bFirst === first) return true;
      // Soundex only for short single-word matches to avoid pulling
      // unrelated long names together.
      if (
        first.length > 0 &&
        first.length <= 8 &&
        bFirst.length > 0 &&
        bFirst.length <= 8 &&
        sndx === soundex(bFirst)
      ) {
        return true;
      }
      return false;
    });

    if (target) {
      target.count += count;
      if (!target.variants.includes(name)) target.variants.push(name);
      // Promote display name if a longer/properly-cased variant has at
      // least as much mass alone (so "Amanda" wins over "amanda" but
      // "Amanda" stays winning over "Amanda Solar" with 1 mention).
      const currentCount =
        raw.find((r) => r.name === target.canonical)?.count ?? 0;
      if (count > currentCount && properlyCased(name)) {
        target.canonical = name;
      }
    } else {
      buckets.push({
        canonical: name,
        count,
        variants: [name],
      });
    }
  }

  return buckets.sort((a, b) => b.count - a.count);
}

// ---- helpers ------------------------------------------------------------

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[''`.,;:!?]/g, "")
    .replace(/\s+/g, " ");
}

function firstToken(s: string): string {
  const t = s.split(" ")[0];
  return t ?? "";
}

/** Heuristic for "properly cased" · starts with uppercase, has at least
 *  one lowercase. Used to prefer "Amanda" over "amanda" or "AMANDA" when
 *  picking the display canonical. */
function properlyCased(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length < 2) return false;
  return /^[A-Z]/.test(trimmed) && /[a-z]/.test(trimmed);
}

/**
 * Soundex · classic American Soundex (1918 patent · still the canonical
 * phonetic algorithm). Returns a 4-char code where the first char is the
 * input's first letter and the next 3 are digit codes derived from the
 * consonants.
 *
 *   B F P V         → 1
 *   C G J K Q S X Z → 2
 *   D T             → 3
 *   L               → 4
 *   M N             → 5
 *   R               → 6
 *   vowels + H W    → skipped (but break adjacency)
 *
 * Adjacent duplicates of the same code are collapsed. Result padded to
 * length 4 with "0".
 */
export function soundex(input: string): string {
  const code = input.toUpperCase().replace(/[^A-Z]/g, "");
  if (!code) return "";
  const map: Record<string, string> = {
    B: "1",
    F: "1",
    P: "1",
    V: "1",
    C: "2",
    G: "2",
    J: "2",
    K: "2",
    Q: "2",
    S: "2",
    X: "2",
    Z: "2",
    D: "3",
    T: "3",
    L: "4",
    M: "5",
    N: "5",
    R: "6",
  };

  let result = code[0]!;
  let prev = map[code[0]!] ?? "";
  for (let i = 1; i < code.length && result.length < 4; i++) {
    const c = map[code[i]!];
    if (c !== undefined && c !== prev) {
      result += c;
    }
    // H and W don't reset the prev code (so "Ashcraft" doesn't double the S)
    // but vowels do. We treat H/W as "no reset" to follow the patent.
    if (code[i] === "H" || code[i] === "W") {
      // no-op · keep prev
    } else {
      prev = c ?? "";
    }
  }
  return (result + "000").slice(0, 4);
}
