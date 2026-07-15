// Routing test · translated pathnames + helper contract (I.6).
//
// Pins the invariants `.claude/rules/i18n.md` requires:
//   - every translated pathname declares all 4 locales (no silent fallback)
//   - en-CA mirrors en (Canadian English shares routes with US English)
//   - es and fr actually differ from en (translation, not copy-paste)
//   - the `getLocalizedPath` helper honors `as-needed` prefixing
//   - `getLocaleAlternates` produces the BCP-47-keyed map Next's Metadata
//     API expects, including `x-default` → default-locale path
//
// If any of these regress, the marketing pages will silently emit
// incorrect hreflang or canonical URLs and SEO drift starts immediately.

import { describe, expect, test } from "vitest";

import {
  LOCALE_TO_BCP47,
  getLocaleAlternates,
  getLocalizedPath,
  getPathsByLocale,
} from "../pathnames";
import { routing, type Locale } from "../routing";

const ALL_LOCALES: readonly Locale[] = routing.locales;

/* ------------------------------------------------------------------------ */
/* Pathnames configuration                                                   */
/* ------------------------------------------------------------------------ */

describe("routing.pathnames · translated route invariants", () => {
  // Every entry whose value is an object must declare every supported locale.
  // (String values are locale-agnostic and skipped.)
  const translatedEntries = Object.entries(
    routing.pathnames as Record<string, string | Record<string, string>>,
  ).filter(
    (entry): entry is [string, Record<string, string>] =>
      typeof entry[1] === "object",
  );

  test("at least one translated pathname is declared (sanity)", () => {
    expect(translatedEntries.length).toBeGreaterThan(0);
  });

  for (const [canonical, config] of translatedEntries) {
    test(`pathname ${canonical} declares all 4 locales`, () => {
      for (const locale of ALL_LOCALES) {
        expect(
          config[locale],
          `missing translation for ${locale} on ${canonical}`,
        ).toBeTypeOf("string");
        expect(
          config[locale].length,
          `empty translation for ${locale} on ${canonical}`,
        ).toBeGreaterThan(0);
      }
    });

    test(`pathname ${canonical} · en-CA mirrors en (no Canadian-English route translation)`, () => {
      expect(config["en-CA"]).toBe(config.en);
    });

    test(`pathname ${canonical} · es and fr actually translate (differ from en where translation is meaningful)`, () => {
      // The root path "/" stays identical across all locales —
      // The root path "/" stays identical across all locales — there's
      // no English word to translate. /cookies has its own translation
      // in fr (/temoins). Every other translated route must differ in
      // at least one of es/fr to count as a real translation.
      const trivial = canonical === "/";
      if (trivial) return;

      const enValue = config.en;
      expect(
        config.es !== enValue || config.fr !== enValue,
        `${canonical} has identical es and fr to en (not actually translated)`,
      ).toBe(true);
    });

    test(`pathname ${canonical} starts with "/"`, () => {
      for (const locale of ALL_LOCALES) {
        expect(
          config[locale].startsWith("/"),
          `${locale} value '${config[locale]}' does not start with /`,
        ).toBe(true);
      }
    });
  }
});

/* ------------------------------------------------------------------------ */
/* LOCALE_TO_BCP47                                                           */
/* ------------------------------------------------------------------------ */

describe("LOCALE_TO_BCP47", () => {
  test("maps every supported locale", () => {
    for (const locale of ALL_LOCALES) {
      expect(LOCALE_TO_BCP47[locale]).toBeTypeOf("string");
    }
  });

  test("matches the SEO rule contract (en-US / es-US / en-CA / fr-CA)", () => {
    expect(LOCALE_TO_BCP47.en).toBe("en-US");
    expect(LOCALE_TO_BCP47.es).toBe("es-US");
    expect(LOCALE_TO_BCP47["en-CA"]).toBe("en-CA");
    expect(LOCALE_TO_BCP47.fr).toBe("fr-CA");
  });

  test("is frozen — accidental mutation throws in strict mode", () => {
    expect(Object.isFrozen(LOCALE_TO_BCP47)).toBe(true);
  });
});

/* ------------------------------------------------------------------------ */
/* getLocalizedPath                                                          */
/* ------------------------------------------------------------------------ */

