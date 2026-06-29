// Unit test for the GBP booking-link derivation (E10 · gbp_no_booking signal).
import { describe, expect, test } from "vitest";

import { gbpHasBookingFromLinks } from "../persist";

describe("gbpHasBookingFromLinks", () => {
  test("true when a reservation / appointment / booking link is present", () => {
    expect(gbpHasBookingFromLinks([{ type: "reservations", url: "x" }])).toBe(
      true,
    );
    expect(gbpHasBookingFromLinks([{ type: "APPOINTMENT" }])).toBe(true);
    expect(gbpHasBookingFromLinks([{ type: "book_online" }])).toBe(true);
    expect(
      gbpHasBookingFromLinks([{ type: "menu" }, { type: "reservation" }]),
    ).toBe(true);
  });

  test("false for menu/order-only, empty, or garbage input", () => {
    expect(gbpHasBookingFromLinks([{ type: "menu" }, { type: "order" }])).toBe(
      false,
    );
    expect(gbpHasBookingFromLinks([])).toBe(false);
    expect(gbpHasBookingFromLinks(null)).toBe(false);
    expect(gbpHasBookingFromLinks(undefined)).toBe(false);
    expect(gbpHasBookingFromLinks("nope")).toBe(false);
    expect(gbpHasBookingFromLinks([{ title: "no type field" }])).toBe(false);
  });
});
