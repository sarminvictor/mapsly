/**
 * hreflang + canonical helpers · invariant tests.
 *
 * What's tested:
 *   - Every routing locale maps to a unique BCP-47 region tag
 *   - URL slug map matches the `localePrefix: "as-needed"` convention
 *     (default locale has empty slug; en-CA is lowercased)
 *   - Translated paths from `routing.pathnames` are picked up correctly
 *   - `buildHreflang` includes every locale + `x-default`
 *   - `buildAlternates` produces an absolute canonical + relative hreflangs
 *
 * What's NOT tested (intentional):
 *   - The rendered HTML output of Next's Metadata API (Next's responsibility)
 *   - DataForSEO or any external integration
 */

import { describe, expect, test } from "vitest";
import {
  ALL_LOCALES,
  LOCALE_TO_BCP47,
  LOCALE_TO_URL_SLUG,
  buildAlternates,
  buildHreflang,
  localizedPath,
  resolveTranslatedPath,
} from "../hreflang";
import { routing, type Locale } from "@/i18n/routing";
import { CANONICAL_ORIGIN } from "../canonical";

describe("locale mapping tables", () => {
  test("LOCALE_TO_BCP47 covers every routing locale", () => {
    for (const locale of routing.locales) {
      expect(LOCALE_TO_BCP47[locale]).toBeDefined();
    }
  });

  test("LOCALE_TO_BCP47 values are unique (no two routing locales share a tag)", () => {
    const values = Object.values(LOCALE_TO_BCP47);
    expect(new Set(values).size).toBe(values.length);
  });

  test("LOCALE_TO_BCP47 follows BCP-47 region-tag format", () => {
    for (const tag of Object.values(LOCALE_TO_BCP47)) {
      // ll-RR pattern
      expect(tag).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    }
  });

  test("LOCALE_TO_URL_SLUG covers every routing locale", () => {
    for (const locale of routing.locales) {
      expect(LOCALE_TO_URL_SLUG[locale]).toBeDefined();
    }
  });

  test("default locale's URL slug is empty (no prefix)", () => {
    expect(LOCALE_TO_URL_SLUG[routing.defaultLocale]).toBe("");
  });

  test("non-default locales' URL slugs are lowercased + non-empty", () => {
    for (const locale of routing.locales) {
      if (locale === routing.defaultLocale) continue;
      const slug = LOCALE_TO_URL_SLUG[locale];
      expect(slug).not.toBe("");
      expect(slug).toBe(slug.toLowerCase());
    }
  });

  test("ALL_LOCALES exports the same set as routing.locales", () => {
    expect([...ALL_LOCALES].sort()).toEqual([...routing.locales].sort());
  });
});

describe("resolveTranslatedPath", () => {
  test("returns the English path for the default locale", () => {
    expect(resolveTranslatedPath("/for-agencies", "en")).toBe("/for-agencies");
  });

  test("returns the Spanish translated path", () => {
    expect(resolveTranslatedPath("/for-agencies", "es")).toBe("/para-agencias");
  });

  test("returns the French translated path", () => {
    expect(resolveTranslatedPath("/for-agencies", "fr")).toBe("/pour-agences");
  });

  test("en-CA inherits the English path (Canadian English shares routes)", () => {
    expect(resolveTranslatedPath("/for-agencies", "en-CA")).toBe(
      "/for-agencies",
    );
  });

  test("the homepage is always '/'", () => {
    for (const locale of routing.locales) {
      expect(resolveTranslatedPath("/", locale)).toBe("/");
    }
  });

  test("unknown logical paths fall through unchanged", () => {
    // /biz/[slug] is not in routing.pathnames yet (B.5 hasn't shipped)
    expect(resolveTranslatedPath("/biz/some-spa", "en")).toBe("/biz/some-spa");
    expect(resolveTranslatedPath("/biz/some-spa", "fr")).toBe("/biz/some-spa");
  });
});