describe("getLocalizedPath", () => {
  test("default locale gets no prefix (as-needed)", () => {
    expect(getLocalizedPath("/for-agencies", "en")).toBe("/for-agencies");
    expect(getLocalizedPath("/", "en")).toBe("/");
  });

  test("non-default locales get a /{locale} prefix, verbatim casing", () => {
    expect(getLocalizedPath("/for-agencies", "es")).toBe("/es/para-agencias");
    expect(getLocalizedPath("/for-agencies", "fr")).toBe("/fr/pour-agences");
    expect(getLocalizedPath("/for-agencies", "en-CA")).toBe(
      "/en-CA/for-agencies",
    );
  });

  test("root path resolves to /{locale} for prefixed locales (no trailing slash)", () => {
    expect(getLocalizedPath("/", "es")).toBe("/es");
    expect(getLocalizedPath("/", "fr")).toBe("/fr");
    expect(getLocalizedPath("/", "en-CA")).toBe("/en-CA");
  });

  test("locale-agnostic pathnames (string config) use the canonical for every locale", () => {
    // "/" is configured as the bare string "/" in routing.pathnames —
    // every locale resolves to the same segment plus its prefix.
    expect(getLocalizedPath("/", "en")).toBe("/");
    expect(getLocalizedPath("/", "fr")).toBe("/fr");
  });

  test("translated routes use the per-locale segment", () => {
    expect(getLocalizedPath("/for-agencies", "es")).toBe("/es/para-agencias");
    expect(getLocalizedPath("/for-agencies", "fr")).toBe("/fr/pour-agences");
    expect(getLocalizedPath("/home", "es")).toBe("/es/inicio");
    expect(getLocalizedPath("/home", "fr")).toBe("/fr/accueil");
  });

  test("nested routes preserve the per-locale segment", () => {
    expect(getLocalizedPath("/signin/check-email", "es")).toBe(
      "/es/iniciar-sesion/revisa-tu-correo",
    );
    expect(getLocalizedPath("/signin/check-email", "fr")).toBe(
      "/fr/connexion/verifiez-vos-courriels",
    );
  });

  test("unmapped canonical falls back to the canonical itself (defensive)", () => {
    // Not in routing.pathnames — helper returns the raw path so URLs stay
    // sensible. The test suite catches real callers via the alternates
    // contract test below.
    expect(getLocalizedPath("/unmapped-route", "en")).toBe("/unmapped-route");
    expect(getLocalizedPath("/unmapped-route", "es")).toBe(
      "/es/unmapped-route",
    );
  });
});

/* ------------------------------------------------------------------------ */
/* getLocaleAlternates                                                       */
/* ------------------------------------------------------------------------ */

describe("getLocaleAlternates", () => {
  test("returns 5 keys: 4 BCP-47 locales + x-default", () => {
    const alts = getLocaleAlternates("/for-agencies");
    expect(Object.keys(alts).sort()).toEqual([
      "en-CA",
      "en-US",
      "es-US",
      "fr-CA",
      "x-default",
    ]);
  });

  test("for-agencies alternates match the expected paths", () => {
    expect(getLocaleAlternates("/for-agencies")).toEqual({
      "en-US": "/for-agencies",
      "es-US": "/es/para-agencias",
      "en-CA": "/en-CA/for-agencies",
      "fr-CA": "/fr/pour-agences",
      "x-default": "/for-agencies",
    });
  });

  test("for-businesses alternates match the expected paths", () => {
    expect(getLocaleAlternates("/for-businesses")).toEqual({
      "en-US": "/for-businesses",
      "es-US": "/es/para-empresas",
      "en-CA": "/en-CA/for-businesses",
      "fr-CA": "/fr/pour-entreprises",
      "x-default": "/for-businesses",
    });
  });

  test("root alternates match the expected paths", () => {
    expect(getLocaleAlternates("/")).toEqual({
      "en-US": "/",
      "es-US": "/es",
      "en-CA": "/en-CA",
      "fr-CA": "/fr",
      "x-default": "/",
    });
  });

  test("x-default always equals the en-US value (default locale)", () => {
    for (const canonical of [
      "/",
      "/for-businesses",
      "/for-agencies",
      "/privacy",
      "/terms",
      "/cookies",
      "/refunds",
      "/signin",
      "/home",
      "/discover",
    ]) {
      const alts = getLocaleAlternates(canonical);
      expect(
        alts["x-default"],
        `x-default vs en-US mismatch for ${canonical}`,
      ).toBe(alts["en-US"]);
    }
  });

  test("en-CA value never differs from en-US (Canadian English shares routes)", () => {
    for (const canonical of Object.keys(routing.pathnames)) {
      const alts = getLocaleAlternates(canonical);
      expect(
        alts["en-CA"].replace(/^\/en-CA/, "") || "/",
        `en-CA path segment vs en-US mismatch for ${canonical}`,
      ).toBe(alts["en-US"]);
    }
  });
});

/* ------------------------------------------------------------------------ */
/* getPathsByLocale                                                          */
/* ------------------------------------------------------------------------ */

describe("getPathsByLocale", () => {
  test("returns one entry per locale, keyed by internal locale code", () => {
    const paths = getPathsByLocale("/for-agencies");
    expect(Object.keys(paths).sort()).toEqual(
      [...ALL_LOCALES].sort() as string[],
    );
  });

  test("matches getLocalizedPath for each locale", () => {
    const paths = getPathsByLocale("/for-agencies");
    for (const locale of ALL_LOCALES) {
      expect(paths[locale]).toBe(getLocalizedPath("/for-agencies", locale));
    }
  });
});
