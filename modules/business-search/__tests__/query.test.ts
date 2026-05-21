/**
 * Business-search · unit tests (F.11).
 *
 * Two surfaces under test:
 *
 *   1. `normalizeWebsiteToken` — pure function. URL → host extraction
 *      that the `Business.website` `contains` clause needs.
 *
 *   2. `searchBusinesses` — exercises the Prisma boundary. We mock
 *      `@/lib/prisma` so the test runs without a Neon connection (the
 *      Prisma generated client is also not always available in the
 *      sandbox; per `vitest.config.ts`, tests that touch
 *      `@/lib/prisma` MUST mock it).
 *
 * Per `.claude/rules/testing.md`, we test invariants — short queries
 * skip the DB, the where clause shape is correct, results pass through
 * unchanged, and Prisma failures degrade to `[]` (we never throw to
 * the route handler).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---------------------------------------------------------------------------
// Prisma mock · must be hoisted before importing the module under test.
// ---------------------------------------------------------------------------

const findManyMock = vi.fn();

vi.mock("@/lib/prisma", () => ({
  default: {
    business: {
      findMany: (...args: unknown[]) => findManyMock(...args),
    },
  },
}));

// Import AFTER the mock is registered.
import { normalizeWebsiteToken, searchBusinesses } from "../query";
import { MAX_MATCHES } from "../types";

// ---------------------------------------------------------------------------
// normalizeWebsiteToken
// ---------------------------------------------------------------------------

describe("normalizeWebsiteToken", () => {
  test("strips https scheme + www + path", () => {
    expect(normalizeWebsiteToken("https://www.solea-spa.com/treatments")).toBe(
      "solea-spa.com",
    );
  });

  test("strips http scheme", () => {
    expect(normalizeWebsiteToken("http://example.io/")).toBe("example.io");
  });

  test("handles bare host with path", () => {
    expect(normalizeWebsiteToken("foo.bar.com/a/b")).toBe("foo.bar.com");
  });

  test("lowercases and trims plain text", () => {
    expect(normalizeWebsiteToken("  Solea Spa  ")).toBe("solea spa");
  });

  test("empty string returns empty", () => {
    expect(normalizeWebsiteToken("")).toBe("");
    expect(normalizeWebsiteToken("   ")).toBe("");
  });

  test("strips query + hash", () => {
    expect(normalizeWebsiteToken("https://example.com?a=1#b")).toBe(
      "example.com",
    );
  });

  test("strips trailing punctuation", () => {
    expect(normalizeWebsiteToken("https://example.com.")).toBe("example.com");
  });
});

// ---------------------------------------------------------------------------
// searchBusinesses
// ---------------------------------------------------------------------------

describe("searchBusinesses", () => {
  beforeEach(() => {
    findManyMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns [] without touching Prisma for queries < 2 chars", async () => {
    const out = await searchBusinesses("a");
    expect(out).toEqual([]);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  test("returns [] for whitespace-only input", async () => {
    const out = await searchBusinesses("   ");
    expect(out).toEqual([]);
    expect(findManyMock).not.toHaveBeenCalled();
  });

  test("issues a findMany with the documented where shape", async () => {
    findManyMock.mockResolvedValue([]);
    await searchBusinesses("solea");

    expect(findManyMock).toHaveBeenCalledTimes(1);
    const arg = findManyMock.mock.calls[0][0] as Record<string, unknown>;

    // `take` is bounded to MAX_MATCHES.
    expect(arg.take).toBe(MAX_MATCHES);

    // `select` only includes picker-rendered fields — no broad include
    // (INC-37 prevention).
    expect(arg.select).toEqual({
      id: true,
      slug: true,
      name: true,
      city: true,
      category: true,
      website: true,
    });

    // Where clause filters to active rows + ORs across the 4 documented
    // columns; website OR uses the host-token (no scheme/path).
    const where = arg.where as { isActive: boolean; OR: unknown[] };
    expect(where.isActive).toBe(true);
    expect(Array.isArray(where.OR)).toBe(true);
    expect(where.OR).toHaveLength(4);
    const fieldNames = (where.OR as Array<Record<string, unknown>>).map(
      (clause) => Object.keys(clause)[0],
    );
    expect(fieldNames.sort()).toEqual(
      ["city", "name", "slug", "website"].sort(),
    );

    // Order: review count desc, then id asc (stable tiebreaker).
    expect(arg.orderBy).toEqual([{ reviewCount: "desc" }, { id: "asc" }]);
  });

  test("URL-shaped query uses host-only token for the website clause", async () => {
    findManyMock.mockResolvedValue([]);
    await searchBusinesses("https://www.solea-spa.com/x");

    const arg = findManyMock.mock.calls[0][0] as {
      where: { OR: Array<Record<string, { contains: string }>> };
    };
    const websiteClause = arg.where.OR.find(
      (c) => Object.keys(c)[0] === "website",
    );
    expect(websiteClause).toBeDefined();
    expect(websiteClause!.website.contains).toBe("solea-spa.com");
  });

  test("passes Prisma rows through unchanged", async () => {
    const rows = [
      {
        id: "biz_1",
        slug: "solea-spa",
        name: "Solea Spa",
        city: "Miami",
        category: "medical_spa",
        website: "https://solea-spa.com",
      },
      {
        id: "biz_2",
        slug: "glow-rx",
        name: "Glow RX",
        city: "Brickell",
        category: "medical_spa",
        website: null,
      },
    ];
    findManyMock.mockResolvedValue(rows);

    const out = await searchBusinesses("spa");
    expect(out).toEqual(rows);
  });

  test("degrades to [] when Prisma throws", async () => {
    findManyMock.mockRejectedValue(new Error("Neon WebSocket closed"));
    const out = await searchBusinesses("anything");
    expect(out).toEqual([]);
  });
});
