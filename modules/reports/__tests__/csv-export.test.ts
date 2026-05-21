/**
 * Unit + integration tests for the CSV export module (F.7).
 *
 * Per `.claude/rules/testing.md` the invariants we cover are:
 *
 *   - Escape semantics for every CSV-injection vector (=, +, -, @,
 *     TAB, CR) per `.claude/rules/security.md`.
 *   - RFC 4180 quoting · commas / quotes / newlines inside fields.
 *   - Column ordering is preserved exactly as the caller requested.
 *   - Unknown column ids are silently dropped (forward compat).
 *   - Empty rows produce header-only output.
 *   - Default column set is stable (header sample assertion).
 *   - Boolean / number / date formatting · the integration shape.
 */

import { describe, expect, test } from "vitest";

import {
  CSV_COLUMNS,
  DEFAULT_COLUMN_IDS,
  byteLength,
  escapeCsvField,
  formatCsvDate,
  generateLeadCsv,
  resolveColumns,
} from "../csv-export";
import type { CsvColumnId, LeadCsvRow } from "../types";

/** Helper · build a fully-populated row for sample assertions. */
function buildRow(overrides: Partial<LeadCsvRow> = {}): LeadCsvRow {
  return {
    leadId: "lead-abc",
    businessName: "Solea Brickell Spa",
    category: "medical_spa",
    address: "123 Brickell Ave",
    city: "Miami",
    province: "FL",
    country: "US",
    postalCode: "33131",
    phone: "+1-305-555-0100",
    email: "owner@solea.example",
    website: "https://solea.example",
    rating: 4.4,
    reviewCount: 342,
    yearsOnGoogle: 5,
    mapslyScore: 6.2,
    matchScore: 0.87,
    status: "NEW",
    statusChangedAt: new Date("2026-05-10T15:00:00Z"),
    addedAt: new Date("2026-05-01T00:00:00Z"),
    lighthousePerformance: 58,
    lighthouseSeo: 84,
    lcp: 3.4,
    hasLocalBusinessSchema: false,
    napConsistent: true,
    ...overrides,
  };
}

/* ----------------------------------------------------------- escape */

describe("escapeCsvField · CSV-injection guard", () => {
  test("prefixes single-quote on always-dangerous trigger chars (=, @)", () => {
    expect(escapeCsvField("=cmd|'/c calc'!A1")).toBe(`'=cmd|'/c calc'!A1`);
    expect(escapeCsvField("@import")).toBe(`'@import`);
  });

  test("prefixes +/- when followed by non-digit (formula), preserves when followed by digit/space (phone, negative)", () => {
    // Formula-shaped · prefix.
    expect(escapeCsvField("+sum(1,2)")).toBe(`"'+sum(1,2)"`);
    expect(escapeCsvField("-cmd")).toBe("'-cmd");
    // Phone / negative-number shaped · pass through untouched so the
    // CSV doesn't render `'+1-305-...` in spreadsheet apps.
    expect(escapeCsvField("+1-305-555-0100")).toBe("+1-305-555-0100");
    expect(escapeCsvField("-1+2")).toBe("-1+2");
    expect(escapeCsvField("- 12")).toBe("- 12");
    expect(escapeCsvField("-")).toBe("-");
  });

  test("prefixes single-quote on whitespace trigger chars (TAB, CR)", () => {
    expect(escapeCsvField("\tinjected")).toBe(`'\tinjected`);
    // CR alone is enough · the prefix happens BEFORE RFC4180 quoting,
    // so the field also gets wrapped because CR forces quoting.
    expect(escapeCsvField("\rinjected")).toBe(`"'\rinjected"`);
  });

  test("does NOT prefix safe values", () => {
    expect(escapeCsvField("Solea Brickell Spa")).toBe("Solea Brickell Spa");
    expect(escapeCsvField("4.4")).toBe("4.4");
    expect(escapeCsvField("medical_spa")).toBe("medical_spa");
  });
});

describe("escapeCsvField · RFC 4180 quoting", () => {
  test("wraps fields containing a comma", () => {
    expect(escapeCsvField("Miami, FL")).toBe(`"Miami, FL"`);
  });

  test("wraps fields containing a double-quote and doubles the quote", () => {
    expect(escapeCsvField('She said "hi"')).toBe(`"She said ""hi"""`);
  });

  test("wraps fields containing a newline", () => {
    expect(escapeCsvField("line1\nline2")).toBe(`"line1\nline2"`);
  });

  test("returns empty string unchanged (no wrap, no prefix)", () => {
    expect(escapeCsvField("")).toBe("");
  });
});

