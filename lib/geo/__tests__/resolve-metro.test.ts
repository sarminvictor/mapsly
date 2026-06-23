// Phase 1 · metro consolidation must collapse sub-cities/neighborhoods into ONE
// parent metro, keep genuinely-separate metros separate, and stamp lat/lng to
// the nearest owning anchor.

import { describe, expect, test } from "vitest";
import {
  resolveMetro,
  nearestMetro,
  haversineKm,
  metroBySlug,
  normalizePlace,
} from "../resolve-metro";
import { radiusKmForMetro } from "../us-metros";

describe("resolveMetro — alias collapse", () => {
  test("Miami sub-areas collapse to one metro", () => {
    for (const q of [
      "Miami",
      "miami, fl",
      "Miami Beach",
      "Brickell",
      "Coral Gables",
      "Hialeah",
      "South Beach",
      "Wynwood",
    ]) {
      expect(resolveMetro(q)?.slug, q).toBe("miami");
    }
  });

  test("genuinely separate metros stay separate", () => {
    expect(resolveMetro("Fort Lauderdale")?.slug).toBe("fort-lauderdale");
    expect(resolveMetro("Hollywood FL")?.slug).toBe("fort-lauderdale");
    expect(resolveMetro("Hollywood")?.slug).toBe("los-angeles"); // LA neighborhood
  });

  test("suburbs map to their metro", () => {
    expect(resolveMetro("Scottsdale")?.slug).toBe("phoenix");
    expect(resolveMetro("Cambridge")?.slug).toBe("boston");
    expect(resolveMetro("St. Petersburg")?.slug).toBe("tampa");
    expect(resolveMetro("Saint Paul")?.slug).toBe("minneapolis");
    expect(resolveMetro("Cupertino")?.slug).toBe("san-jose");
    expect(resolveMetro("Austin Texas")?.slug).toBe("austin");
  });

  test("unknown place returns null", () => {
    expect(resolveMetro("Atlantis")).toBeNull();
    expect(resolveMetro("")).toBeNull();
  });

  test("normalizePlace is punctuation/case insensitive", () => {
    expect(normalizePlace("  St.  Petersburg! ")).toBe("st petersburg");
  });
});

describe("nearestMetro — owning-anchor stamping", () => {
  test("downtown Miami stamps to miami", () => {
    const r = nearestMetro(25.77, -80.19);
    expect(r?.metro.slug).toBe("miami");
    expect(r!.distanceKm).toBeLessThan(2);
  });

  test("a point far from any metro returns null", () => {
    // Middle of Nevada desert
    expect(nearestMetro(39.5, -117.0)).toBeNull();
  });

  test("radius is derived from tier (LARGE = 30km)", () => {
    expect(radiusKmForMetro(metroBySlug("miami")!)).toBe(30);
    expect(radiusKmForMetro(metroBySlug("new-york")!)).toBe(40); // MEGA
  });
});

describe("haversineKm", () => {
  test("zero distance for identical points", () => {
    expect(haversineKm(25.77, -80.19, 25.77, -80.19)).toBeCloseTo(0, 5);
  });
  test("Miami → Fort Lauderdale is ~40km", () => {
    const d = haversineKm(25.7617, -80.1918, 26.1224, -80.1373);
    expect(d).toBeGreaterThan(35);
    expect(d).toBeLessThan(45);
  });
});
