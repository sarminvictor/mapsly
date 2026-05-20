// Snapshot tests for the per-locale formatters.
//
// Strategy: pin a fixed reference time and `timeZone: "UTC"` where time-of-day
// is rendered, then assert the EXACT output string per locale. These are
// allowed snapshot tests per `.claude/rules/testing.md` § "Snapshot tests for
// compute formulas (golden values)" — the input is a fixed value, the output
// is a deterministic string, so the test catches accidental regressions in
// locale mapping or fraction-digit defaults.
//
// IMPORTANT — Unicode whitespace:
//   `Intl.NumberFormat` emits NO-BREAK SPACE (U+00A0) between digit groups
//   and the currency symbol for fr-CA and en-CA on Node 24's bundled ICU.
//   We pin these via ` ` literals in the expected strings, NOT regular
//   spaces. If the test reports `expected "1 234"` vs `actual "1 234"` and
//   looks identical, it's almost certainly an NBSP mismatch — diff with
//   `node -e 'console.log([..."<str>"].map(c => c.codePointAt(0).toString(16)))'`
//   to confirm.
//
// IMPORTANT — Currency display defaults on Canadian locales:
//   `Intl.NumberFormat("en-CA", { currency: "CAD" })` emits a BARE `$` (not
//   `CA$`). Canadian English speakers know their default currency is CAD —
//   the disambiguator only appears when rendering a foreign currency, e.g.
//   `Intl.NumberFormat("fr-CA", { currency: "USD" })` → `"29,99 $ US"`.
//   This matches platform conventions and is what we want; if a caller needs
//   the unambiguous "CAD" prefix, they should pass
//   `currencyDisplay: "code"` (yields `"CAD 29.99"`).

import { describe, expect, test } from "vitest";

import {
  defaultCurrencyForLocale,
  formatDate,
  formatNumber,
  formatPrice,
  formatRelativeTime,
  localeToBcp47,
} from "../format";

/* ------------------------------------------------------------------------ */
/* Locale mapping                                                            */
/* ------------------------------------------------------------------------ */

describe("localeToBcp47", () => {
  test("expands short routing slugs to region-tagged BCP-47", () => {
    expect(localeToBcp47("en")).toBe("en-US");
    expect(localeToBcp47("es")).toBe("es-US");
    expect(localeToBcp47("en-CA")).toBe("en-CA");
    expect(localeToBcp47("fr")).toBe("fr-CA");
  });

  test("unknown locale passes through unchanged", () => {
    expect(localeToBcp47("pt-BR")).toBe("pt-BR");
  });
});

describe("defaultCurrencyForLocale", () => {
  test("US locales default to USD, Canadian locales to CAD", () => {
    expect(defaultCurrencyForLocale("en")).toBe("USD");
    expect(defaultCurrencyForLocale("es")).toBe("USD");
    expect(defaultCurrencyForLocale("en-CA")).toBe("CAD");
    expect(defaultCurrencyForLocale("fr")).toBe("CAD");
  });

  test("accepts expanded BCP-47 tags and resolves to the routing slug currency", () => {
    // fr-CA must resolve to CAD even when passed in BCP-47 form (not just
    // the routing slug "fr"). Without normalization, the lookup falls back
    // to USD — a real correctness bug spotted in review.
    expect(defaultCurrencyForLocale("fr-CA")).toBe("CAD");
    expect(defaultCurrencyForLocale("en-US")).toBe("USD");
    expect(defaultCurrencyForLocale("es-US")).toBe("USD");
  });

  test("unknown locale falls back to USD", () => {
    expect(defaultCurrencyForLocale("pt-BR")).toBe("USD");
  });
});

/* ------------------------------------------------------------------------ */
/* Numbers                                                                   */
/* ------------------------------------------------------------------------ */

