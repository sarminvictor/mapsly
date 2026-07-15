/**
 * canonical constants + helpers · invariant tests.
 */

import { describe, expect, test } from "vitest";
import {
  CANONICAL_ORIGIN,
  MARKETING_LAST_MODIFIED,
  absoluteUrl,
} from "../canonical";

describe("CANONICAL_ORIGIN", () => {
  test("is the production origin with HTTPS + no trailing slash", () => {
    expect(CANONICAL_ORIGIN).toBe("https://www.mapsly.ai");
    expect(CANONICAL_ORIGIN.endsWith("/")).toBe(false);
  });

  // The invariant that actually matters: production serves `www` and the apex
  // 307s to it, so an apex origin aims every canonical/hreflang/sitemap URL we
  // emit at a redirect. Google requires the canonical to be the final URL.
  test("is the host that answers 200 — never the redirecting apex", () => {
    expect(CANONICAL_ORIGIN).not.toBe("https://mapsly.ai");
    expect(new URL(CANONICAL_ORIGIN).hostname).toBe("www.mapsly.ai");
  });
});

describe("MARKETING_LAST_MODIFIED", () => {
  test("is a valid ISO 8601 UTC timestamp", () => {
    // Must end with 'Z' and parse to a real Date
    expect(MARKETING_LAST_MODIFIED).toMatch(/Z$/);
    const d = new Date(MARKETING_LAST_MODIFIED);
    expect(Number.isNaN(d.getTime())).toBe(false);
  });

  test("is in the past or present (sanity)", () => {
    // Sanity: not set to year 9999 by accident. Permissively bounded.
    const lastMod = new Date(MARKETING_LAST_MODIFIED).getTime();
    const farFuture = new Date("2050-01-01T00:00:00.000Z").getTime();
    expect(lastMod).toBeLessThan(farFuture);
  });
});

describe("absoluteUrl", () => {
  test("prefixes path with canonical origin", () => {
    expect(absoluteUrl("/")).toBe(`${CANONICAL_ORIGIN}/`);
    expect(absoluteUrl("/for-agencies")).toBe(
      `${CANONICAL_ORIGIN}/for-agencies`,
    );
    expect(absoluteUrl("/es/para-agencias")).toBe(
      `${CANONICAL_ORIGIN}/es/para-agencias`,
    );
  });

  test("throws when path lacks leading slash", () => {
    expect(() => absoluteUrl("for-agencies")).toThrow();
    expect(() => absoluteUrl("")).toThrow();
  });
});
