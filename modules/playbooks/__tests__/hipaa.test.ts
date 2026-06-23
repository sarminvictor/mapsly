/**
 * HIPAA tracking-pixel detector · golden tests
 *
 * Covers the co-location tiers (health + ad-pixel + booking → high; health +
 * GA4-only + booking → medium), the non-health and no-website guards, the
 * no-tracker / no-booking null paths, the contested-status note, and the
 * exposure-framing invariant on the explanation.
 */

import { describe, expect, test } from "vitest";
import { assertExposurePhrasing } from "../copy-lint";
import { runSignal } from "../driver";
import { hipaaPixelOnPhiPage } from "../signals/shared/hipaa";
import type { EvidenceBundle } from "../types";

type Tech = NonNullable<EvidenceBundle["tech"]>;

function bundle(
  tech: Tech | null,
  categorySlugs: string[] = ["med-spa"],
  website: string | null = "https://clinic.example",
): EvidenceBundle {
  return {
    business: {
      id: "b1",
      slug: "clinic",
      categorySlugs,
      website,
      services: [],
    },
    tech,
    lighthouseAudits: null,
    reviews: [],
  };
}

const META_PIXEL: Tech[number] = { name: "Meta Pixel", category: "pixel" };
const TIKTOK_PIXEL: Tech[number] = { name: "TikTok Pixel", category: "pixel" };
const GA4: Tech[number] = { name: "GA4", category: "analytics" };
const BOOKING: Tech[number] = { name: "Calendly", category: "booking" };

describe("hipaaPixelOnPhiPage · tiers", () => {
  test("health + Meta Pixel + booking → high (corroboration 2)", () => {
    const v = runSignal(hipaaPixelOnPhiPage, bundle([META_PIXEL, BOOKING]));
    expect(v?.value).toBe("high");
    expect(v?.confidence).toBe("high");
    expect(v?.corroborationCount).toBe(2);
    expect(v?.evidence.length).toBe(2);
  });

  test("health + TikTok Pixel + booking → high", () => {
    const v = runSignal(hipaaPixelOnPhiPage, bundle([TIKTOK_PIXEL, BOOKING]));
    expect(v?.value).toBe("high");
  });

  test("health + GA4-only + booking → medium", () => {
    const v = runSignal(hipaaPixelOnPhiPage, bundle([GA4, BOOKING]));
    expect(v?.value).toBe("medium");
    expect(v?.confidence).toBe("medium");
  });

  test("health + pixel but NO booking → null (no PHI surface)", () => {
    const v = runSignal(hipaaPixelOnPhiPage, bundle([META_PIXEL]));
    expect(v).toBeNull();
  });

  test("health + booking but NO tracker → null", () => {
    const v = runSignal(hipaaPixelOnPhiPage, bundle([BOOKING]));
    expect(v).toBeNull();
  });
});

describe("hipaaPixelOnPhiPage · guards", () => {
  test("non-health business → null", () => {
    const v = runSignal(
      hipaaPixelOnPhiPage,
      bundle([META_PIXEL, BOOKING], ["restaurant"]),
    );
    expect(v).toBeNull();
  });

  test("no website → null (not checked)", () => {
    const v = runSignal(
      hipaaPixelOnPhiPage,
      bundle([META_PIXEL, BOOKING], ["med-spa"], null),
    );
    expect(v).toBeNull();
  });

  test("tech enrichment missing (null) → null", () => {
    const v = runSignal(hipaaPixelOnPhiPage, bundle(null));
    expect(v).toBeNull();
  });
});

describe("hipaaPixelOnPhiPage · copy", () => {
  test("explanation passes assertExposurePhrasing and notes contested status", () => {
    const v = runSignal(hipaaPixelOnPhiPage, bundle([META_PIXEL, BOOKING]));
    expect(v).not.toBeNull();
    expect(() => assertExposurePhrasing(v!.explanation)).not.toThrow();
    expect(v!.explanation.toLowerCase()).toContain("contested");
  });

  test("regulationRefs flag the AHA v. HHS contestation", () => {
    const refs = hipaaPixelOnPhiPage.regulationRefs.join(" ");
    expect(refs).toContain("AHA v. HHS");
    expect(refs.toUpperCase()).toContain("CONTESTED");
  });
});