describe("localizedPath", () => {
  test("homepage URLs per locale", () => {
    expect(localizedPath("/", "en")).toBe("/");
    expect(localizedPath("/", "es")).toBe("/es");
    expect(localizedPath("/", "en-CA")).toBe("/en-ca");
    expect(localizedPath("/", "fr")).toBe("/fr");
  });

  test("/for-agencies URLs per locale", () => {
    expect(localizedPath("/for-agencies", "en")).toBe("/for-agencies");
    expect(localizedPath("/for-agencies", "es")).toBe("/es/para-agencias");
    expect(localizedPath("/for-agencies", "en-CA")).toBe("/en-ca/for-agencies");
    expect(localizedPath("/for-agencies", "fr")).toBe("/fr/pour-agences");
  });

  test("/privacy URLs per locale", () => {
    expect(localizedPath("/privacy", "en")).toBe("/privacy");
    expect(localizedPath("/privacy", "es")).toBe("/es/privacidad");
    expect(localizedPath("/privacy", "en-CA")).toBe("/en-ca/privacy");
    expect(localizedPath("/privacy", "fr")).toBe("/fr/confidentialite");
  });

  test("/refunds URLs per locale", () => {
    expect(localizedPath("/refunds", "en")).toBe("/refunds");
    expect(localizedPath("/refunds", "es")).toBe("/es/reembolsos");
    expect(localizedPath("/refunds", "en-CA")).toBe("/en-ca/refunds");
    expect(localizedPath("/refunds", "fr")).toBe("/fr/remboursements");
  });

  test("unknown paths get the locale prefix without translation", () => {
    expect(localizedPath("/biz/some-spa", "en")).toBe("/biz/some-spa");
    expect(localizedPath("/biz/some-spa", "es")).toBe("/es/biz/some-spa");
    expect(localizedPath("/biz/some-spa", "fr")).toBe("/fr/biz/some-spa");
  });
});

describe("buildHreflang", () => {
  test("homepage produces every locale + x-default", () => {
    const langs = buildHreflang("/");
    expect(langs).toEqual({
      "en-US": "/",
      "es-US": "/es",
      "en-CA": "/en-ca",
      "fr-CA": "/fr",
      "x-default": "/",
    });
  });

  test("/for-agencies produces translated paths per locale", () => {
    const langs = buildHreflang("/for-agencies");
    expect(langs).toEqual({
      "en-US": "/for-agencies",
      "es-US": "/es/para-agencias",
      "en-CA": "/en-ca/for-agencies",
      "fr-CA": "/fr/pour-agences",
      "x-default": "/for-agencies",
    });
  });

  test("x-default equals the default-locale URL", () => {
    for (const logical of [
      "/",
      "/for-agencies",
      "/privacy",
      "/terms",
      "/refunds",
    ]) {
      const langs = buildHreflang(logical);
      expect(langs["x-default"]).toBe(
        langs[LOCALE_TO_BCP47[routing.defaultLocale]],
      );
    }
  });

  test("every output is a relative path (starts with '/')", () => {
    const langs = buildHreflang("/for-agencies");
    for (const url of Object.values(langs)) {
      expect(url.startsWith("/")).toBe(true);
      expect(url.startsWith("http")).toBe(false);
    }
  });
});

describe("buildAlternates", () => {
  test("canonical is absolute on the production origin", () => {
    const alt = buildAlternates("/for-agencies", "en");
    expect(alt.canonical).toBe(`${CANONICAL_ORIGIN}/for-agencies`);
  });

  test("canonical reflects the locale of the rendering page", () => {
    const enAlt = buildAlternates("/for-agencies", "en");
    const esAlt = buildAlternates("/for-agencies", "es");
    expect(enAlt.canonical).toBe(`${CANONICAL_ORIGIN}/for-agencies`);
    expect(esAlt.canonical).toBe(`${CANONICAL_ORIGIN}/es/para-agencias`);
  });

  test("languages block matches buildHreflang output exactly", () => {
    const alt = buildAlternates("/", "en");
    expect(alt.languages).toEqual(buildHreflang("/"));
  });

  test("works for every routing locale", () => {
    for (const locale of routing.locales as readonly Locale[]) {
      const alt = buildAlternates("/", locale);
      expect(alt.canonical.startsWith(CANONICAL_ORIGIN)).toBe(true);
      expect(Object.keys(alt.languages).length).toBe(
        routing.locales.length + 1, // + x-default
      );
    }
  });
});