describe("formatNumber", () => {
  test("en-US groups with commas and dots for decimal", () => {
    expect(formatNumber(1234567.89, "en")).toBe("1,234,567.89");
  });

  test("fr-CA groups with NBSP and commas for decimal", () => {
    // U+00A0 NO-BREAK SPACE between groups, comma as decimal separator.
    expect(formatNumber(1234567.89, "fr")).toBe("1 234 567,89");
  });

  test("renders '—' for null / undefined / NaN by default", () => {
    expect(formatNumber(null, "en")).toBe("—");
    expect(formatNumber(undefined, "en")).toBe("—");
    expect(formatNumber(Number.NaN, "en")).toBe("—");
  });

  test("custom fallback respected", () => {
    expect(formatNumber(null, "en", { fallback: "n/a" })).toBe("n/a");
  });

  test("forwards Intl options · percent format", () => {
    expect(
      formatNumber(0.4321, "en", {
        style: "percent",
        maximumFractionDigits: 1,
      }),
    ).toBe("43.2%");
  });
});

/* ------------------------------------------------------------------------ */
/* Prices                                                                    */
/* ------------------------------------------------------------------------ */

describe("formatPrice", () => {
  test("en-US default → USD with bare '$'", () => {
    expect(formatPrice(29.99, "en")).toBe("$29.99");
    expect(formatPrice(2999, "en")).toBe("$2,999.00");
  });

  test("es-US default → USD with bare '$' · same shape as en-US", () => {
    expect(formatPrice(2999, "es")).toBe("$2,999.00");
  });

  test("en-CA default → CAD with bare '$' (Canadian default · unambiguous)", () => {
    expect(formatPrice(29.99, "en-CA")).toBe("$29.99");
  });

  test("fr-CA default → CAD with comma decimal and trailing '$'", () => {
    // NBSP between digits and currency symbol.
    expect(formatPrice(29.99, "fr")).toBe("29,99 $");
  });

  test("fr-CA with explicit foreign currency (USD) adds 'US' suffix", () => {
    // ICU disambiguates foreign currency: "29,99 $ US"
    expect(formatPrice(29.99, "fr", { currency: "USD" })).toBe("29,99 $ US");
  });

  test("en-CA explicit foreign currency (USD) emits 'US$'", () => {
    // ICU prefixes foreign currency code in Canadian English.
    expect(formatPrice(29.99, "en-CA", { currency: "USD" })).toBe("US$29.99");
  });

  test("trimWholeAmountFraction strips '.00' for whole numbers", () => {
    expect(formatPrice(29, "en", { trimWholeAmountFraction: true })).toBe(
      "$29",
    );
    // Non-whole amounts keep two decimals.
    expect(formatPrice(29.5, "en", { trimWholeAmountFraction: true })).toBe(
      "$29.50",
    );
  });

  test("en-CA with explicit CAD currency · same as default (bare $)", () => {
    // Explicit CAD pass-through verifies the option plumbing — output stays
    // the bare '$' that en-CA emits by default. Callers wanting an explicit
    // 'CAD' prefix should reach for next-intl's useFormatter() with
    // currencyDisplay='code' instead.
    expect(formatPrice(29.99, "en-CA", { currency: "CAD" })).toBe("$29.99");
  });

  test("renders '—' for null / NaN by default", () => {
    expect(formatPrice(null, "en")).toBe("—");
    expect(formatPrice(Number.NaN, "fr")).toBe("—");
  });

  test("custom fallback respected", () => {
    expect(formatPrice(null, "en", { fallback: "n/a" })).toBe("n/a");
  });
});

/* ------------------------------------------------------------------------ */
/* Dates                                                                     */
/* ------------------------------------------------------------------------ */

// Reference date pinned so the snapshots don't drift with the clock.
// 2026-05-17 14:30:00 UTC — a Sunday.
const REF_ISO = "2026-05-17T14:30:00Z";