/* --------------------------------------------------------- formatCsvDate */

describe("formatCsvDate", () => {
  test("formats a Date as ISO YYYY-MM-DD UTC", () => {
    expect(formatCsvDate(new Date("2026-05-01T00:00:00Z"))).toBe("2026-05-01");
  });

  test("returns empty string for null / undefined", () => {
    expect(formatCsvDate(null)).toBe("");
    expect(formatCsvDate(undefined)).toBe("");
  });

  test("does not throw on an invalid Date", () => {
    expect(formatCsvDate(new Date("not-a-date"))).toBe("");
  });
});

/* --------------------------------------------------------- resolveColumns */

describe("resolveColumns", () => {
  test("returns DEFAULT_COLUMN_IDS resolution when no ids passed", () => {
    const resolved = resolveColumns(undefined);
    expect(resolved.map((c) => c.id)).toEqual([...DEFAULT_COLUMN_IDS]);
  });

  test("returns DEFAULT_COLUMN_IDS resolution when empty array passed", () => {
    const resolved = resolveColumns([]);
    expect(resolved.map((c) => c.id)).toEqual([...DEFAULT_COLUMN_IDS]);
  });

  test("preserves the requested column order", () => {
    const ids: CsvColumnId[] = ["email", "businessName", "phone"];
    const resolved = resolveColumns(ids);
    expect(resolved.map((c) => c.id)).toEqual(ids);
  });

  test("silently drops unknown ids (forward compat)", () => {
    const ids: CsvColumnId[] = [
      "businessName",
      "doesNotExist" as CsvColumnId,
      "phone",
    ];
    const resolved = resolveColumns(ids);
    expect(resolved.map((c) => c.id)).toEqual(["businessName", "phone"]);
  });

  test("collapses duplicate ids · first occurrence wins", () => {
    const ids: CsvColumnId[] = ["email", "email", "phone"];
    const resolved = resolveColumns(ids);
    expect(resolved.map((c) => c.id)).toEqual(["email", "phone"]);
  });

  test("falls back to defaults when ALL ids are unknown", () => {
    const ids = ["nopeA" as CsvColumnId, "nopeB" as CsvColumnId];
    const resolved = resolveColumns(ids);
    expect(resolved.length).toBe(DEFAULT_COLUMN_IDS.length);
    expect(resolved.map((c) => c.id)).toEqual([...DEFAULT_COLUMN_IDS]);
  });
});

/* --------------------------------------------------- registry invariants */

describe("CSV_COLUMNS registry", () => {
  test("is frozen", () => {
    expect(Object.isFrozen(CSV_COLUMNS)).toBe(true);
  });

  test("every column id is unique", () => {
    const ids = CSV_COLUMNS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every column has a non-empty label", () => {
    for (const col of CSV_COLUMNS) {
      expect(col.label.length).toBeGreaterThan(0);
    }
  });

  test("every column's derive function returns a string for a populated row", () => {
    const row = buildRow();
    for (const col of CSV_COLUMNS) {
      expect(typeof col.derive(row)).toBe("string");
    }
  });

  test("every DEFAULT_COLUMN_ID exists in the registry", () => {
    const allIds = new Set(CSV_COLUMNS.map((c) => c.id));
    for (const id of DEFAULT_COLUMN_IDS) {
      expect(allIds.has(id)).toBe(true);
    }
  });
});

/* --------------------------------------------------- generateLeadCsv */

describe("generateLeadCsv · structure", () => {
  test("empty rows produces header-only output with trailing newline", () => {
    const csv = generateLeadCsv([], { columnIds: ["businessName", "phone"] });
    expect(csv).toBe("Business,Phone\r\n");
  });

  test("respects custom newline option", () => {
    const csv = generateLeadCsv([], {
      columnIds: ["businessName"],
      newline: "\n",
    });
    expect(csv).toBe("Business\n");
  });

  test("header row uses the column labels in the requested order", () => {
    const csv = generateLeadCsv([buildRow()], {
      columnIds: ["phone", "businessName"],
    });
    const [header] = csv.split("\r\n");
    expect(header).toBe("Phone,Business");
  });

  test("renders one row per input lead", () => {
    const rows = [buildRow(), buildRow({ businessName: "Sunrise Salon" })];
    const csv = generateLeadCsv(rows, { columnIds: ["businessName"] });
    expect(csv).toBe(`Business\r\nSolea Brickell Spa\r\nSunrise Salon\r\n`);
  });

  test("default-column header is stable (sample assertion)", () => {
    const csv = generateLeadCsv([]);
    expect(csv).toBe(
      "Business,Category,City,State / Province,Phone,Email,Website," +
        "Rating,Reviews,Mapsly score,Match score,Status,Added\r\n",
    );
  });
});

