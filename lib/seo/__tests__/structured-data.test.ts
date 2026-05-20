/**
 * Structured-data generators · invariant tests.
 *
 * Per `.claude/rules/testing.md`, schema generation is "logic added" — pure
 * functions whose output ships in HTML to Google. A broken schema means
 * silent loss of rich-snippet eligibility, which is hard to detect from
 * Search Console (the snippet just stops appearing). Asserting the shape
 * here is cheap insurance.
 */

import { describe, expect, test } from "vitest";
import {
  breadcrumbSchema,
  faqSchema,
  jsonLdString,
  organizationSchema,
  websiteSchema,
} from "../structured-data";
import { CANONICAL_ORIGIN } from "../canonical";

describe("organizationSchema", () => {
  test("returns valid Schema.org Organization shape", () => {
    const org = organizationSchema();
    expect(org["@context"]).toBe("https://schema.org");
    expect(org["@type"]).toBe("Organization");
    expect(org.name).toBe("Mapsly");
    expect(org.url).toBe(CANONICAL_ORIGIN);
    expect(typeof org.description).toBe("string");
    expect((org.description as string).length).toBeGreaterThan(20);
    expect(Array.isArray(org.sameAs)).toBe(true);
  });

  test("description override is applied", () => {
    const org = organizationSchema({ description: "Custom blurb" });
    expect(org.description).toBe("Custom blurb");
  });

  test("sameAs profile URLs are included verbatim", () => {
    const profiles = [
      "https://twitter.com/mapsly",
      "https://linkedin.com/company/mapsly",
    ];
    const org = organizationSchema({ sameAs: profiles });
    expect(org.sameAs).toEqual(profiles);
  });

  test("output is JSON-serializable", () => {
    expect(() => JSON.parse(JSON.stringify(organizationSchema()))).not.toThrow();
  });
});

describe("websiteSchema", () => {
  test("returns minimal WebSite shape by default (no SearchAction)", () => {
    const site = websiteSchema();
    expect(site["@context"]).toBe("https://schema.org");
    expect(site["@type"]).toBe("WebSite");
    expect(site.name).toBe("Mapsly");
    expect(site.url).toBe(CANONICAL_ORIGIN);
    expect(site.potentialAction).toBeUndefined();
  });

  test("includes SearchAction when a search URL template is provided", () => {
    const site = websiteSchema({
      searchUrlTemplate: `${CANONICAL_ORIGIN}/search?q={search_term_string}`,
    });
    const action = site.potentialAction as Record<string, unknown>;
    expect(action["@type"]).toBe("SearchAction");
    const target = action.target as Record<string, unknown>;
    expect(target["@type"]).toBe("EntryPoint");
    expect(target.urlTemplate).toContain("{search_term_string}");
    expect(action["query-input"]).toBe(
      "required name=search_term_string",
    );
  });

  test("custom site name is applied", () => {
    const site = websiteSchema({ name: "Mapsly Dev" });
    expect(site.name).toBe("Mapsly Dev");
  });
});

describe("breadcrumbSchema", () => {
  test("returns Schema.org BreadcrumbList with 1-indexed positions", () => {
    const crumbs = breadcrumbSchema([
      { name: "Home", url: "/" },
      { name: "For Agencies", url: "/for-agencies" },
    ]);
    expect(crumbs["@context"]).toBe("https://schema.org");
    expect(crumbs["@type"]).toBe("BreadcrumbList");
    const items = crumbs.itemListElement as Array<Record<string, unknown>>;
    expect(items).toHaveLength(2);
    expect(items[0]!.position).toBe(1);
    expect(items[1]!.position).toBe(2);
    expect(items[0]!.name).toBe("Home");
    expect(items[1]!.name).toBe("For Agencies");
  });

  test("absolutifies relative URLs to canonical origin", () => {
    const crumbs = breadcrumbSchema([{ name: "Home", url: "/" }]);
    const items = crumbs.itemListElement as Array<Record<string, unknown>>;
    expect(items[0]!.item).toBe(`${CANONICAL_ORIGIN}/`);
  });

  test("preserves already-absolute URLs verbatim", () => {
    const crumbs = breadcrumbSchema([
      { name: "External", url: "https://example.com/page" },
    ]);
    const items = crumbs.itemListElement as Array<Record<string, unknown>>;
    expect(items[0]!.item).toBe("https://example.com/page");
  });

  test("rejects empty input — empty breadcrumbs are a programmer error", () => {
    expect(() => breadcrumbSchema([])).toThrow();
  });
});

describe("faqSchema", () => {
  test("returns Schema.org FAQPage with mainEntity", () => {
    const faq = faqSchema([
      { question: "What is Mapsly?", answer: "A local-business platform." },
      { question: "Is it free?", answer: "There is a paid tier from $29/mo." },
    ]);
    expect(faq["@context"]).toBe("https://schema.org");
    expect(faq["@type"]).toBe("FAQPage");
    const entries = faq.mainEntity as Array<Record<string, unknown>>;
    expect(entries).toHaveLength(2);
    expect(entries[0]!["@type"]).toBe("Question");
    expect(entries[0]!.name).toBe("What is Mapsly?");
    const answer = entries[0]!.acceptedAnswer as Record<string, unknown>;
    expect(answer["@type"]).toBe("Answer");
    expect(answer.text).toBe("A local-business platform.");
  });

  test("rejects empty input", () => {
    expect(() => faqSchema([])).toThrow();
  });
});

describe("jsonLdString", () => {
  test("produces parseable JSON", () => {
    const s = jsonLdString(organizationSchema());
    expect(() => JSON.parse(s)).not.toThrow();
  });

  test("escapes closing-script sequences (XSS defense-in-depth)", () => {
    const s = jsonLdString({
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "Pre </script><img src=x onerror=alert(1)> Post",
    });
    expect(s).not.toContain("</script>");
    expect(s).toContain("<\\/script");
    // Round-trip: after the escape, the JSON still parses to the original string
    const parsed = JSON.parse(s.replace(/<\\\/script/gi, "</script")) as {
      name: string;
    };
    expect(parsed.name).toContain("</script>");
  });

  test("case-insensitive closing-script escape", () => {
    const s = jsonLdString({
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "</SCRIPT>",
    });
    expect(s).not.toContain("</SCRIPT>");
  });
});
