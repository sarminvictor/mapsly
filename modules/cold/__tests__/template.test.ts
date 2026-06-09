import { describe, expect, test } from "vitest";

import { buildFooter, renderTemplate } from "../template";

describe("renderTemplate", () => {
  const tokens = {
    businessName: "Acme",
    city: "Miami",
    unansweredCount: "6",
    rating: "",
  };

  test("substitutes tokens", () => {
    expect(renderTemplate("Hi {{businessName}} in {{city}}", tokens)).toBe(
      "Hi Acme in Miami",
    );
  });

  test("{{#if}} shows on truthy, hides on empty/zero/missing", () => {
    expect(
      renderTemplate(
        "{{#if unansweredCount}}{{unansweredCount}} reviews{{/if}}",
        tokens,
      ),
    ).toBe("6 reviews");
    expect(renderTemplate("{{#if rating}}{{rating}}★{{/if}}", tokens)).toBe("");
    expect(renderTemplate("{{#if missing}}x{{/if}}", tokens)).toBe("");
    expect(renderTemplate("{{#if zero}}x{{/if}}", { zero: "0" })).toBe("");
  });

  test("{{#unless}} is the inverse", () => {
    expect(
      renderTemplate("{{#unless rating}}no rating{{/unless}}", tokens),
    ).toBe("no rating");
    expect(renderTemplate("{{#unless businessName}}x{{/unless}}", tokens)).toBe(
      "",
    );
  });

  test("missing token renders empty", () => {
    expect(renderTemplate("a{{nope}}b", tokens)).toBe("ab");
  });
});

describe("buildFooter", () => {
  test("includes address + unsubscribe link", () => {
    const f = buildFooter("Mapsly, 1 Main St", "https://mapsly.ai/u/abc.def");
    expect(f).toContain("Mapsly, 1 Main St");
    expect(f).toContain("https://mapsly.ai/u/abc.def");
    expect(f).toContain("Unsubscribe");
  });

  test("omits address line when blank", () => {
    const f = buildFooter("", "https://x/u/t");
    expect(f).toContain("https://x/u/t");
    expect(f).toContain("Mapsly");
    expect(f).not.toContain("Mapsly\n\n"); // no empty address line
  });
});
