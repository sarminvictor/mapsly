// Unit tests for legacyContactRows — the pure mapping that backfills a legacy
// Business's single-value contact fields into normalized Contact rows.

import { describe, expect, test } from "vitest";

import { legacyContactRows } from "../legacy-contacts";
import { normalizeEmail, normalizePhone } from "../reachability";

describe("legacyContactRows", () => {
  test("maps email + phone + instagram to the right channels", () => {
    const rows = legacyContactRows({
      email: "Hello@Spa.com",
      phone: "(305) 555-1234",
      instagramHandle: "@SoleaSpa",
    });
    const byChannel = Object.fromEntries(rows.map((r) => [r.channel, r]));

    expect(byChannel.EMAIL.normalizedValue).toBe(
      normalizeEmail("Hello@Spa.com"),
    );
    expect(byChannel.EMAIL.source).toBe("MANUAL");
    expect(byChannel.PHONE.normalizedValue).toBe(
      normalizePhone("(305) 555-1234"),
    );
    expect(byChannel.INSTAGRAM.normalizedValue).toBe("instagram.com/soleaspa");
  });

  test("pulls structured contactInfo entries", () => {
    const rows = legacyContactRows({
      contactInfo: [
        { type: "whatsapp", value: "+1 305 555 9000" },
        { type: "linkedin", value: "https://LinkedIn.com/in/Foo" },
        { type: "unknownthing", value: "skip me" },
      ],
    });
    const channels = rows.map((r) => r.channel).sort();
    expect(channels).toEqual(["LINKEDIN", "WHATSAPP"]);
  });

  test("de-dupes by channel + normalized value", () => {
    const rows = legacyContactRows({
      email: "hello@spa.com",
      contactInfo: [{ type: "email", value: "HELLO@spa.com" }],
    });
    expect(rows.filter((r) => r.channel === "EMAIL")).toHaveLength(1);
  });

  test("ignores empty / nullish fields", () => {
    expect(legacyContactRows({})).toEqual([]);
    expect(
      legacyContactRows({ email: null, phone: "", instagramHandle: "@" }),
    ).toEqual([]);
  });
});