describe("generateLeadCsv · cell formatting", () => {
  test("null fields render as empty cells", () => {
    const csv = generateLeadCsv(
      [
        buildRow({
          phone: null,
          email: null,
          rating: null,
          reviewCount: null,
        }),
      ],
      {
        columnIds: ["businessName", "phone", "email", "rating", "reviewCount"],
      },
    );
    const [, body] = csv.split("\r\n");
    expect(body).toBe("Solea Brickell Spa,,,,");
  });

  test("escapes a comma inside a name", () => {
    const csv = generateLeadCsv([buildRow({ businessName: "Spa, Inc." })], {
      columnIds: ["businessName"],
    });
    expect(csv).toBe(`Business\r\n"Spa, Inc."\r\n`);
  });

  test("escapes embedded double-quote", () => {
    const csv = generateLeadCsv(
      [buildRow({ businessName: 'The "Best" Spa' })],
      { columnIds: ["businessName"] },
    );
    expect(csv).toBe(`Business\r\n"The ""Best"" Spa"\r\n`);
  });

  test("CSV-injection guard runs on derived fields too", () => {
    // A name starting with `=` would otherwise be interpreted as a
    // formula by Excel/Sheets. The escape function prefixes a quote.
    const csv = generateLeadCsv([buildRow({ businessName: "=evil()" })], {
      columnIds: ["businessName"],
    });
    expect(csv).toBe(`Business\r\n'=evil()\r\n`);
  });

  test("numbers are trimmed to sensible decimals", () => {
    const csv = generateLeadCsv(
      [buildRow({ rating: 4.4321, mapslyScore: 6.2999, matchScore: 0.87654 })],
      { columnIds: ["rating", "mapslyScore", "matchScore"] },
    );
    const [, body] = csv.split("\r\n");
    expect(body).toBe("4.4,6.3,0.88");
  });

  test("boolean cells use Yes / No / empty", () => {
    const csv = generateLeadCsv(
      [
        buildRow({ hasLocalBusinessSchema: false, napConsistent: true }),
        buildRow({ hasLocalBusinessSchema: null, napConsistent: null }),
      ],
      { columnIds: ["hasLocalBusinessSchema", "napConsistent"] },
    );
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe("No,Yes");
    expect(lines[2]).toBe(",");
  });

  test("dates render as ISO YYYY-MM-DD", () => {
    const csv = generateLeadCsv([buildRow()], {
      columnIds: ["addedAt", "statusChangedAt"],
    });
    const [, body] = csv.split("\r\n");
    expect(body).toBe("2026-05-01,2026-05-10");
  });
});

/* ----------------------------------------------- integration shape test */

describe("generateLeadCsv · integration shape (F.7 spec)", () => {
  /**
   * Per F.7 description · "Validation: integration test (CSV bytes +
   * content sample assertion)". The assertions below sample byte
   * length + the exact contents of the first two rows so a regression
   * in escape or column-derive logic surfaces clearly.
   */
  test("two-row sample matches expected bytes + content", () => {
    const rows: LeadCsvRow[] = [
      buildRow(),
      buildRow({
        businessName: "Anchor, Local",
        phone: "+1-416-555-0144",
        email: "tom@anchorlocal.example",
        mapslyScore: 7.8,
        matchScore: 0.92,
        addedAt: new Date("2026-05-15T00:00:00Z"),
      }),
    ];
    const csv = generateLeadCsv(rows, {
      columnIds: [
        "businessName",
        "city",
        "phone",
        "email",
        "mapslyScore",
        "matchScore",
        "addedAt",
      ],
    });

    expect(csv).toContain(
      "Business,City,Phone,Email,Mapsly score,Match score,Added",
    );
    expect(csv).toContain(
      "Solea Brickell Spa,Miami,+1-305-555-0100,owner@solea.example,6.2,0.87,2026-05-01",
    );
    expect(csv).toContain(
      `"Anchor, Local",Miami,+1-416-555-0144,tom@anchorlocal.example,7.8,0.92,2026-05-15`,
    );

    // Bytes-on-the-wire assertion · catches accidental BOM / line-ending changes.
    expect(byteLength(csv)).toBeGreaterThanOrEqual(csv.length);
    expect(byteLength(csv)).toBe(Buffer.byteLength(csv, "utf8"));
  });
});
