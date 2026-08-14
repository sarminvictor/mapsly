/**
 * Golden tests for the hand-rolled sitemap builder (INC-2026-07-20-66).
 *
 * The GOLDEN_STATIC_LOCS list below is the EXACT `<loc>` set the live
 * production sitemap served on 2026-07-20 (captured before the
 * metadata-route → route-handler migration). The migration must not add,
 * drop, or rewrite a single static marketing URL — a diff here means the
 * marketing surface Google already knows about changed shape.
 */

import { describe, expect, test } from "vitest";

import {
  buildBizEntries,
  buildSitemapXml,
  buildStaticEntries,
  xmlEscape,
} from "../sitemap-xml";

/** Captured from https://www.mapsly.ai/sitemap.xml on 2026-07-20. */
const GOLDEN_STATIC_LOCS = [
  "https://www.mapsly.ai/",
  "https://www.mapsly.ai/es",
  "https://www.mapsly.ai/en-CA",
  "https://www.mapsly.ai/fr",
  "https://www.mapsly.ai/for-businesses",
  "https://www.mapsly.ai/es/para-empresas",
  "https://www.mapsly.ai/en-CA/for-businesses",
  "https://www.mapsly.ai/fr/pour-entreprises",
  // T1 · standalone /pricing page (added 2026-08-14).
  "https://www.mapsly.ai/pricing",
  "https://www.mapsly.ai/es/precios",
  "https://www.mapsly.ai/en-CA/pricing",
  "https://www.mapsly.ai/fr/tarifs",
  "https://www.mapsly.ai/compare/mapsly-vs-apollo",
  "https://www.mapsly.ai/es/compare/mapsly-vs-apollo",
  "https://www.mapsly.ai/en-CA/compare/mapsly-vs-apollo",
  "https://www.mapsly.ai/fr/compare/mapsly-vs-apollo",
  "https://www.mapsly.ai/compare/mapsly-vs-gohighlevel",
  "https://www.mapsly.ai/es/compare/mapsly-vs-gohighlevel",
  "https://www.mapsly.ai/en-CA/compare/mapsly-vs-gohighlevel",
  "https://www.mapsly.ai/fr/compare/mapsly-vs-gohighlevel",
  "https://www.mapsly.ai/compare/mapsly-vs-leadswift-d7",
  "https://www.mapsly.ai/es/compare/mapsly-vs-leadswift-d7",
  "https://www.mapsly.ai/en-CA/compare/mapsly-vs-leadswift-d7",
  "https://www.mapsly.ai/fr/compare/mapsly-vs-leadswift-d7",
  "https://www.mapsly.ai/privacy",
  "https://www.mapsly.ai/es/privacidad",
  "https://www.mapsly.ai/en-CA/privacy",
  "https://www.mapsly.ai/fr/confidentialite",
  "https://www.mapsly.ai/terms",
  "https://www.mapsly.ai/es/terminos",
  "https://www.mapsly.ai/en-CA/terms",
  "https://www.mapsly.ai/fr/conditions",
  "https://www.mapsly.ai/cookies",
  "https://www.mapsly.ai/es/cookies",
  "https://www.mapsly.ai/en-CA/cookies",
  "https://www.mapsly.ai/fr/temoins",
  "https://www.mapsly.ai/refunds",
  "https://www.mapsly.ai/es/reembolsos",
  "https://www.mapsly.ai/en-CA/refunds",
  "https://www.mapsly.ai/fr/remboursements",
];

describe("buildStaticEntries", () => {
  test("emits exactly the 40 golden static marketing URLs", () => {
    const locs = buildStaticEntries().map((e) => e.loc);
    expect(locs.length).toBe(40);
    expect([...locs].sort()).toEqual([...GOLDEN_STATIC_LOCS].sort());
  });

  test("every entry carries the full alternate set (4 locales + x-default)", () => {
    for (const entry of buildStaticEntries()) {
      const hreflangs = entry.alternates.map((a) => a.hreflang);
      expect(hreflangs).toEqual([
        "en-US",
        "es-US",
        "en-CA",
        "fr-CA",
        "x-default",
      ]);
      for (const alt of entry.alternates) {
        expect(alt.href).toMatch(/^https:\/\/www\.mapsly\.ai/);
      }
    }
  });

  test("en-CA URLs keep their casing (v0.19.36 regression lock)", () => {
    const locs = buildStaticEntries().map((e) => e.loc);
    expect(locs).toContain("https://www.mapsly.ai/en-CA");
    // The lowercase form 307s in production — it must never appear.
    expect(locs.some((l) => l.includes("/en-ca"))).toBe(false);
  });

  test("homepage entries carry priority 1.0", () => {
    const home = buildStaticEntries().filter(
      (e) => e.loc === "https://www.mapsly.ai/",
    );
    expect(home.length).toBe(1);
    expect(home[0]!.priority).toBe(1.0);
  });

  test("every entry's own URL appears in its alternate set (self-reference)", () => {
    for (const entry of buildStaticEntries()) {
      expect(entry.alternates.map((a) => a.href)).toContain(entry.loc);
    }
  });

  test("no duplicate URLs across static + biz entries", () => {
    const locs = [
      ...buildStaticEntries(),
      ...buildBizEntries([
        { slug: "some-biz", lastModified: new Date("2026-07-01T00:00:00Z") },
      ]),
    ].map((e) => e.loc);
    expect(new Set(locs).size).toBe(locs.length);
  });
});

describe("buildBizEntries", () => {
  const fixture = [
    {
      slug: "spectrum-aesthetics",
      lastModified: new Date("2026-07-01T00:00:00.000Z"),
    },
  ];

  test("emits one entry per locale with correct paths and lastmod", () => {
    const entries = buildBizEntries(fixture);
    expect(entries.map((e) => e.loc)).toEqual([
      "https://www.mapsly.ai/biz/spectrum-aesthetics",
      "https://www.mapsly.ai/es/biz/spectrum-aesthetics",
      "https://www.mapsly.ai/en-CA/biz/spectrum-aesthetics",
      "https://www.mapsly.ai/fr/biz/spectrum-aesthetics",
    ]);
    for (const e of entries) {
      expect(e.lastmod).toBe("2026-07-01T00:00:00.000Z");
      expect(e.priority).toBe(0.6);
      expect(e.changefreq).toBe("weekly");
      expect(e.alternates.map((a) => a.hreflang)).toEqual([
        "en-US",
        "es-US",
        "en-CA",
        "fr-CA",
        "x-default",
      ]);
    }
  });
});

describe("buildSitemapXml", () => {
  test("emits a namespaced urlset with x-default alternates", () => {
    const xml = buildSitemapXml(buildStaticEntries());
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain(
      'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
    );
    expect(xml).toContain('xmlns:xhtml="http://www.w3.org/1999/xhtml"');
    expect(xml).toContain('hreflang="x-default"');
    expect((xml.match(/<url>/g) ?? []).length).toBe(40);
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });

  test("escapes XML entities in every interpolated value", () => {
    const xml = buildSitemapXml(
      buildBizEntries([
        {
          slug: 'a&b<c>"d',
          lastModified: new Date("2026-07-01T00:00:00.000Z"),
        },
      ]),
    );
    expect(xml).toContain("a&amp;b&lt;c&gt;&quot;d");
    // No raw ampersand may survive outside entity encodings.
    expect(/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml)).toBe(false);
  });
});

describe("xmlEscape", () => {
  test("escapes the five XML entities", () => {
    expect(xmlEscape(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });
});
