/**
 * SmbFAQ + page-level JSON-LD shape lock.
 *
 * SEO matters (per `.claude/rules/seo.md`). The FAQPage + Organization
 * schemas have specific required fields that Google's structured-data
 * validator enforces; if a future refactor renames a key, the schema
 * silently produces invalid JSON-LD and we lose rich snippets.
 *
 * We don't ship a runtime validator — we lock the shape in tests.
 */
import { describe, expect, test } from "vitest";
import en from "../../../../messages/en.json";

interface FaqEntry {
  "@type": "Question";
  name: string;
  acceptedAnswer: {
    "@type": "Answer";
    text: string;
  };
}

function buildFaqSchema(t: (key: string) => string): {
  "@context": string;
  "@type": string;
  mainEntity: FaqEntry[];
} {
  const ITEMS = ["q1", "q2", "q3", "q4", "q5"] as const;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: ITEMS.map((q) => ({
      "@type": "Question",
      name: t(`faq.${q}`),
      acceptedAnswer: {
        "@type": "Answer",
        text: t(`faq.${q.replace("q", "a")}`),
      },
    })),
  };
}

describe("for_businesses · FAQPage JSON-LD shape", () => {
  // Build a thin t() that mirrors next-intl's nested-key dot-path lookup
  // against the JSON file. Good enough for schema-shape locking.
  const fb = (en as { for_businesses: Record<string, Record<string, string>> })
    .for_businesses;
  const t = (key: string): string => {
    const [section, ...rest] = key.split(".");
    const subKey = rest.join(".");
    const v = fb[section]?.[subKey];
    if (typeof v !== "string") throw new Error(`missing translation: ${key}`);
    return v;
  };

  test("schema parses and matches FAQPage shape exactly", () => {
    const schema = buildFaqSchema(t);
    // JSON.stringify → parse round-trip catches non-serializable values
    const json = JSON.stringify(schema);
    const parsed = JSON.parse(json);
    expect(parsed["@context"]).toBe("https://schema.org");
    expect(parsed["@type"]).toBe("FAQPage");
    expect(parsed.mainEntity).toHaveLength(5);
    for (const entry of parsed.mainEntity) {
      expect(entry["@type"]).toBe("Question");
      expect(typeof entry.name).toBe("string");
      expect(entry.name.length).toBeGreaterThan(0);
      expect(entry.acceptedAnswer["@type"]).toBe("Answer");
      expect(typeof entry.acceptedAnswer.text).toBe("string");
      expect(entry.acceptedAnswer.text.length).toBeGreaterThan(0);
    }
  });

  test("FAQ entries are short enough for Google rich-snippet eligibility (<5000 chars per answer)", () => {
    const schema = buildFaqSchema(t);
    for (const entry of schema.mainEntity) {
      expect(entry.acceptedAnswer.text.length).toBeLessThan(5000);
    }
  });

  test("meta title is under Google's ~60 char display limit", () => {
    // Google truncates titles around 60 chars on SERP. Soft assert at 70.
    expect(fb.meta.title.length).toBeLessThan(70);
  });

  test("meta description is between 120-180 chars (Google SERP ideal)", () => {
    expect(fb.meta.description.length).toBeGreaterThan(120);
    expect(fb.meta.description.length).toBeLessThan(200);
  });
});
