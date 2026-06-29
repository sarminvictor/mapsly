/**
 * Unit tests for the pure createMany row-builders in enrich-contacts.ts.
 *
 * These replaced the N+1 per-row upsert/find loops with batched createMany
 * payloads. We test the PURE builders (no DB) for the invariants that matter:
 *   - isPrimary is set on the FIRST contact per channel only.
 *   - same-scan duplicates (channel + normalizedValue) collapse.
 *   - tech rows de-dupe by name and stamp a single detectedAt.
 *
 * The full orchestrator (free-fetch-first + $transaction batched write) is an
 * integration surface validated against a Neon test branch in CI; here we lock
 * the row-shaping logic that feeds it.
 */

import { describe, expect, test } from "vitest";
import type { ParsedContact } from "@/services/contact-scraper";
import type { DetectedTech } from "@/services/tech-fingerprint/fingerprint";
import { __test } from "../enrich-contacts";

const { buildContactCreateRows, buildTechCreateRows } = __test;

const NOW = new Date("2026-06-25T12:00:00.000Z");

/** Typed ParsedContact fixture (avoids `as any` in the builder calls). */
function contact(
  channel: ParsedContact["channel"],
  normalizedValue: string,
  confidence = 90,
): ParsedContact {
  return {
    channel,
    value: normalizedValue,
    normalizedValue,
    role: "UNKNOWN",
    source: "SCRAPE_HOMEPAGE",
    confidence,
  };
}

/** Typed DetectedTech fixture. */
function tech(name: string, category: DetectedTech["category"]): DetectedTech {
  return { name, category, confidence: 0.9, source: "self-fingerprint" };
}

describe("buildContactCreateRows", () => {
  test("marks the first contact per channel isPrimary", () => {
    const rows = buildContactCreateRows(
      "biz1",
      [
        contact("EMAIL", "a@x.com"),
        contact("EMAIL", "b@x.com"),
        contact("PHONE", "+13055551212"),
      ],
      NOW,
    );

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ channel: "EMAIL", isPrimary: true });
    expect(rows[1]).toMatchObject({ channel: "EMAIL", isPrimary: false });
    expect(rows[2]).toMatchObject({ channel: "PHONE", isPrimary: true });
    // Stamps share the injected `now`.
    expect(rows[0].firstSeenAt).toBe(NOW);
    expect(rows[0].lastSeenAt).toBe(NOW);
    expect(rows[0].businessId).toBe("biz1");
  });

  test("collapses same-scan duplicates (channel + normalizedValue)", () => {
    const rows = buildContactCreateRows(
      "biz1",
      [
        contact("INSTAGRAM", "instagram.com/spa"),
        contact("INSTAGRAM", "instagram.com/spa"),
      ],
      NOW,
    );
    expect(rows).toHaveLength(1);
  });

  test("rounds confidence to an integer", () => {
    const rows = buildContactCreateRows(
      "biz1",
      [contact("EMAIL", "a@x.com", 89.6)],
      NOW,
    );
    expect(rows[0].confidence).toBe(90);
  });

  test("empty input → no rows", () => {
    expect(buildContactCreateRows("biz1", [], NOW)).toEqual([]);
  });
});

describe("buildTechCreateRows", () => {
  test("de-dupes by name and stamps a single detectedAt", () => {
    const rows = buildTechCreateRows(
      "biz1",
      [
        tech("WordPress", "CMS"),
        tech("WordPress", "CMS"),
        tech("Cloudflare", "CDN"),
      ],
      NOW,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.name)).toEqual(["WordPress", "Cloudflare"]);
    expect(rows[0].detectedAt).toBe(NOW);
    expect(rows[0].businessId).toBe("biz1");
  });

  test("empty input → no rows", () => {
    expect(buildTechCreateRows("biz1", [], NOW)).toEqual([]);
  });
});