describe("formatDate", () => {
  test("default 'medium' style · en-US", () => {
    expect(formatDate(REF_ISO, "en")).toBe("May 17, 2026");
  });

  test("default 'medium' style · es-US", () => {
    // es-US emits "17 may 2026" (lowercase, day-first, no comma).
    expect(formatDate(REF_ISO, "es")).toBe("17 may 2026");
  });

  test("default 'medium' style · en-CA", () => {
    // en-CA → "May 17, 2026" — same shape as en-US.
    expect(formatDate(REF_ISO, "en-CA")).toBe("May 17, 2026");
  });

  test("default 'medium' style · fr-CA", () => {
    // fr-CA → "17 mai 2026" — day-first, French month name, no comma.
    expect(formatDate(REF_ISO, "fr")).toBe("17 mai 2026");
  });

  test("'short' style · day + month only", () => {
    expect(formatDate(REF_ISO, "en", { style: "short" })).toBe("May 17");
    expect(formatDate(REF_ISO, "fr", { style: "short" })).toBe("17 mai");
  });

  test("'long' style · spelled-out month", () => {
    expect(formatDate(REF_ISO, "en", { style: "long" })).toBe("May 17, 2026");
    expect(formatDate(REF_ISO, "fr", { style: "long" })).toBe("17 mai 2026");
  });

  test("accepts Date instance and epoch ms", () => {
    const d = new Date(REF_ISO);
    expect(formatDate(d, "en", { style: "short" })).toBe("May 17");
    expect(formatDate(d.getTime(), "en", { style: "short" })).toBe("May 17");
  });

  test("renders fallback for null/invalid input", () => {
    expect(formatDate(null, "en")).toBe("—");
    expect(formatDate(undefined, "en")).toBe("—");
    expect(formatDate("not a date", "en")).toBe("—");
    expect(formatDate(null, "en", { fallback: "n/a" })).toBe("n/a");
  });

  test("explicit options override 'style' · datetime with UTC tz pin", () => {
    // Force UTC time-of-day so test passes in any timezone.
    expect(
      formatDate(REF_ISO, "en", {
        options: {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "UTC",
        },
      }),
    ).toBe("May 17, 2026, 14:30");
  });
});

/* ------------------------------------------------------------------------ */
/* Relative time                                                             */
/* ------------------------------------------------------------------------ */

const NOW = new Date("2026-05-17T14:30:00Z");

describe("formatRelativeTime", () => {
  test("en-US · past · seconds through days", () => {
    expect(
      formatRelativeTime(new Date(NOW.getTime() - 30_000), "en", { now: NOW }),
    ).toBe("30 seconds ago");
    expect(
      formatRelativeTime(new Date(NOW.getTime() - 2 * 60_000), "en", {
        now: NOW,
      }),
    ).toBe("2 minutes ago");
    expect(
      formatRelativeTime(new Date(NOW.getTime() - 3 * 3_600_000), "en", {
        now: NOW,
      }),
    ).toBe("3 hours ago");
  });

  test("en-US · 'auto' renders natural phrasing for 1d / 1w", () => {
    expect(
      formatRelativeTime(new Date(NOW.getTime() - 86_400_000), "en", {
        now: NOW,
      }),
    ).toBe("yesterday");
    expect(
      formatRelativeTime(new Date(NOW.getTime() - 7 * 86_400_000), "en", {
        now: NOW,
      }),
    ).toBe("last week");
  });

  test("fr-CA · past · French phrasing", () => {
    expect(
      formatRelativeTime(new Date(NOW.getTime() - 2 * 3_600_000), "fr", {
        now: NOW,
      }),
    ).toBe("il y a 2 heures");
    expect(
      formatRelativeTime(new Date(NOW.getTime() - 86_400_000), "fr", {
        now: NOW,
      }),
    ).toBe("hier");
  });

  test("'always' numeric forces unit phrasing", () => {
    expect(
      formatRelativeTime(new Date(NOW.getTime() - 86_400_000), "en", {
        now: NOW,
        numeric: "always",
      }),
    ).toBe("1 day ago");
  });

  test("future tense renders correctly", () => {
    expect(
      formatRelativeTime(new Date(NOW.getTime() + 2 * 3_600_000), "en", {
        now: NOW,
      }),
    ).toBe("in 2 hours");
    expect(
      formatRelativeTime(new Date(NOW.getTime() + 2 * 3_600_000), "fr", {
        now: NOW,
      }),
    ).toBe("dans 2 heures");
  });

  test("renders fallback for null/invalid", () => {
    expect(formatRelativeTime(null, "en", { now: NOW })).toBe("—");
    expect(formatRelativeTime("not a date", "en", { now: NOW })).toBe("—");
  });
});
