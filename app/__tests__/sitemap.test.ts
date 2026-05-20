/**
 * sitemap + robots route handlers · invariant tests.
 *
 * `app/sitemap.ts` and `app/robots.ts` are Next.js metadata route handlers,
 * not Server Components — they run at request time + the function is pure
 * with respect to inputs (no DB, no env-time data). Easy to unit-test.
 *
 * What we assert:
 *   - Sitemap has at least one entry per locale × public path
 *   - Every URL is absolute on the canonical origin
 *   - Every entry declares hreflang sibling URLs
 *   - Robots references the sitemap
 *   - Authenticated routes are disallowed
 */

import { describe, expect, test } from "vitest";
import sitemap from "../sitemap";
import robots from "../robots";
import { routing } from "@/i18n/routing";
import { CANONICAL_ORIGIN } from "@/lib/seo/canonical";

describe("app/sitemap.ts", () => {
  test("emits at least one entry per (path × locale)", () => {
    const entries = sitemap();
    // 4 public paths today (/, /privacy, /terms, /cookies) × 4 locales = 16
    // This number bumps as B.2–B.5 ship; assert ≥ 4 × 4 to keep the test
    // robust against new public routes landing.
    expect(entries.length).toBeGreaterThanOrEqual(routing.locales.length * 4);
  });

  test("every URL is absolute on the canonical origin", () => {
    for (const entry of sitemap()) {
      expect(entry.url.startsWith(`${CANONICAL_ORIGIN}/`)).toBe(true);
    }
  });

  test("homepage has priority 1.0", () => {
    const home = sitemap().filter((e) => e.url === `${CANONICAL_ORIGIN}/`);
    expect(home.length).toBeGreaterThan(0);
    for (const entry of home) {
      expect(entry.priority).toBe(1.0);
    }
  });

  test("lastModified is set on every entry", () => {
    for (const entry of sitemap()) {
      expect(entry.lastModified).toBeDefined();
    }
  });

  test("every entry declares its hreflang siblings", () => {
    for (const entry of sitemap()) {
      const langs = entry.alternates?.languages as
        | Record<string, string>
        | undefined;
      expect(langs).toBeDefined();
      expect(Object.keys(langs!).length).toBeGreaterThanOrEqual(
        routing.locales.length, // one per locale (plus x-default)
      );
      // x-default required for multilingual sitemaps
      expect(langs!["x-default"]).toBeDefined();
    }
  });

  test("each entry's own URL appears in its languages block", () => {
    for (const entry of sitemap()) {
      const langs = entry.alternates?.languages as Record<string, string>;
      const values = Object.values(langs);
      expect(values).toContain(entry.url);
    }
  });

  test("there are no duplicate URLs", () => {
    const urls = sitemap().map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe("app/robots.ts", () => {
  test("declares the sitemap URL", () => {
    const r = robots();
    expect(r.sitemap).toBe(`${CANONICAL_ORIGIN}/sitemap.xml`);
  });

  test("has a single wildcard rule allowing root", () => {
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    expect(rules.length).toBeGreaterThanOrEqual(1);
    const wildcard = rules.find((rule) => rule.userAgent === "*");
    expect(wildcard).toBeDefined();
    expect(wildcard!.allow).toBe("/");
  });

  test("disallows API + authenticated portal routes", () => {
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
    const wildcard = rules.find((rule) => rule.userAgent === "*")!;
    const disallow = wildcard.disallow as string[];
    expect(disallow).toContain("/api/");
    expect(disallow).toContain("/dashboard");
    expect(disallow).toContain("/lists");
    expect(disallow).toContain("/signin");
    expect(disallow).toContain("/dev");
  });
});
