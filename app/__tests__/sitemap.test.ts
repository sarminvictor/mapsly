/**
 * sitemap + robots route handlers · invariant tests.
 *
 * `app/sitemap.ts` and `app/robots.ts` are Next.js metadata route handlers.
 * `robots` is sync; `sitemap` is async since B.5 (it enumerates active
 * businesses via `listBizSitemapEntries`, which is a cached Prisma query
 * that returns `[]` in test env because the lazy `lib/prisma.ts` proxy
 * throws when `DATABASE_URL` is unset — that throw is swallowed by the
 * `try/catch` in `listBizSitemapEntries` and falls back to empty).
 *
 * What we assert:
 *   - Sitemap has at least one entry per locale × static public path
 *   - Every URL is absolute on the canonical origin
 *   - Every entry declares hreflang sibling URLs
 *   - Robots references the sitemap
 *   - Authenticated routes are disallowed
 */

import { describe, expect, test, vi } from "vitest";

// `app/sitemap.ts` calls `listBizSitemapEntries` which uses `'use cache'` +
// cacheLife/cacheTag. Outside Next's runtime those throw E887. Stub them
// here so the sitemap function can run end-to-end. The biz enumeration
// still returns [] in test env because the lazy Prisma proxy throws when
// DATABASE_URL is unset — caught by listBizSitemapEntries's try/catch.
vi.mock("next/cache", () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  revalidateTag: vi.fn(),
  unstable_noStore: vi.fn(),
}));

import sitemap from "../sitemap";
import robots from "../robots";
import { routing } from "@/i18n/routing";
import { CANONICAL_ORIGIN } from "@/lib/seo/canonical";

describe("app/sitemap.ts", () => {
  test("emits at least one entry per (path × locale)", async () => {
    const entries = await sitemap();
    // 4 static public paths today (/, /privacy, /terms, /cookies) × 4 locales
    // = 16. Biz profile entries may add more in production, but `0` in test
    // env (Prisma proxy throws without DATABASE_URL, caught + returns []).
    expect(entries.length).toBeGreaterThanOrEqual(routing.locales.length * 4);
  });

  test("every URL is absolute on the canonical origin", async () => {
    for (const entry of await sitemap()) {
      expect(entry.url.startsWith(`${CANONICAL_ORIGIN}/`)).toBe(true);
    }
  });

  test("homepage has priority 1.0", async () => {
    const home = (await sitemap()).filter(
      (e) => e.url === `${CANONICAL_ORIGIN}/`,
    );
    expect(home.length).toBeGreaterThan(0);
    for (const entry of home) {
      expect(entry.priority).toBe(1.0);
    }
  });

  test("lastModified is set on every entry", async () => {
    for (const entry of await sitemap()) {
      expect(entry.lastModified).toBeDefined();
    }
  });

  test("every entry declares its hreflang siblings", async () => {
    for (const entry of await sitemap()) {
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

  test("each entry's own URL appears in its languages block", async () => {
    for (const entry of await sitemap()) {
      const langs = entry.alternates?.languages as Record<string, string>;
      const values = Object.values(langs);
      expect(values).toContain(entry.url);
    }
  });

  test("there are no duplicate URLs", async () => {
    const urls = (await sitemap()).map((e) => e.url);
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
