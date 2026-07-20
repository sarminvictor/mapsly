/**
 * robots route handler · invariant tests.
 *
 * The sitemap half of this file died with `app/sitemap.ts`
 * (INC-2026-07-20-66: metadata routes bake their build-time result under
 * cacheComponents — the sitemap is now the request-time route handler
 * `app/sitemap.xml/route.ts`). Its invariants moved to
 * `lib/seo/__tests__/sitemap-xml.test.ts`, which golden-locks the exact
 * static URL set instead of shape-checking it.
 *
 * What we assert here:
 *   - Robots references the sitemap (URL unchanged by the migration)
 *   - Authenticated routes are disallowed
 */

import { describe, expect, test } from "vitest";

import robots from "../robots";
import { CANONICAL_ORIGIN } from "@/lib/seo/canonical";

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
    expect(disallow).toContain("/home");
    expect(disallow).toContain("/discover");
    expect(disallow).toContain("/signin");
    expect(disallow).toContain("/dev");
  });
});
