// Routing-test for /en-ca path + locale-specific copy.
//
// I.4 deliverable. The Canadian English locale is implemented as a sparse
// override file on top of en.json — the spec ".claude/rules/i18n.md" says
// "only Canada-specific overrides (e.g. cheque vs check)". This test pins
// that contract so a future edit to en.json doesn't silently drift the
// fallback assumptions, and so an empty/missing en-CA file is caught fast.

import enMessages from "../../messages/en.json";
import enCAMessages from "../../messages/en-CA.json";
import { describe, expect, test } from "vitest";

import { routing } from "../routing";

/* ------------------------------------------------------------------------ */
/* Routing config                                                            */
/* ------------------------------------------------------------------------ */

describe("routing config · en-CA", () => {
  test("en-CA is a registered locale", () => {
    expect(routing.locales).toContain("en-CA");
  });

  test("default locale is en (en-CA falls back to en)", () => {
    expect(routing.defaultLocale).toBe("en");
  });

  test("en-CA pathnames mirror en (no translated routes for Canadian English)", () => {
    // For every translated pathname, en-CA matches en. Spanish + French
    // get their own pathnames; en-CA does not — it's the same routing tree
    // as en with only message-string overrides.
    const pathnames = routing.pathnames as Record<
      string,
      string | Record<string, string>
    >;
    for (const config of Object.values(pathnames)) {
      if (typeof config === "object") {
        expect(config["en-CA"]).toBe(config["en"]);
      }
    }
  });
});

/* ------------------------------------------------------------------------ */
/* Message file shape                                                        */
/* ------------------------------------------------------------------------ */

describe("messages/en-CA.json · sparse override file", () => {
  test("file is valid JSON and parses to a plain object", () => {
    expect(enCAMessages).toBeDefined();
    expect(typeof enCAMessages).toBe("object");
    expect(Array.isArray(enCAMessages)).toBe(false);
  });

  test("Canadian spelling: agency.lists.service_templates.brand is 'Brand defence'", () => {
    // The en baseline uses American 'defense'; en-CA overrides to 'defence'.
    expect(enMessages.agency.lists.service_templates.brand).toBe(
      "Brand defense",
    );
    expect(enCAMessages.agency.lists.service_templates.brand).toBe(
      "Brand defence",
    );
  });

  test("override file is SPARSE — does not duplicate untouched en keys", () => {
    // Sparse-override discipline: every key present in en-CA must represent
    // an INTENTIONAL deviation from en. If en-CA contains a key that
    // matches en byte-for-byte, that's accidental duplication — it makes
    // future en updates silently land at en-US but not en-CA.
    const flatten = (
      obj: Record<string, unknown>,
      prefix = "",
    ): Record<string, unknown> => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === "object" && !Array.isArray(v)) {
          Object.assign(out, flatten(v as Record<string, unknown>, path));
        } else {
          out[path] = v;
        }
      }
      return out;
    };

    const flatEn = flatten(enMessages as unknown as Record<string, unknown>);
    const flatEnCA = flatten(
      enCAMessages as unknown as Record<string, unknown>,
    );

    const accidentalDuplicates: string[] = [];
    for (const [path, val] of Object.entries(flatEnCA)) {
      if (path in flatEn && flatEn[path] === val) {
        accidentalDuplicates.push(path);
      }
    }
    expect(accidentalDuplicates).toEqual([]);
  });

  test("every key in en-CA also exists in en (no orphan overrides)", () => {
    // If en-CA defines a key path that doesn't exist in en, the override
    // never resolves — typo or stale key. Catch it.
    const flatten = (
      obj: Record<string, unknown>,
      prefix = "",
    ): Set<string> => {
      const out = new Set<string>();
      for (const [k, v] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (v && typeof v === "object" && !Array.isArray(v)) {
          for (const child of flatten(
            v as Record<string, unknown>,
            path,
          ).values()) {
            out.add(child);
          }
        } else {
          out.add(path);
        }
      }
      return out;
    };

    const enKeys = flatten(enMessages as unknown as Record<string, unknown>);
    const enCAKeys = flatten(
      enCAMessages as unknown as Record<string, unknown>,
    );

    const orphans: string[] = [];
    for (const path of enCAKeys) {
      if (!enKeys.has(path)) orphans.push(path);
    }
    expect(orphans).toEqual([]);
  });
});
