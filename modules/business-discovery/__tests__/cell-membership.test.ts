/**
 * Cell membership · the geo bounding-box definition.
 *
 * Pins the fix for the Miami qualify blind spot (2026-06-11): a 10km
 * Miami cell discovered 100 businesses, 37 of them Google-labelled
 * Coral Gables / Miami Beach / Key Biscayne — the old exact-city match
 * made them permanently invisible to Qualify. Membership must match
 * the same geometry discovery searched.
 */

import { describe, expect, test } from "vitest";

import { boundingBoxForCell, cellMembershipWhere } from "../cell-membership";

// The real Miami cell: (25.7617, -80.1918) r=10km.
const MIAMI = { lat: 25.7617, lng: -80.1918, radiusKm: 10 };

describe("boundingBoxForCell", () => {
  test("box contains the radius circle around the Miami cell", () => {
    const box = boundingBoxForCell(MIAMI);
    // 10km ≈ 0.0898° of latitude.
    expect(box.latMax - box.latMin).toBeCloseTo(0.1797, 3);
    // Longitude degrees are narrower at 25.76°N → wider degree span.
    expect(box.lngMax - box.lngMin).toBeGreaterThan(box.latMax - box.latMin);
    expect(box.latMin).toBeLessThan(MIAMI.lat);
    expect(box.latMax).toBeGreaterThan(MIAMI.lat);
  });

  test("the Coral Gables / Miami Beach businesses fall inside the box", () => {
    const box = boundingBoxForCell(MIAMI);
    const coralGables = { lat: 25.7215, lng: -80.2684 };
    const miamiBeach = { lat: 25.7907, lng: -80.13 };
    for (const p of [coralGables, miamiBeach]) {
      expect(p.lat).toBeGreaterThanOrEqual(box.latMin);
      expect(p.lat).toBeLessThanOrEqual(box.latMax);
      expect(p.lng).toBeGreaterThanOrEqual(box.lngMin);
      expect(p.lng).toBeLessThanOrEqual(box.lngMax);
    }
  });

  test("Fort Lauderdale (~40km north) stays outside", () => {
    const box = boundingBoxForCell(MIAMI);
    expect(26.1224).toBeGreaterThan(box.latMax);
  });

  test("clamps at poles / antimeridian instead of inverting", () => {
    const box = boundingBoxForCell({ lat: 89.99, lng: 179.99, radiusKm: 50 });
    expect(box.latMax).toBeLessThanOrEqual(90);
    expect(box.lngMax).toBeLessThanOrEqual(180);
    expect(box.latMin).toBeLessThanOrEqual(box.latMax);
    expect(box.lngMin).toBeLessThanOrEqual(box.lngMax);
  });
});

describe("cellMembershipWhere", () => {
  const where = cellMembershipWhere({
    dataforseoCategoryId: "medical_spa",
    ...MIAMI,
    city: "Miami",
    country: "US",
  });

  test("matches by category slug + geo box, with city fallback ONLY for null-coordinate rows", () => {
    expect(where.categoryIds).toEqual({ has: "medical_spa" });
    const [geo, fallback] = where.OR as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(geo.lat).toMatchObject({});
    expect(fallback).toEqual({ lat: null, city: "Miami", country: "US" });
  });

  test("does NOT contain a bare top-level city equality (the old blind-spot shape)", () => {
    expect("city" in where).toBe(false);
  });
});
